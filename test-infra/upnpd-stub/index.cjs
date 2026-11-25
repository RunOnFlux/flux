// flux-upnpd as FluxOS on its node sees it: the local API on /run/flux-upnpd/api.sock, run in the
// node by flux-upnpd-stub.service on a node createTestEnv gives `upnpdNodes`. No router behind it:
// every mapping FluxOS wants is mapped, unless the suite has made it fail (control routes on
// FLUX_NODE_IP:16259).
//
// It answers as flux-upnpd does:
// - GET /events: the state first (identity, apiPort, mapping, mappings with forSeconds), then
//   each event after it.
// - PUT /desired {ports: [{port, description, protocols}]}: the whole set; a port left out is no
//   longer wanted.
// - POST /map {port, description, protocols}: {ticket}; the port joins the set, and `mapped` with
//   the ticket follows: ok, or the first protocol that failed with its failure, the rest not tried.
// - mappingState on every change of a wanted mapping's state.
// - A restart ends every stream, removes the socket's directory (systemd's RuntimeDirectory) and
//   forgets the set, then listens again.
//
// Control:
// - GET /control: every set FluxOS sent and every map it asked, in order, with when (ms since the
//   stub started), and how many restarts.
// - POST /control/fail {port, protocol, failure, reason|holder}: the mapping fails from now on,
//   its map included.
// - POST /control/heal {port, protocol}: it maps again.
// - POST /control/restart: restarts as flux-upnpd does.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const DIR = '/run/flux-upnpd';
const SOCKET = path.join(DIR, 'api.sock');
const CONTROL_PORT = 16259;
const RESTART_GAP_MS = 500;
const startedAt = Date.now();
const now = () => Date.now() - startedAt;

// by port: { description, protocols }
const declared = new Map();
// by `port/protocol`: { failure, reason, holder }
const failures = new Map();
// by `port/protocol`: { port, protocol, state, failure, reason, holder, since }
const states = new Map();
const streams = new Set();
const desiredSent = [];
const mapsAsked = [];
let nextTicket = 1;
let restarts = 0;
let server = null;

const keyOf = (port, protocol) => `${port}/${protocol}`;

function send(event) {
  const line = `${JSON.stringify(event)}\n`;
  streams.forEach((stream) => stream.write(line));
}

function failureFields(failed) {
  return failed.failure === 'held'
    ? { failure: 'held', holder: failed.holder ?? 'another host' }
    : { failure: failed.failure, reason: failed.reason ?? failed.failure };
}

function mappingStatus(entry, withAge) {
  const status = { port: entry.port, protocol: entry.protocol, state: entry.state };
  if (entry.state === 'failing') Object.assign(status, failureFields(entry));
  if (withAge) status.forSeconds = Math.floor((now() - entry.since) / 1000);
  return status;
}

/** Each wanted mapping's state from the set and the failures, a change raising mappingState. */
function refresh() {
  const wanted = new Set();
  declared.forEach(({ protocols }, port) => {
    protocols.forEach((protocol) => {
      const key = keyOf(port, protocol);
      wanted.add(key);
      const failed = failures.get(key);
      const next = failed ? { state: 'failing', ...failureFields(failed) } : { state: 'mapped' };
      const current = states.get(key);
      const same = current && current.state === next.state && current.failure === next.failure;
      if (same) return;
      const entry = {
        port, protocol, ...next, since: now(),
      };
      states.set(key, entry);
      send({ type: 'mappingState', ...mappingStatus(entry, false) });
    });
  });
  [...states.keys()].filter((key) => !wanted.has(key)).forEach((key) => states.delete(key));
}

function status() {
  return {
    identity: 'harness:0',
    apiPort: Number(process.env.FLUX_API_PORT || 16127),
    mapping: true,
    mappings: [...states.values()].map((entry) => mappingStatus(entry, true)),
  };
}

function body(req) {
  return new Promise((resolve) => {
    let text = '';
    req.on('data', (chunk) => { text += chunk; });
    req.on('end', () => {
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        resolve(null);
      }
    });
  });
}

function json(res, code, value) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

const PROTOCOLS = ['tcp', 'udp'];

function portOf(entry) {
  const protocols = entry?.protocols ?? ['tcp'];
  const once = protocols.every((p, i) => PROTOCOLS.includes(p) && protocols.indexOf(p) === i);
  if (!Number.isInteger(entry?.port) || typeof entry.description !== 'string' || !protocols.length || !once) return null;
  return { port: entry.port, description: entry.description, protocols };
}

async function api(req, res) {
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write(`${JSON.stringify({ type: 'state', ...status() })}\n`);
    streams.add(res);
    res.on('close', () => streams.delete(res));
    return;
  }
  if (req.method === 'GET' && req.url === '/status') {
    json(res, 200, status());
    return;
  }
  if (req.method === 'PUT' && req.url === '/desired') {
    const given = await body(req);
    const ports = Array.isArray(given?.ports) ? given.ports.map(portOf) : null;
    if (!ports || ports.includes(null)) {
      json(res, 400, { error: 'ports: [{port, description, protocols}]' });
      return;
    }
    desiredSent.push({ at: now(), ports });
    declared.clear();
    ports.forEach(({ port, description, protocols }) => declared.set(port, { description, protocols }));
    refresh();
    json(res, 200, {});
    return;
  }
  if (req.method === 'POST' && req.url === '/map') {
    const asked = portOf(await body(req));
    if (!asked) {
      json(res, 400, { error: 'protocols is "tcp", "udp" or both, each once' });
      return;
    }
    const ticket = nextTicket;
    nextTicket += 1;
    mapsAsked.push({ at: now(), ticket, ...asked });
    const held = declared.get(asked.port);
    const protocols = [...new Set([...(held?.protocols ?? []), ...asked.protocols])];
    declared.set(asked.port, { description: asked.description, protocols });
    json(res, 200, { ticket });
    setImmediate(() => {
      const failed = asked.protocols.find((protocol) => failures.has(keyOf(asked.port, protocol)));
      const event = {
        type: 'mapped', ticket, port: asked.port, ok: !failed,
      };
      if (failed) Object.assign(event, { protocol: failed }, failureFields(failures.get(keyOf(asked.port, failed))));
      send(event);
      refresh();
    });
    return;
  }
  json(res, 404, { error: 'no such resource' });
}

function listen() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o750 });
  fs.rmSync(SOCKET, { force: true });
  server = http.createServer((req, res) => { api(req, res); });
  server.listen(SOCKET, () => fs.chmodSync(SOCKET, 0o660));
}

function restart() {
  restarts += 1;
  streams.forEach((stream) => stream.end());
  streams.clear();
  server.closeAllConnections();
  server.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  declared.clear();
  states.clear();
  setTimeout(listen, RESTART_GAP_MS);
}

http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/control') {
    json(res, 200, {
      desired: desiredSent, maps: mapsAsked, restarts, streams: streams.size,
    });
    return;
  }
  if (req.method === 'POST' && (req.url === '/control/fail' || req.url === '/control/heal')) {
    const given = await body(req);
    const key = keyOf(given?.port, given?.protocol);
    if (req.url === '/control/fail') failures.set(key, given);
    else failures.delete(key);
    refresh();
    json(res, 200, {});
    return;
  }
  if (req.method === 'POST' && req.url === '/control/restart') {
    restart();
    json(res, 200, {});
    return;
  }
  json(res, 404, { error: 'no such control' });
}).listen(CONTROL_PORT, process.env.FLUX_NODE_IP || '0.0.0.0');

listen();
