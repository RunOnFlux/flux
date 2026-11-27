// Resource Query Service - Query functions for app and node resource usage
const config = require('config');
const dbHelper = require('../dbHelper');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const generalService = require('../generalService');
const registryManager = require('../appDatabase/registryManager');
const hwRequirements = require('../appRequirements/hwRequirements');
const appConstants = require('../utils/appConstants');
const admissionControl = require('../utils/admissionControl');
const log = require('../../lib/log');

// Import appQueryService to avoid circular dependency (will be cleaned up later)
const appQueryService = require('./appQueryService');

/**
 * Get application usage statistics
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {object} Message.
 */
async function fluxUsage(req, res) {
  try {
    const apps = await registryManager.getInstalledApps();
    const totalApps = apps.length;
    const runningApps = await appQueryService.listRunningApps();
    const totalRunning = runningApps.data ? runningApps.data.length : 0;

    // Ensure node specs are loaded before accessing them
    const nodeSpecs = await hwRequirements.getNodeSpecs();

    const usage = {
      totalApps,
      runningApps: totalRunning,
      stoppedApps: totalApps - totalRunning,
      nodeSpecs,
    };

    const dataResponse = messageHelper.createDataMessage(usage);
    return res ? res.json(dataResponse) : dataResponse;
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

/**
 * What this node has committed to the applications it holds, and which of them it
 * could not read.
 *
 * An enterprise app is stored locally with its components emptied - they are the
 * customer's decrypted configuration and do not belong in a local database - so
 * counting the stored row directly credits that app with no cpu, no memory and
 * no disk at all, including the fixed overhead every component carries. It is
 * not skipped by a rule: it takes the ordinary path, finds an empty list and
 * adds nothing. That total is what the node subtracts from its own capacity
 * before accepting another app, so a node holding enterprise apps believes it
 * is emptier than it is and keeps taking work it cannot run.
 *
 * So the specifications are decrypted first, through the cached path: it keys on
 * the spec hash, shares one attempt between concurrent callers and remembers a
 * failure briefly, none of which the raw decrypt does - and this is reached from
 * two public endpoints, so a decrypt per caller would be an amplifier into
 * fluxbenchd. Unformatted, because the formatter strips the hash the cache keys
 * on and nothing here reads a formatted field.
 *
 * `unreadable` is the names it could not decrypt, and it is the reason this
 * returns two things rather than three numbers. An app whose components cannot
 * be read contributes nothing, which is indistinguishable from an app that
 * reserves nothing - the caller has to be able to tell those apart, because one
 * of them means this node cannot account for itself. It does not leave the
 * process: the API halves publish the totals alone.
 *
 * @param {object} [options]
 * @param {string} [options.excludeApp] Name of an installed app left out of the totals.
 * @returns {object} Message carrying {appsCpusLocked, appsRamLocked, appsHddLocked, unreadable}.
 *   Rejects with the original error when the installed apps cannot be read: a
 *   node that cannot count what it has committed has no totals to give.
 */
async function appsResources({ excludeApp } = {}) {
  log.info('Checking appsResources');
  const dbopen = dbHelper.databaseConnection();
  const appsDatabase = dbopen.db(config.database.appslocal.database);
  const appsQuery = excludeApp ? { name: { $ne: excludeApp } } : {};
  const appsProjection = { projection: { _id: 0 } };
  const stored = await dbHelper.findInDatabase(appsDatabase, appConstants.localAppsInformation, appsQuery, appsProjection);

  // eslint-disable-next-line global-require
  const { decryptEnterpriseApps } = require('./appQueryService');
  const { inPlace: appsResult, unreadable } = await decryptEnterpriseApps(stored, { formatSpecs: false });

  const tier = await generalService.nodeTier().catch((error) => log.error(error));
  const reservations = admissionControl.reserved();
  if (excludeApp) reservations.delete(excludeApp);

  let appsCpusLocked = 0;
  let appsRamLocked = 0;
  let appsHddLocked = 0;
  const count = ({ cpu, ram, hdd }) => {
    appsCpusLocked += cpu;
    appsRamLocked += ram;
    appsHddLocked += hdd;
  };
  // An app holding a reservation is counted by it, not by its row.
  const apps = Array.isArray(appsResult) ? appsResult : [];
  apps.filter((app) => !reservations.has(app.name)).forEach((app) => count(appFootprint(app, tier)));
  reservations.forEach(count);
  const appsUsage = {
    appsCpusLocked,
    appsRamLocked,
    appsHddLocked,
    unreadable: unreadable.map((app) => app.name),
  };
  return messageHelper.createDataMessage(appsUsage);
}

/**
 * What an app takes of the node: its cpu cores, ram (MB) and disk (GB), with the
 * filesystem minimum and swap each component's volume carries.
 * @param {object} app App specification, decrypted.
 * @param {string|undefined} tier The node's tier; undefined counts untiered sizes.
 * @returns {{cpu: number, ram: number, hdd: number}}
 */
function appFootprint(app, tier) {
  const perVolume = config.fluxapps.hddFileSystemMinimum + config.fluxapps.defaultSwap;
  const sized = (spec) => {
    const tiered = spec.tiered && tier;
    return {
      cpu: serviceHelper.ensureNumber(tiered ? spec[`cpu${tier}`] || spec.cpu : spec.cpu) || 0,
      ram: serviceHelper.ensureNumber(tiered ? spec[`ram${tier}`] || spec.ram : spec.ram) || 0,
      hdd: (serviceHelper.ensureNumber(tiered ? spec[`hdd${tier}`] || spec.hdd : spec.hdd) || 0) + perVolume,
    };
  };
  if (app.version >= 4) {
    return app.compose.map(sized).reduce((sum, each) => ({
      cpu: sum.cpu + each.cpu, ram: sum.ram + each.ram, hdd: sum.hdd + each.hdd,
    }), { cpu: 0, ram: 0, hdd: 0 });
  }
  return sized(app);
}

/**
 * The applications this node holds but cannot size.
 *
 * One whose specification cannot be read contributes nothing to the totals,
 * which is indistinguishable from one that reserves nothing - so a decision that
 * subtracts those totals from the node's capacity believes space is free that is
 * already spoken for.
 *
 * Offered rather than enforced here, because the answer differs by caller.
 * Taking on NEW work while this is non-empty over-commits the node. Maintaining
 * work it already holds does not: a redeploy of an app already counted adds
 * nothing, and refusing there would freeze every other application on the node
 * over one it cannot read.
 *
 * @param {object} response - what appsResources answered with
 * @returns {string[]} the names, empty when the totals account for everything
 */
function unaccountedApps(response) {
  if (response.status !== 'success') return [];

  return response.data.unreadable || [];
}

/**
 * The committed totals, and nothing else.
 *
 * Three numbers, node-wide, exactly as this has always answered. `unreadable`
 * stops here: the names are already public on chain, but "this node is holding an
 * application it cannot read" is a statement about the node's health that nobody
 * outside it needs.
 *
 * @param {object} req Request.
 * @param {object} res Response.
 * @returns {Promise<void>}
 */
async function appsResourcesApi(req, res) {
  let response;
  try {
    response = await appsResources();
  } catch (error) {
    log.error(error);
    res.json(messageHelper.createErrorMessage(error.message || error, error.name, error.code));
    return;
  }

  const { appsCpusLocked, appsRamLocked, appsHddLocked } = response.data;
  res.json(messageHelper.createDataMessage({ appsCpusLocked, appsRamLocked, appsHddLocked }));
}

/**
 * The same three numbers, for a caller inside this process that publishes them.
 * @param {object} usage - what appsResources answered with
 * @returns {object} {appsCpusLocked, appsRamLocked, appsHddLocked}
 */
function publicResourceView(usage) {
  const { appsCpusLocked, appsRamLocked, appsHddLocked } = usage;

  return { appsCpusLocked, appsRamLocked, appsHddLocked };
}

module.exports = {
  fluxUsage,
  appsResources,
  appFootprint,
  unaccountedApps,
  appsResourcesApi,
  publicResourceView,
};
