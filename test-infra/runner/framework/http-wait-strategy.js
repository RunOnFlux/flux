// A testcontainers WaitStrategy that polls an HTTP URL until it responds OK,
// bypassing Docker's health state machine entirely.
//
// Why not the built-in strategies:
//   - Wait.forHealthCheck() couples readiness to Docker's health state machine,
//     which tears the container down the instant Docker reports "unhealthy". Under
//     fleet-boot contention (10 privileged docker-in-docker nodes booting at once)
//     a node can miss the healthcheck startPeriod, or a probe can time out under CPU
//     pressure even though FluxOS is already serving — Docker flips to "unhealthy"
//     and testcontainers destroys the fleet. (It also flips "unhealthy" transiently
//     during monitor teardown on restart — moby health.go CloseMonitorChannel.)
//   - Wait.forHttp() resolves its target as runtimeHost:boundPorts.getBinding(port),
//     i.e. a host-PUBLISHED port. This harness publishes no ports and addresses every
//     node by its static network IP, so there is no bound port for forHttp to target.
//
// This strategy polls the node's own URL — the exact route every test uses to reach
// it — so readiness is validated against the real path, independent of Docker health.
//
// Implements the public testcontainers `WaitStrategy` interface directly (waitUntilReady
// + the startup-timeout accessors), so it needs no internal `testcontainers/build/...`
// import. `.start()` calls withStartupTimeout() when the container has an explicit
// startup timeout, then waitForContainer() calls waitUntilReady(); container.restart()
// calls only waitUntilReady().
export class HttpPollWaitStrategy {
  #url;
  #startupTimeoutMs = 120000;
  #startupTimeoutSet = false;
  #pollIntervalMs;
  #probeTimeoutMs;

  constructor(url, { pollIntervalMs = 500, probeTimeoutMs = 2000 } = {}) {
    this.#url = url;
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

  async waitUntilReady() {
    const deadline = Date.now() + this.#startupTimeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(this.#url, { signal: AbortSignal.timeout(this.#probeTimeoutMs) });
        if (res.ok) return;
      } catch {
        // not serving yet — keep polling until the deadline
      }
      await new Promise((r) => setTimeout(r, this.#pollIntervalMs));
    }
    throw new Error(`HttpPollWaitStrategy: ${this.#url} not ready after ${this.#startupTimeoutMs}ms`);
  }
}
