/**
 * Graceful Shutdown — v8 enterprise stop-gap (TEMPORARY)
 *
 * Lets an enterprise client set a per-component graceful-shutdown window on a v8
 * spec by embedding a token in the component `description`:
 *
 *     gracefulShutdownSec:300
 *
 * When present, and the app is gated (enterprise owner + v8), the value is
 * stamped on the container as the `flux.graceful.stop-s` label at create time
 * (dockerService.appDockerCreate). dockerService.appDockerStop reads that label
 * and passes it to docker stop as the timeout `t`, so the container receives its
 * image STOPSIGNAL and `t` seconds to exit cleanly before SIGKILL. This
 * reproduces only the signal stage of the v9 shutdown pipeline
 * (`docker.stop({ t: gracefulTimeout })`).
 *
 * `<n>` is an upper bound, not a fixed wait: docker stop signals immediately and
 * only SIGKILLs if the container has not exited after `<n>`s, so cooperative
 * apps exit in seconds regardless of the value.
 *
 * Purely node-local: no app-spec field, no validation change, no consensus.
 * Remove when v9 (`shutdown.gracefulTimeout`) lands.
 */

const MIN_SECONDS = 1;
const MAX_SECONDS = 21600; // 6h — mirrors the v9 gracefulTimeout ceiling

/**
 * Parses the `gracefulShutdownSec:<n>` token out of a component description and
 * clamps it to [MIN_SECONDS, MAX_SECONDS]. The key is matched case-insensitively
 * and accepts `:` or `=` as the separator.
 *
 * @param {string} description - component description text
 * @returns {number|null} clamped seconds, or null if absent/malformed/<1
 */
function parseGracefulShutdownSec(description) {
  if (typeof description !== 'string' || !description) {
    return null;
  }
  const match = description.match(/\bgracefulShutdownSec\s*[:=]\s*(\d+)\b/i);
  if (!match) {
    return null;
  }
  const seconds = Number(match[1]);
  if (!Number.isInteger(seconds) || seconds < MIN_SECONDS) {
    return null;
  }
  return Math.min(seconds, MAX_SECONDS);
}

module.exports = {
  parseGracefulShutdownSec,
  MIN_SECONDS,
  MAX_SECONDS,
};
