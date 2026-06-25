/**
 * Spec-diff helpers for app REDEPLOY (the update path).
 *
 * A redeploy rebuilds an app from a new spec. Historically it tore down and
 * recreated EVERYTHING (container, image, volume, the per-owner docker network,
 * every ufw/UPnP port) even when only the image changed - flapping the cross-app
 * network (the networkWith cascade hazard) and churning the firewall for no reason.
 * These helpers let the redeploy paths apply only the delta between old and new.
 *
 * Scope split (deliberate):
 *  - VOLUME is NOT diffed here: it is the operator's hard-vs-soft choice (hard wipes
 *    the FLUXFSVOL + recreates it fresh, soft keeps it). The on-chain update path
 *    selects hard-vs-soft upstream via its hdd-equality check.
 *  - The app's own NETWORK is kept across a redeploy by default (see below).
 *  - PORTS are diffed per component as a set difference (open new-old, close old-new).
 */

const { appsThatMightBeUsingOldGatewayIpAssignment } = require('../utils/appConstants');
const ComponentRedeployAction = require('./componentRedeployAction');

/**
 * Whether a redeploy must RECREATE the app's own docker network rather than keep it.
 *
 * The network is named `fluxDockerNetwork_<appName>`, derived from the app name, so a
 * redeploy of the same app always yields the identical network - destroying and
 * recreating it produces a byte-identical network while needlessly disconnecting every
 * networkWith consumer attached to it. So we keep it. networkWith LINK changes need no
 * recreate either: the container is always rebuilt and re-attaches to the current link
 * set (a removed link is dropped when its old container is removed). The only apps whose
 * network genuinely must be recreated are the legacy ones still on the old gateway-IP
 * subnet assignment, which need a fresh network to migrate off it.
 *
 * @param {object} spec - app specification (the new/target spec)
 * @returns {boolean} true if the app's own network must be recreated (legacy-gateway app)
 */
function mustRecreateNetwork(spec) {
  const name = spec && spec.name;
  return Boolean(name) && appsThatMightBeUsingOldGatewayIpAssignment.includes(name);
}

/**
 * The set of host ports an app needs open (ufw/UPnP), as a Set of numbers. For a v4+
 * composed app this is the union across components; for a simple app it is spec.ports.
 * ufw/UPnP rules are per-port (not per-component) and FluxOS gives every component a
 * distinct external port, so a flat union is the correct desired-port set for the node.
 *
 * @param {object} spec - app specification
 * @returns {Set<number>}
 */
function appPortSet(spec) {
  const ports = new Set();
  if (!spec) return ports;
  const add = (list) => (Array.isArray(list) ? list : []).forEach((p) => {
    const n = Number(p);
    if (Number.isFinite(n)) ports.add(n);
  });
  if (Array.isArray(spec.compose) && spec.compose.length) {
    spec.compose.forEach((c) => add(c && c.ports));
  } else {
    add(spec.ports);
    // v1 apps carry a singular `port` rather than a `ports` array (mirror normalizePorts).
    if (spec.port != null) {
      const n = Number(spec.port);
      if (Number.isFinite(n)) ports.add(n);
    }
  }
  return ports;
}

/**
 * Port delta between the old (installed) and new spec for a redeploy: the SET DIFFERENCE,
 * so only genuinely added/removed ports touch ufw/UPnP - the intersection (unchanged ports)
 * is left exactly as-is, avoiding the ~1s/port UPnP re-map churn and the firewall flap.
 *
 * @param {object} oldSpec - installed spec
 * @param {object} newSpec - target spec
 * @returns {{toOpen: number[], toClose: number[]}} ports to open (new-old) and close (old-new)
 */
function portDelta(oldSpec, newSpec) {
  const oldPorts = appPortSet(oldSpec);
  const newPorts = appPortSet(newSpec);
  const toOpen = [...newPorts].filter((p) => !oldPorts.has(p));
  const toClose = [...oldPorts].filter((p) => !newPorts.has(p));
  return { toOpen, toClose };
}

// Fields that are NOT part of an app's runtime shape: they change on every
// re-registration/renewal without changing what the node must run. The update
// handler masks them out before deciding whether anything actually changed.
const NON_RUNTIME_FIELDS = ['description', 'expire', 'hash', 'height', 'instances', 'owner'];

/**
 * Whether two specs differ in any RUNTIME-relevant field (everything except the
 * non-runtime fields above). Byte-identical to the inline mask the on-chain update
 * handler used: deep-clone both, delete the non-runtime fields, JSON.stringify-compare.
 * NOTE: like that original, this is key-order sensitive and compares the RAW (not
 * tier-normalised) specs - kept that way deliberately to preserve existing behaviour.
 *
 * @param {object} oldSpec
 * @param {object} newSpec
 * @returns {boolean} true if a runtime field changed
 */
function specsDiffer(oldSpec, newSpec) {
  const a = JSON.parse(JSON.stringify(oldSpec || {}));
  const b = JSON.parse(JSON.stringify(newSpec || {}));
  NON_RUNTIME_FIELDS.forEach((f) => { delete a[f]; delete b[f]; });
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * Whether the volume (FLUXFSVOL) must be reset: the hdd size changed. The on-chain
 * update handler uses this to choose hard (volume reset) vs soft (volume kept) for a
 * spec/component. Direct hdd inequality, matching the original inline checks.
 *
 * @param {object} oldSpec - installed spec/component
 * @param {object} newSpec - target spec/component
 * @returns {boolean} true if hdd changed
 */
function volumeSpecChanged(oldSpec, newSpec) {
  // A missing old spec means there is no existing volume, so one must be created: treat as
  // changed (the hard/reset direction). Guards callers that may pass an undefined installed
  // component (e.g. a component newly ADDED by an update) from a deref TypeError - the total
  // classification lives in classifyComponentRedeploy below, this is defence in depth.
  if (!oldSpec) return true;
  return oldSpec.hdd !== newSpec.hdd;
}

/**
 * Classify how one compose COMPONENT must be handled by a composed-app redeploy, from the
 * installed component spec (or undefined if the update ADDS it) and the target spec. Returns
 * a ComponentRedeployAction member - the single source of truth both reinstallOldApplications
 * reverse-compose loops switch on, so a component that is new/unchanged/soft/hard is decided
 * once, in one tested place, instead of an inline chain that read undefined.hdd for a new
 * component.
 *
 * @param {object} installedComponent - the matching component from the installed app, or undefined when added
 * @param {object} newComponent - the target component spec
 * @returns {string} a ComponentRedeployAction member (NEW / UNCHANGED / SOFT / HARD)
 */
function classifyComponentRedeploy(installedComponent, newComponent) {
  if (!installedComponent) return ComponentRedeployAction.NEW;
  if (JSON.stringify(installedComponent) === JSON.stringify(newComponent)) return ComponentRedeployAction.UNCHANGED;
  // volume (hdd) changed -> reset the volume (hard); otherwise keep it (soft). Mirrors the
  // original inline order (unchanged -> !volumeSpecChanged ? soft : hard).
  if (volumeSpecChanged(installedComponent, newComponent)) return ComponentRedeployAction.HARD;
  return ComponentRedeployAction.SOFT;
}

module.exports = {
  mustRecreateNetwork,
  appPortSet,
  portDelta,
  specsDiffer,
  volumeSpecChanged,
  classifyComponentRedeploy,
};
