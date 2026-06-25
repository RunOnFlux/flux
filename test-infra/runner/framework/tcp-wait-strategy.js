import net from 'node:net';

// A testcontainers WaitStrategy that polls a TCP host:port until it accepts a
// connection, bypassing Docker's health state machine entirely.
//
// Sibling of HttpPollWaitStrategy (see that file for the full rationale on why
// Wait.forHealthCheck() is unsafe — it tears the container down on the first
// transient "unhealthy" under fleet-boot contention, and forHttp can't target a
// static-IP container with no published port). This is the non-HTTP variant, for
// services that don't speak HTTP — currently mongo, which speaks the Mongo wire
// protocol. Readiness here means "the port accepts a connection"; the caller's
// first real use (seedMongo's driver connect) is the authoritative readiness gate.
//
// Implements the public testcontainers WaitStrategy interface directly
// (waitUntilReady + the startup-timeout accessors), so it needs no internal
// testcontainers/build import.
export class TcpPollWaitStrategy {
  #host;
  #port;
  #startupTimeoutMs = 120000;
  #startupTimeoutSet = false;
  #pollIntervalMs;
  #probeTimeoutMs;

  constructor(host, port, { pollIntervalMs = 500, probeTimeoutMs = 2000 } = {}) {
    this.#host = host;
    this.#port = port;
    this.#pollIntervalMs = pollIntervalMs;
    this.#probeTimeoutMs = probeTimeoutMs;
  }

  withStartupTimeout(startupTimeoutMs) {
    this.#startupTimeoutMs = startupTimeoutMs;
    this.#startupTimeoutSet = true;
    return this;
  }

  isStartupTimeoutSet() {
    return this.#startupTimeoutSet;
  }

  getStartupTimeout() {
    return this.#startupTimeoutMs;
  }

  #tryConnect() {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: this.#host, port: this.#port });
      const finish = (ok) => { socket.destroy(); resolve(ok); };
      socket.setTimeout(this.#probeTimeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  }

  async waitUntilReady() {
    const deadline = Date.now() + this.#startupTimeoutMs;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      if (await this.#tryConnect()) return;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, this.#pollIntervalMs));
    }
    throw new Error(`TcpPollWaitStrategy: ${this.#host}:${this.#port} not accepting connections after ${this.#startupTimeoutMs}ms`);
  }
}
