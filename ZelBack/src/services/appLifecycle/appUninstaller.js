const util = require('util');
const systemcrontab = require('crontab');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const messageHelper = require('../messageHelper');
const dockerService = require('../dockerService');
const imageReaper = require('./imageReaper');
const dbHelper = require('../dbHelper');
const globalState = require('../utils/globalState');
const fluxosTrial = require('../utils/fluxosTrial');
const operationRegistry = require('../utils/operationRegistry');
const folderStates = require('../appMonitoring/folderStates');
const log = require('../../lib/log');
const {
  localAppsInformation, globalAppsInformation, globalAppsMessages, appsFolder,
} = require('../utils/appConstants');
const config = require('config');
// const advancedWorkflows = require('./advancedWorkflows'); // Moved to dynamic require to avoid circular dependency
const upnpService = require('../upnpService');
const portReconciler = require('../portReconciler');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const nodeConfirmationService = require('../nodeConfirmationService');
const { availableApps } = require('../appDatabase/registryManager');
const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');
const { specificationFormatter } = require('../utils/appSpecHelpers');
const { stopAppMonitoring } = require('../appManagement/appInspector');
const appsRuntimeState = require('../appManagement/appsRuntimeState');
const appPlacements = require('../appManagement/appPlacements');
const volumeService = require('../utils/volumeService');
const fluxEventBus = require('../utils/fluxEventBus');
const appSlice = require('./appSlice');
const { Privilege, authOf } = require('../utils/privileges');
const { RemovalOutcome } = require('../utils/removalOutcome');
const appRemovedMessage = require('../utils/appRemovedMessage');
const { untilSucceeds, BOOT_STEP_RETRY_MS } = require('../utils/untilSucceeds');

/**
 * The node does not hold this application.
 *
 * WHAT MARKS IT IS THE TYPE, NOT THE WORDS. A caller that has to tell "it is not here"
 * from "the removal did not complete" reads the mark; the message is the body these
 * endpoints answer with, and belongs to whoever reads the response stream.
 *
 * `name` is left as Error's, because it is serialised into that same body.
 */
class AppNotFoundError extends Error {
  constructor() {
    super('Flux App not found');
  }
}

const crontabLoad = util.promisify(systemcrontab.load);

// Fired once per component identifier after a successful local removal, beside
// the durable runtime-state clear (mirrors appInstaller.setOnInstallComplete).
// serviceManager wires it to appReconciler.forgetDesiredState so every
// in-memory verdict about the component dies with it - a
// back-require of appReconciler here would capture a stale partial export
// (appReconciler already requires this module and both replace module.exports).
let onComponentRemoved = null;
function setOnComponentRemoved(callback) {
  onComponentRemoved = callback;
}

// Apps whose removal stopped part way, each being run again until it finishes, with
// whether the run that finishes it is still to tell the network.
const unfinishedRemovals = new Map();

/**
 * Runs the removal of an app that stopped part way again until it finishes. Until
 * then the app is held as departing: the reconciler never starts it and the node's
 * announcements leave it out. A call for an app already held does nothing.
 * @param {string} appName
 * @param {boolean} force Passed to each removal.
 * @param {boolean} announce Whether the removal that finishes tells the network; it
 *   does not once the network has been told meanwhile (announceRemoval).
 * @returns {void}
 */
function finishRemoval(appName, force, announce) {
  if (unfinishedRemovals.has(appName)) return;
  const pending = { announce };
  unfinishedRemovals.set(appName, pending);
  globalState.departingApps.enter(appName);
  log.warn(`${appName} was not fully removed; held stopped and unannounced until it is`);
  // first run once the removal that stopped has ended, so it is not answered by that removal
  serviceHelper.delay(BOOT_STEP_RETRY_MS).then(() => untilSucceeds(`Removal of ${appName}`, async () => {
    // eslint-disable-next-line no-use-before-define
    const outcome = await removeAppLocally(appName, null, force, true, pending.announce);
    if (outcome !== RemovalOutcome.REMOVED && outcome !== RemovalOutcome.NOT_INSTALLED) {
      throw new Error(`${appName} was not removed (${outcome})`);
    }
  })).then(() => {
    unfinishedRemovals.delete(appName);
    globalState.departingApps.leave(appName);
  });
}

// This node's removals it could not announce when it made them.
function unannouncedRemovals() {
  return {
    database: dbHelper.databaseConnection().db(config.database.local.database),
    collection: config.database.local.collections.unannouncedRemovals,
  };
}

/**
 * Sends this node's fluxappremoved for these apps, from `ip`: one message naming
 * them all once the network reads that (appRemovedMessage), one each until then.
 * @param {string[]} appNames
 * @param {string} ip This node's socket address now.
 * @returns {Promise<void>}
 */
async function sendRemovals(appNames, ip) {
  if (appRemovedMessage.namesSeveralApps()) {
    log.info(`Broadcasting appremoved message for ${appNames.join(', ')} to the network`);
    await fluxCommunicationMessagesSender.broadcastMessageToAll({
      type: 'fluxappremoved', version: 2, apps: appNames, ip, broadcastedAt: Date.now(),
    });
    return;
  }
  // eslint-disable-next-line no-restricted-syntax
  for (const appName of appNames) {
    log.info(`Broadcasting appremoved message for ${appName} to the network`);
    // eslint-disable-next-line no-await-in-loop
    await fluxCommunicationMessagesSender.broadcastMessageToAll({
      type: 'fluxappremoved', version: 1, appName, ip, broadcastedAt: Date.now(),
    });
  }
}

/**
 * Keeps a removal this node cannot announce now, to be announced once it can
 * (announceKeptRemovals), for as long as a peer could still hold the app's
 * location row on this node: until this node's own row of it expires. With no
 * unexpired row there is nothing for the announcement to cancel, and nothing is
 * kept.
 * @param {string} appName
 * @param {string|null} ip This node's socket address, when it knows it now.
 * @returns {Promise<void>}
 */
async function keepRemoval(appName, ip) {
  try {
    const address = ip || fluxNetworkHelper.getKnownLocalSocketAddress();
    const database = dbHelper.databaseConnection().db(config.database.appsglobal.database);
    const rows = address
      ? await dbHelper.findInDatabase(database, config.database.appsglobal.collections.appsLocations, { name: appName, ip: address }, { projection: { _id: 0, expireAt: 1 } })
      : [];
    const expireAt = (rows || []).reduce((latest, row) => (row.expireAt && (!latest || row.expireAt > latest) ? row.expireAt : latest), null);
    if (!expireAt || expireAt <= new Date()) {
      log.warn(`${appName} removed without announcing it - peers do not accept this node's messages, and no location row of it on this node is left for an announcement to cancel`);
      return;
    }
    const kept = unannouncedRemovals();
    await dbHelper.updateOneInDatabase(kept.database, kept.collection, { appName }, { $set: { appName }, $max: { expireAt } }, { upsert: true });
    log.warn(`${appName} removed while peers do not accept this node's messages; its removal is announced once they do`);
  } catch (error) {
    log.error(`${appName} removed without announcing it, and its removal could not be kept: ${error.message}`);
  }
}

/**
 * Announces each removal keepRemoval kept, from this node's address now, and
 * forgets it. One whose location row has expired since, or whose app is installed
 * here again, is forgotten unsent. For the announcement cycle, inside it, once
 * peers accept this node's messages at its address.
 * @param {Set<string>} installedNames The apps installed here now.
 * @param {string} ip This node's socket address now.
 * @returns {Promise<void>}
 */
async function announceKeptRemovals(installedNames, ip) {
  if (!ip || !nodeConfirmationService.canSendMessages()) return;
  const { database, collection } = unannouncedRemovals();
  const kept = await dbHelper.findInDatabase(database, collection, {}, { projection: { _id: 0, appName: 1, expireAt: 1 } });
  const now = new Date();
  const owed = kept.filter(({ appName, expireAt }) => expireAt > now && !installedNames.has(appName)).map(({ appName }) => appName);
  if (owed.length) await sendRemovals(owed, ip);
  // eslint-disable-next-line no-restricted-syntax
  for (const { appName } of kept) {
    // eslint-disable-next-line no-await-in-loop
    await dbHelper.removeDocumentsFromCollection(database, collection, { appName });
  }
}

// The announcements asked for and not yet sent, by app: what each asker waits on.
const announcementsAsked = new Map();
// The announcements being sent, while they are.
let announcing = null;

/**
 * Tells the network this node no longer holds these apps, and drops them from the
 * running apps cache. While peers would not accept this node's messages
 * (nodeConfirmationService.canSendMessages) each removal is kept and announced
 * once they would (keepRemoval).
 * @param {string[]} appNames
 * @returns {Promise<void>}
 */
async function announceNow(appNames) {
  // An announcement cycle that took its list before these removals marked the
  // apps still names them, and a claim arriving after this message re-creates the
  // row it cleared. Waiting for the cycle in flight puts the two on the wire in
  // the order they happened, so the claim is applied first and this clears it.
  // A cycle starting from here on reads the mark and leaves the apps out. A cycle
  // is in flight only from its snapshot to its broadcast, and every call in that
  // span has its own time limit.
  await globalState.announceCycle.waitReady({ waitAll: false });
  const ip = await fluxNetworkHelper.getLocalSocketAddress();
  // Read as the message would go out: whether this node can be heard changes
  // while a removal waits its turn.
  if (ip && nodeConfirmationService.canSendMessages()) {
    await sendRemovals(appNames, ip);
  } else {
    // eslint-disable-next-line no-restricted-syntax
    for (const appName of appNames) {
      // eslint-disable-next-line no-await-in-loop
      await keepRemoval(appName, ip);
    }
  }
  const { runningAppsCache } = globalState;
  appNames.forEach((appName) => {
    // a removal still being finished has nothing left to tell
    const pending = unfinishedRemovals.get(appName);
    if (pending) pending.announce = false;
    if (runningAppsCache.has(appName)) {
      runningAppsCache.delete(appName);
      log.info(`Removed ${appName} from running apps cache`);
    }
  });
}

/**
 * Sends what is asked for, in turns: the apps asked for while one turn is sent
 * go out together in the next.
 * @returns {Promise<void>}
 */
async function announceAsked() {
  while (announcementsAsked.size) {
    const turn = new Map(announcementsAsked);
    announcementsAsked.clear();
    try {
      // eslint-disable-next-line no-await-in-loop
      await announceNow([...turn.keys()]);
      turn.forEach(({ resolve }) => resolve());
    } catch (error) {
      turn.forEach(({ reject }) => reject(error));
    }
  }
  announcing = null;
}

/**
 * Tells the network this node no longer holds the app (fluxappremoved), and drops it
 * from the running apps cache. For an app whose removal from this node is complete or
 * committed. Removals asked to be announced while others are being sent are told
 * together in one message once the network reads that (appRemovedMessage).
 * @param {string} appName
 * @returns {Promise<void>} Settles once the message naming the app is sent or kept.
 */
function announceRemoval(appName) {
  if (!announcementsAsked.has(appName)) announcementsAsked.set(appName, Promise.withResolvers());
  const { promise } = announcementsAsked.get(appName);
  if (!announcing) announcing = announceAsked();
  return promise;
}

/**
 * Stop Syncthing app and clean up cache
 * @param {string} monitoredName - Monitored app name
 * @param {string} appId - Application ID
 * @param {object} res - Response object for streaming
 * @returns {Promise<void>}
 */
async function stopSyncthingAndCleanup(monitoredName, appId, res) {
  // Hard removal - the data is going, so what this node says about it goes first
  // and unconditionally. Stopping syncthing can fail; the volume is deleted either
  // way, and state describing it must not outlive it on the strength of that.
  const { receiveOnlySyncthingAppsCache } = globalState;
  if (receiveOnlySyncthingAppsCache && receiveOnlySyncthingAppsCache.has(appId)) {
    receiveOnlySyncthingAppsCache.delete(appId);
    log.info(`Deleted syncthing cache for ${appId} during hard removal`);
  }
  // The published claim goes with the data it describes. Peers rank a seed on it,
  // and one kept past the removal offers a volume this node no longer has -
  // outranking a node that still holds the app and seeding an empty folder in its
  // place.
  folderStates.removed(appId);
  globalState.seedMarks.delete(appId);

  try {
    // Dynamic require to avoid circular dependency
    // eslint-disable-next-line global-require
    const advancedWorkflows = require('./advancedWorkflows');
    await advancedWorkflows.stopSyncthingApp(monitoredName, res);
  } catch (error) {
    log.error(`Error stopping Syncthing app: ${error.message}`);
  }
}

/**
 * Writes each line of progress to the log, and to the caller's stream when there is one.
 * @param {object} res
 * @returns {function(string): void}
 */
function reportTo(res) {
  return (status) => {
    log.info(status);
    if (res) {
      res.write(serviceHelper.ensureString({ status }));
      if (res.flush) res.flush();
    }
  };
}

/**
 * Unmount volume for application or component
 * @param {string} appId - Application ID
 * @param {string} entityName - Entity name for logging
 * @param {object} res - Response object for streaming
 * @returns {Promise<void>}
 */
async function unmountVolume(appId, entityName, res) {
  log.info(`Unmounting volume of ${entityName}...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Unmounting volume of ${entityName}...` }));
    if (res.flush) res.flush();
  }

  // The unmount carries on either way - a volume that will not unmount is not
  // a reason to hold an uninstall open - but only one of these two lines is
  // true, and the stream is the only account an operator gets of what is still
  // mounted.
  const unmount = await serviceHelper.runCommand('umount', {
    runAsRoot: true, hostMountNamespace: true, params: [appsFolder + appId], logError: false,
  });
  if (unmount.error) {
    log.error(unmount.error);
    log.info(`An error occurred while unmounting ${entityName} storage. Continuing...`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `An error occured while unmounting ${entityName} storage. Continuing...` }));
      if (res.flush) res.flush();
    }
    return;
  }

  log.info(`Volume of ${entityName} unmounted`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Volume of ${entityName} unmounted` }));
    if (res.flush) res.flush();
  }
}

/**
 * Clean up application data directory
 * @param {string} appId - Application ID
 * @param {string} entityName - Entity name for logging
 * @param {object} res - Response object for streaming
 * @returns {Promise<void>}
 */
async function cleanupAppData(appId, entityName, res) {
  log.info(`Cleaning up ${entityName} data...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Cleaning up ${entityName} data...` }));
    if (res.flush) res.flush();
  }

  // the bare mountpoint is kept immutable while unmounted (set at volume
  // creation); clear the flag or the removal below fails
  await serviceHelper.runCommand('chattr', { runAsRoot: true, params: ['-i', appsFolder + appId], logError: false });

  // The removal carries on either way - data left behind is not a reason to
  // hold an uninstall open - but only one of these two lines is true, and the
  // stream is the only account an operator gets of what is still on the disk.
  const removal = await serviceHelper.runCommand('rm', {
    runAsRoot: true, params: ['-rf', appsFolder + appId], logError: false,
  });
  if (removal.error) {
    log.error(removal.error);
    log.info(`An error occured while cleaning ${entityName} data. Continuing...`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `An error occured while cleaning ${entityName} data. Continuing...` }));
      if (res.flush) res.flush();
    }
    return;
  }

  log.info(`Data of ${entityName} cleaned`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Data of ${entityName} cleaned` }));
    if (res.flush) res.flush();
  }
}

/**
 * Clean up crontab entry for application
 * @param {string} appId - Application ID
 * @param {object} res - Response object for streaming
 * @returns {Promise<string|null>} Volume path if found, null otherwise
 */
async function cleanupCrontab(appId, res) {
  let volumepath = null;

  log.info('Adjusting crontab...');
  if (res) {
    res.write(serviceHelper.ensureString({ status: 'Adjusting crontab...' }));
    if (res.flush) res.flush();
  }

  const crontab = await crontabLoad().catch((e) => {
    log.error(e);
    log.info('An error occured while loading crontab. Continuing...');
    if (res) {
      res.write(serviceHelper.ensureString({ status: 'An error occured while loading crontab. Continuing...' }));
      if (res.flush) res.flush();
    }
  });

  if (crontab) {
    const jobs = crontab.jobs();
    let jobToRemove;
    jobs.forEach((job) => {
      if (job.comment() === appId) {
        jobToRemove = job;
        // find the command that tells us where the actual fsvol is;
        const command = job.command();
        const cmdsplit = command.split(' ');
        // eslint-disable-next-line prefer-destructuring
        volumepath = cmdsplit[4]; // sudo mount -o loop /home/abcapp2TEMP /root/flux/ZelApps/abcapp2 is an example
        if (!job || !job.isValid()) {
          // remove the job as its invalid anyway
          crontab.remove(job);
        }
      }
    });

    if (jobToRemove) {
      crontab.remove(jobToRemove);
      try {
        crontab.save();
      } catch (e) {
        log.error(e);
        log.info('An error occured while saving crontab. Continuing...');
        if (res) {
          res.write(serviceHelper.ensureString({ status: 'An error occured while saving crontab. Continuing...' }));
          if (res.flush) res.flush();
        }
      }
      log.info('Crontab Adjusted.');
      if (res) {
        res.write(serviceHelper.ensureString({ status: 'Crontab Adjusted.' }));
        if (res.flush) res.flush();
      }
    } else {
      log.info('Crontab not found.');
      if (res) {
        res.write(serviceHelper.ensureString({ status: 'Crontab not found.' }));
        if (res.flush) res.flush();
      }
    }
  }

  return volumepath;
}

/**
 * Clean up volume path
 * @param {string} volumepath - Volume path to clean
 * @param {string} entityName - Entity name for logging
 * @param {object} res - Response object for streaming
 * @param {boolean} [conclusive=true] - Whether the search that produced
 *   `volumepath` covered everywhere it should have. False with no path means
 *   an image may be on disk that nothing will account for again, which is
 *   said rather than passed over; the default suits a caller that did not
 *   search.
 * @returns {Promise<void>}
 */
async function cleanupVolumePath(volumepath, entityName, res, conclusive = true) {
  if (!volumepath) {
    // Nothing to delete and nowhere left to look are different answers, and
    // only the first of them means the disk is clear. An image whose location
    // could not be established outlives the app's last record of itself, so
    // the one chance to say it is here.
    if (!conclusive) {
      log.warn(`Data volume of ${entityName} could not be located and is left on disk`);
      if (res) {
        res.write(serviceHelper.ensureString({ status: `Data volume of ${entityName} could not be located and is left on disk` }));
        if (res.flush) res.flush();
      }
    }
    return;
  }

  log.info(`Cleaning up data volume of ${entityName}...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Cleaning up data volume of ${entityName}...` }));
    if (res.flush) res.flush();
  }

  // Passed as an argument rather than interpolated into a command string. The
  // path can come from the recorded image now, which reached this node as a
  // kernel string and went through the database - so whitespace in it would
  // turn one removal into several, and `rm -rf` is not a thing to be wrong
  // about.
  const removal = await serviceHelper.runCommand('rm', { runAsRoot: true, params: ['-rf', volumepath], logError: false });
  // The removal carries on either way - an image left behind is not a reason
  // to hold an uninstall open - but only one of these two is true, and the
  // stream is the only account an operator gets of what is still on the disk.
  if (removal.error) {
    log.error(removal.error);
    log.info(`An error occured while cleaning ${entityName} volume. Continuing...`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `An error occured while cleaning ${entityName} volume. Continuing...` }));
      if (res.flush) res.flush();
    }
    return;
  }

  log.info(`Volume of ${entityName} cleaned`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Volume of ${entityName} cleaned` }));
    if (res.flush) res.flush();
  }
}

/**
 * Hard uninstall a component (complete removal including data)
 * @param {string} appName - Parent application name
 * @param {string} appId - Component ID
 * @param {object} componentSpecifications - Component specifications
 * @param {object} res - Response object for streaming
 * @param {function} stopAppMonitoring - Function to stop monitoring
 * @param {boolean} force - Use aggressive removal (kill + force remove) for stuck containers
 * @returns {Promise<void>}
 */
// eslint-disable-next-line no-shadow
async function hardUninstallComponent(appName, appId, componentSpecifications, res, stopAppMonitoring, force = false) {
  const componentName = componentSpecifications.name;

  // Stop monitoring and container
  log.info(`Stopping Flux App Component ${componentName}...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Stopping Flux App Component ${componentName}...` }));
    if (res.flush) res.flush();
  }

  const monitoredName = `${componentName}_${appName}`;
  if (stopAppMonitoring) {
    stopAppMonitoring(monitoredName, true);
  }

  // Use kill instead of stop for forced removals
  if (force) {
    await dockerService.appDockerKill(appId).catch((error) => {
      log.warn(`Failed to kill container ${appId}: ${error.message}`);
      const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
      if (res) {
        res.write(serviceHelper.ensureString(errorResponse));
        if (res.flush) res.flush();
      }
    });
  } else {
    await dockerService.appDockerStop(appId).catch((error) => {
      const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
      if (res) {
        res.write(serviceHelper.ensureString(errorResponse));
        if (res.flush) res.flush();
      }
    });
  }

  log.info(`Flux App Component ${componentName} stopped`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App Component ${componentName} stopped` }));
    if (res.flush) res.flush();
  }

  // Stop Syncthing
  await stopSyncthingAndCleanup(monitoredName, appId, res);

  // Remove container
  log.info(`Removing Flux App component ${componentName} container...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Removing Flux App component ${componentName} container...` }));
    if (res.flush) res.flush();
  }

  let containerRemoved = false;
  if (force) {
    await removeContainer(appId, { force: true }).then(() => {
      containerRemoved = true;
    }).catch((error) => {
      log.error(`Force remove failed for ${appId}: ${error.message}`);
      const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
      if (res) {
        res.write(serviceHelper.ensureString(errorResponse));
        if (res.flush) res.flush();
      }
    });
  } else {
    await removeContainer(appId).then(() => {
      containerRemoved = true;
    }).catch((error) => {
      log.error(`Container remove failed for ${appId}: ${error.message}`);
      const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
      if (res) {
        res.write(serviceHelper.ensureString(errorResponse));
        if (res.flush) res.flush();
      }
    });
  }

  if (containerRemoved) {
    log.info(`Flux App component ${componentName} container removed`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `Flux App component ${componentName} container removed` }));
      if (res.flush) res.flush();
    }
  } else {
    log.warn(`WARNING: Container ${appId} may not have been fully removed. Network cleanup may fail.`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `WARNING: Container ${appId} may not have been fully removed. Network cleanup may fail.` }));
      if (res.flush) res.flush();
    }
  }

  // Cleanup ports
  // eslint-disable-next-line no-use-before-define
  await cleanupPorts(componentSpecifications, appName, res, `component ${componentName}`);

  // Unmount volume
  await unmountVolume(appId, `component ${componentName}`, res);

  // Clean up data
  await cleanupAppData(appId, `component ${componentName}`, res);

  // The backing image is discovered deterministically; the crontab (legacy
  // remount mechanism) is only cleaned up, never relied on - a missing entry
  // used to orphan the image on disk.
  const discovered = await volumeService.getVolumeFilePath(appId);
  const crontabVolume = await cleanupCrontab(appId, res);

  // Clean up volume path
  await cleanupVolumePath(discovered.path ?? crontabVolume, `component ${componentName}`, res, discovered.conclusive);

  // Remove image (only if container was successfully removed)
  if (containerRemoved) {
    log.info(`Removing Flux App component ${componentName} image...`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `Removing Flux App component ${componentName} image...` }));
      if (res.flush) res.flush();
    }

    await imageReaper.reclaimImages([componentSpecifications.repotag], { report: reportTo(res) });

    log.info(`Flux App component ${componentName} image operations done`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `Flux App component ${componentName} image operations done` }));
      if (res.flush) res.flush();
    }
  } else {
    log.warn(`Skipping image removal for ${appId} because container removal failed`);
  }

  log.info(`Flux App component ${componentName} of ${appName} was successfully removed`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App component ${componentName} of ${appName} was successfully removed` }));
    if (res.flush) res.flush();
  }
}

/**
 * Hard uninstall an application (complete removal including data)
 * @param {string} appName - Application name
 * @param {string} appId - Application ID
 * @param {object} appSpecifications - App specifications
 * @param {object} res - Response object for streaming
 * @param {function} stopAppMonitoring - Function to stop monitoring
 * @param {boolean} force - Use aggressive removal (kill + force remove) for stuck containers
 * @returns {Promise<void>}
 // eslint-disable-next-line no-shadow
 */
// eslint-disable-next-line no-shadow
async function hardUninstallApplication(appName, appId, appSpecifications, res, stopAppMonitoring, force = false) {
  // Stop monitoring and container
  log.info(`Stopping Flux App ${appName}...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Stopping Flux App ${appName}...` }));
    if (res.flush) res.flush();
  }

  if (stopAppMonitoring) {
    stopAppMonitoring(appName, true);
  }

  // Use kill instead of stop for forced removals
  if (force) {
    await dockerService.appDockerKill(appId).catch((error) => {
      log.warn(`Failed to kill container ${appId}: ${error.message}`);
      const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
      if (res) {
        res.write(serviceHelper.ensureString(errorResponse));
        if (res.flush) res.flush();
      }
    });
  } else {
    await dockerService.appDockerStop(appId).catch((error) => {
      const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
      if (res) {
        res.write(serviceHelper.ensureString(errorResponse));
        if (res.flush) res.flush();
      }
    });
  }

  log.info(`Flux App ${appName} stopped`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App ${appName} stopped` }));
    if (res.flush) res.flush();
  }

  // Stop Syncthing
  await stopSyncthingAndCleanup(appName, appId, res);

  // Remove container
  log.info(`Removing Flux App ${appName} container...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Removing Flux App ${appName} container...` }));
    if (res.flush) res.flush();
  }

  let containerRemoved = false;
  if (force) {
    await removeContainer(appId, { force: true }).then(() => {
      containerRemoved = true;
    }).catch((error) => {
      log.error(`Force remove failed for ${appId}: ${error.message}`);
      const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
      if (res) {
        res.write(serviceHelper.ensureString(errorResponse));
        if (res.flush) res.flush();
      }
    });
  } else {
    await removeContainer(appId).then(() => {
      containerRemoved = true;
    }).catch((error) => {
      log.error(`Container remove failed for ${appId}: ${error.message}`);
      const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
      if (res) {
        res.write(serviceHelper.ensureString(errorResponse));
        if (res.flush) res.flush();
      }
    });
  }

  if (containerRemoved) {
    log.info(`Flux App ${appName} container removed`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `Flux App ${appName} container removed` }));
      if (res.flush) res.flush();
    }
  } else {
    log.warn(`WARNING: Container ${appId} may not have been fully removed. Network cleanup may fail.`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `WARNING: Container ${appId} may not have been fully removed. Network cleanup may fail.` }));
      if (res.flush) res.flush();
    }
  }

  // Cleanup ports
  // eslint-disable-next-line no-use-before-define
  await cleanupPorts(appSpecifications, appName, res, appName);

  // Unmount volume
  await unmountVolume(appId, appName, res);

  // Clean up data
  await cleanupAppData(appId, appName, res);

  // The backing image is discovered deterministically; the crontab (legacy
  // remount mechanism) is only cleaned up, never relied on - a missing entry
  // used to orphan the image on disk.
  const discovered = await volumeService.getVolumeFilePath(appId);
  const crontabVolume = await cleanupCrontab(appId, res);

  // Clean up volume path
  await cleanupVolumePath(discovered.path ?? crontabVolume, appName, res, discovered.conclusive);

  // Remove image (only if container was successfully removed)
  if (containerRemoved) {
    log.info(`Removing Flux App ${appName} image...`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `Removing Flux App ${appName} image...` }));
      if (res.flush) res.flush();
    }

    await imageReaper.reclaimImages([appSpecifications.repotag], { report: reportTo(res) });

    log.info(`Flux App ${appName} image operations done`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `Flux App ${appName} image operations done` }));
      if (res.flush) res.flush();
    }
  } else {
    log.warn(`Skipping image removal for ${appId} because container removal failed`);
  }

  log.info(`Flux App ${appName} was successfully removed`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App ${appName} was successfuly removed` }));
    if (res.flush) res.flush();
  }
}

/**
 * Helper function to cleanup ports (firewall and UPnP)
 * @param {object} appSpecifications - App specifications
 * @param {string} appName - Application name
 * @param {object} res - Response object for streaming
 * @param {string} entityName - Name of entity for logging (app or component name)
 * @returns {Promise<void>}
 */
async function cleanupPorts(appSpecifications, appName, res, entityName) {
  const portStatus = {
    status: `Denying ${entityName} ports...`,
  };
  log.info(portStatus);
  if (res) {
    res.write(serviceHelper.ensureString(portStatus));
    if (res.flush) res.flush();
  }

  const appPorts = appSpecifications.ports ?? (appSpecifications.port ? [appSpecifications.port] : []);
  await fluxNetworkHelper.deleteAppPortRules(appPorts.map((port) => serviceHelper.ensureNumber(port)));

  if (appSpecifications.ports) {
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        await portReconciler.release(serviceHelper.ensureNumber(port), `Flux_App_${appName}`);
      }
    }
  } else if (appSpecifications.port) {
    // v1 compatibility
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      await portReconciler.release(serviceHelper.ensureNumber(appSpecifications.port), `Flux_App_${appName}`);
    }
  }

  const portStatus2 = {
    status: `Ports of ${entityName} denied`,
  };
  log.info(portStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(portStatus2));
    if (res.flush) res.flush();
  }
}

/**
 * Removes an app's container, recording first that FluxOS is taking it down
 * (appsRuntimeState.setRemovedByFluxOs), so its absence is never read as
 * tampering. A removal that fails leaves the record: docker may still complete
 * it, and the reconciler clears the record once it sees the container in place
 * and not being removed. Rejects, sending nothing, when the record cannot be
 * written.
 * @param {string} appId
 * @param {object} [options]
 * @param {boolean} [options.force] Removes a running container.
 * @returns {Promise<void>}
 */
async function removeContainer(appId, { force = false } = {}) {
  await appsRuntimeState.setRemovedByFluxOs(appId, true);
  if (force) await dockerService.appDockerForceRemove(appId);
  else await dockerService.appDockerRemove(appId);
}

/**
 * Removes a container a soft uninstall takes down. One that is not there is
 * already removed: a redeploy stopped part way leaves its app with no container,
 * and the next one must not fail on it.
 * @param {string} appId
 * @returns {Promise<void>}
 */
async function removeContainerUnlessGone(appId) {
  try {
    await removeContainer(appId);
  } catch (error) {
    if (!dockerService.isContainerNotFound(error)) throw error;
    log.info(`Container ${appId} is not there; nothing to remove`);
  }
}

/**
 * Soft uninstall a component (container and image removal only, keeps data)
 * @param {string} appName - Parent application name
 * @param {string} appId - Component ID
 * @param {object} componentSpecifications - Component specifications
 * @param {object} res - Response object for streaming
 * @param {function} stopAppMonitoring - Function to stop monitoring
 // eslint-disable-next-line no-shadow
 * @returns {Promise<void>}
 */
// eslint-disable-next-line no-shadow
async function softUninstallComponent(appName, appId, componentSpecifications, res, stopAppMonitoring) {
  const componentName = componentSpecifications.name;

  // Stop monitoring
  log.info(`Stopping Flux App Component ${componentName}...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Stopping Flux App Component ${componentName}...` }));
    if (res.flush) res.flush();
  }

  const monitoredName = `${componentName}_${appName}`;
  if (stopAppMonitoring) {
    stopAppMonitoring(monitoredName, false);
  }

  // Stop container
  await dockerService.appDockerStop(appId).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
  });

  log.info(`Flux App Component ${componentName} stopped`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App Component ${componentName} stopped` }));
    if (res.flush) res.flush();
  }

  // Remove container
  log.info(`Removing Flux App component ${componentName} container...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Removing Flux App component ${componentName} container...` }));
    if (res.flush) res.flush();
  }

  await removeContainerUnlessGone(appId);

  log.info(`Flux App component ${componentName} container removed`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App component ${componentName} container removed` }));
    if (res.flush) res.flush();
  }

  // Remove image
  log.info(`Removing Flux App component ${componentName} image...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Removing Flux App component ${componentName} image...` }));
    if (res.flush) res.flush();
  }

  await imageReaper.reclaimImages([componentSpecifications.repotag], { report: reportTo(res) });

  log.info(`Flux App component ${componentName} image operations done`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App component ${componentName} image operations done` }));
    if (res.flush) res.flush();
  }

  // Cleanup ports
  // eslint-disable-next-line no-use-before-define
  await cleanupPorts(componentSpecifications, appName, res, `component ${componentName}`);

  log.info(`Flux App component ${componentName} of ${appName} was successfully removed`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App component ${componentName} of ${appName} was successfully removed` }));
    if (res.flush) res.flush();
  }
}

/**
 * Soft uninstall an application (container and image removal only, keeps data)
 * @param {string} appName - Application name
 * @param {string} appId - Application ID
 * @param {object} appSpecifications - App specifications
 * @param {object} res - Response object for streaming
 // eslint-disable-next-line no-shadow
 * @param {function} stopAppMonitoring - Function to stop monitoring
 * @returns {Promise<void>}
 */
// eslint-disable-next-line no-shadow
async function softUninstallApplication(appName, appId, appSpecifications, res, stopAppMonitoring) {
  // Stop monitoring
  log.info(`Stopping Flux App ${appName}...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Stopping Flux App ${appName}...` }));
    if (res.flush) res.flush();
  }

  if (stopAppMonitoring) {
    stopAppMonitoring(appName, false);
  }

  // Stop container
  await dockerService.appDockerStop(appId).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
  });

  log.info(`Flux App ${appName} stopped`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App ${appName} stopped` }));
    if (res.flush) res.flush();
  }

  // Remove container
  log.info(`Removing Flux App ${appName} container...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Removing Flux App ${appName} container...` }));
    if (res.flush) res.flush();
  }

  await removeContainerUnlessGone(appId);

  log.info(`Flux App ${appName} container removed`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App ${appName} container removed` }));
    if (res.flush) res.flush();
  }

  // Remove image
  log.info(`Removing Flux App ${appName} image...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Removing Flux App ${appName} image...` }));
    if (res.flush) res.flush();
  }

  await imageReaper.reclaimImages([appSpecifications.repotag], { report: reportTo(res) });

  log.info(`Flux App ${appName} image operations done`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App ${appName} image operations done` }));
    if (res.flush) res.flush();
  }

  // Cleanup ports
  await cleanupPorts(appSpecifications, appName, res, appName);

  log.info(`Flux App ${appName} was successfuly removed`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App ${appName} was successfuly removed` }));
    if (res.flush) res.flush();
  }
}

// target -> { announced, announce }, for the removal of that target sent to its
// app's manager and not yet settled, so a removal joining it knows whether the
// network was told, and one that stops waiting for it can ask for it to be told.
const removalsInFlight = new Map();

/**
 * Remove application completely from local node. The removal is sent to the
 * app's manager: it stops the app's running operation at its next step and runs
 * next; a removal of the same target already pending or running answers this one
 * with its outcome, and this call then tells the network itself when it was asked
 * to and that removal did not.
 *
 * A call with no response stream does not wait behind another operation: while
 * one other than a removal holds the app, this answers PENDING and the removal
 * stays sent. A call streaming to a caller waits for the outcome.
 * @param {string} app - Application name, or one component as component_app
 * @param {object} res - Response object for streaming
 * @param {boolean} force - Force removal
 * @param {boolean} endResponse - Whether to end response
 * @param {boolean} sendMessage - Whether to send message to network
 * @param {object} [options]
 * @param {object} [options.specifications] - The specification to remove the app by,
 *   used as given in place of the stored one
 * @param {object} [options.parent] - The operation this removal is a step of
 * @returns {Promise<string>} One of RemovalOutcome.
 */
async function removeAppLocally(app, res, force = false, endResponse = true, sendMessage = false, { specifications = null, parent = null } = {}) {
  await fluxosTrial.settled();
  // Normalise to the bare identifier this function reasons about: a caller may
  // pass the flux-prefixed docker name (e.g. the syncthing flow), which would
  // otherwise mis-derive the component as `flux{component}` below.
  // eslint-disable-next-line no-param-reassign
  app = app ? dockerService.getBaseAppName(app) : app;

  // Log removal trigger with stack trace to identify caller
  const { stack } = new Error();
  const callerLine = stack.split('\n')[2]?.trim();
  log.warn(`APP REMOVAL TRIGGERED: ${app} | force=${force} | sendMessage=${sendMessage} | caller: ${callerLine}`);

  if (!app) return removeAppHolding(app, res, endResponse, sendMessage, { specifications, force });

  const appName = app.includes('_') ? app.split('_')[1] : app;
  let inFlight = parent ? null : removalsInFlight.get(app);
  const first = !parent && !inFlight;
  if (first) {
    inFlight = { announced: false, announce: false };
    removalsInFlight.set(app, inFlight);
  }
  let ran = false;
  const removal = operationRegistry.submit(appName, 'remove', () => {
    ran = true;
    return removeAppHolding(app, res, endResponse, sendMessage, { specifications, force, inFlight });
  }, {
    owner: callerLine,
    target: app,
    parent,
    onWait: ({ holder }) => {
      const message = holder === 'remove'
        ? `Waiting for the removal of ${appName} in progress before removing ${app}`
        : `Stopping the ${operationRegistry.OPERATION_NAMES[holder]} of ${appName} for its removal`;
      log.warn(message);
      if (res) {
        res.write(serviceHelper.ensureString(messageHelper.createWarningMessage(message)));
        if (res.flush) res.flush();
      }
      if (holder !== 'remove') fluxEventBus.publish('app:operationPreempted', { appName, operation: holder, by: 'removal' });
    },
  });
  if (first) {
    // The entry lasts as long as the removal it describes, whoever stops waiting for it.
    const forget = () => {
      if (removalsInFlight.get(app) === inFlight) removalsInFlight.delete(app);
    };
    const settled = async (outcome) => {
      forget();
      if (outcome === RemovalOutcome.REMOVED && inFlight.announce && !inFlight.announced) {
        inFlight.announced = true;
        await announceRemoval(appName);
      }
    };
    removal.then(settled, forget).catch((error) => log.error(`removeAppLocally - ${appName} removed, and not announced: ${error.message}`));
  }
  // Held by anything but a removal, the app is busy with another operation, which
  // stops at its next step: the removal runs once it has.
  const holder = parent ? null : operationRegistry.get(appName)?.type;
  if (!res && holder && holder !== 'remove') {
    // told by the removal that ran when it was not asked to tell the network
    if (sendMessage && !first) inFlight.announce = true;
    log.info(`removeAppLocally - the removal of ${app} runs once the ${operationRegistry.OPERATION_NAMES[holder]} of ${appName} stops`);
    return RemovalOutcome.PENDING;
  }
  const outcome = await removal;
  if (!ran) {
    log.info(`removeAppLocally - ${app} was being removed already: ${outcome}`);
    if (sendMessage && outcome === RemovalOutcome.REMOVED && !inFlight.announced) await announceRemoval(appName);
    if (res) {
      res.write(serviceHelper.ensureString(messageHelper.createSuccessMessage(`Flux App ${app} was being removed already. Result: ${outcome}`)));
      if (res.flush) res.flush();
      if (endResponse) res.end();
    }
  }
  return outcome;
}

/**
 * The removal itself, run holding the app.
 * @param {string} app - Application name, normalised, or component_app
 * @param {object} res - Response object for streaming
 * @param {boolean} endResponse - Whether to end response
 * @param {boolean} sendMessage - Whether to send message to network
 * @param {object} options
 * @param {object} [options.specifications] - As removeAppLocally's
 * @param {boolean} options.force - Force removal
 * @param {{announced: boolean}} [options.inFlight] - Told when the network is told
 * @returns {Promise<string>} One of RemovalOutcome.
 */
async function removeAppHolding(app, res, endResponse, sendMessage, { specifications = null, force = false, inFlight = null }) {
  // Names what this call marked as departing, and nothing else.
  let departingName = null;
  // Set once a teardown has begun: a failure from there on leaves the app part
  // removed, and an app missing a component cannot run, so it is the whole app.
  let tornDownApp = null;
  let announced = false;
  try {
    if (!app) {
      throw new Error('No App specified');
    }

    const isComponent = app.includes('_');
    const appName = isComponent ? app.split('_')[1] : app;
    const appComponent = app.split('_')[0];

    // The node stops claiming the app here, at the decision to hand it back, and
    // not when its container happens to die. Keyed by the name the removal message
    // carries below, so the two can never name different things.
    if (sendMessage) {
      departingName = appName;
      globalState.departingApps.enter(departingName);
    }

    // Find app specifications in database
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const database = dbopen.db(config.database.appsglobal.database);

    const appsQuery = { name: appName };
    const appsProjection = {};
    let appSpecifications = specifications
      ?? await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    if (!appSpecifications) {
      if (!force) {
        throw new AppNotFoundError();
      }
      // get it from global Specifications
      appSpecifications = await dbHelper.findOneInDatabase(database, globalAppsInformation, appsQuery, appsProjection);
      if (!appSpecifications) {
        // get it from locally available Specifications
        const allApps = await availableApps();
        appSpecifications = allApps.find((a) => a.name === appName);
        // get it from permanent messages: the app's newest, read through the
        // index on name, height and timestamp
        if (!appSpecifications) {
          const [currentSpecifications] = await dbHelper.findInDatabase(
            database,
            globalAppsMessages,
            { 'appSpecifications.name': appName },
            { projection: { _id: 0 }, sort: { height: -1, timestamp: -1 }, limit: 1 },
          );
          if (currentSpecifications && currentSpecifications.height) {
            ({ appSpecifications } = currentSpecifications);
          }
        }
      }
    }

    if (!appSpecifications) {
      throw new AppNotFoundError();
    }

    let appId = dockerService.getAppIdentifier(app); // get app or app component identifier

    if (!specifications) {
      // do this temporarily - otherwise we have to move a bunch of functions around
      appSpecifications = await checkAndDecryptAppSpecs(appSpecifications);
      appSpecifications = specificationFormatter(appSpecifications);
    }

    // Told before the teardown, which can take as long as deleting the volume: a
    // holder that counts this copy while it is being deleted could hand its own back
    // beside it. An announcement that fails leaves the app installed, and one whose
    // teardown then stops part way is finished in the background (finishRemoval).
    if (sendMessage) {
      await announceRemoval(appName);
      announced = true;
      if (inFlight) inFlight.announced = true;
    }
    await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.REMOVAL_BEFORE_TEARDOWN, appName);

    tornDownApp = appName;
    if (appSpecifications.version >= 4 && !isComponent) {
      // it is a composed application
      // eslint-disable-next-line no-restricted-syntax
      for (const appComposedComponent of appSpecifications.compose.reverse()) {
        appId = dockerService.getAppIdentifier(`${appComposedComponent.name}_${appSpecifications.name}`);
        const appComponentSpecifications = appComposedComponent;
        // eslint-disable-next-line no-await-in-loop
        await hardUninstallComponent(appName, appId, appComponentSpecifications, res, stopAppMonitoring, force);
      }
    } else if (isComponent) {
      const componentSpecifications = appSpecifications.compose.find((component) => component.name === appComponent);
      appId = dockerService.getAppIdentifier(`${componentSpecifications.name}_${appSpecifications.name}`);
      await hardUninstallComponent(appName, appId, componentSpecifications, res, stopAppMonitoring, force);
    } else {
      await hardUninstallApplication(appName, appId, appSpecifications, res, stopAppMonitoring, force);
    }
    if (!isComponent) await appSlice.release(appName);

    // clear node-local runtime state (operator stop lock, crash backoff) for the
    // removed component(s) so a later reinstall starts from a clean slate
    let removedIdentifiers;
    if (appSpecifications.version >= 4 && appSpecifications.compose) {
      removedIdentifiers = isComponent
        ? [`${appComponent}_${appSpecifications.name}`]
        : appSpecifications.compose.map((c) => `${c.name}_${appSpecifications.name}`);
    } else {
      removedIdentifiers = [appName];
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const identifier of removedIdentifiers) {
      // eslint-disable-next-line no-await-in-loop
      await appsRuntimeState.remove(identifier);
      if (onComponentRemoved) onComponentRemoved(identifier);
    }

    if (!isComponent) {
      const dockerNetworkStatus = {
        status: 'Cleaning up docker network...',
      };
      log.info(dockerNetworkStatus);
      if (res) {
        res.write(serviceHelper.ensureString(dockerNetworkStatus));
        if (res.flush) res.flush();
      }

      let networkRemoved = false;
      let networkError = null;

      if (force) {
        // For forced removals, give Docker a moment to clean up container endpoints
        await serviceHelper.delay(2000);

        // Use aggressive network removal that disconnects endpoints first
        log.info(`Attempting force removal of network for ${appName}...`);
        await dockerService.forceRemoveFluxAppDockerNetwork(appName).then(() => {
          networkRemoved = true;
          log.info(`Network ${appName} force removed successfully`);
        }).catch((error) => {
          networkError = error;
          log.error(`Force network removal failed: ${error.message}`);

          // Retry once more after additional delay
          log.warn(`Retrying force network removal for ${appName} after delay...`);
        });

        // Retry if first attempt failed
        if (!networkRemoved && networkError) {
          await serviceHelper.delay(3000);
          await dockerService.forceRemoveFluxAppDockerNetwork(appName).then(() => {
            networkRemoved = true;
            log.info(`Network ${appName} removed on retry`);
          }).catch((error) => {
            log.error(`Network removal retry failed: ${error.message}`);
          });
        }
      } else {
        // Standard removal for non-forced uninstalls
        await dockerService.removeFluxAppDockerNetwork(appName).then(() => {
          networkRemoved = true;
        }).catch((error) => {
          networkError = error;
          log.error(`Network removal failed: ${error.message}`);
        });
      }

      if (networkRemoved) {
        const dockerNetworkStatus2 = {
          status: 'Docker network cleaned',
        };
        log.info(dockerNetworkStatus2);
        if (res) {
          res.write(serviceHelper.ensureString(dockerNetworkStatus2));
          if (res.flush) res.flush();
        }
      } else {
        const dockerNetworkStatusWarning = {
          status: `WARNING: Docker network for ${appName} may not have been fully removed`,
        };
        log.warn(dockerNetworkStatusWarning);
        if (res) {
          res.write(serviceHelper.ensureString(dockerNetworkStatusWarning));
          if (res.flush) res.flush();
        }
      }
      const databaseStatus = {
        status: 'Cleaning up database...',
      };
      log.info(databaseStatus);
      if (res) {
        res.write(serviceHelper.ensureString(databaseStatus));
        if (res.flush) res.flush();
      }
      await fluxEventBus.checkpoint(fluxEventBus.Checkpoint.REMOVAL_BEFORE_ROW_DELETE, appName);
      await dbHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
      // The app's volume is gone, and the record of when this node took it with it.
      // A record left behind is never read, as the app is not installed, and boot
      // removes it, so the removal stands whether this delete succeeds or not.
      try {
        await appPlacements.removePlacement(appName);
      } catch (error) {
        log.warn(`removeAppLocally - the placement record of ${appName} was not removed: ${error.message}`);
      }
      // Nor is there an app left for boot's location check to decide: an install
      // of the same name from here on is a new app.
      globalState.unconfirmedApps.delete(appName);
      const databaseStatus2 = {
        status: 'Database cleaned',
      };
      log.info(databaseStatus2);
      if (res) {
        res.write(serviceHelper.ensureString(databaseStatus2));
        if (res.flush) res.flush();
      }
    }
    // Published once the removal has finished, the app's row included.
    fluxEventBus.publish('app:removed', { name: appName });

    const appRemovalResponseDone = messageHelper.createSuccessMessage(`Removal step done. Result: Flux App ${appName} was successfuly removed`);
    log.info(appRemovalResponseDone);

    if (res) {
      res.write(serviceHelper.ensureString(appRemovalResponseDone));
      if (res.flush) res.flush();
      if (endResponse) {
        res.end();
      }
    }
    return RemovalOutcome.REMOVED;
  } catch (error) {
    log.error(`Error removing app ${app}: ${error.message}`);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );

    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
      if (endResponse) {
        res.end();
      }
    }
    // A specification that cannot be found anywhere means the node is not holding
    // this app, which answers a caller asking for it to be gone. An app whose
    // teardown had begun, of the whole app or of one component, is removed whole in
    // the background, and the network is told once it is gone. Any other error leaves the app as it was.
    if (error instanceof AppNotFoundError) return RemovalOutcome.NOT_INSTALLED;
    if (tornDownApp) finishRemoval(tornDownApp, force, !announced);
    return RemovalOutcome.FAILED;
  } finally {
    if (departingName) {
      globalState.departingApps.leave(departingName);
    }
  }
}

/**
 * This node's share of a global removal: the removal the route makes when it
 * is sent neither force nor global.
 *
 * @param {string} appname - Application name
 * @returns {Promise<string>} The removal outcome
 */
function removeHere(appname) {
  return removeAppLocally(appname, null, false, true, true);
}

/**
 * API endpoint for removing application locally
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<void>}
 */
async function removeAppLocallyApi(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    if (appname.includes('_')) {
      throw new Error('Components cannot be removed manually');
    }

    let { global } = req.params;
    global = global || req.query.global || false;
    global = serviceHelper.ensureBoolean(global);

    let { force } = req.params;
    force = force || req.query.force || false;
    force = serviceHelper.ensureBoolean(force);

    // The node operator is deliberately NOT here. Hosting an app is not owning it:
    // an operator who can remove one can script the removal against every install
    // and keep a customer's app off their node indefinitely, which the customer
    // experiences as an app that will not stay deployed and cannot diagnose.
    // Ending an app is the owner's call, or the team's on their behalf.
    //
    // One gate, and vetted status does not narrow it further: appownerorfluxteam
    // admits exactly {owner, fluxTeam, fluxSupport}, which is who may uninstall a
    // vetted app too. A second check against the same set can only ever agree, and
    // asking it costs two database reads and a vetted lookup per uninstall.
    const authorized = await verificationHelper.verifyPrivilege(Privilege.APP_OWNER_OR_FLUX_TEAM, authOf(req), { appName: appname });
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }

    if (global) {
      // eslint-disable-next-line global-require
      const appController = require('../appManagement/appController');
      appController.executeAppGlobalCommand(appname, 'appremove', authOf(req), undefined, removeHere); // do not wait
      const appResponse = messageHelper.createSuccessMessage(`${appname} queried for global reinstallation`);
      return res.json(appResponse);
    }

    // Set response headers for streaming
    res.setHeader('Content-Type', 'application/json');

    await removeAppLocally(appname, res, force, true, true);
    return undefined; // Explicitly return after async operation
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res.json(errorResponse);
  }
}

module.exports = {
  announceRemoval,
  announceKeptRemovals,
  finishRemoval,
  hardUninstallComponent,
  hardUninstallApplication,
  softUninstallComponent,
  softUninstallApplication,
  cleanupPorts,
  removeAppLocally,
  removeAppLocallyApi,
  removeHere,
  setOnComponentRemoved,
};
