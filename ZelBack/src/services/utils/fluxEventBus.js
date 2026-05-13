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
  #nextId;
  #enabled;

  constructor(enabled) {
    super();
    this.#buffer = new Array(RING_BUFFER_SIZE);
    this.#writeIndex = 0;
    this.#nextId = 1;
    this.#enabled = enabled ?? (config.has('testEventStream') && config.get('testEventStream') === true);
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
    try {
      this.emit('event', entry);
    } catch (err) { log.error(`FluxEventBus listener error: ${err.message}`); }
  }

  since(afterId) {
    const totalWritten = this.#nextId - 1;
    const count = Math.min(totalWritten, RING_BUFFER_SIZE);
    if (count === 0) return [];
    const startIdx = totalWritten > RING_BUFFER_SIZE ? this.#writeIndex : 0;
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
