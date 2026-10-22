/**
 * A hard redeploy: an app removed from this node, data and all, and installed again
 * at a specification, the whole app at once. The one way an app is rebuilt from
 * nothing; the callers decide when, and hold the node while it runs.
 */
const log = require('../../lib/log');
const fluxEventBus = require('../utils/fluxEventBus');
const appUninstaller = require('./appUninstaller');
const appInstaller = require('./appInstaller');
const { RemovalOutcome } = require('../utils/removalOutcome');
const { InstallOutcome } = require('../utils/installOutcome');

/**
 * Remove the app and install it again at appSpecs.
 *
 * Nothing is installed unless the removal finished. A node busy with another removal
 * leaves the app as it was; a removal that stopped part way is finished by the
 * uninstaller, which removes the whole app and tells the network. Once the removal
 * has finished this node holds nothing of the app, so an install that does not
 * complete is told to the network, once, here.
 * @param {object} appSpecs The specification to install.
 * @param {object} [res] A response stream the caller holds.
 * @returns {Promise<string>} The InstallOutcome; BUSY when another removal held the
 *   node, FAILED when the removal did not finish.
 */
async function rebuildApp(appSpecs, res) {
  const removal = await appUninstaller.removeAppLocally(appSpecs.name, res, false, false);
  if (removal !== RemovalOutcome.REMOVED && removal !== RemovalOutcome.NOT_INSTALLED) {
    log.warn(`appRebuild - ${appSpecs.name} was not removed (${removal}), so it is not reinstalled`);
    const outcome = removal === RemovalOutcome.BUSY ? InstallOutcome.BUSY : InstallOutcome.FAILED;
    fluxEventBus.publish('app:rebuilt', { name: appSpecs.name, outcome });
    return outcome;
  }

  let outcome;
  try {
    await appInstaller.checkAppRequirements(appSpecs);
    // the installer's own teardown says nothing: whether to tell the network is decided below
    outcome = await appInstaller.registerAppLocally(appSpecs, undefined, res, false, false);
  } catch (error) {
    log.error(`appRebuild - ${appSpecs.name} was not reinstalled: ${error.message}`);
    outcome = InstallOutcome.FAILED;
  }

  if (outcome !== InstallOutcome.INSTALLED && removal === RemovalOutcome.REMOVED) {
    log.warn(`appRebuild - ${appSpecs.name} was removed and not reinstalled (${outcome}); telling the network`);
    await appUninstaller.announceRemoval(appSpecs.name)
      .catch((error) => log.error(`appRebuild - the removal of ${appSpecs.name} was not announced: ${error.message}`));
  }
  fluxEventBus.publish('app:rebuilt', { name: appSpecs.name, outcome });
  return outcome;
}

module.exports = { rebuildApp };
