const dockerService = require('../dockerService');
const appQueryService = require('../appQuery/appQueryService');
const log = require('../../lib/log');

/**
 * Remove app networks no installed app accounts for.
 *
 * A network is created per app and removed by the uninstaller, and by nothing
 * else. An uninstall interrupted between the container going and the network
 * going - a reboot, a crash, a removal that failed both its retries - leaves
 * one behind for ever, because nothing looks again.
 *
 * Each holds an explicitly assigned `172.23.<octet>.0/24`, and the octet is
 * taken from a walk of 1..255 for one nothing is using. A leaked network keeps
 * its octet permanently, so the cost is not untidiness: when the last octet is
 * gone, no app can be installed on the node again.
 *
 * Runs at startup, before anything installs. A sweep must never meet an install
 * in progress - there is a moment in one where the network exists and the
 * database record does not - and at boot no such moment exists.
 *
 * The names are built from the app records rather than parsed back out of the
 * networks: an app name can only be recovered from `fluxDockerNetwork_<name>`
 * by assuming what a name may contain, and being wrong there removes a live
 * app's network.
 *
 * A list that cannot be read means every network looks unowned, so nothing is
 * removed rather than everything.
 *
 * @returns {Promise<string[]>} the networks reclaimed
 */
async function reclaimOrphanedAppNetworks() {
  try {
    const installed = await appQueryService.installedApps();
    if (!installed || installed.status !== 'success' || !Array.isArray(installed.data)) {
      log.warn('networkRecovery - the installed app list could not be read; no network was reclaimed');
      return [];
    }

    const expected = new Set(installed.data.map((app) => `fluxDockerNetwork_${app.name}`));
    const reclaimed = await dockerService.reclaimAppNetworks(expected);
    if (reclaimed.length) {
      log.info(`networkRecovery - reclaimed ${reclaimed.length} app network(s) no installed app owns: ${reclaimed.join(', ')}`);
    }
    return reclaimed;
  } catch (error) {
    log.error(`networkRecovery - could not reclaim app networks: ${error.message}`);
    return [];
  }
}

module.exports = { reclaimOrphanedAppNetworks };
