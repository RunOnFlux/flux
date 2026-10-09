/**
 * Readiness notification to a supervising systemd.
 *
 * A Type=notify unit is active only once the service says so. FluxOS says so
 * once its API listens, through `systemd-notify --ready`, which sends READY=1
 * on the socket systemd names in NOTIFY_SOCKET.
 * Without that variable there is no supervisor to tell (pm2, a manual start,
 * a Type=exec unit) and nothing is sent.
 */

const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');

// Above systemd-notify's own 5 s wait for systemd to acknowledge.
const ATTEMPT_TIMEOUT_MS = 10 * 1000;
const RETRY_DELAY_MS = 10 * 1000;
const RETRY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Tell systemd this service is ready, when systemd is listening.
 *
 * A failed attempt is retried until RETRY_WINDOW_MS has passed; systemd
 * ignores a repeated READY=1, including one whose earlier copy arrived but
 * was not acknowledged in time. Never rejects.
 * @param {{now?: () => number, sleep?: (ms: number) => Promise<void>}} [options]
 * @returns {Promise<boolean>} True when systemd acknowledged the notification.
 */
async function notifyReady({ now = Date.now, sleep = serviceHelper.delay } = {}) {
  if (!process.env.NOTIFY_SOCKET) return false;
  const deadline = now() + RETRY_WINDOW_MS;
  let failures = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await serviceHelper.runCommand('systemd-notify', {
      params: ['--ready'], logError: false, timeout: ATTEMPT_TIMEOUT_MS,
    });
    if (!error) {
      log.info('Readiness reported to systemd');
      return true;
    }
    failures += 1;
    if (failures === 1) log.warn(`systemd-notify --ready failed, retrying: ${error.message}`);
    if (now() >= deadline) {
      log.error(`systemd-notify --ready failed ${failures} times; fluxos.service stays activating: ${error.message}`);
      return false;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(RETRY_DELAY_MS);
  }
}

module.exports = {
  notifyReady,
  ATTEMPT_TIMEOUT_MS,
  RETRY_DELAY_MS,
  RETRY_WINDOW_MS,
};
