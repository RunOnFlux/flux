const { EventEmitter } = require('node:events');
const config = require('config');
const log = require('../../lib/log');

const RING_BUFFER_SIZE = 1024;

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

    const lastId = parseInt(req.headers['last-event-id'], 10) || 0;
    const missed = this.since(lastId);
    for (const entry of missed) {
      res.write(`event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\nid: ${entry.id}\n\n`);
    }

    const onEvent = (entry) => {
      res.write(`event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\nid: ${entry.id}\n\n`);
    };

    this.on('event', onEvent);

    const keepalive = setInterval(() => {
      res.write(': keepalive\n\n');
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
