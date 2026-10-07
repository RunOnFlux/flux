/**
 * Readiness notification to a supervising systemd.
 *
 * A Type=notify unit is active only once the service says so. FluxOS says so
 * when its API listens and the daemon RPC answers, through `systemd-notify
 * --ready`, which sends READY=1 on the socket systemd names in NOTIFY_SOCKET.
 * Without that variable there is no supervisor to tell (pm2, a manual start,
 * a Type=exec unit) and nothing is sent.
 */

const childProcess = require('node:child_process');

const log = require('../../lib/log');

/**
 * Tell systemd this service is ready, when systemd is listening.
 * @returns {boolean} True when a notification was sent.
 */
function notifyReady() {
  if (!process.env.NOTIFY_SOCKET) return false;
  childProcess.execFile('systemd-notify', ['--ready'], (error) => {
    if (error) {
      log.warn(`systemd-notify --ready failed: ${error.message}`);
      return;
    }
    log.info('Readiness reported to systemd');
  });
  return true;
}

module.exports = {
  notifyReady,
};
