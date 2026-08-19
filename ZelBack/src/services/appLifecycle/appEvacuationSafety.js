// Whether this node may give up an app right now.
//
// "Evacuation" is a node shedding the apps it holds. Deliberately not called
// draining: that word already means a socket or buffer emptying in this codebase,
// and in v9 it means an app shedding traffic.
//
// Every existing removal path decides on an instance count alone, and a count
// cannot tell a redundant copy from the last one that holds the data. Two of the
// paths that do it - surplus removal and the geolocation-change redeploy - have
// already destroyed customer volumes. This is the predicate they should all ask.
//
// The answer is deliberately conservative: anything it cannot establish is a
// refusal, because the cost of waiting is a delay and the cost of being wrong is
// an unrecoverable `rm -rf`.

const config = require('config');
const log = require('../../lib/log');
const dockerService = require('../dockerService');
const globalState = require('../utils/globalState');
const mountParser = require('../utils/mountParser');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const { socketAddressesMatch, extractIp } = require('../utils/socketAddressUtils');

/**
 * How many running instances the network insists this app keeps. Mirrors the
 * spawner's deficit test (`$lt: [actual, {$ifNull: [instances, 3]}]`) exactly:
 * the drain works by creating a deficit the spawner then fills, so a different
 * idea of "enough" here would either stall the drain or leave the app short.
 * @param {object} spec Global app specification.
 * @returns {number}
 */
function requiredInstances(spec) {
  return spec.instances ?? config.fluxapps.minimumInstances;
}

/**
 * The components of an app that keep synced state, with the syncthing folder id
 * each one owns. Folder ids ARE app identifiers.
 * @param {object} spec Global app specification.
 * @returns {Array<{name: string, syncMode: string, folderId: string}>}
 */
function syncedComponents(spec) {
  const components = spec.version >= 4 && Array.isArray(spec.compose) ? spec.compose : [spec];
  return components.reduce((acc, component) => {
    const syncMode = mountParser.getComponentSyncMode(component.containerData || '');
    if (!syncMode) return acc;
    const identifier = spec.version >= 4 && Array.isArray(spec.compose)
      ? `${component.name}_${spec.name}`
      : spec.name;
    acc.push({
      name: component.name || spec.name,
      syncMode,
      folderId: dockerService.getAppIdentifier(identifier),
    });
    return acc;
  }, []);
}

/**
 * Instances that are not this node, counted one per physical host.
 *
 * Several FluxNode registrations routinely share one machine and one connection,
 * so two locations at the same address were never two copies: they fail together,
 * and on a residential line they are being drained together. Counting them
 * separately is how an app with "two instances" loses both.
 * @param {Array<{ip: string}>} locations Instance locations for the app.
 * @param {string} localSocketAddr This node's socket address.
 * @returns {number} Distinct other hosts holding the app.
 */
function otherHostCount(locations, localSocketAddr) {
  const localIp = extractIp(localSocketAddr);
  const hosts = new Set();
  locations.forEach((location) => {
    if (socketAddressesMatch(location.ip, localSocketAddr)) return;
    const ip = extractIp(location.ip);
    if (ip && ip !== localIp) hosts.add(ip);
  });
  return hosts.size;
}

/**
 * May this node remove this app right now?
 *
 * @param {string} appName Global app name.
 * @param {object} deps Injected collaborators, so this is testable without a
 *   database, a docker daemon or a syncthing process.
 * @param {Function} deps.appLocation Instance locations for an app name.
 * @param {Function} deps.getApplicationGlobalSpecifications Global spec for an app name.
 * @param {Function} deps.findSyncedPeer Connected peer that holds a folder, or null.
 * @param {Function} [deps.isElectedPrimary] Whether this node currently runs the
 *   `g:` component as primary.
 * @returns {Promise<{safe: boolean, reason: string}>}
 */
async function canSafelyRemoveApp(appName, deps) {
  const {
    appLocation,
    getApplicationGlobalSpecifications,
    findSyncedPeer,
    isElectedPrimary = async () => false,
  } = deps;

  try {
    if (globalState.backupInProgress.includes(appName)) {
      return { safe: false, reason: 'backup in progress' };
    }
    if (globalState.restoreInProgress.includes(appName)) {
      return { safe: false, reason: 'restore in progress' };
    }

    const spec = await getApplicationGlobalSpecifications(appName);
    if (!spec) {
      // No spec means we cannot tell how many instances the app needs, nor
      // whether it keeps state. Both are required to answer safely.
      return { safe: false, reason: 'no global specification available' };
    }

    const localSocketAddr = await fluxNetworkHelper.getLocalSocketAddress();
    if (!localSocketAddr) {
      return { safe: false, reason: 'local socket address unknown' };
    }

    const locations = await appLocation(appName);
    if (!Array.isArray(locations) || !locations.length) {
      // An empty list is far more likely to mean the location view has not
      // populated than that the app runs nowhere while installed here.
      return { safe: false, reason: 'no instance locations known' };
    }

    // The serialisation gate. Removing takes the app to N-1, so every other
    // draining holder sees it short and waits; the spawner fills the gap and
    // releases the next one. Acting while it is ALREADY short would take a
    // second copy off an app that is mid-replacement.
    const required = requiredInstances(spec);
    if (locations.length < required) {
      return {
        safe: false,
        reason: `app is below its instance count (${locations.length}/${required}), another move is in flight`,
      };
    }

    const synced = syncedComponents(spec);
    const otherHosts = otherHostCount(locations, localSocketAddr);

    if (!synced.length) {
      // Nothing to lose but the container, which the spawner rebuilds from the
      // specification. Removing the only instance is a gap, not a loss.
      return { safe: true, reason: `stateless app, ${otherHosts} other host(s) hold it` };
    }

    // Past here the volume IS the product.
    if (otherHosts < 1) {
      return { safe: false, reason: 'stateful app and this is the only host holding it' };
    }

    if (await isElectedPrimary(appName)) {
      return { safe: false, reason: 'this node is the elected primary; stand down first' };
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const component of synced) {
      // eslint-disable-next-line no-await-in-loop
      const peer = await findSyncedPeer(component.folderId);
      if (!peer) {
        return {
          safe: false,
          reason: `no connected peer holds ${component.folderId} in full`,
        };
      }
    }

    return {
      safe: true,
      reason: `${synced.length} synced component(s) held in full by a connected peer, ${otherHosts} other host(s)`,
    };
  } catch (error) {
    log.warn(`appEvacuationSafety - ${appName}: ${error.message}`);
    return { safe: false, reason: `safety check failed: ${error.message}` };
  }
}

module.exports = {
  canSafelyRemoveApp,
  requiredInstances,
  syncedComponents,
  otherHostCount,
};
