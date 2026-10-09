/**
 * Readiness notification to a supervising systemd.
 *
 * A Type=notify unit is active only once the service says so. FluxOS says so
 * once its API listens, through `systemd-notify --ready`, which sends READY=1
 * on the socket systemd names in NOTIFY_SOCKET.
 * Without that variable there is no supervisor to tell (pm2, a manual start,
 * a Type=exec unit) and nothing is sent.
 *
 * systemd-notify succeeds once systemd has processed the message, whether or
 * not the unit's NotifyAccess accepted it, so a success here means sent, not
 * accepted.
 */

const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');

// Above systemd-notify's own 5 s wait for systemd to process the message.
const TIMEOUT_MS = 10 * 1000;

/**
 * Send READY=1 to systemd, when systemd is listening. Never rejects.
 * @returns {Promise<boolean>} True when READY=1 was sent.
 */
async function notifyReady() {
  if (!process.env.NOTIFY_SOCKET) return false;
  const { error } = await serviceHelper.runCommand('systemd-notify', {
    params: ['--ready'], logError: false, timeout: TIMEOUT_MS,
  });
  if (error) {
    log.warn(`systemd-notify --ready failed: ${error.message}`);
    return false;
  }
  log.info('READY sent to systemd');
  return true;
}

module.exports = {
  notifyReady,
  TIMEOUT_MS,
};
