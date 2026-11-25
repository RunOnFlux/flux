/**
 * flux-upnpd: where FLUXUPNPD_CONNECTION names its socket (`unix:///run/flux-upnpd/api.sock`,
 * set by ArcaneOS's FluxOS unit), the one writer of this node's router mappings. Unset, FluxOS
 * maps through the router itself (portReconciler).
 *
 * FluxOS tells flux-upnpd every port it wants mapped (PUT /desired, the whole set each time) and
 * maps an installing app's port at once (POST /map, whose end a `mapped` event naming its ticket
 * reports). Both go out one at a time in the order they were asked, and a set is read as it is
 * sent, so a set never undoes a map asked before it. flux-upnpd forgets the set when it restarts,
 * so it is sent again on each new event stream. It is sent only once boot has declared every
 * installed app's ports (openDesired): until then flux-upnpd keeps the set it was last given, and
 * a partial set would start the removal of every port it leaves out.
 *
 * The event stream (GET /events) starts with flux-upnpd's state, each wanted mapping's state and
 * how long it has been in it among it, then carries every event after that. A map's `mapped`
 * arrives only on a stream, so a map is sent only while one is open. The socket is found by
 * watching for it: its directory is flux-upnpd's RuntimeDirectory, gone while flux-upnpd is
 * stopped, so the watch follows it from its parent, and flux-upnpd sets the socket's mode once it
 * listens. A stream that ends after its state, the socket still there, is opened again at once.
 */

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const readline = require('node:readline');

const log = require('../lib/log');

const REQUEST_TIMEOUT_MS = 10_000;
// The failures that are the router's own: no answer, or a refusal. A port another host holds, a
// node leaving its address and a mapper that stopped are not.
const ROUTER_FAILURES = new Set(['unanswered', 'refused']);
const NOT_RUNNING = { ok: false, failure: 'stopped', reason: 'flux-upnpd is not running' };

// 'states' when a stream's first line has replaced every mapping's state, 'mappingState' with the
// entry when one changes, 'routerFailure' when the router fails a mapping for a reason of its own.
const events = new EventEmitter();

let socket = null;
let parentWatch = null;
let dirWatch = null;
let stream = null;
let streaming = false;
// Bumped as each stream ends: a ticket from an earlier stream has lost its `mapped`.
let generation = 0;
let connecting = null;
let desiredSource = () => [];
let desiredOpen = false;
let desiredQueued = false;
let lane = Promise.resolve();
// The waiter of each ticket, and the ends that arrived before their POST was answered.
const waiters = new Map();
const ended = new Map();
// Each wanted mapping's state, by `port/protocol`: { port, protocol, state, failure, holder,
// reason, sinceMs } with sinceMs on the monotonic clock.
const states = new Map();

const monotonicMs = () => Number(process.hrtime.bigint() / 1000000n);

/**
 * @returns {string|null} The socket flux-upnpd serves FluxOS on, or null where FluxOS maps through
 *   the router itself.
 */
function connection() {
  const value = process.env.FLUXUPNPD_CONNECTION;
  if (!value) return null;
  const parsed = new URL(value);
  if (parsed.protocol !== 'unix:' || !parsed.pathname || parsed.pathname === '/') {
    throw new Error(`FLUXUPNPD_CONNECTION must be unix:///<socket path>, not ${value}`);
  }
  return parsed.pathname;
}

/**
 * One request on the socket.
 * @param {string} method
 * @param {string} route
 * @param {object} [body]
 * @returns {Promise<{status: number, body: object}>}
 */
function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      socketPath: socket,
      method,
      path: route,
      agent: false,
      timeout: REQUEST_TIMEOUT_MS,
      headers: payload === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let parsed = {};
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          parsed = { error: text };
        }
        resolve({ status: res.statusCode, body: parsed });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`flux-upnpd did not answer ${method} ${route} within ${REQUEST_TIMEOUT_MS} ms`)));
    req.on('error', reject);
    req.end(payload ?? undefined);
  });
}

/**
 * Runs `work` once every write asked before it has been sent.
 * @template T
 * @param {function(): Promise<T>} work
 * @returns {Promise<T>}
 */
function inLane(work) {
  const turn = lane.then(work);
  lane = turn.catch(() => {});
  return turn;
}

/**
 * The key of a mapping.
 * @param {number} port
 * @param {string} protocol
 * @returns {string}
 */
function keyOf(port, protocol) {
  return `${port}/${protocol}`;
}

/**
 * A mapping's state as a line gives it, from `sinceMs`.
 * @param {object} line
 * @param {number} sinceMs
 * @returns {object}
 */
function entryOf(line, sinceMs) {
  return {
    port: line.port,
    protocol: line.protocol,
    state: line.state,
    failure: line.failure ?? null,
    holder: line.holder ?? null,
    reason: line.reason ?? null,
    sinceMs,
  };
}

/**
 * Hands a ticket's end to its waiter, or keeps it for the waiter its POST answer brings.
 * @param {number} ticket
 * @param {object} result
 */
function end(ticket, result) {
  const waiter = waiters.get(ticket);
  if (waiter) {
    waiters.delete(ticket);
    waiter(result);
  } else {
    ended.set(ticket, result);
  }
}

/**
 * Acts on one line of the stream.
 * @param {object} line
 */
function onLine(line) {
  switch (line.type) {
    case 'state': {
      const now = monotonicMs();
      states.clear();
      (line.mappings ?? []).forEach((mapping) => {
        states.set(keyOf(mapping.port, mapping.protocol), entryOf(mapping, now - (mapping.forSeconds ?? 0) * 1000));
      });
      events.emit('states');
      break;
    }
    case 'mappingState': {
      const entry = entryOf(line, monotonicMs());
      states.set(keyOf(line.port, line.protocol), entry);
      events.emit('mappingState', entry);
      if (entry.state === 'failing' && ROUTER_FAILURES.has(entry.failure)) events.emit('routerFailure');
      break;
    }
    case 'mapped': {
      const result = line.ok ? { ok: true } : {
        ok: false,
        protocol: line.protocol ?? null,
        failure: line.failure,
        holder: line.holder ?? null,
        reason: line.reason ?? null,
      };
      if (!line.ok && ROUTER_FAILURES.has(line.failure)) events.emit('routerFailure');
      end(line.ticket, result);
      break;
    }
    default:
  }
}

/**
 * Ends the stream's state: every ticket waiting on it has lost its `mapped`.
 */
function streamEnded() {
  const hadState = streaming;
  streaming = false;
  stream = null;
  generation += 1;
  ended.clear();
  [...waiters.values()].forEach((waiter) => waiter(NOT_RUNNING));
  waiters.clear();
  // eslint-disable-next-line no-use-before-define
  if (hadState && socket && fs.existsSync(socket)) connect();
}

/**
 * Opens the event stream, unless one is open or opening.
 * @returns {Promise<boolean>} whether a stream is open, its state read
 */
function connect() {
  if (streaming) return Promise.resolve(true);
  if (connecting) return connecting;
  connecting = new Promise((resolve) => {
    let answered = false;
    const answer = (open) => {
      if (answered) return;
      answered = true;
      connecting = null;
      resolve(open);
    };
    const req = http.get({ socketPath: socket, path: '/events', agent: false }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        res.on('end', () => { req.destroy(); });
        answer(false);
        return;
      }
      stream = req;
      const lines = readline.createInterface({ input: res, crlfDelay: Infinity });
      // a stream cut off ends as its close says; readline passes the cut on as an error
      lines.on('error', () => {});
      lines.on('line', (text) => {
        if (!text.trim()) return;
        let line;
        try {
          line = JSON.parse(text);
        } catch (error) {
          log.error(`flux-upnpd - an event that is not JSON: ${error.message}`);
          return;
        }
        if (line.type === 'state' && !streaming) {
          streaming = true;
          onLine(line);
          answer(true);
          // eslint-disable-next-line no-use-before-define
          sendDesired();
          return;
        }
        onLine(line);
      });
      res.on('close', () => {
        answer(false);
        if (stream === req) streamEnded();
      });
    });
    req.on('error', () => {
      answer(false);
      if (stream === req) streamEnded();
    });
  });
  return connecting;
}

/**
 * Watches flux-upnpd's directory for its socket, while the directory exists.
 * @param {string} dir
 */
function watchDirectory(dir) {
  dirWatch?.close();
  dirWatch = null;
  try {
    dirWatch = fs.watch(dir, (eventType, name) => {
      if (name === path.basename(socket) && !streaming) connect();
    });
    dirWatch.on('error', () => {
      dirWatch?.close();
      dirWatch = null;
    });
  } catch {
    dirWatch = null;
  }
}

/**
 * Follows flux-upnpd from here on: its socket's appearance, its event stream, and from openDesired
 * on, the set of ports wanted mapped.
 * @param {{socket?: string, desired: function(): Array<{port: number, description: string, protocols: string[]}>}} options
 *   socket: connection() unless given; desired: the ports wanted mapped now, as PUT /desired takes
 *   them, read as each set is sent
 * @returns {Promise<boolean>} whether a stream opened at once
 */
function start({ socket: at = connection(), desired }) {
  if (socket) return connect();
  socket = at;
  desiredSource = desired;
  const dir = path.dirname(socket);
  parentWatch = fs.watch(path.dirname(dir), (eventType, name) => {
    if (name !== path.basename(dir)) return;
    watchDirectory(dir);
    if (!streaming) connect();
  });
  parentWatch.on('error', (error) => log.error(`flux-upnpd - ${path.dirname(dir)} watch failed: ${error.message}`));
  watchDirectory(dir);
  return connect();
}

/**
 * Stops following flux-upnpd: the watches and the stream end, and every waiting map is answered
 * as one flux-upnpd did not take.
 */
function stop() {
  parentWatch?.close();
  parentWatch = null;
  dirWatch?.close();
  dirWatch = null;
  const open = stream;
  socket = null;
  if (open) open.destroy();
  streaming = false;
  stream = null;
  connecting = null;
  generation += 1;
  ended.clear();
  [...waiters.values()].forEach((waiter) => waiter(NOT_RUNNING));
  waiters.clear();
  states.clear();
  desiredSource = () => [];
  desiredOpen = false;
  desiredQueued = false;
  lane = Promise.resolve();
}

/**
 * Sends the ports wanted mapped, once boot has declared them and while a stream is open: the set
 * is read when it goes, so one send covers every change asked while it waited.
 * @returns {Promise<void>}
 */
function sendDesired() {
  if (!desiredOpen || desiredQueued) return lane;
  desiredQueued = true;
  return inLane(async () => {
    desiredQueued = false;
    if (!streaming) return;
    const ports = desiredSource();
    try {
      const { status, body } = await request('PUT', '/desired', { ports });
      if (status !== 200) log.error(`flux-upnpd - the ports wanted mapped were refused (${status}): ${body.error}`);
    } catch (error) {
      log.error(`flux-upnpd - the ports wanted mapped were not sent: ${error.message}`);
    }
  });
}

/**
 * Boot has declared every installed app's ports: from now on flux-upnpd is given the set.
 * @returns {Promise<void>}
 */
function openDesired() {
  desiredOpen = true;
  return sendDesired();
}

/**
 * The ports wanted mapped changed.
 * @returns {Promise<void>}
 */
function desiredChanged() {
  return sendDesired();
}

/**
 * Maps a port now, in each of `protocols` in turn, and joins it to the ports flux-upnpd keeps.
 * @param {number} port
 * @param {string} description
 * @param {string[]} protocols 'tcp', 'udp' or both
 * @returns {Promise<{ok: boolean, protocol?: string|null, failure?: string, holder?: string|null, reason?: string|null}>}
 *   as flux-upnpd's `mapped` gives it; failure `stopped` where flux-upnpd is not running or its
 *   stream ended before the map did
 */
async function map(port, description, protocols) {
  const sent = await inLane(async () => {
    if (!socket || !await connect()) return { result: NOT_RUNNING };
    const at = generation;
    try {
      const { status, body } = await request('POST', '/map', { port, description, protocols });
      if (status !== 200) return { result: { ok: false, failure: 'stopped', reason: body.error ?? `flux-upnpd answered ${status}` } };
      return { ticket: body.ticket, at };
    } catch (error) {
      return { result: { ok: false, failure: 'stopped', reason: error.message } };
    }
  });
  if (sent.result) return sent.result;
  if (ended.has(sent.ticket)) {
    const result = ended.get(sent.ticket);
    ended.delete(sent.ticket);
    return result;
  }
  if (sent.at !== generation) return NOT_RUNNING;
  return new Promise((resolve) => { waiters.set(sent.ticket, resolve); });
}

/**
 * Every wanted mapping's state, as flux-upnpd last gave it.
 * @returns {object[]} { port, protocol, state, failure, holder, reason, sinceMs }
 */
function mappingStates() {
  return [...states.values()];
}

module.exports = {
  ROUTER_FAILURES,
  connection,
  desiredChanged,
  events,
  map,
  mappingStates,
  openDesired,
  start,
  stop,
};
