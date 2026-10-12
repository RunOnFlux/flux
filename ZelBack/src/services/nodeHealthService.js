const config = require('config');
const os = require('os');
const log = require('../lib/log');
const messageHelper = require('./messageHelper');
const dbHelper = require('./dbHelper');
const generalService = require('./generalService');
const daemonServiceMiscRpcs = require('./daemonService/daemonServiceMiscRpcs');
const dockerService = require('./dockerService');
const syncthingService = require('./syncthingService');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const appInspector = require('./appManagement/appInspector');
const { isDaemonUnavailable } = require('./utils/routeGuards');

/**
 * What one fitness check found, as /flux/health reports it per check.
 * OK: checked and passed. UNMEASURED: the check could not be run; it refuses
 * nobody. DEGRADED: failing, but it does not decide this node's fitness. FAIL:
 * failing; the node is unfit.
 */
const CHECK = Object.freeze({
  OK: 'ok',
  UNMEASURED: 'unmeasured',
  DEGRADED: 'degraded',
  FAIL: 'fail',
});

/**
 * The syncthing check for each syncthing health state, where that state does
 * not make the node unfit. syncthingService names its own states; this is the
 * one place they become /flux/health's.
 */
const SYNCTHING_CHECK = Object.freeze({
  [syncthingService.SYNCTHING_HEALTH.OK]: CHECK.OK,
  [syncthingService.SYNCTHING_HEALTH.UNMEASURED]: CHECK.UNMEASURED,
  [syncthingService.SYNCTHING_HEALTH.UNHEALTHY]: CHECK.DEGRADED,
});

/**
 * Whether the node meets its tier's RAM and CPU thread requirements. The tier
 * comes from the node's collateral as the daemon reports it: while the daemon
 * cannot be read the check is UNMEASURED, and a node whose collateral makes it
 * no tier FAILs.
 * @returns {Promise<{result: string, reason: (string|undefined), cause: (string|undefined)}>}
 *   result is CHECK.OK, CHECK.FAIL or CHECK.UNMEASURED. A FAIL carries `reason`,
 *   which says why for the operator and may carry what was measured, and
 *   `cause`, which names the failure and stays the same while it holds:
 *   noCollateral, outputMissing, noTier, ram or cpu.
 */
async function confirmNodeTierHardware() {
  let collateralTier;
  try {
    collateralTier = await generalService.nodeCollateralTier();
  } catch (error) {
    if (!isDaemonUnavailable(error)) log.error(error);
    return { result: CHECK.UNMEASURED };
  }

  const { collateral, tier, missingOutput } = collateralTier;
  if (missingOutput) {
    return { result: CHECK.FAIL, reason: `Node collateral output ${missingOutput} not found`, cause: 'outputMissing' };
  }
  if (collateral === null) return { result: CHECK.FAIL, reason: 'Node has no collateral', cause: 'noCollateral' };
  if (!tier) return { result: CHECK.FAIL, reason: `Node collateral (${collateral}) matches no Flux Node tier`, cause: 'noTier' };

  const nodeRam = os.totalmem() / 1024 / 1024 / 1024;
  const nodeCpuThreads = os.cpus().length;
  if (nodeRam < tier.minRamGb) {
    return { result: CHECK.FAIL, reason: `Node Total Ram (${nodeRam}) below ${tier.label} requirements`, cause: 'ram' };
  }
  if (nodeCpuThreads < tier.minCpuThreads) {
    return { result: CHECK.FAIL, reason: `Node Cpu Threads (${nodeCpuThreads}) below ${tier.label} requirements`, cause: 'cpu' };
  }
  return { result: CHECK.OK };
}

/**
 * The verdict this node last reached, so a failure is logged when it HAPPENS
 * rather than every time somebody asks.
 *
 * The condition is not the event. /id/loginphrase is uncached and fluxbench
 * retries it on a 30s sleep while a node is failing, so logging at the point of
 * refusal would put out a line every half minute for a state that has not moved
 * - roughly 2,880 a day, burying the one line that says when it started under
 * thousands of copies of itself. A level cannot fix that; it only decides who
 * sees the flood.
 *
 * Keyed on the failing check and the cause of its failure. A check that names
 * its cause is keyed on that: the hardware message carries the RAM the node
 * measured, and a hypervisor that balloons memory moves that figure while the
 * node fails for the same cause. Every other check is keyed on its message,
 * never the DOS code: the code climbs as the score accrues (11, 13, 15), and
 * keying on it would make every increment a fresh line. A message that
 * genuinely changes IS news.
 *
 * The check prefix is there so a check added later that reuses an existing
 * message or cause still reads as a change of verdict rather than as the same
 * one.
 *
 * Starts at ok, so a node that boots fit says nothing and a node that boots
 * unfit says so once.
 */
let lastFitnessVerdict = 'ok';

/**
 * Refuse the node, logging only if this is not what it was already refusing for.
 * Every failing return goes through here so a check added later cannot be
 * silent by omission.
 * @param {string} check The failing check.
 * @param {object} error What the caller is answered with.
 * @param {object} checks The checks run so far.
 * @param {string} [cause] Names the failure while it holds; the message is used
 *   when the check names none.
 */
function unfit(check, error, checks, cause) {
  const verdict = `${check}:${cause ?? error.message}`;
  if (verdict !== lastFitnessVerdict) {
    lastFitnessVerdict = verdict;
    log.warn(`Node is not fit to serve the network: ${check} - ${error.message || error.name}`);
  }
  return {
    ok: false, error, failed: check, checks: { ...checks, [check]: CHECK.FAIL },
  };
}

/**
 * Pass the node, saying so only if it was previously refusing.
 */
function fit(checks) {
  if (lastFitnessVerdict !== 'ok') {
    lastFitnessVerdict = 'ok';
    log.info('Node is fit to serve the network again');
  }
  return {
    ok: true, error: null, failed: null, checks,
  };
}

/**
 * Assess node fitness: the checks that decide whether this node can serve the
 * network. /flux/health reports them and /id/loginphrase gates on them.
 * Returns the first failing check; never throws. Logs a change of verdict, not
 * the verdict - see lastFitnessVerdict.
 * @returns {Promise<{ok: boolean, error: (object|null), failed: (string|null), checks: object}>}
 *   `checks` maps each check run to a CHECK value; `failed` names the one that
 *   made the node unfit, which reads CHECK.FAIL.
 */
async function checkNodeFitness() {
  const checks = {};

  // db: a fast read proves the local database answers
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.local.database);
    const collection = config.database.local.collections.activeLoginPhrases;
    await dbHelper.findOneInDatabase(database, collection, { loginPhrase: 'TestLoginPhraseForDBTest' }, {});
    checks.db = CHECK.OK;
  } catch (error) {
    return unfit('db', { message: error.message, name: error.name, code: error.code }, checks);
  }

  // syncthing: measured everywhere, but it only decides fitness where FluxOS
  // owns the daemon, and only once there is a measurement to decide on.
  //
  // This check exists because a legacy operator's syncthing may be absent,
  // mis-installed, wrongly owned or simply killed - which is why the whole
  // repair path (stop, install, configure, spawn) and the ownership dance are
  // held to the same question. Where we do not own it - Arcane ships and
  // supervises its own - FluxOS has no way to restart it, so failing the node
  // here would take it off the network for a fault it neither caused nor can
  // repair. Asked of syncthingService rather than re-derived from the node type,
  // because the two are not the same question and answering it twice is how
  // they drift. The app path is unaffected either way: mount-safety, folder
  // state and the active-standby election each hold their own syncthing
  // readiness and stand down on it without help from here.
  //
  // Unmeasured refuses nobody: until the sentinel has started there is no
  // reading, and a slow daemon at boot delays the sentinel.
  const syncthingState = syncthingService.healthState();
  if (syncthingState === syncthingService.SYNCTHING_HEALTH.UNHEALTHY && syncthingService.ownsSyncthing()) {
    const error = new Error('Syncthing is not running properly');
    return unfit('syncthing', { message: error.message, name: error.name, code: error.code }, checks);
  }
  checks.syncthing = SYNCTHING_CHECK[syncthingState];

  // docker: listing images proves the daemon answers
  try {
    await dockerService.dockerListImages();
    checks.docker = CHECK.OK;
  } catch (error) {
    return unfit('docker', { message: error.message, name: error.name, code: error.code }, checks);
  }

  // daemon: whether fluxd answers and has caught up with the chain. Reported,
  // never refused on: a daemon catching up after a restart reads the same as one
  // that has stopped answering, and daemonHealthMonitor acts on one that stays so.
  checks.daemon = daemonServiceMiscRpcs.isDaemonSynced().data.synced ? CHECK.OK : CHECK.DEGRADED;

  // hardware: the node must still meet its tier requirements
  const hardware = await confirmNodeTierHardware();
  if (hardware.result === CHECK.FAIL) {
    return unfit('hardware', { message: hardware.reason, name: 'Error', code: undefined }, checks, hardware.cause);
  }
  checks.hardware = hardware.result;

  // DOS state. getDOSState answers with createDataMessage, which hardcodes
  // status 'success', so there is no error shape to branch on; its data is
  // dosState and dosMessage.
  const { data: dos } = fluxNetworkHelper.getDOSState();
  if (dos.dosState > 10 || dos.dosMessage !== null) {
    let error = { message: dos.dosMessage, name: 'DOS', code: dos.dosState };
    if (dos.dosMessage !== 'Flux IP detection failed' && dos.dosMessage !== 'Flux collision detection. Another ip:port is confirmed on flux network with the same collateral transaction information.') {
      error = { message: dos.dosMessage, name: 'CONNERROR', code: dos.dosState };
    }
    return unfit('dos', error, checks);
  }
  checks.dos = CHECK.OK;

  // Apps DOS state
  const dosAppsState = appInspector.getAppsDOSState();
  if (dosAppsState.status === 'success' && dosAppsState.data.dosState >= 100) {
    return unfit('appsDos', { message: dosAppsState.data.dosMessage, name: 'DOS', code: dosAppsState.data.dosState }, checks);
  }
  checks.appsDos = CHECK.OK;

  return fit(checks);
}

/**
 * Node health endpoint. Reports whether this node is fit to serve the network,
 * using the same checks /id/loginphrase gates on. GET /flux/health.
 *
 * Always HTTP 200. Fit: a success message whose data maps each check to a
 * CHECK value. Unfit: an error message (code, name, message) whose data also
 * carries `failed`, the check that refused the node, and `checks`, every check
 * run up to and including it.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function nodeHealth(_, res) {
  try {
    const fitness = await checkNodeFitness();
    if (!fitness.ok) {
      const errMessage = messageHelper.createErrorMessage(fitness.error.message, fitness.error.name, fitness.error.code);
      errMessage.data.failed = fitness.failed;
      errMessage.data.checks = fitness.checks;
      res.json(errMessage);
      return;
    }
    res.json(messageHelper.createDataMessage(fitness.checks));
  } catch (error) {
    log.error(error);
    res.json(messageHelper.createErrorMessage(error.message, error.name, error.code));
  }
}

module.exports = {
  CHECK,
  checkNodeFitness,
  confirmNodeTierHardware,
  nodeHealth,
};
