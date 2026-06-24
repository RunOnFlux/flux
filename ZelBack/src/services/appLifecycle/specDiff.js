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

module.exports = {
  mustRecreateNetwork,
};
