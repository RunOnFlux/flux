const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const chai = require('chai');
const sinon = require('sinon');

const upnpd = require('../../ZelBack/src/services/upnpd');

const { expect } = chai;

/**
 * A stand-in flux-upnpd on a socket in `dir`, answering as flux-upnpd does: /events starts with
 * the state and stays open, /map answers a ticket, /desired an empty object. What it was asked is
 * kept in order.
 */
function standIn(dir) {
  const fake = {
    requests: [],
    desired: [],
    maps: [],
    streams: [],
    state: {
      identity: 'tx:0', upnp: true, apiPort: 16127, mapping: true, mappings: [],
    },
    nextTicket: 1,
    // a stream opened gives no state, as a flux-upnpd still starting
    withholdState: false,
    // called with the ticket of each /map; the answer waits for what it returns
    onMap: null,
    send(event) {
      fake.streams.forEach((stream) => stream.write(`${JSON.stringify(event)}\n`));
    },
    // ends every stream, as flux-upnpd cutting off a reader does
    cut() {
      fake.streams.splice(0).forEach((stream) => stream.end());
    },
  };
  fake.server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      fake.requests.push(`${req.method} ${req.url}`);
      if (req.method === 'GET' && req.url === '/events') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        if (!fake.withholdState) res.write(`${JSON.stringify({ type: 'state', ...fake.state })}\n`);
        fake.streams.push(res);
        return;
      }
      if (req.method === 'PUT' && req.url === '/desired') {
        fake.desired.push(JSON.parse(body).ports);
        res.end('{}');
        return;
      }
      if (req.method === 'POST' && req.url === '/map') {
        const ticket = fake.nextTicket;
        fake.nextTicket += 1;
        fake.maps.push({ ticket, ...JSON.parse(body) });
        Promise.resolve(fake.onMap?.(ticket)).then(() => res.end(JSON.stringify({ ticket })));
        return;
      }
      res.statusCode = 404;
      res.end('{"error":"no such resource"}');
    });
  });
  fake.listen = () => new Promise((resolve) => { fake.server.listen(path.join(dir, 'api.sock'), resolve); });
  fake.close = () => new Promise((resolve) => {
    fake.server.closeAllConnections();
    fake.server.close(() => resolve());
  });
  return fake;
}

/** Resolves once `condition` holds, looked at as each pending I/O settles. */
async function until(condition, label) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setImmediate(resolve); });
  }
}

describe('upnpd tests', () => {
  let root;
  let dir;
  let socket;
  let fake;
  let desired;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'upnpd-'));
    dir = path.join(root, 'flux-upnpd');
    fs.mkdirSync(dir);
    socket = path.join(dir, 'api.sock');
    fake = standIn(dir);
    desired = [];
  });

  afterEach(async () => {
    upnpd.stop();
    await fake.close();
    fs.rmSync(root, { recursive: true, force: true });
    sinon.restore();
  });

  const start = () => upnpd.start({ socket, desired: () => desired });

  describe('connection tests', () => {
    afterEach(() => {
      delete process.env.FLUXUPNPD_CONNECTION;
    });

    it('should name the socket FLUXUPNPD_CONNECTION names', () => {
      process.env.FLUXUPNPD_CONNECTION = 'unix:///run/flux-upnpd/api.sock';
      expect(upnpd.connection()).to.equal('/run/flux-upnpd/api.sock');
    });

    it('should name none without it', () => {
      expect(upnpd.connection()).to.equal(null);
    });

    it('should refuse a connection that is not a socket', () => {
      process.env.FLUXUPNPD_CONNECTION = 'http://127.0.0.1:1234';
      expect(() => upnpd.connection()).to.throw('FLUXUPNPD_CONNECTION must be unix:///<socket path>');
    });
  });

  describe('map tests', () => {
    it('should answer a map with its ticket\'s mapped', async () => {
      await fake.listen();
      expect(await start()).to.equal(true);
      fake.onMap = (ticket) => setImmediate(() => fake.send({
        type: 'mapped', ticket, port: 31000, ok: true,
      }));
      const result = await upnpd.map(31000, 'Flux_App_example1', ['tcp', 'udp']);
      expect(result).to.deep.equal({ ok: true });
      expect(fake.maps).to.deep.equal([{
        ticket: 1, port: 31000, description: 'Flux_App_example1', protocols: ['tcp', 'udp'],
      }]);
    });

    it('should answer a failed map with its structured failure', async () => {
      await fake.listen();
      await start();
      fake.onMap = (ticket) => setImmediate(() => fake.send({
        type: 'mapped', ticket, port: 31000, ok: false, protocol: 'udp', failure: 'held', holder: '192.168.1.50',
      }));
      const result = await upnpd.map(31000, 'Flux_App_example1', ['tcp', 'udp']);
      expect(result).to.deep.equal({
        ok: false, protocol: 'udp', failure: 'held', holder: '192.168.1.50', reason: null,
      });
    });

    it('should answer a map whose mapped arrives before its ticket', async () => {
      await fake.listen();
      await start();
      // the ticket is answered once the stream has been read past its mapped
      fake.onMap = (ticket) => {
        const read = new Promise((resolve) => { upnpd.events.once('mappingState', resolve); });
        fake.send({
          type: 'mapped', ticket, port: 31000, ok: false, protocol: 'tcp', failure: 'refused', reason: 'ConflictInMappingEntry',
        });
        fake.send({
          type: 'mappingState', port: 31000, protocol: 'tcp', state: 'failing', failure: 'refused', reason: 'ConflictInMappingEntry',
        });
        return read;
      };
      const result = await upnpd.map(31000, 'Flux_App_example1', ['tcp']);
      expect(result).to.include({ ok: false, failure: 'refused', reason: 'ConflictInMappingEntry' });
    });

    it('should answer a map with no flux-upnpd running as stopped, asking nothing', async () => {
      expect(await start()).to.equal(false);
      const result = await upnpd.map(31000, 'Flux_App_example1', ['tcp']);
      expect(result).to.include({ ok: false, failure: 'stopped' });
      expect(fake.requests).to.deep.equal([]);
    });

    it('should answer a map as stopped when the stream ends before its mapped', async () => {
      await fake.listen();
      await start();
      const mapping = upnpd.map(31000, 'Flux_App_example1', ['tcp']);
      await until(() => fake.maps.length === 1, 'the map');
      fake.cut();
      expect(await mapping).to.include({ ok: false, failure: 'stopped' });
    });
  });

  describe('desired tests', () => {
    it('should send no set until boot has declared every port', async () => {
      await fake.listen();
      await start();
      desired = [{ port: 31000, description: 'Flux_App_example1', protocols: ['tcp', 'udp'] }];
      await upnpd.desiredChanged();
      expect(fake.desired).to.deep.equal([]);
      await upnpd.openDesired();
      expect(fake.desired).to.deep.equal([desired]);
    });

    it('should read the set as it is sent', async () => {
      await fake.listen();
      await start();
      await upnpd.openDesired();
      desired = [{ port: 31000, description: 'Flux_App_example1', protocols: ['tcp'] }];
      const first = upnpd.desiredChanged();
      desired = [{ port: 31001, description: 'Flux_App_example2', protocols: ['tcp'] }];
      const second = upnpd.desiredChanged();
      await Promise.all([first, second]);
      expect(fake.desired).to.deep.equal([[], [{ port: 31001, description: 'Flux_App_example2', protocols: ['tcp'] }]]);
    });

    it('should send a set asked after a map only once the map has gone', async () => {
      await fake.listen();
      await start();
      await upnpd.openDesired();
      fake.onMap = (ticket) => setImmediate(() => fake.send({
        type: 'mapped', ticket, port: 31000, ok: true,
      }));
      const mapping = upnpd.map(31000, 'Flux_App_example1', ['tcp']);
      const sending = upnpd.desiredChanged();
      await Promise.all([mapping, sending]);
      expect(fake.requests.slice(-2)).to.deep.equal(['POST /map', 'PUT /desired']);
    });

    it('should send the set again on each new stream', async () => {
      await fake.listen();
      await start();
      desired = [{ port: 31000, description: 'Flux_App_example1', protocols: ['tcp', 'udp'] }];
      await upnpd.openDesired();
      fake.cut();
      await until(() => fake.desired.length === 2, 'the set sent on the new stream');
      expect(fake.requests.filter((request) => request === 'GET /events')).to.have.length(2);
      expect(fake.desired[1]).to.deep.equal(desired);
    });

    it('should open the stream once flux-upnpd\'s socket appears', async () => {
      expect(await start()).to.equal(false);
      await fake.listen();
      await until(() => fake.streams.length === 1, 'the stream on the new socket');
    });

    it('should open the stream once flux-upnpd\'s directory comes back with its socket', async () => {
      fs.rmSync(dir, { recursive: true });
      expect(await start()).to.equal(false);
      // flux-upnpd listening in a directory of its own, moved into place whole
      const elsewhere = path.join(root, 'elsewhere');
      fs.mkdirSync(elsewhere);
      fake = standIn(elsewhere);
      await fake.listen();
      fs.renameSync(elsewhere, dir);
      await until(() => fake.streams.length === 1, 'the stream on the socket in the directory');
    });
  });

  describe('state tests', () => {
    it('should take every mapping\'s state from the stream\'s first line, timed from how long it has held it', async () => {
      fake.state.mappings = [
        { port: 31000, protocol: 'tcp', state: 'failing', failure: 'refused', reason: 'no room', forSeconds: 600 },
        { port: 31000, protocol: 'udp', state: 'mapped', forSeconds: 5 },
      ];
      await fake.listen();
      const before = Number(process.hrtime.bigint() / 1000000n);
      await start();
      const states = upnpd.mappingStates();
      expect(states.map((entry) => ({ ...entry, sinceMs: undefined }))).to.deep.equal([
        {
          port: 31000, protocol: 'tcp', state: 'failing', failure: 'refused', holder: null, reason: 'no room', sinceMs: undefined,
        },
        {
          port: 31000, protocol: 'udp', state: 'mapped', failure: null, holder: null, reason: null, sinceMs: undefined,
        },
      ]);
      expect(states[0].sinceMs).to.be.within(before - 600000 - 1000, before - 600000 + 1000);
    });

    it('should follow each change of a mapping\'s state', async () => {
      await fake.listen();
      await start();
      const changed = new Promise((resolve) => { upnpd.events.once('mappingState', resolve); });
      fake.send({
        type: 'mappingState', port: 31000, protocol: 'tcp', state: 'failing', failure: 'held', holder: '192.168.1.50',
      });
      expect(await changed).to.include({
        port: 31000, protocol: 'tcp', state: 'failing', failure: 'held', holder: '192.168.1.50',
      });
      expect(upnpd.mappingStates()).to.have.length(1);
    });

    it('should report the router\'s own failures, and no other', async () => {
      await fake.listen();
      await start();
      const failures = sinon.spy();
      upnpd.events.on('routerFailure', failures);
      try {
        ['unanswered', 'refused', 'held', 'leaving', 'stopped'].forEach((failure) => fake.send({
          type: 'mappingState', port: 31000, protocol: 'tcp', state: 'failing', failure, reason: 'x',
        }));
        fake.send({
          type: 'mapped', ticket: 9, port: 31000, ok: false, protocol: 'tcp', failure: 'unanswered', reason: 'x',
        });
        fake.send({
          type: 'mapped', ticket: 10, port: 31000, ok: false, protocol: 'tcp', failure: 'held', holder: 'y',
        });
        const last = new Promise((resolve) => { upnpd.events.once('mappingState', resolve); });
        fake.send({
          type: 'mappingState', port: 31001, protocol: 'tcp', state: 'mapped',
        });
        await last;
        expect(failures.callCount).to.equal(3);
      } finally {
        upnpd.events.off('routerFailure', failures);
      }
    });
  });

  describe('upnp tests', () => {
    it('should know nothing of UPnP before flux-upnpd\'s first state, then take it from that state', async () => {
      expect(upnpd.upnpOn()).to.equal(null);
      await fake.listen();
      await start();
      await upnpd.whenStated();
      expect(upnpd.upnpOn()).to.equal(true);
    });

    it('should give a flux-upnpd that says UPnP is off no set', async () => {
      fake.state.upnp = false;
      await fake.listen();
      await start();
      desired = [{ port: 31000, description: 'Flux_App_example1', protocols: ['tcp'] }];
      await upnpd.openDesired();
      await upnpd.desiredChanged();
      expect(upnpd.upnpOn()).to.equal(false);
      expect(fake.desired).to.deep.equal([]);
    });

    it('should follow UPnP turned off and on, giving the set only while it is on and again when it comes on', async () => {
      const said = [];
      const onUpnp = (on) => said.push(on);
      upnpd.events.on('upnp', onUpnp);
      try {
        await fake.listen();
        await start();
        desired = [{ port: 31000, description: 'Flux_App_example1', protocols: ['tcp'] }];
        await upnpd.openDesired();
        expect(fake.desired).to.have.length(1);
        fake.send({ type: 'upnp', on: false });
        await until(() => upnpd.upnpOn() === false, 'UPnP off');
        await upnpd.desiredChanged();
        expect(fake.desired).to.have.length(1);
        fake.send({ type: 'upnp', on: true });
        await until(() => fake.desired.length === 2, 'the set given as UPnP comes on');
        expect(fake.desired[1]).to.deep.equal(desired);
        expect(said).to.deep.equal([true, false, true]);
      } finally {
        upnpd.events.off('upnp', onUpnp);
      }
    });

    it('should keep what flux-upnpd last said while no stream is open', async () => {
      await fake.listen();
      await start();
      await upnpd.whenStated();
      await fake.close();
      // flux-upnpd back, its state still to come: the client opens a stream only once the last
      // has ended
      const restarted = standIn(dir);
      restarted.withholdState = true;
      await restarted.listen();
      try {
        await until(() => restarted.requests.includes('GET /events'), 'a stream to the restarted flux-upnpd');
        expect(upnpd.upnpOn()).to.equal(true);
      } finally {
        await restarted.close();
      }
    });
  });
});
