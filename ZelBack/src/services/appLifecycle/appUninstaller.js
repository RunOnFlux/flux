const util = require('util');
const path = require('path');
const nodecmd = require('node-cmd');
const systemcrontab = require('crontab');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const messageHelper = require('../messageHelper');
const dockerService = require('../dockerService');
const dbHelper = require('../dbHelper');
const globalState = require('../utils/globalState');
const log = require('../../lib/log');
const { localAppsInformation, globalAppsInformation, globalAppsMessages } = require('../utils/appConstants');
const config = require('config');
// const advancedWorkflows = require('./advancedWorkflows'); // Moved to dynamic require to avoid circular dependency
const upnpService = require('../upnpService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const { socketAddressesMatch } = require('../utils/socketAddressUtils');
const { availableApps } = require('../appDatabase/registryManager');
const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');
const { specificationFormatter } = require('../utils/appSpecHelpers');
const { stopAppMonitoring } = require('../appManagement/appInspector');
const appsRuntimeState = require('../appManagement/appsRuntimeState');
const appNetworkLinker = require('./appNetworkLinker');
const imageManager = require('../appSecurity/imageManager');
const fluxEventBus = require('../utils/fluxEventBus');

const fluxDirPath = process.env.FLUXOS_PATH || path.join(process.env.HOME, 'zelflux');
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
const appsFolder = `${appsFolderPath}/`;
const cmdAsync = util.promisify(nodecmd.run);
const crontabLoad = util.promisify(systemcrontab.load);

const { AsyncLock } = require('../utils/asyncLock');

// Node-wide serial lock guarding the genuinely cross-app-unsafe host mutations performed
// during app teardown: ufw rule deletes + UPnP DeletePortMapping (cleanupPorts), the shared
// host crontab rewrite (cleanupCrontab), and the content-addressed docker image store
// (appDockerImageRemove) — the single host firewall, IGD client, crontab file and image
// store that two concurrent removals must not race. The per-app filesystem ops inside the
// same wrap (unmountVolume, cleanupAppData, cleanupVolumePath) are concurrency-safe on their
// own and are merely along for the ride. Deliberately NOT covered: (1) the graceful drain
// (appDockerStopGracefulOrKill, window up to 3900s) — kept OUTSIDE so one app's drain can
// never head-of-line-block every other removal's cleanup; (2) the docker network removal
// (per-app fluxDockerNetwork_<name>, daemon-serialized, so cross-app-safe).
// SCOPE: this serializes the removal teardown path only. The same ufw/UPnP/image resources
// are also mutated by portManager prelaunch, availabilityChecker, and imageUpdateService,
// which do NOT yet take this lock — tracked follow-up: promote to a shared host-mutation lock.
// Invariant: acquire only via withHostTeardownLock (one enable() paired with exactly one
// disable() in its finally). Regions are sequential, NEVER nested, and the lock is never
// held across a graceful drain or a hardUninstall*/softUninstall* return. maxConcurrent=1 is
// load-bearing: AsyncLock.disable() resolves the HEAD of the queue, correct ONLY while
// acquisition is strictly serial (single holder) — raising it would corrupt serialization.
const hostTeardownLock = new AsyncLock(1);

async function withHostTeardownLock(fn) {
  await hostTeardownLock.enable();
  try {
    return await fn();
  } finally {
    hostTeardownLock.disable();
  }
}

// Fired once per component identifier after a successful local removal, beside
// the durable runtime-state clear (mirrors appInstaller.setOnInstallComplete).
// serviceManager wires it to appReconciler.clearControllerDesired so the
// reconciler's in-memory controller verdict dies with the component - a
// back-require of appReconciler here would capture a stale partial export
// (appReconciler already requires this module and both replace module.exports).
let onComponentRemoved = null;
function setOnComponentRemoved(callback) {
  onComponentRemoved = callback;
}

/**
 * Stop Syncthing app and clean up cache
 * @param {string} monitoredName - Monitored app name
 * @param {string} appId - Application ID
 * @param {object} res - Response object for streaming
 * @returns {Promise<void>}
 */
async function stopSyncthingAndCleanup(monitoredName, appId, res) {
  try {
    // Dynamic require to avoid circular dependency
    // eslint-disable-next-line global-require
    const advancedWorkflows = require('./advancedWorkflows');
    await advancedWorkflows.stopSyncthingApp(monitoredName, res);

    // Hard removal - delete syncthing cache since data will be deleted
    // eslint-disable-next-line no-shadow, global-require
    const globalState = require('../utils/globalState');
    const { receiveOnlySyncthingAppsCache } = globalState;
    if (receiveOnlySyncthingAppsCache && receiveOnlySyncthingAppsCache.has(appId)) {
      receiveOnlySyncthingAppsCache.delete(appId);
      log.info(`Deleted syncthing cache for ${appId} during hard removal`);
    }
  } catch (error) {
    log.error(`Error stopping Syncthing app: ${error.message}`);
  }
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

  const execUnmount = `sudo umount ${appsFolder + appId}`;
  const execSuccess = await cmdAsync(execUnmount).catch((e) => {
    log.error(e);
    log.info(`An error occurred while unmounting ${entityName} storage. Continuing...`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `An error occured while unmounting ${entityName} storage. Continuing...` }));
      if (res.flush) res.flush();
    }
  });

  if (execSuccess) {
    log.info(`Volume of ${entityName} unmounted`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `Volume of ${entityName} unmounted` }));
      if (res.flush) res.flush();
    }
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

  const execDelete = `sudo rm -rf ${appsFolder + appId}`;
  await cmdAsync(execDelete).catch((e) => {
    log.error(e);
    log.info(`An error occured while cleaning ${entityName} data. Continuing...`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `An error occured while cleaning ${entityName} data. Continuing...` }));
      if (res.flush) res.flush();
    }
  });

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
 * @returns {Promise<void>}
 */
async function cleanupVolumePath(volumepath, entityName, res) {
  if (!volumepath) return;

  log.info(`Cleaning up data volume of ${entityName}...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Cleaning up data volume of ${entityName}...` }));
    if (res.flush) res.flush();
  }

  const execVolumeDelete = `sudo rm -rf ${volumepath}`;
  await cmdAsync(execVolumeDelete).catch((e) => {
    log.error(e);
    log.info(`An error occured while cleaning ${entityName} volume. Continuing...`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `An error occured while cleaning ${entityName} volume. Continuing...` }));
      if (res.flush) res.flush();
    }
  });

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
async function hardUninstallComponent(appName, appId, componentSpecifications, res, stopAppMonitoring, force = false, cancelGraceful = false) {
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

  // Cancel/expiry: drain components that declared a graceful window (force-kill the
  // rest). Otherwise: kill on forced removals, graceful stop on normal removals.
  if (cancelGraceful) {
    await dockerService.appDockerStopGracefulOrKill(appId).catch((error) => {
      log.warn(`Failed to stop/kill container ${appId}: ${error.message}`);
      const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
      if (res) {
        res.write(serviceHelper.ensureString(errorResponse));
        if (res.flush) res.flush();
      }
    });
  } else if (force) {
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
    await dockerService.appDockerForceRemove(appId).then(() => {
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
    await dockerService.appDockerRemove(appId).then(() => {
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

  // Serialize the shared host mutations (ufw/UPnP, umount, crontab, image store) under
  // hostTeardownLock. The graceful drain already ran above, OUTSIDE the lock.
  await withHostTeardownLock(async () => {
    // Cleanup ports
    // eslint-disable-next-line no-use-before-define
    await cleanupPorts(componentSpecifications, appName, res, `component ${componentName}`);

    // Unmount volume
    await unmountVolume(appId, `component ${componentName}`, res);

    // Clean up data
    await cleanupAppData(appId, `component ${componentName}`, res);

    // Clean up crontab and get volume path
    const volumepath = await cleanupCrontab(appId, res);

    // Clean up volume path
    await cleanupVolumePath(volumepath, `component ${componentName}`, res);

    // Remove image (only if container was successfully removed)
    if (containerRemoved) {
      log.info(`Removing Flux App component ${componentName} image...`);
      if (res) {
        res.write(serviceHelper.ensureString({ status: `Removing Flux App component ${componentName} image...` }));
        if (res.flush) res.flush();
      }

      await dockerService.appDockerImageRemove(componentSpecifications.repotag).catch((error) => {
        const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
        log.error(errorResponse);
        if (res) {
          res.write(serviceHelper.ensureString(errorResponse));
          if (res.flush) res.flush();
        }
      });

      log.info(`Flux App component ${componentName} image operations done`);
      if (res) {
        res.write(serviceHelper.ensureString({ status: `Flux App component ${componentName} image operations done` }));
        if (res.flush) res.flush();
      }
    } else {
      log.warn(`Skipping image removal for ${appId} because container removal failed`);
    }
  });

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
async function hardUninstallApplication(appName, appId, appSpecifications, res, stopAppMonitoring, force = false, cancelGraceful = false) {
  // Stop monitoring and container
  log.info(`Stopping Flux App ${appName}...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Stopping Flux App ${appName}...` }));
    if (res.flush) res.flush();
  }

  if (stopAppMonitoring) {
    stopAppMonitoring(appName, true);
  }

  // Cancel/expiry: drain if the app declared a graceful window (force-kill otherwise).
  // Otherwise: kill on forced removals, graceful stop on normal removals.
  if (cancelGraceful) {
    await dockerService.appDockerStopGracefulOrKill(appId).catch((error) => {
      log.warn(`Failed to stop/kill container ${appId}: ${error.message}`);
      const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
      if (res) {
        res.write(serviceHelper.ensureString(errorResponse));
        if (res.flush) res.flush();
      }
    });
  } else if (force) {
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
    await dockerService.appDockerForceRemove(appId).then(() => {
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
    await dockerService.appDockerRemove(appId).then(() => {
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

  // Serialize the shared host mutations (ufw/UPnP, umount, crontab, image store) under
  // hostTeardownLock. The graceful drain already ran above, OUTSIDE the lock.
  await withHostTeardownLock(async () => {
    // Cleanup ports
    // eslint-disable-next-line no-use-before-define
    await cleanupPorts(appSpecifications, appName, res, appName);

    // Unmount volume
    await unmountVolume(appId, appName, res);

    // Clean up data
    await cleanupAppData(appId, appName, res);

    // Clean up crontab and get volume path
    const volumepath = await cleanupCrontab(appId, res);

    // Clean up volume path
    await cleanupVolumePath(volumepath, appName, res);

    // Remove image (only if container was successfully removed)
    if (containerRemoved) {
      log.info(`Removing Flux App ${appName} image...`);
      if (res) {
        res.write(serviceHelper.ensureString({ status: `Removing Flux App ${appName} image...` }));
        if (res.flush) res.flush();
      }

      await dockerService.appDockerImageRemove(appSpecifications.repotag).catch((error) => {
        const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
        log.error(errorResponse);
        if (res) {
          res.write(serviceHelper.ensureString(errorResponse));
          if (res.flush) res.flush();
        }
      });

      log.info(`Flux App ${appName} image operations done`);
      if (res) {
        res.write(serviceHelper.ensureString({ status: `Flux App ${appName} image operations done` }));
        if (res.flush) res.flush();
      }
    } else {
      log.warn(`Skipping image removal for ${appId} because container removal failed`);
    }
  });

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

  if (appSpecifications.ports) {
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        await fluxNetworkHelper.deleteAllowPortRule(serviceHelper.ensureNumber(port));
      }
    }
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      // eslint-disable-next-line no-restricted-syntax
      for (const port of appSpecifications.ports) {
        // eslint-disable-next-line no-await-in-loop
        await upnpService.removeMapUpnpPort(serviceHelper.ensureNumber(port), `Flux_App_${appName}`);
      }
    }
  } else if (appSpecifications.port) {
    // v1 compatibility
    const firewallActive = await fluxNetworkHelper.isFirewallActive();
    if (firewallActive) {
      await fluxNetworkHelper.deleteAllowPortRule(serviceHelper.ensureNumber(appSpecifications.port));
    }
    const isUPNP = upnpService.isUPNP();
    if (isUPNP) {
      await upnpService.removeMapUpnpPort(serviceHelper.ensureNumber(appSpecifications.port), `Flux_App_${appName}`);
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

  await dockerService.appDockerRemove(appId);

  log.info(`Flux App component ${componentName} container removed`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App component ${componentName} container removed` }));
    if (res.flush) res.flush();
  }

  // Serialize the shared host mutations (image store, ufw/UPnP) under hostTeardownLock.
  // The soft path uses a plain appDockerStop (no graceful drain), so there is no long
  // wait to keep outside the lock here.
  await withHostTeardownLock(async () => {
    // Remove image
    log.info(`Removing Flux App component ${componentName} image...`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `Removing Flux App component ${componentName} image...` }));
      if (res.flush) res.flush();
    }

    await dockerService.appDockerImageRemove(componentSpecifications.repotag).catch((error) => {
      const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
      log.error(errorResponse);
      if (res) {
        res.write(serviceHelper.ensureString(errorResponse));
        if (res.flush) res.flush();
      }
    });

    log.info(`Flux App component ${componentName} image operations done`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `Flux App component ${componentName} image operations done` }));
      if (res.flush) res.flush();
    }

    // Cleanup ports
    // eslint-disable-next-line no-use-before-define
    await cleanupPorts(componentSpecifications, appName, res, `component ${componentName}`);
  });

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

  await dockerService.appDockerRemove(appId);

  log.info(`Flux App ${appName} container removed`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App ${appName} container removed` }));
    if (res.flush) res.flush();
  }

  // Remove image
  // Serialize the shared host mutations (image store, ufw/UPnP) under hostTeardownLock.
  // The soft path uses a plain appDockerStop (no graceful drain), so there is no long
  // wait to keep outside the lock here.
  await withHostTeardownLock(async () => {
    log.info(`Removing Flux App ${appName} image...`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `Removing Flux App ${appName} image...` }));
      if (res.flush) res.flush();
    }

    await dockerService.appDockerImageRemove(appSpecifications.repotag).catch((error) => {
      const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
      log.error(errorResponse);
      if (res) {
        res.write(serviceHelper.ensureString(errorResponse));
        if (res.flush) res.flush();
      }
    });

    log.info(`Flux App ${appName} image operations done`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `Flux App ${appName} image operations done` }));
      if (res.flush) res.flush();
    }

    // Cleanup ports
    await cleanupPorts(appSpecifications, appName, res, appName);
  });

  log.info(`Flux App ${appName} was successfuly removed`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App ${appName} was successfuly removed` }));
    if (res.flush) res.flush();
  }
}

// Guards removeUnrequiredDependencies against overlapping runs (it removes apps,
// which can re-trigger it).
let dependencyCleanupInProgress = false;

/**
 * Removes any locally-installed `dependencyOnly` app (e.g. a stats collector)
 * that no installed workload still requires via `networkWith`. Triggered after a
 * workload is removed and at boot. Loops until the set is stable so a chain
 * unwinds fully: removing the datadog that linked to alloy then orphans the alloy.
 * Each removal is a normal (non-forced) removeAppLocally, so the collector's own
 * `gracefulShutdownSec` drain window is honoured; by the time this runs the
 * workload that depended on it has already finished draining and been removed.
 *
 * @returns {Promise<void>}
 */
async function removeUnrequiredDependencies() {
  if (dependencyCleanupInProgress) {
    return;
  }
  dependencyCleanupInProgress = true;
  try {
    const attempted = new Set();
    // Bounded: each pass either removes one app or stops. The cap is a backstop.
    for (let pass = 0; pass < 50; pass += 1) {
      // eslint-disable-next-line no-await-in-loop
      const orphans = await appNetworkLinker.findUnrequiredInstalledDependencies();
      // Remove a consumer before the app it consumes (datadog before the alloy it
      // links to) so the network/log wiring tears down in dependency order.
      orphans.sort((a, b) => {
        if (appNetworkLinker.getLinkedApps(a).some((n) => n.toLowerCase() === b.name.toLowerCase())) return -1;
        if (appNetworkLinker.getLinkedApps(b).some((n) => n.toLowerCase() === a.name.toLowerCase())) return 1;
        return 0;
      });
      const target = orphans.find((app) => !attempted.has(app.name.toLowerCase()));
      if (!target) {
        return;
      }
      attempted.add(target.name.toLowerCase());
      log.info(`Dependency cleanup: removing ${target.name} - no installed app requires it any more`);
      // force=false honours gracefulShutdownSec; sendMessage=true tells the
      // network this node dropped it. removeAppLocally swallows its own errors.
      // eslint-disable-next-line no-await-in-loop
      await removeAppLocally(target.name, null, false, false, true);
    }
    log.warn('Dependency cleanup: reached pass limit, will retry on next trigger');
  } catch (error) {
    log.error(`Dependency cleanup failed: ${error.message}`);
  } finally {
    dependencyCleanupInProgress = false;
  }
}

/**
 * Reverse dependency cascade: before a dependencyOnly app (a stats collector) is
 * removed, gracefully uninstall every installed workload that transitively
 * requires it, so a consumer is never left attached to a torn-down dependency.
 * No-op for components and non-dependencyOnly apps. The caller runs this before
 * acquiring the removal lock so each nested workload removal can acquire it.
 *
 * @param {string} appName - bare app name being removed
 * @returns {Promise<void>}
 */
async function removeRequiringWorkloadsFirst(appName) {
  if (!appName || appName.includes('_')) {
    return; // components don't carry the marker
  }
  const dbopen = dbHelper.databaseConnection();
  const appsDatabase = dbopen.db(config.database.appslocal.database);
  const spec = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, { name: appName }, { projection: { _id: 0, description: 1 } });
  if (!spec || !appNetworkLinker.parseDependencyOnly(spec.description)) {
    return;
  }
  const workloads = await appNetworkLinker.findInstalledWorkloadsRequiring(appName);
  // eslint-disable-next-line no-restricted-syntax
  for (const workload of workloads) {
    log.info(`Reverse dependency cascade: uninstalling workload ${workload.name} before its dependency ${appName}`);
    // force=false honours gracefulShutdownSec; sendMessage=true tells the network.
    // eslint-disable-next-line no-await-in-loop
    await removeAppLocally(workload.name, null, false, false, true);
  }
}

/**
 * Whether a removal should run the reverse dependency cascade (uninstall the
 * workloads that require a dependencyOnly app before the dependency itself).
 * Fires on a graceful removal (force=false) and on a cancel/expiry, where the
 * expiry sweep sets cancelGraceful=true even though force=true. A plain
 * force-kill (force=true, cancelGraceful=false) does not cascade.
 *
 * @param {boolean} force
 * @param {boolean} cancelGraceful
 * @returns {boolean}
 */
function shouldReverseCascade(force, cancelGraceful) {
  return !force || cancelGraceful;
}

/**
 * Whether a whole-app removal warrants a forward-cascade sweep of now-unrequired
 * dependencyOnly apps. A workload removal stops requiring its deps; a removal that
 * ran the reverse cascade removed workloads that may have required sibling deps.
 * Components never carry the dependency marker, so they are skipped.
 *
 * @param {boolean} isComponent
 * @param {string} description - app-level description (carries the dependencyOnly marker)
 * @param {boolean} force
 * @param {boolean} cancelGraceful
 * @returns {boolean}
 */
function shouldSweepUnrequiredDependencies(isComponent, description, force, cancelGraceful) {
  if (isComponent) {
    return false;
  }
  return !appNetworkLinker.parseDependencyOnly(description) || shouldReverseCascade(force, cancelGraceful);
}

/**
 * Remove application completely from local node
 * @param {string} app - Application name
 * @param {object} res - Response object for streaming
 * @param {boolean} force - Force removal
 * @param {boolean} endResponse - Whether to end response
 * @param {boolean} sendMessage - Whether to send message to network
 * @returns {Promise<void>}
 */
async function removeAppLocally(app, res, force = false, endResponse = true, sendMessage = false, cancelGraceful = false) {
  try {
    // Normalise to the bare identifier this function reasons about: a caller may
    // pass the flux-prefixed docker name (e.g. the syncthing flow), which would
    // otherwise mis-derive the component as `flux{component}` below.
    // eslint-disable-next-line no-param-reassign
    app = app ? dockerService.getBaseAppName(app) : app;

    // Log removal trigger with stack trace to identify caller
    const { stack } = new Error();
    const callerLine = stack.split('\n')[2]?.trim();
    log.warn(`APP REMOVAL TRIGGERED: ${app} | force=${force} | sendMessage=${sendMessage} | caller: ${callerLine}`);

    if (!force) {
      if (globalState.removalInProgress) {
        const warnResponse = messageHelper.createWarningMessage('Another application is undergoing removal. Removal not possible.');
        log.warn(warnResponse);
        if (res) {
          res.write(serviceHelper.ensureString(warnResponse));
          if (res.flush) res.flush();
          if (endResponse) {
            res.end();
          }
        }
        return;
      }
      if (globalState.installationInProgress) {
        const warnResponse = messageHelper.createWarningMessage('Another application is undergoing installation. Removal not possible.');
        log.warn(warnResponse);
        if (res) {
          res.write(serviceHelper.ensureString(warnResponse));
          if (res.flush) res.flush();
          if (endResponse) {
            res.end();
          }
        }
        return;
      }
    }

    // Reverse dependency cascade: before tearing down a dependencyOnly app,
    // gracefully uninstall any installed workload that still requires it - a
    // consumer must never outlive its dependency (see shouldReverseCascade for when
    // this fires). Run before the lock below so each nested workload removal can
    // acquire it. Gated off in production.
    if (shouldReverseCascade(force, cancelGraceful) && config.fluxapps.manageDependencyOnlyLifecycle) {
      await removeRequiringWorkloadsFirst(app);
    }

    globalState.removalInProgress = true;

    if (!app) {
      throw new Error('No App specified');
    }

    const isComponent = app.includes('_');
    const appName = isComponent ? app.split('_')[1] : app;
    const appComponent = app.split('_')[0];

    // Find app specifications in database
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const database = dbopen.db(config.database.appsglobal.database);

    const appsQuery = { name: appName };
    const appsProjection = {};
    let appSpecifications = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    if (!appSpecifications) {
      if (!force) {
        throw new Error('Flux App not found');
      }
      // get it from global Specifications
      appSpecifications = await dbHelper.findOneInDatabase(database, globalAppsInformation, appsQuery, appsProjection);
      if (!appSpecifications) {
        // get it from locally available Specifications
        const allApps = await availableApps();
        appSpecifications = allApps.find((a) => a.name === appName);
        // get it from permanent messages
        if (!appSpecifications) {
          const query = {};
          const projection = { projection: { _id: 0 } };
          const messages = await dbHelper.findInDatabase(database, globalAppsMessages, query, projection);
          const appMessages = messages.filter((message) => {
            const specifications = message.appSpecifications;
            return specifications.name === appName;
          });
          let currentSpecifications;
          appMessages.forEach((message) => {
            if (!currentSpecifications || message.height > currentSpecifications.height) {
              currentSpecifications = message;
            }
          });
          if (currentSpecifications && currentSpecifications.height) {
            ({ appSpecifications } = currentSpecifications);
          }
        }
      }
    }

    if (!appSpecifications) {
      throw new Error('Flux App not found');
    }

    let appId = dockerService.getAppIdentifier(app); // get app or app component identifier

    // do this temporarily - otherwise we have to move a bunch of functions around
    appSpecifications = await checkAndDecryptAppSpecs(appSpecifications);
    appSpecifications = specificationFormatter(appSpecifications);

    if (appSpecifications.version >= 4 && !isComponent) {
      // it is a composed application
      // eslint-disable-next-line no-restricted-syntax
      for (const appComposedComponent of appSpecifications.compose.reverse()) {
        appId = dockerService.getAppIdentifier(`${appComposedComponent.name}_${appSpecifications.name}`);
        const appComponentSpecifications = appComposedComponent;
        // eslint-disable-next-line no-await-in-loop
        await hardUninstallComponent(appName, appId, appComponentSpecifications, res, stopAppMonitoring, force, cancelGraceful);
      }
    } else if (isComponent) {
      const componentSpecifications = appSpecifications.compose.find((component) => component.name === appComponent);
      appId = dockerService.getAppIdentifier(`${componentSpecifications.name}_${appSpecifications.name}`);
      await hardUninstallComponent(appName, appId, componentSpecifications, res, stopAppMonitoring, force, cancelGraceful);
    } else {
      await hardUninstallApplication(appName, appId, appSpecifications, res, stopAppMonitoring, force, cancelGraceful);
    }

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

    // A node-pinned app removed via the operator/customer path (force=false) stays
    // globally registered and still targets this node, so the spawner is obliged to
    // reinstall it. The spawn-throttle cache (trySpawningGlobalAppCache, default 12h),
    // set when the app first spawned here, is never cleared on the spawner's success
    // path and suppresses reselection at appSpawner.js:285 - up to a 12h silent outage
    // for a single-instance pinned app. Clear it so the next scan reinstalls. Scoped to
    // whole-app removal of an app that pins THIS node: non-pinned apps keep the throttle
    // (the network re-places them on another node), and force=true paths are left as-is
    // (e.g. the over-instance self-removal already clears it; expiry/cancel must not).
    if (!force && !isComponent && Array.isArray(appSpecifications.nodes) && appSpecifications.nodes.length > 0) {
      const localSocketAddress = await fluxNetworkHelper.getLocalSocketAddress();
      if (localSocketAddress && appSpecifications.nodes.some((ip) => socketAddressesMatch(ip, localSocketAddress))) {
        const globalSpec = await dbHelper.findOneInDatabase(database, globalAppsInformation, { name: appName }, { projection: { _id: 0, hash: 1 } });
        const { trySpawningGlobalAppCache } = globalState;
        if (globalSpec && globalSpec.hash && trySpawningGlobalAppCache && trySpawningGlobalAppCache.has(globalSpec.hash)) {
          trySpawningGlobalAppCache.delete(globalSpec.hash);
          log.info(`Cleared spawn-throttle cache for node-pinned app ${appName} (hash ${globalSpec.hash}) so the spawner can reinstall it`);
        }
      }
    }

    fluxEventBus.publish('app:removed', { name: appName });

    if (sendMessage) {
      const ip = await fluxNetworkHelper.getLocalSocketAddress();
      if (ip) {
        const broadcastedAt = Date.now();
        const appRemovedMessage = {
          type: 'fluxappremoved',
          version: 1,
          appName,
          ip,
          broadcastedAt,
        };
        log.info('Broadcasting appremoved message to the network');
        // broadcast messages about app removed to all peers
        await fluxCommunicationMessagesSender.broadcastMessageToAll(appRemovedMessage);
        // Remove app from running apps cache
        const { runningAppsCache } = globalState;
        if (runningAppsCache.has(appName)) {
          runningAppsCache.delete(appName);
          log.info(`Removed ${appName} from running apps cache`);
        }
      }
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
      await dbHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
      const databaseStatus2 = {
        status: 'Database cleaned',
      };
      log.info(databaseStatus2);
      if (res) {
        res.write(serviceHelper.ensureString(databaseStatus2));
        if (res.flush) res.flush();
      }
    }
    const appRemovalResponseDone = messageHelper.createSuccessMessage(`Removal step done. Result: Flux App ${appName} was successfuly removed`);
    log.info(appRemovalResponseDone);

    if (res) {
      res.write(serviceHelper.ensureString(appRemovalResponseDone));
      if (res.flush) res.flush();
      if (endResponse) {
        res.end();
      }
    }

    // Removing a workload may orphan a dependencyOnly app (stats collector) that
    // linked to it; likewise, cancelling a dependencyOnly app reverse-cascades its
    // workloads above, which can orphan its sibling collectors. Sweep orphans after
    // this removal's lock clears (the finally below) - see shouldSweepUnrequiredDependencies.
    // Deferred direct call, not an event subscription - the event bus is
    // test-observability only. Gated off in production.
    if (config.fluxapps.manageDependencyOnlyLifecycle
      && shouldSweepUnrequiredDependencies(isComponent, appSpecifications.description, force, cancelGraceful)) {
      setImmediate(() => {
        removeUnrequiredDependencies().catch((error) => log.error(`Dependency cleanup trigger failed: ${error.message}`));
      });
    }
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
  } finally {
    globalState.removalInProgress = false;
  }
}

/**
 * Soft remove application locally (database and container only)
 * @param {string} app - Application name
 * @param {object} res - Response object for streaming
 // eslint-disable-next-line no-shadow
 * @param {object} globalStateRef - Global state reference
 * @param {function} stopAppMonitoring - Function to stop monitoring
 * @returns {Promise<void>}
 */
// eslint-disable-next-line no-shadow
async function softRemoveAppLocally(app, res, globalStateRef, stopAppMonitoring) {
  // eslint-disable-next-line no-shadow
  const globalState = globalStateRef;
  if (globalState.removalInProgress) {
    throw new Error('Another application is undergoing removal');
  }
  if (globalState.installationInProgress) {
    throw new Error('Another application is undergoing installation');
  }

  globalState.removalInProgress = true;

  try {
    if (!app) {
      throw new Error('No Flux App specified');
    }

    const isComponent = app.includes('_');
    const appName = isComponent ? app.split('_')[1] : app;
    const appComponent = app.split('_')[0];

    // Find app specifications in database
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);

    const appsQuery = { name: appName };
    const appsProjection = {};
    let appSpecifications = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    if (!appSpecifications) {
      throw new Error('Flux App not found');
    }

    let appId = dockerService.getAppIdentifier(app);

    // do this temporarily - otherwise we have to move a bunch of functions around
    appSpecifications = await checkAndDecryptAppSpecs(appSpecifications);
    appSpecifications = specificationFormatter(appSpecifications);

    if (appSpecifications.version >= 4 && !isComponent) {
      // it is a composed application
      // eslint-disable-next-line no-restricted-syntax
      for (const appComposedComponent of appSpecifications.compose.reverse()) {
        appId = dockerService.getAppIdentifier(`${appComposedComponent.name}_${appSpecifications.name}`);
        const appComponentSpecifications = appComposedComponent;
        // eslint-disable-next-line no-await-in-loop
        await softUninstallComponent(appName, appId, appComponentSpecifications, res, stopAppMonitoring);
      }
    } else if (isComponent) {
      const componentSpecifications = appSpecifications.compose.find((component) => component.name === appComponent);
      appId = dockerService.getAppIdentifier(`${componentSpecifications.name}_${appSpecifications.name}`);
      await softUninstallComponent(appName, appId, componentSpecifications, res, stopAppMonitoring);
    } else {
      await softUninstallApplication(appName, appId, appSpecifications, res, stopAppMonitoring);
    }

    // node-local controller state dies with the components on the soft path too:
    // a (soft) redeploy is an explicit "make it run", so neither the operator
    // lock nor a stale controller verdict may survive it
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
      const databaseStatus = {
        status: 'Cleaning up database...',
      };
      log.info(databaseStatus);
      if (res) {
        res.write(serviceHelper.ensureString(databaseStatus));
        if (res.flush) res.flush();
      }
      await dbHelper.findOneAndDeleteInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
      const databaseStatus2 = {
        status: 'Database cleaned',
      };
      log.info(databaseStatus2);
      if (res) {
        res.write(serviceHelper.ensureString(databaseStatus2));
        if (res.flush) res.flush();
      }
      const appRemovalResponseDone = messageHelper.createSuccessMessage(`Removal step done. Result: Flux App ${appName} was partially removed`);
      log.info(appRemovalResponseDone);
      if (res) {
        res.write(serviceHelper.ensureString(appRemovalResponseDone));
        if (res.flush) res.flush();
      }
    }
  } catch (error) {
    log.error(`Error soft removing app ${app}: ${error.message}`);
    throw error;
  } finally {
    globalState.removalInProgress = false;
  }
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
    let { global } = req.params;
    global = global || req.query.global || false;
    global = serviceHelper.ensureBoolean(global);

    if (appname.includes('_')) {
      throw new Error('Components cannot be removed manually');
    }

    let { force } = req.params;
    force = force || req.query.force || false;
    force = serviceHelper.ensureBoolean(force);

    if (!appname) {
      throw new Error('No Flux App specified');
    }

    const authorized = await verificationHelper.verifyPrivilege('appownerabove', req, appname);
    if (!authorized) {
      const errMessage = messageHelper.errUnauthorizedMessage();
      return res.json(errMessage);
    }

    // For vetted apps, only app owner or Flux Team can uninstall
    // First, get app specifications to check if vetted
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const database = dbopen.db(config.database.appsglobal.database);
    const appsQuery = { name: appname };
    const appsProjection = {};

    let appSpecsForVettedCheck = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, appsQuery, appsProjection);
    if (!appSpecsForVettedCheck) {
      appSpecsForVettedCheck = await dbHelper.findOneInDatabase(database, globalAppsInformation, appsQuery, appsProjection);
    }

    if (appSpecsForVettedCheck) {
      const appIsVetted = await imageManager.isAppVetted(appSpecsForVettedCheck);
      if (appIsVetted) {
        // Check if user is specifically the app owner or Flux Team
        const isAppOwner = await verificationHelper.verifyPrivilege('appowner', req, appname);
        const isFluxTeam = await verificationHelper.verifyPrivilege('fluxteam', req);

        if (!isAppOwner && !isFluxTeam) {
          const errMessage = messageHelper.createErrorMessage('This is a vetted application. Only the app owner or InFlux Support Team are allowed to uninstall it.');
          return res.json(errMessage);
        }
      }
    }

    if (global) {
      // eslint-disable-next-line global-require
      const appController = require('../appManagement/appController');
      appController.executeAppGlobalCommand(appname, 'appremove', req.headers.zelidauth); // do not wait
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
  hardUninstallComponent,
  hardUninstallApplication,
  softUninstallComponent,
  softUninstallApplication,
  cleanupPorts,
  removeAppLocally,
  removeUnrequiredDependencies,
  removeRequiringWorkloadsFirst,
  shouldReverseCascade,
  shouldSweepUnrequiredDependencies,
  softRemoveAppLocally,
  removeAppLocallyApi,
  setOnComponentRemoved,
};
