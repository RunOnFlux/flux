// The harness-only telemetry surface: an event stream and a set of counters,
// both dead in production (`testEventStream` is false there, and every entry
// point below returns before doing any work).
//
// THE RULE, and it is what keeps the ring a sensible size: FACTS AS EVENTS,
// CADENCE AS A COUNTER.
//
// An event marks something that HAPPENED - a block processed, a container
// actuated, a spec stored. Every one of the publishers in this codebase is of
// that kind, and because things happening are rare, a 1024-entry ring is
// generous. A heartbeat - "the loop ran again and did nothing" - is not a fact
// about the system, it is a fact about the clock, and putting one in here
// spends a SHARED budget that every other consumer draws from. The chatty
// publisher does not pay that cost; whichever other event a test needed pays
// it, silently.
//
// So when a test needs to know a loop has run N times, or which branch it took
// on each pass, that is a TALLY, not a stream: increment a counter with
// `count()` and let the reader ask for the number over /flux/testcounters,
// rather than broadcasting twenty messages a minute so it can count them.
// Publish an event only for the thing that actually happened.

const { EventEmitter } = require('node:events');
const config = require('config');
const log = require('../../lib/log');

const RING_BUFFER_SIZE = 1024;

// Express compression middleware buffers res.write() calls to build
// compressible chunks. SSE writes are too small to trigger a flush on
// their own, so events never reach the client. Calling res.flush()
// after each write forces the compression buffer to drain immediately.
function sseWrite(res, data) {
  res.write(data);
  if (res.flush) res.flush();
}

class FluxEventBus extends EventEmitter {
  #buffer;
  #writeIndex;
  #writeCount;
  #nextId;
  #enabled;
  #counters;

  constructor(enabled) {
    super();
    this.#buffer = new Array(RING_BUFFER_SIZE);
    this.#writeIndex = 0;
    // How many events this bus has published, which is what since() needs to
    // know whether the ring has wrapped. Kept separate from #nextId: ids are
    // seeded from the clock and carry no count information.
    this.#writeCount = 0;
    // Seeded from the monotonic clock (microseconds since boot) so event ids
    // stay monotonic across a FluxOS restart on a running host: a fresh process
    // mints ids larger than anything the previous one served, so a consumer
    // filtering on last-seen-id - any SSE client sending Last-Event-ID - does
    // not silently discard every post-restart event. Starting from 1 made the
    // whole post-restart stream invisible to such a consumer until the counter
    // happened to climb past the id it last saw, which on a busy node is never.
    // Not monotonic across a HOST reboot (the clock restarts near zero), which
    // is fine - no consumer survives one.
    this.#nextId = Number(process.hrtime.bigint() / 1000n);
    this.#enabled = enabled ?? (config.has('testEventStream') && config.get('testEventStream') === true);
    this.#counters = new Map();
  }

  get enabled() { return this.#enabled; }

  publish(name, data) {
    if (!this.#enabled) return;
    const entry = {
      id: this.#nextId++,
      event: name,
      data,
      timestamp: Date.now(),
    };
    this.#buffer[this.#writeIndex] = entry;
    this.#writeIndex = (this.#writeIndex + 1) % RING_BUFFER_SIZE;
    this.#writeCount += 1;
    try {
      this.emit('event', entry);
    } catch (err) { log.error(`FluxEventBus listener error: ${err.message}`); }
  }

  since(afterId) {
    const count = Math.min(this.#writeCount, RING_BUFFER_SIZE);
    if (count === 0) return [];
    // Once the ring has wrapped, the oldest surviving entry is the one about to
    // be overwritten; before that it is slot 0.
    const startIdx = this.#writeCount > RING_BUFFER_SIZE ? this.#writeIndex : 0;
    const result = [];
    for (let i = 0; i < count; i++) {
      const idx = (startIdx + i) % RING_BUFFER_SIZE;
      const entry = this.#buffer[idx];
      if (entry && entry.id > afterId) {
        result.push(entry);
      }
    }
    return result;
  }

  // The id of the oldest entry the ring still holds, or 0 while it has never
  // wrapped (nothing has been dropped, so every id is still reachable).
  //
  // Ids are minted with a single ++, so they are contiguous: anything between a
  // consumer's last-seen id and this one was published and then overwritten.
  // Without this, since() cannot tell "nothing happened since you last looked"
  // apart from "plenty happened and I threw it away", and a consumer that
  // reconnects into a gap waits out its whole budget for an event that already
  // came and went - failing at the deadline, as a product bug, rather than at
  // the cause.
  oldestRetainedId() {
    if (this.#writeCount === 0 || this.#writeCount <= RING_BUFFER_SIZE) return 0;
    const oldest = this.#buffer[this.#writeIndex];
    return oldest ? oldest.id : 0;
  }

  // Cadence, not facts - see the rule at the top of this file. A no-op when
  // disabled, exactly like publish().
  //
  // count('masterSlave:cycles')                       -> counters['masterSlave:cycles']
  // count('masterSlave:decision', id, 'heldOnPeer')   -> counters['masterSlave:decision'][id].heldOnPeer
  count(name, ...path) {
    if (!this.#enabled) return;
    let node = this.#counters.get(name);
    if (!node) {
      node = path.length ? new Map() : 0;
      this.#counters.set(name, node);
    }
    if (!path.length) {
      this.#counters.set(name, (typeof node === 'number' ? node : 0) + 1);
      return;
    }
    let cursor = node;
    for (let i = 0; i < path.length - 1; i += 1) {
      let next = cursor.get(path[i]);
      if (!(next instanceof Map)) {
        next = new Map();
        cursor.set(path[i], next);
      }
      cursor = next;
    }
    const leaf = path[path.length - 1];
    cursor.set(leaf, (cursor.get(leaf) || 0) + 1);
  }

  counters() {
    const plain = (value) => {
      if (!(value instanceof Map)) return value;
      const out = {};
      for (const [k, v] of value) out[k] = plain(v);
      return out;
    };
    return plain(this.#counters);
  }

  countersHandler(req, res) {
    if (!this.#enabled) {
      res.status(404).json({ status: 'error', data: { message: 'Test counters not enabled' } });
      return;
    }
    res.json({ status: 'success', data: this.counters() });
  }

  sseHandler(req, res) {
    if (!this.#enabled) {
      res.status(404).json({ status: 'error', data: { message: 'Event stream not enabled' } });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const lastId = parseInt(req.headers['last-event-id'], 10) || 0;
    // A resuming consumer that fell behind the ring is told so, and told how
    // much, before it is handed the survivors. Silence here is what turns a
    // dropped event into a timeout somewhere else entirely.
    const oldestRetained = this.oldestRetainedId();
    if (lastId > 0 && oldestRetained > lastId + 1) {
      sseWrite(res, `event: stream:gap\ndata: ${JSON.stringify({ afterId: lastId, oldestRetainedId: oldestRetained, dropped: oldestRetained - lastId - 1 })}\nid: ${lastId}\n\n`);
    }
    const missed = this.since(lastId);
    for (const entry of missed) {
      sseWrite(res, `event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\nid: ${entry.id}\n\n`);
    }

    const onEvent = (entry) => {
      sseWrite(res, `event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\nid: ${entry.id}\n\n`);
    };

    this.on('event', onEvent);

    const keepalive = setInterval(() => {
      sseWrite(res, ': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      this.removeListener('event', onEvent);
      clearInterval(keepalive);
    });
  }
}

const fluxEventBus = new FluxEventBus();
fluxEventBus.FluxEventBus = FluxEventBus;

module.exports = fluxEventBus;
