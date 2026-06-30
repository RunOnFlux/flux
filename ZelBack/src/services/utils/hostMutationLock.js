const { AsyncLock } = require('./asyncLock');

// Node-wide serial lock guarding the cross-app-unsafe HOST mutations that several FluxOS
// subsystems perform: the ufw ruleset (fluxNetworkHelper allowPort/deleteAllowPortRule ->
// `sudo ufw ...`), the UPnP IGD client (upnpService mapUpnpPort/removeMapUpnpPort), and the
// content-addressed docker image store (appDockerImageRemove, used by teardown, the cold-image
// reaper, and watchtower cleanup). These are each a single physical host resource; two concurrent
// operations (e.g. an app install opening a port while a removal deletes one, or the reaper
// removing a cold image while a teardown removes another)
// corrupt the firewall ruleset / router session / image store. One shared lock across ALL
// callers (removal teardown, install port-open, prelaunch port-probe, availability self-test,
// watchtower cleanup, cold-image reaper) is the single serialization point.
//
// Usage rules (load-bearing — see asyncLock.js disable()==shift-the-head):
//   - Acquire ONLY via withHostMutationLock; one enable() is paired with exactly one
//     disable() in its finally. maxConcurrent=1 keeps acquisition strictly serial FIFO so
//     disable() always resolves the calling holder. NEVER raise maxConcurrent.
//   - Wrap ONLY the host mutation call(s). NEVER hold the lock across an UNBOUNDED wait: no
//     test-bind, no peer-reachability probe, no image pull, no container graceful-drain, no
//     serviceHelper.delay. Two acquisition granularities are in use, both correct:
//       (a) leaf, per-call (install port-open, prelaunch probe, availability self-test,
//           watchtower cleanup, cold-image reaper): in a multi-port loop acquire/release PER PORT
//           (each UPnP call carries ~1s of internal pacing), and the reaper acquires PER IMAGE,
//           so the longest a holder blocks others is one call;
//       (b) per-APP, for the removal teardown (appUninstaller.runTeardown Phase B): ONE
//           acquisition wraps a whole app's components' host teardown + its docker-network
//           removal. This is deliberate (one lock once per app, not per component) — the
//           graceful drain already ran OUTSIDE it, and the steps inside are bounded host
//           ops (ufw/UPnP/umount/rm -rf/image/network), no unbounded wait. The head-of-line
//           cost of holding it across an app's components is accepted at current contention.
//   - NEVER acquire while already holding it (no nesting) — AsyncLock(1) would deadlock.
//     In particular do not wrap any region that transitively calls removeAppLocally (the
//     teardown path acquires this lock): e.g. portManager.restoreAppsPortsSupport.
//
// Deliberately NOT serialized (documented scope boundary):
//   - the graceful container drain (appDockerStopGracefulOrKill, up to 3900s) — per-app,
//     kept outside so one drain can't head-of-line every other host mutation;
//   - fluxNetworkHelper.allowPortApi / upnpService.*Api admin-gated manual REST handlers and
//     once-at-boot node-self plumbing (restoreFluxPortsSupport/adjustFirewall) — rare, not a
//     per-app lifecycle race;
//   - the shared host crontab rewrites (crontab.save in advancedWorkflows / volumeValidation /
//     crontabAndMountsCleanup) — a follow-up "second wave"; one of those callers itself calls
//     removeAppLocally, so wrapping needs leaf-only re-entrancy care.
const hostMutationLock = new AsyncLock(1);

/**
 * Run fn while holding the node-wide host-mutation lock. fn must perform ONLY a leaf host
 * mutation (a single ufw / UPnP / image-store call) and contain no long wait. Returns fn's
 * result; the lock is always released (finally), even if fn throws.
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
async function withHostMutationLock(fn) {
  await hostMutationLock.enable();
  try {
    return await fn();
  } finally {
    hostMutationLock.disable();
  }
}

module.exports = { withHostMutationLock };
