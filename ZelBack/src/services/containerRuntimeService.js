const fs = require('node:fs/promises');
const log = require('../lib/log');
const nodeDosState = require('./nodeDosState');
const policyStore = require('./policyStore');

// Whether FluxOS runs inside a container, and whether the network takes such a
// node out of service.
//
// A node in a container (LXC, OpenVZ, systemd-nspawn, Docker, Podman, ...)
// shares its host's kernel with every other container there, and reads the
// host's load as its own: its benchmark then stands on stored figures rather
// than measuring. A virtual machine runs its own kernel and is not a container.
//
// The test is FluxOS's own PID namespace. The kernel gives the host's initial
// PID namespace a fixed inode, PROC_PID_INIT_INO; a container that runs its own
// init has a namespace of its own, which no file or setting inside the
// container changes. So a node whose FluxOS runs in a PID namespace of its own
// is a container node, including a host that starts FluxOS in a private PID
// namespace (systemd's PrivatePIDs=). A container started in the host's PID
// namespace (Docker's --pid=host, LXC sharing the host's) reads as a host: it is
// not held.
//
// A process never changes PID namespace, so it is read once, at start. The
// signed network policy decides the consequence: its `containerdos` document set
// to `true` holds a container node out of service; absent, anything else, or no
// verified policy at all, the node reports what it is and serves on.

/** The inode of the host's initial PID namespace: the kernel's PROC_PID_INIT_INO. */
const HOST_PID_NAMESPACE = 0xEFFFFFFC;

const DOS_DOCUMENT = 'containerdos';

const REASON = 'FluxOS is running in a container. A Flux node must run on a host or in a virtual machine, never in a container (LXC, OpenVZ, systemd-nspawn, Docker, Podman). Move the node and restart FluxOS';

// The PID namespace FluxOS runs in, or null when it could not be read.
let pidNamespace = null;
let unsubscribeBundle = null;

/**
 * Whether the signed network policy holds a container node out of service.
 * @returns {boolean}
 */
function dosEnabled() {
  return policyStore.getDocument(DOS_DOCUMENT) === true;
}

/**
 * Whether FluxOS runs in a container: null when its PID namespace is unknown.
 * @returns {?boolean}
 */
function inContainer() {
  return pidNamespace === null ? null : pidNamespace !== HOST_PID_NAMESPACE;
}

/**
 * Hold this node out of service while it is a container node and the policy
 * says so, and release it otherwise. An unknown namespace gives no verdict.
 */
function decide() {
  if (inContainer() === true && dosEnabled()) {
    nodeDosState.setStickyDos(nodeDosState.StickyDosOwner.CONTAINER_RUNTIME, REASON);
  } else {
    nodeDosState.clearStickyDos(nodeDosState.StickyDosOwner.CONTAINER_RUNTIME);
  }
}

/**
 * Read FluxOS's PID namespace, decide, and decide again on every policy bundle
 * this node adopts. Idempotent.
 * @param {{pidNamespaceLink?: string}} [paths] The link naming this process's
 *   PID namespace, `pid:[<inode>]`.
 * @returns {Promise<void>}
 */
async function start({ pidNamespaceLink = '/proc/self/ns/pid' } = {}) {
  if (unsubscribeBundle) return;
  const link = await fs.readlink(pidNamespaceLink).catch((error) => {
    log.error(`containerRuntimeService - cannot read ${pidNamespaceLink}, no verdict: ${error.message}`);
    return null;
  });
  const inode = link?.match(/^pid:\[(\d+)\]$/)?.[1];
  if (link !== null && inode === undefined) {
    log.error(`containerRuntimeService - ${pidNamespaceLink} reads '${link}', not a PID namespace, no verdict`);
  }
  pidNamespace = inode === undefined ? null : Number(inode);
  if (inContainer()) log.warn(`containerRuntimeService - FluxOS runs in a container (PID namespace ${pidNamespace})`);
  unsubscribeBundle = policyStore.onBundleChanged(decide);
  decide();
}

/**
 * Stop following the policy. Test support and shutdown.
 */
function stop() {
  if (unsubscribeBundle) unsubscribeBundle();
  unsubscribeBundle = null;
  pidNamespace = null;
}

/**
 * What /flux/info reports.
 * @returns {{inContainer: ?boolean, pidNamespace: ?number, dosEnabled: boolean}}
 */
function getStatus() {
  return { inContainer: inContainer(), pidNamespace, dosEnabled: dosEnabled() };
}

module.exports = {
  HOST_PID_NAMESPACE,
  getStatus,
  start,
  stop,
};
