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

/**
 * Tell systemd this service is ready, when systemd is listening.
 * @returns {Promise<boolean>} True when a notification was sent.
 */
async function notifyReady() {
  if (!process.env.NOTIFY_SOCKET) return false;
  const { error } = await serviceHelper.runCommand('systemd-notify', { params: ['--ready'] });
  if (error) {
    log.warn(`systemd-notify --ready failed: ${error.message}`);
  } else {
    log.info('Readiness reported to systemd');
  }
  return true;
}

module.exports = {
  notifyReady,
};
