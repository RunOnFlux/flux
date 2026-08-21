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
      // The key masterSlaveApps elects on, and the name the container carries
      // once the prefix is stripped - so a caller can ask whether THIS node is
      // running the component without reconstructing either.
      identifier,
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
 * @param {Function} deps.isElectedPrimary Three-state: true if this node is the
 *   elected `g:` primary, false if another node provably is, null if the
 *   election cannot say. Required - null and false are not interchangeable here.
 * @param {Function} deps.isComponentRunningLocally Whether a component
 *   identifier is running on this node right now. Required.
 * @returns {Promise<{safe: boolean, code: string, reason: string}>} `code` is
 *   the machine-readable verdict - a refusal because the election cannot answer
 *   reads identically to an idle pass without it, and a node stuck that way
 *   should be visible rather than silent.
 */
async function canSafelyRemoveApp(appName, deps) {
  const {
    appLocation,
    getApplicationGlobalSpecifications,
    findSyncedPeer,
    isElectedPrimary,
    isComponentRunningLocally,
  } = deps;

  try {
    // No default. These used to default to `async () => false`, which answered
    // "no, you are not the primary" to a caller that had not asked anyone - the
    // one unavailable input in this function that proceeded rather than
    // refused. A caller that cannot answer must not be told the removal is
    // safe, so the omission throws and the catch below turns it into a refusal
    // that says so.
    if (typeof isElectedPrimary !== 'function' || typeof isComponentRunningLocally !== 'function') {
      throw new Error('isElectedPrimary and isComponentRunningLocally are required');
    }
    if (globalState.backupInProgress.includes(appName)) {
      return { safe: false, code: 'BACKUP_IN_PROGRESS', reason: 'backup in progress' };
    }
    if (globalState.restoreInProgress.includes(appName)) {
      return { safe: false, code: 'RESTORE_IN_PROGRESS', reason: 'restore in progress' };
    }

    const spec = await getApplicationGlobalSpecifications(appName);
    if (!spec) {
      // No spec means we cannot tell how many instances the app needs, nor
      // whether it keeps state. Both are required to answer safely.
      return { safe: false, code: 'NO_SPEC', reason: 'no global specification available' };
    }

    const localSocketAddr = await fluxNetworkHelper.getLocalSocketAddress();
    if (!localSocketAddr) {
      return { safe: false, code: 'NO_LOCAL_ADDRESS', reason: 'local socket address unknown' };
    }

    const locations = await appLocation(appName);
    if (!Array.isArray(locations) || !locations.length) {
      // An empty list is far more likely to mean the location view has not
      // populated than that the app runs nowhere while installed here.
      return { safe: false, code: 'NO_LOCATIONS', reason: 'no instance locations known' };
    }

    // The serialisation gate. Removing takes the app to N-1, so every other
    // draining holder sees it short and waits; the spawner fills the gap and
    // releases the next one. Acting while it is ALREADY short would take a
    // second copy off an app that is mid-replacement.
    const required = requiredInstances(spec);
    if (locations.length < required) {
      return {
        safe: false,
        code: 'BELOW_INSTANCE_COUNT',
        reason: `app is below its instance count (${locations.length}/${required}), another move is in flight`,
      };
    }

    const synced = syncedComponents(spec);
    const otherHosts = otherHostCount(locations, localSocketAddr);

    if (!synced.length) {
      // Nothing to lose but the container, which the spawner rebuilds from the
      // specification. Removing the only instance is a gap, not a loss.
      return { safe: true, code: 'STATELESS', reason: `stateless app, ${otherHosts} other host(s) hold it` };
    }

    // Past here the volume IS the product.
    if (otherHosts < 1) {
      return { safe: false, code: 'ONLY_HOST', reason: 'stateful app and this is the only host holding it' };
    }

    // ASKED BEFORE THE ELECTION, and that order is the whole of what makes a
    // stand-down safe. A node that holds the only good copy refuses here and
    // never reaches the question below, so standing down can never be the thing
    // that strands an app.
    //
    // On the pass that removes, this is also the proof that everything this node
    // ever wrote has landed elsewhere: by then the component is stopped, so a
    // peer at 100% is a peer holding the final state rather than the state as of
    // a moment before the next write.
    // eslint-disable-next-line no-restricted-syntax
    for (const component of synced) {
      // eslint-disable-next-line no-await-in-loop
      const peer = await findSyncedPeer(component.folderId);
      if (!peer) {
        return {
          safe: false,
          code: 'NO_SYNCED_PEER',
          reason: `no connected peer holds ${component.folderId} in full`,
        };
      }
    }

    // A g: component runs on one node at a time and that node is the one
    // writing to the volume; the rest hold synced copies with the component
    // stopped. So a node not running it cannot be the writer - a local fact,
    // needing neither FDM nor the election, and the reason a load-balancer
    // outage stalls the trim only on the nodes actually holding a writer
    // instead of on all of them.
    const gComponents = synced.filter((component) => component.syncMode === 'g');
    const runningHere = await Promise.all(
      gComponents.map((component) => isComponentRunningLocally(component.identifier)),
    );
    const runningIdentifiers = gComponents
      .filter((_component, index) => runningHere[index])
      .map((component) => component.identifier);
    if (runningIdentifiers.length) {
      const primary = await isElectedPrimary(appName);
      if (primary === null) {
        // Not "there is no primary" - "nobody can tell me who it is". This node
        // is running the writer, so the likeliest reading is that it is the one
        // just promoted and FDM has not caught up. Handing the app back from
        // under it drops whatever it has written since the peer last reported
        // the folder complete.
        return {
          safe: false,
          code: 'ELECTION_UNKNOWN',
          reason: 'this node runs the g: component and the election cannot say who is primary',
        };
      }
      if (primary === true) {
        // Not a removal, and not a refusal to leave - an instruction to stop
        // writing first. The caller stops these components and asks again next
        // pass, by which time the election has given the role to a peer and the
        // check above means something stronger. `standDown` names what to stop,
        // so the caller does not re-derive it from the spec.
        return {
          safe: false,
          code: 'STAND_DOWN_REQUIRED',
          reason: 'this node is the elected primary; stop the component before handing the app back',
          standDown: runningIdentifiers,
        };
      }
    }

    return {
      safe: true,
      code: 'SYNCED_ELSEWHERE',
      reason: `${synced.length} synced component(s) held in full by a connected peer, ${otherHosts} other host(s)`,
    };
  } catch (error) {
    log.warn(`appEvacuationSafety - ${appName}: ${error.message}`);
    return { safe: false, code: 'CHECK_FAILED', reason: `safety check failed: ${error.message}` };
  }
}

module.exports = {
  canSafelyRemoveApp,
  requiredInstances,
  syncedComponents,
  otherHostCount,
};
