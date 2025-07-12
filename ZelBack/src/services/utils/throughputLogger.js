/* eslint max-classes-per-file: ["error", 3] */

const { createReadStream } = require('node:fs');
const { createInterface } = require('node:readline');

/**
 * @typedef {{
 * receive: number
 * transmit: number
 * }} InterfaceResult
 */

/**
 * @typedef {{
 * name: InterfaceResult
 * }} LoggingResult
 */

class InterfaceInfo {
  startBytes = 0;

  lastBytes = 0;

  bytes = 0;

  startPackets = 0;

  lastPackets = 0;

  packets = 0;

  lastTimestamp = 0;

  throughputKbps = 0;

  static now() {
    return process.hrtime.bigint();
  }

  calculateThroughput() {
    const bytesUsed = this.bytes - this.lastBytes;
    const elapsed = InterfaceInfo.now() - this.lastTimestamp;
    const elapsedSec = Number(elapsed) / 1_000_000_000;
    const bytesPerSec = bytesUsed / elapsedSec;

    const formatted = Math.round(
      ((bytesPerSec / 1024) + Number.EPSILON) * 1_000,
    ) / 1_000;

    return formatted;
  }

  /**
    *
    * @param {Array<string>} data
    */
  update(data) {
    if (!this.startBytes) {
      this.startBytes = data[0];
      this.startPackets = data[1];

      this.lastBytes = this.bytes;
      this.lastPackets = this.packets;
    }

    this.bytes = data[0];
    this.packets = data[1];

    this.throughputKbps = this.lastTimestamp ? this.calculateThroughput() : 0;
    this.lastTimestamp = InterfaceInfo.now();
  }
}

class InterfaceLogger {
  get asObject() {
    const payload = {
      receive: this.receive.throughputKbps,
      transmit: this.transmit.throughputKbps,
    };

    return payload;
  }

  constructor(name) {
    this.name = name;

    this.receive = new InterfaceInfo();
    this.transmit = new InterfaceInfo();
  }

  static pairwise(arr, func) {
    for (let i = 0; i < arr.length - 1; i += 1) {
      func(arr[i], arr[i + 1]);
    }
  }

  updateFromProcFile(rawLine) {
    // 60521714297 282068444    0  505    0     0          0         0 38453425012 262605254    0    0    0     0       0          0

    const parts = rawLine.trim().split(/\s+/);
    const size = parts.length / 2;

    this.receive.update(parts.slice(0, size));
    this.transmit.update(parts.slice(size));
  }
}

class ThroughputLogger {
  static #netDevPath = '/proc/net/dev';

  /**
   * @type {Map<string, InterfaceLogger>}
   */
  interfaces = new Map();

  /**
   * @type {NodeJS.Timeout | null}
   */
  timer = null;

  get asObject() {
    const payload = {};

    // eslint-disable-next-line no-restricted-syntax
    for (const [key, value] of this.interfaces.entries()) {
      payload[key] = value.asObject;
    }

    return payload;
  }

  /**
   *
   * @param {(result: LoggingResult) => {}} callback
   * @param {{intervalMs?: number, matchInterfaces?: Array<string>}}
   */
  constructor(callback, options = {}) {
    this.callback = callback;
    this.intervalMs = options.intervalMs || 3_600_000;
    this.matchInterfaces = options.matchInterfaces || [];
  }

  async start() {
    if (this.timer) return;

    await this.processInterfaces();

    const processor = this.processInterfaces.bind(this);

    this.timer = setInterval(processor, this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async processInterfaces() {
    const fileStream = createReadStream(ThroughputLogger.#netDevPath);

    const lineIterator = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let lineIndex = 0;

    // eslint-disable-next-line no-restricted-syntax
    for await (const line of lineIterator) {
      if (lineIndex > 1) {
        const [interfaceName, interfaceData] = line.trim().split(':');

        // eslint-disable-next-line
        if (!(this.matchInterfaces.includes(interfaceName))) continue;

        if (!this.interfaces.has(interfaceName)) {
          this.interfaces.set(interfaceName, new InterfaceLogger(interfaceName));
        }

        const interfaceLogger = this.interfaces.get(interfaceName);
        interfaceLogger.updateFromProcFile(interfaceData);
      }

      lineIndex += 1;
    }

    this.callback(this.asObject);
  }
}

module.exports = { ThroughputLogger };
