/**
 * The listening sockets systemd passes FluxOS (sd_listen_fds_with_names). Each socket unit
 * names its socket with FileDescriptorName=, and FluxOS takes it by that name.
 *
 * On an ArcaneOS image `fluxos-node-service.socket` passes the node service's listener,
 * 169.254.43.43:16101 bound with FreeBind=yes; the address is the image's (systemd-networkd
 * puts it on lo). Without that socket FluxOS adds the address and binds the listener itself.
 */

const log = require('../../lib/log');

const SD_LISTEN_FDS_START = 3;

/** The node service's socket (`fluxos-node-service.socket`). */
const NODE_SERVICE = 'fluxos-node-service';

/**
 * The sockets systemd passed to process `pid`, by name; empty when the handover is not
 * addressed to it. A handover whose names do not match its sockets is refused whole.
 * @param {object} env the environment holding LISTEN_PID, LISTEN_FDS and LISTEN_FDNAMES
 * @param {number} pid this process's id
 * @returns {Map<string, number>} each socket's file descriptor by name
 */
function passedSockets(env, pid) {
  const passed = new Map();
  if (env.LISTEN_PID === undefined || Number(env.LISTEN_PID) !== pid) return passed;
  const count = Number(env.LISTEN_FDS);
  if (!Number.isInteger(count) || count < 1) return passed;
  const names = (env.LISTEN_FDNAMES || '').split(':');
  if (names.length !== count || new Set(names).size !== count) {
    log.error(`systemd passed ${count} sockets named "${env.LISTEN_FDNAMES || ''}"; none is used`);
    return passed;
  }
  names.forEach((name, i) => passed.set(name, SD_LISTEN_FDS_START + i));
  return passed;
}

let sockets = null;

/**
 * The file descriptor of the socket systemd passed under `name`, if it passed one.
 * @param {string} name the socket's FileDescriptorName=
 * @returns {number|undefined}
 */
function fd(name) {
  if (!sockets) sockets = passedSockets(process.env, process.pid);
  return sockets.get(name);
}

module.exports = {
  NODE_SERVICE,
  fd,
  passedSockets,
};
