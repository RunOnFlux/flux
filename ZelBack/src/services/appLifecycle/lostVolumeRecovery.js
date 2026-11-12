/**
 * What a node does with an installed app component whose data volume is gone:
 * its image is on no mounted filesystem, holds no filesystem, or is not the one
 * this node made. The node holds nothing of the component's data.
 *
 * A synced component is rebuilt here, on a fresh volume that syncs from its
 * peers, only while another holder is proven to run it: that holder has the
 * data, and the rebuilt copy takes it from there. In every other case the app
 * is removed from this node and the network places it elsewhere - a primary
 * that lost its volume, a copy no other holder runs, and an app with no synced
 * data, whose data nothing can bring back.
 */

const log = require('../../lib/log');
const dockerService = require('../dockerService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const registryManager = require('../appDatabase/registryManager');
const fluxEventBus = require('../utils/fluxEventBus');
const globalState = require('../utils/globalState');
const localRemovalQueue = require('./localRemovalQueue');
const { componentStateOnOtherHolders, PeerComponent } = require('../appMonitoring/peerComponent');
const { createPeerFolderLiveness } = require('../appMonitoring/peerFolderLiveness');

// Reasons from ensureAppVolumeMounted that say the component's data is not on
// this node. Every other reason describes the host, which may yet mount it.
const VOLUME_GONE_REASONS = new Set([
  'volume_file_missing',
  'mount_failed',
  'volume_incomplete_install',
  'volume_image_unrecognised',
]);

// A component is rebuilt at most once in this window, so a disk that keeps
// losing images does not rebuild it in a loop.
const REBUILD_MIN_INTERVAL_MS = 60 * 60 * 1000;

const lastRebuildAt = new Map(); // identifier -> monotonic ms
const recovering = new Set(); // identifiers being decided or acted on

// Rebuilds one component, or a whole app with no components: set by
// serviceManager, as the redeploy code depends on the reconciler that calls in here.
let rebuilder = null;

function monotonicMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

/**
 * @param {string} reason A reason from ensureAppVolumeMounted, with or without a
 *   ': detail' suffix.
 * @returns {boolean} Whether it says the component's data is not on this node.
 */
function isVolumeGone(reason) {
  return VOLUME_GONE_REASONS.has(String(reason).split(':')[0]);
}

/**
 * @param {(target: {appName: string, componentName: (string|null), specifications: (object|null)}) => Promise<unknown>} fn
 */
function setRebuilder(fn) {
  rebuilder = fn;
}

function decided(identifier, appName, action, reason) {
  log.warn(`lostVolumeRecovery - ${identifier}'s volume is gone: ${action === 'rebuild' ? 'rebuilding it' : 'removing the app from this node'} (${reason})`);
  fluxEventBus.publish('app:lostVolume', {
    identifier, appName, action, reason,
  });
}

/**
 * An installed component's volume could not be mounted. A component whose data
 * is gone is rebuilt or its app removed; any other reason is left to the host.
 * One decision per component at a time; resolves once it has been carried out
 * or queued.
 * @param {object} component
 * @param {string} component.identifier `<component>_<app>`, or the app name for v1-3.
 * @param {string} component.appName
 * @param {number} component.version The app specification's version.
 * @param {boolean} component.synced Whether the component's data syncs (g: or r:).
 * @param {string} component.reason Why ensureAppVolumeMounted did not mount it.
 * @returns {Promise<void>}
 */
async function recover({
  identifier, appName, version, synced, reason,
}) {
  if (!isVolumeGone(reason) || recovering.has(identifier)) return;
  recovering.add(identifier);
  try {
    if (!synced) {
      decided(identifier, appName, 'remove', 'its data is not synced');
      localRemovalQueue.queueRemovals([appName]);
      return;
    }
    const last = lastRebuildAt.get(identifier);
    if (last !== undefined && monotonicMs() - last < REBUILD_MIN_INTERVAL_MS) return;
    // A redeploy declines while another operation holds the node; asked again on
    // the reconciler's next pass.
    if (globalState.operationHolding()) return;
    const localSocketAddr = await fluxNetworkHelper.getLocalSocketAddress();
    if (!localSocketAddr) return;
    const elsewhere = await componentStateOnOtherHolders(
      (name) => registryManager.appLocation(name),
      localSocketAddr,
      {
        appIds: [dockerService.getAppIdentifier(identifier)],
        identifier,
        appName,
        liveness: createPeerFolderLiveness(),
        logPrefix: 'lostVolumeRecovery',
      },
    );
    if (elsewhere !== PeerComponent.RUNNING) {
      decided(identifier, appName, 'remove', `no other holder is proven to run it (${elsewhere})`);
      localRemovalQueue.queueRemovals([appName]);
      return;
    }
    const componentName = version >= 4 ? identifier.split('_')[0] : null;
    const specifications = componentName ? null : await registryManager.getApplicationSpecifications(appName);
    if (!componentName && !specifications) {
      log.warn(`lostVolumeRecovery - ${appName} has no specification to rebuild from`);
      return;
    }
    lastRebuildAt.set(identifier, monotonicMs());
    decided(identifier, appName, 'rebuild', 'another holder runs it');
    await rebuilder({ appName, componentName, specifications });
  } catch (error) {
    log.error(`lostVolumeRecovery - ${identifier}: ${error.message}`);
  } finally {
    recovering.delete(identifier);
  }
}

/**
 * Test helper: forgets every rebuild and decision in progress.
 */
function reset() {
  lastRebuildAt.clear();
  recovering.clear();
}

module.exports = {
  REBUILD_MIN_INTERVAL_MS,
  isVolumeGone,
  recover,
  reset,
  setRebuilder,
};
