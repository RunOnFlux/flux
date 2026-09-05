const chai = require('chai');
const sinon = require('sinon');
const { EventEmitter } = require('events');
const proxyquire = require('proxyquire');

const { expect } = chai;

describe('appLogsHandler tests', () => {
  let verifyPrivilege;
  let getDockerContainerByIdOrName;
  let appLogsHandler;
  let logStream;
  let container;
  let emitted;

  function frame(text, streamId = 1) {
    const body = Buffer.from(text, 'utf8');
    const header = Buffer.alloc(8);
    header.writeUInt8(streamId, 0);
    header.writeUInt32BE(body.length, 4);
    return Buffer.concat([header, body]);
  }

  // The namespace records what each room was told, so a test asserts on the
  // fan-out rather than on one socket.
  const makeNamespace = () => ({
    to(room) {
      return {
        emit: (event, payload) => {
          emitted.push({ room, event, payload });
        },
      };
    },
  });

  const makeSocket = (id, nsp) => {
    const listeners = {};
    return {
      id,
      nsp,
      connected: true,
      rooms: new Set(),
      emit: sinon.stub(),
      join(room) { this.rooms.add(room); },
      on(event, fn) {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      fire(event, ...args) {
        return Promise.all((listeners[event] || []).map((fn) => fn(...args)));
      },
    };
  };

  beforeEach(() => {
    emitted = [];
    logStream = new EventEmitter();
    logStream.destroy = sinon.stub();
    container = { id: 'abc123', logs: sinon.stub().resolves(logStream) };
    verifyPrivilege = sinon.stub().resolves(true);
    getDockerContainerByIdOrName = sinon.stub().resolves(container);
    appLogsHandler = proxyquire('../../ZelBack/src/lib/socketIoHandlers/appLogsHandler', {
      '../../services/verificationHelper': { verifyPrivilege },
      '../../services/dockerService': { getDockerContainerByIdOrName },
    });
  });

  afterEach(() => {
    appLogsHandler.feeds.forEach((feed) => clearInterval(feed.timer));
    appLogsHandler.feeds.clear();
    sinon.restore();
  });

  async function subscribe(socket, name = 'fluxcomp_myapp', auth = 'zelidauth') {
    await socket.fire('subscribe', auth, name);
  }

  // Let the listener run until it reaches the await being raced. A fixed number
  // of microtask ticks would be guessing at how many awaits precede it.
  async function until(predicate, ticks = 50) {
    for (let i = 0; i < ticks; i += 1) {
      if (predicate()) return;
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => { setImmediate(resolve); });
    }
    throw new Error('condition never reached');
  }

  describe('authorisation', () => {
    it('refuses a non-string container without reaching the verifier', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      await socket.fire('subscribe', 'zelidauth', { evil: true });

      expect(socket.emit.calledWith('error', 'No container specified.')).to.be.true;
      expect(verifyPrivilege.called, 'verifyPrivilege throws a TypeError for a non-string on purpose').to.be.false;
    });

    it('refuses a non-string zelidauth without reaching the verifier', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      await socket.fire('subscribe', { evil: true }, 'fluxcomp_myapp');

      expect(socket.emit.calledWith('error', 'Not authorized.')).to.be.true;
      expect(verifyPrivilege.called).to.be.false;
    });

    it('does not touch docker for an unauthorised caller', async () => {
      // The lookup is a remote-controlled operation on an attacker-supplied
      // name, so it must sit behind the privilege check rather than beside it.
      verifyPrivilege.resolves(false);
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      await subscribe(socket);

      expect(socket.emit.calledWith('error', 'Not authorized.')).to.be.true;
      expect(getDockerContainerByIdOrName.called).to.be.false;
    });

    it('asks for the privilege by the app name, not the component name', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      await subscribe(socket, 'fluxcomponent_myapp');

      expect(verifyPrivilege.firstCall.args[2]).to.deep.equal({ appName: 'myapp' });
    });

    it('answers a container that is not there rather than opening a feed', async () => {
      getDockerContainerByIdOrName.rejects(new Error('Container nope not found'));
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      await subscribe(socket, 'nope');

      expect(socket.emit.calledWith('error', 'Container not found.')).to.be.true;
      expect(appLogsHandler.feeds.size).to.equal(0);
    });
  });

  describe('the stream is shared', () => {
    it('opens one docker stream however many viewers subscribe', async () => {
      const nsp = makeNamespace();
      const a = makeSocket('s1', nsp);
      const b = makeSocket('s2', nsp);
      appLogsHandler(a); appLogsHandler(b);

      await subscribe(a);
      await subscribe(b);

      expect(container.logs.callCount, 'a stream per viewer multiplies the daemon\'s work').to.equal(1);
      expect(appLogsHandler.feeds.get('abc123').subscribers.size).to.equal(2);
    });

    it('bounds the docker read that establishes the stream', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      await subscribe(socket);

      const opts = container.logs.firstCall.args[0];
      expect(opts.follow, 'a poll is not what this is').to.be.true;
      expect(opts.tail, 'follow without a tail reads the whole file to establish').to.equal(appLogsHandler.BACKFILL_LINES);
      expect(opts.timestamps).to.be.true;
    });

    it('keeps the stream while any viewer remains and closes it when the last leaves', async () => {
      const nsp = makeNamespace();
      const a = makeSocket('s1', nsp);
      const b = makeSocket('s2', nsp);
      appLogsHandler(a); appLogsHandler(b);
      await subscribe(a);
      await subscribe(b);

      await a.fire('disconnect');
      expect(logStream.destroy.called, 'one viewer leaving is not the last').to.be.false;
      expect(appLogsHandler.feeds.has('abc123')).to.be.true;

      await b.fire('disconnect');
      expect(logStream.destroy.called, 'nothing is reading what the daemon is sending').to.be.true;
      expect(appLogsHandler.feeds.has('abc123')).to.be.false;
    });

    it('releases the feed when a viewer unsubscribes without disconnecting', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);
      await subscribe(socket);

      await socket.fire('unsubscribe');

      expect(appLogsHandler.feeds.has('abc123')).to.be.false;
    });

    it('does not hand a late viewer lines the room is about to send it', async () => {
      // Every line goes into both `recent` and `queued`, so whatever is queued
      // when a second viewer joins is also the tail of `recent` and is about to
      // reach it through the room. Sending the whole of `recent` delivers that
      // tail twice - the one thing a log pane must never do.
      const clock = sinon.useFakeTimers();
      try {
        const nsp = makeNamespace();
        const a = makeSocket('s1', nsp);
        appLogsHandler(a);
        await subscribe(a);

        logStream.emit('data', frame('one\ntwo\n'));
        clock.tick(appLogsHandler.BATCH_MS);          // one and two are delivered and drained
        logStream.emit('data', frame('three\nfour\n')); // still queued, not yet flushed

        const b = makeSocket('s2', nsp);
        appLogsHandler(b);
        await subscribe(b);

        const backfill = b.emit.getCalls().filter((c) => c.args[0] === 'logs');
        expect(backfill, 'the late viewer got no context at all').to.have.length(1);
        expect(
          backfill[0].args[1].lines,
          'the queued tail was sent as backfill and will arrive again on the next flush',
        ).to.deep.equal(['one', 'two']);

        clock.tick(appLogsHandler.BATCH_MS);
        const roomFrames = emitted.filter((e) => e.event === 'logs');
        expect(roomFrames[roomFrames.length - 1].payload.lines).to.deep.equal(['three', 'four']);
      } finally {
        clock.restore();
      }
    });

    it('refuses a second container on one connection', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);
      await subscribe(socket);

      await subscribe(socket, 'fluxother_app2');

      expect(socket.emit.calledWith('error', 'This connection already follows a container.')).to.be.true;
      expect(container.logs.callCount).to.equal(1);
    });
  });

  describe('batching and backpressure', () => {
    it('sends lines collected over the window as one message', async () => {
      const clock = sinon.useFakeTimers();
      try {
        const socket = makeSocket('s1', makeNamespace());
        appLogsHandler(socket);
        await subscribe(socket);

        logStream.emit('data', frame('one\ntwo\n'));
        logStream.emit('data', frame('three\n'));
        expect(emitted.filter((e) => e.event === 'logs'), 'nothing is sent before the window closes').to.have.length(0);

        clock.tick(appLogsHandler.BATCH_MS);

        const frames = emitted.filter((e) => e.event === 'logs');
        expect(frames, 'three writes inside one window are one message').to.have.length(1);
        expect(frames[0].payload.lines).to.deep.equal(['one', 'two', 'three']);
        expect(frames[0].room).to.equal('applogs:abc123');
      } finally {
        clock.restore();
      }
    });

    it('sends nothing at all while the container is quiet', async () => {
      const clock = sinon.useFakeTimers();
      try {
        const socket = makeSocket('s1', makeNamespace());
        appLogsHandler(socket);
        await subscribe(socket);

        clock.tick(appLogsHandler.BATCH_MS * 10);

        expect(emitted, 'an idle container costs no messages').to.have.length(0);
      } finally {
        clock.restore();
      }
    });

    it('drops the oldest and reports the count when a container outruns the socket', async () => {
      const clock = sinon.useFakeTimers();
      try {
        const socket = makeSocket('s1', makeNamespace());
        appLogsHandler(socket);
        await subscribe(socket);

        const over = appLogsHandler.MAX_QUEUED_LINES + 500;
        logStream.emit('data', frame(`${Array.from({ length: over }, (_, i) => `line${i}`).join('\n')}\n`));
        clock.tick(appLogsHandler.BATCH_MS);

        const skips = emitted.filter((e) => e.event === 'skipped');
        expect(skips, 'an unbounded queue makes a loud container the node\'s memory problem').to.have.length(1);
        expect(skips[0].payload.count).to.equal(500);

        const logs = emitted.filter((e) => e.event === 'logs');
        expect(logs[0].payload.lines).to.have.length(appLogsHandler.MAX_QUEUED_LINES);
        expect(logs[0].payload.lines[0], 'the newest are kept, because this is a live tail').to.equal('line500');
      } finally {
        clock.restore();
      }
    });

    it('reports a drop only once, not on every later flush', async () => {
      const clock = sinon.useFakeTimers();
      try {
        const socket = makeSocket('s1', makeNamespace());
        appLogsHandler(socket);
        await subscribe(socket);

        const over = appLogsHandler.MAX_QUEUED_LINES + 10;
        logStream.emit('data', frame(`${Array.from({ length: over }, (_, i) => `l${i}`).join('\n')}\n`));
        clock.tick(appLogsHandler.BATCH_MS);
        clock.tick(appLogsHandler.BATCH_MS);

        expect(emitted.filter((e) => e.event === 'skipped')).to.have.length(1);
      } finally {
        clock.restore();
      }
    });
  });

  describe('the stream ending', () => {
    it('tells the viewers when the container stops, and keeps nothing running', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);
      await subscribe(socket);

      logStream.emit('data', frame('final-line-no-newline'));
      logStream.emit('end');

      const logs = emitted.filter((e) => e.event === 'logs');
      expect(logs[0].payload.lines, 'the held partial line is released rather than lost').to.deep.equal(['final-line-no-newline']);
      expect(emitted.some((e) => e.event === 'ended'), 'a pane that stops updating silently looks like a bug').to.be.true;
      expect(appLogsHandler.feeds.has('abc123')).to.be.false;
    });

    it('answers a stream error and closes the feed', async () => {
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);
      await subscribe(socket);

      logStream.emit('error', new Error('daemon went away'));

      expect(emitted.some((e) => e.event === 'error')).to.be.true;
      expect(appLogsHandler.feeds.has('abc123')).to.be.false;
    });

    it('does not exit the process when a stream listener throws', async () => {
      // These callbacks are called by the stream, not by socket.io, so the
      // guard that answers a failing socket listener does not reach them. An
      // unhandled throw here reaches apiServer's uncaughtException handler.
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);
      await subscribe(socket);

      expect(() => logStream.emit('data', Buffer.from([0, 0, 0]))).to.not.throw();
      expect(() => logStream.emit('data', null)).to.not.throw();
    });
  });

  describe('a client that leaves mid-setup', () => {
    it('opens no feed when the client goes while authorisation is in flight', async () => {
      let releaseAuth;
      verifyPrivilege.returns(new Promise((resolve) => { releaseAuth = resolve; }));
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      const pending = subscribe(socket);
      await socket.fire('disconnect');
      socket.connected = false;
      releaseAuth(true);
      await pending;

      expect(container.logs.called, 'a feed with no viewer has nobody left to close it').to.be.false;
      expect(appLogsHandler.feeds.size).to.equal(0);
    });

    it('releases the feed when the client goes while the stream is opening', async () => {
      let releaseLogs;
      container.logs.returns(new Promise((resolve) => { releaseLogs = resolve; }));
      const socket = makeSocket('s1', makeNamespace());
      appLogsHandler(socket);

      const pending = subscribe(socket);
      // The stream must actually be opening before the client goes, or the
      // check that precedes the open catches it and there is no race to test.
      await until(() => container.logs.called);
      await socket.fire('disconnect');
      socket.connected = false;
      releaseLogs(logStream);
      await pending;

      expect(appLogsHandler.feeds.has('abc123'), 'the disconnect ran before there was a feed to release').to.be.false;
      expect(logStream.destroy.called, 'the stream opened with nobody to read it and nothing left to close it').to.be.true;
    });
  });
});
