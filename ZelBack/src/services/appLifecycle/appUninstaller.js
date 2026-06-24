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
const pendingTeardownStore = require('./pendingTeardownStore');

const fluxDirPath = process.env.FLUXOS_PATH || path.join(process.env.HOME, 'zelflux');
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
const appsFolder = `${appsFolderPath}/`;
const cmdAsync = util.promisify(nodecmd.run);
const crontabLoad = util.promisify(systemcrontab.load);

// Serialize the cross-app-unsafe host mutations (ufw/UPnP, the image store, the host crontab)
// performed during teardown — the graceful drain stays OUTSIDE the wrap. This is the SAME
// node-wide lock the install port-open, prelaunch probe, availability self-test and watchtower
// prune take, so a teardown can never race them on the shared firewall/IGD/image store. The
// per-app fs ops inside the wrap (unmountVolume, cleanupAppData, cleanupVolumePath) are
// concurrency-safe on their own and are merely along for the ride. See hostMutationLock.js for
// the invariant (leaf-only, never across a wait, never nested).
const { withHostMutationLock } = require('../utils/hostMutationLock');

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
 * Drop all node-local controller state for a set of component identifiers: the
 * durable runtime-state doc (operator lock + condemned stamp, via appsRuntimeState.remove)
 * and the reconciler's in-memory controller verdict (via the onComponentRemoved seam).
 * A redeploy of any kind is an explicit operator "make it run", so neither the
 * operator lock nor a stale controller verdict may survive it. The hard path
 * (removeAppLocally) does this inline; the soft path (advancedWorkflows.softRemoveAppLocally)
 * calls this so both redeploy paths clear the lock identically.
 * @param {string[]} identifiers - component identifiers (`component_app`) or [appName]
 */
async function dropControllerStateForRedeploy(identifiers) {
  // eslint-disable-next-line no-restricted-syntax
  for (const identifier of identifiers) {
    // eslint-disable-next-line no-await-in-loop
    await appsRuntimeState.remove(identifier);
    if (onComponentRemoved) onComponentRemoved(identifier);
  }
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

  // Teardown must ALWAYS complete on an autonomous node (no operator to clear a
  // leak). The container is already stopped+removed by the time we unmount, so an
  // EBUSY here is transient (kernel still reaping). Try a normal unmount; if it
  // fails, fall back to a lazy unmount (-l), which detaches the mount immediately
  // and defers cleanup until the last reference drops - guaranteeing the volume is
  // gone so the volume-path rm -rf that follows never operates on a live mount.
  const mountPath = appsFolder + appId;
  let execSuccess = await cmdAsync(`sudo umount ${mountPath}`).then(() => true).catch((e) => {
    log.warn(`Unmount of ${entityName} failed (${e.message}); retrying with a lazy unmount`);
    return false;
  });

  if (!execSuccess) {
    execSuccess = await cmdAsync(`sudo umount -l ${mountPath}`).then(() => true).catch((e) => {
      log.error(e);
      log.info(`A lazy unmount of ${entityName} storage also failed. Continuing...`);
      if (res) {
        res.write(serviceHelper.ensureString({ status: `An error occured while unmounting ${entityName} storage. Continuing...` }));
        if (res.flush) res.flush();
      }
      return false;
    });
  }

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
 * Normalise a spec's ports to a plain number array (v2+ `ports` or v1 `port`),
 * the only port shape the teardown needs. Stored cleartext in the durable doc.
 * @param {object} spec
 * @returns {Array<number>}
 */
function normalizePorts(spec) {
  if (Array.isArray(spec.ports)) return spec.ports;
  if (spec.port !== undefined && spec.port !== null) return [spec.port];
  return [];
}

/**
 * Build the per-component teardown descriptors for an app. Each descriptor is
 * the self-contained, cleartext input a drain + host teardown needs - the same
 * shape persisted in the durable pendingAppTeardowns doc, so the live path and
 * boot recovery drive the identical teardown. Composed apps are returned in
 * reverse order (matching the prior teardown order); a component-scoped removal
 * returns just that one; v1-3 apps are a single descriptor keyed by the app name.
 *
 * @param {object} appSpecifications - decrypted, formatted spec
 * @param {boolean} isComponent - the removal targets a single component
 * @param {string} appComponent - that component's name (when isComponent)
 * @param {string} appName - bare app name
 * @returns {Array<{identifier,appId,componentName,label,ports,repotag}>}
 */
function buildTeardownComponents(appSpecifications, isComponent, appComponent, appName) {
  const mk = (spec, componentName, identifier) => ({
    identifier,
    appId: dockerService.getAppIdentifier(identifier),
    componentName,
    label: componentName === appName ? appName : `component ${componentName}`,
    ports: normalizePorts(spec),
    repotag: spec.repotag,
  });
  if (appSpecifications.version >= 4 && Array.isArray(appSpecifications.compose) && !isComponent) {
    // copy before reversing so the caller's spec object is never mutated
    return [...appSpecifications.compose].reverse().map((c) => mk(c, c.name, `${c.name}_${appName}`));
  }
  if (isComponent) {
    const comp = appSpecifications.compose.find((component) => component.name === appComponent);
    return [mk(comp, comp.name, `${comp.name}_${appName}`)];
  }
  return [mk(appSpecifications, appName, appName)];
}

/**
 * Phase A drain for one component: stop monitoring, drain/kill/stop the
 * container, stop syncthing, remove the container. Holds NO lock - many apps can
 * drain at once and a long graceful window must never head-of-line the shared
 * host-mutation lock. Returns whether the container was actually removed (gates
 * the later image removal). Every docker call is wrapped: getDockerContainer*
 * THROWS on an already-gone container, which is the expected end state here and
 * for boot-recovery replay, so a throw is swallowed and the teardown proceeds.
 *
 * @param {object} descriptor - one entry from buildTeardownComponents
 * @param {string} appName
 * @param {{force:boolean, cancelGraceful:boolean, stopMonitoringFn?:function}} opts
 * @param {object} res
 * @returns {Promise<boolean>} containerRemoved
 */
async function drainComponentContainer(descriptor, appName, opts, res) {
  const { identifier: monitoredName, appId, label } = descriptor;
  const { force = false, cancelGraceful = false, stopMonitoringFn = stopAppMonitoring } = opts;

  log.info(`Stopping Flux App ${label}...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Stopping Flux App ${label}...` }));
    if (res.flush) res.flush();
  }

  if (stopMonitoringFn) {
    stopMonitoringFn(monitoredName, true);
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

  log.info(`Flux App ${label} stopped`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App ${label} stopped` }));
    if (res.flush) res.flush();
  }

  await stopSyncthingAndCleanup(monitoredName, appId, res);

  log.info(`Removing Flux App ${label} container...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Removing Flux App ${label} container...` }));
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
    log.info(`Flux App ${label} container removed`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `Flux App ${label} container removed` }));
      if (res.flush) res.flush();
    }
  } else {
    log.warn(`WARNING: Container ${appId} may not have been fully removed. Network cleanup may fail.`);
    if (res) {
      res.write(serviceHelper.ensureString({ status: `WARNING: Container ${appId} may not have been fully removed. Network cleanup may fail.` }));
      if (res.flush) res.flush();
    }
  }

  return containerRemoved;
}

/**
 * Phase B host teardown for one component: ufw/UPnP ports, the loop-mounted
 * volume, the appdata, the crontab entry + its volume path, and the image. The
 * caller MUST already hold the node-wide hostMutationLock (these are the shared
 * cross-app-unsafe host mutations); this function takes NO lock so one
 * acquisition can wrap a whole app's components + its network removal.
 *
 * Each leaf is independently guarded (.catch / try): a single failing step leaks
 * at most its own host resource (logged) and never skips the rest of the
 * teardown - so "teardown always completes, leaks at most one resource"
 * (decision #2) is literally true. The image is reclaimed UNCONDITIONALLY (not
 * gated on whether the container was removed this pass): a boot-recovery replay
 * runs after the container was already removed, so gating on containerRemoved
 * would leak the tagged image forever (pruneImages is dangling-only). Docker
 * refuses (409) to remove an image still referenced by a live container, which
 * the .catch swallows, so an unconditional attempt is safe in every case.
 *
 * @param {object} descriptor - one entry from buildTeardownComponents
 * @param {string} appName
 * @param {object} res
 */
async function hostTeardownComponent(descriptor, appName, res, skipPorts = false) {
  const {
    appId, label, ports, repotag,
  } = descriptor;

  // A redeploy passes skipPorts: it reconciles the port delta itself (leaving unchanged
  // ports untouched), so the teardown must NOT close this component's ports. Removal/
  // cancel/expiry leave skipPorts false and revoke the ufw/UPnP rules as before.
  if (!skipPorts) {
    // eslint-disable-next-line no-use-before-define
    await cleanupPorts({ ports }, appName, res, label).catch((error) => {
      log.error(`Port cleanup for ${label} failed (continuing teardown): ${error.message}`);
    });
  }

  await unmountVolume(appId, label, res).catch((error) => {
    log.error(`Unmount for ${label} failed (continuing teardown): ${error.message}`);
  });

  await cleanupAppData(appId, label, res).catch((error) => {
    log.error(`Appdata cleanup for ${label} failed (continuing teardown): ${error.message}`);
  });

  const volumepath = await cleanupCrontab(appId, res).catch((error) => {
    log.error(`Crontab cleanup for ${label} failed (continuing teardown): ${error.message}`);
    return null;
  });

  await cleanupVolumePath(volumepath, label, res).catch((error) => {
    log.error(`Volume-path cleanup for ${label} failed (continuing teardown): ${error.message}`);
  });

  log.info(`Removing Flux App ${label} image...`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Removing Flux App ${label} image...` }));
    if (res.flush) res.flush();
  }

  await dockerService.appDockerImageRemove(repotag).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(error.message || error, error.name, error.code);
    log.error(errorResponse);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
  });

  log.info(`Flux App ${label} image operations done`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App ${label} image operations done` }));
    if (res.flush) res.flush();
  }
}

/**
 * Remove the app's docker network. Cross-app (consumers networkWith-attach to
 * another app's fluxDockerNetwork_<owner>), so it runs inside the SAME whole-app
 * hostMutationLock acquisition as the host teardown above. No delays: the force
 * path already force-disconnects every endpoint before removing, so the prior
 * vestigial delay(2000)/delay(3000) only cost head-of-line under the lock
 * (forbidden - never hold the lock across a wait); a single no-delay retry
 * covers a transient. The non-force/force helpers early-return (no throw) when
 * the network is already gone.
 *
 * @param {string} networkName - bare app name
 * @param {boolean} force
 * @param {object} res
 */
async function removeAppDockerNetwork(networkName, force, res) {
  const dockerNetworkStatus = { status: 'Cleaning up docker network...' };
  log.info(dockerNetworkStatus);
  if (res) {
    res.write(serviceHelper.ensureString(dockerNetworkStatus));
    if (res.flush) res.flush();
  }

  let networkRemoved = false;
  if (force) {
    await dockerService.forceRemoveFluxAppDockerNetwork(networkName).then(() => {
      networkRemoved = true;
    }).catch((error) => {
      log.error(`Force network removal failed: ${error.message}`);
    });
    if (!networkRemoved) {
      await dockerService.forceRemoveFluxAppDockerNetwork(networkName).then(() => {
        networkRemoved = true;
      }).catch((error) => {
        log.error(`Network removal retry failed: ${error.message}`);
      });
    }
  } else {
    await dockerService.removeFluxAppDockerNetwork(networkName).then(() => {
      networkRemoved = true;
    }).catch((error) => {
      log.error(`Network removal failed: ${error.message}`);
    });
  }

  if (networkRemoved) {
    const dockerNetworkStatus2 = { status: 'Docker network cleaned' };
    log.info(dockerNetworkStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(dockerNetworkStatus2));
      if (res.flush) res.flush();
    }
  } else {
    const dockerNetworkStatusWarning = { status: `WARNING: Docker network for ${networkName} may not have been fully removed` };
    log.warn(dockerNetworkStatusWarning);
    if (res) {
      res.write(serviceHelper.ensureString(dockerNetworkStatusWarning));
      if (res.flush) res.flush();
    }
  }
}

/**
 * Hard uninstall a component (drain + host teardown, single component). Compat
 * wrapper kept for advancedWorkflows' redeploy paths that call it directly;
 * takes its OWN hostMutationLock around the host teardown (the whole-app removal
 * path goes through runTeardown instead, which holds one lock for all
 * components). The graceful drain runs first, outside the lock.
 * @param {string} appName - Parent application name
 * @param {string} appId - Component docker id / volume folder
 * @param {object} componentSpecifications - Component specifications
 * @param {object} res - Response object for streaming
 * @param {function} stopAppMonitoringFn - Function to stop monitoring
 * @param {boolean} force - Use aggressive removal (kill + force remove) for stuck containers
 * @returns {Promise<void>}
 */
// eslint-disable-next-line no-shadow
async function hardUninstallComponent(appName, appId, componentSpecifications, res, stopAppMonitoring, force = false, cancelGraceful = false) {
  const descriptor = {
    identifier: `${componentSpecifications.name}_${appName}`,
    appId,
    componentName: componentSpecifications.name,
    label: `component ${componentSpecifications.name}`,
    ports: normalizePorts(componentSpecifications),
    repotag: componentSpecifications.repotag,
  };
  await drainComponentContainer(descriptor, appName, { force, cancelGraceful, stopMonitoringFn: stopAppMonitoring }, res);
  await withHostMutationLock(() => hostTeardownComponent(descriptor, appName, res));

  log.info(`Flux App component ${componentSpecifications.name} of ${appName} was successfully removed`);
  if (res) {
    res.write(serviceHelper.ensureString({ status: `Flux App component ${componentSpecifications.name} of ${appName} was successfully removed` }));
    if (res.flush) res.flush();
  }
}

/**
 * Hard uninstall a whole (v1-3) application (drain + host teardown). Compat
 * wrapper kept for advancedWorkflows' redeploy paths; see hardUninstallComponent
 * for the lock note.
 * @param {string} appName - Application name
 * @param {string} appId - Application docker id / volume folder
 * @param {object} appSpecifications - App specifications
 * @param {object} res - Response object for streaming
 * @param {function} stopAppMonitoringFn - Function to stop monitoring
 * @param {boolean} force - Use aggressive removal (kill + force remove) for stuck containers
 * @returns {Promise<void>}
 */
// eslint-disable-next-line no-shadow
async function hardUninstallApplication(appName, appId, appSpecifications, res, stopAppMonitoring, force = false, cancelGraceful = false) {
  const descriptor = {
    identifier: appName,
    appId,
    componentName: appName,
    label: appName,
    ports: normalizePorts(appSpecifications),
    repotag: appSpecifications.repotag,
  };
  await drainComponentContainer(descriptor, appName, { force, cancelGraceful, stopMonitoringFn: stopAppMonitoring }, res);
  await withHostMutationLock(() => hostTeardownComponent(descriptor, appName, res));

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
async function softUninstallComponent(appName, appId, componentSpecifications, res, stopAppMonitoring, skipPorts = false) {
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
  await withHostMutationLock(async () => {
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

    // Cleanup ports - skipped on a redeploy, which reconciles the port delta itself.
    if (!skipPorts) {
      // eslint-disable-next-line no-use-before-define
      await cleanupPorts(componentSpecifications, appName, res, `component ${componentName}`);
    }
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
async function softUninstallApplication(appName, appId, appSpecifications, res, stopAppMonitoring, skipPorts = false) {
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
  await withHostMutationLock(async () => {
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

    // Cleanup ports - skipped on a redeploy, which reconciles the port delta itself.
    if (!skipPorts) {
      await cleanupPorts(appSpecifications, appName, res, appName);
    }
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
 * Phase A drain + Phase B host teardown for a whole app (or one component),
 * driven entirely off the per-component descriptors so the live removal and boot
 * recovery share one implementation. Phase A drains every component with NO lock
 * held (long graceful windows must not head-of-line shared host mutations);
 * Phase B then takes the node-wide hostMutationLock ONCE for the app and tears
 * down every component's ports/volume/data/crontab/image plus the cross-app
 * docker network. Finish drops each component's runtime-state doc (which carries
 * the condemned stamp) FIRST, then clears the durable pendingAppTeardowns doc
 * LAST and only once every stamp drop is confirmed - so the doc remains the
 * recovery backstop for any stamp that did not drop (a swallowed DB failure).
 *
 * @param {object} ctx
 * @param {string} ctx.key - durable-doc key (bare app name, or component_app)
 * @param {string} ctx.appName
 * @param {boolean} ctx.isComponent
 * @param {Array<object>} ctx.components - descriptors (buildTeardownComponents)
 * @param {boolean} ctx.force
 * @param {boolean} ctx.cancelGraceful
 * @param {object} [ctx.res]
 * @returns {Promise<void>}
 */
async function runTeardown(ctx) {
  const {
    key, appName, isComponent, components, force, cancelGraceful, keepNetwork, skipPorts, res,
  } = ctx;

  // Phase A — drain (no lock). Many apps can drain at once. The container-removed
  // signal is not needed downstream (image removal is unconditional now), so the
  // return is intentionally ignored.
  // eslint-disable-next-line no-restricted-syntax
  for (const descriptor of components) {
    // eslint-disable-next-line no-await-in-loop
    await drainComponentContainer(descriptor, appName, { force, cancelGraceful }, res);
  }

  // Phase B — host teardown + network, ONE whole-app lock acquisition. Each
  // component's host teardown is isolated: a throw (e.g. a ufw failure inside
  // cleanupPorts) must not abandon its siblings, the network removal, or the
  // finish below - teardown must always reach completion (decision #2). A truly
  // stuck step leaks at most one host resource (logged); it does not wedge.
  await withHostMutationLock(async () => {
    // eslint-disable-next-line no-restricted-syntax
    for (const descriptor of components) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await hostTeardownComponent(descriptor, appName, res, skipPorts);
      } catch (error) {
        log.error(`Host teardown of ${descriptor.identifier} failed (continuing): ${error.message}`);
      }
    }
    // A whole-app teardown removes the per-owner docker network UNLESS a redeploy
    // asked to keep it (the network is unchanged across a same-app redeploy and its
    // networkWith consumers must stay attached). Removal/cancel/expiry pass keepNetwork
    // false and tear it down as before.
    if (!isComponent && !keepNetwork) {
      await removeAppDockerNetwork(appName, force, res);
    }
  });

  // Finish — drop each component's runtime-state doc (which carries the condemned
  // stamp) FIRST, then clear the durable record LAST, and ONLY once every stamp
  // drop is CONFIRMED. The durable doc is the backstop: while any condemned stamp
  // may survive (a swallowed remove failure, or a crash mid-finish) the doc stays,
  // so the next boot re-recovers and re-drops it. Clearing the doc first (or
  // unconditionally) would orphan a stamp with no record to heal it - wedging the
  // component out of reconciliation permanently. remove() returns false on a
  // swallowed DB error, so we trust ITS signal rather than re-reading isCondemned
  // (which also collapses a read error to "not condemned" and would fail open).
  let allDropped = true;
  // eslint-disable-next-line no-restricted-syntax
  for (const descriptor of components) {
    // eslint-disable-next-line no-await-in-loop
    const dropped = await appsRuntimeState.remove(descriptor.identifier); // drops the condemned stamp
    if (!dropped) allDropped = false;
  }
  if (allDropped) {
    await pendingTeardownStore.clearTeardown(key);
  } else {
    log.warn(`Teardown of ${appName}: a condemned stamp did not drop; keeping the teardown record for boot recovery`);
  }

  const done = messageHelper.createSuccessMessage(`Removal step done. Result: Flux App ${appName} was successfuly removed`);
  log.info(done);
  if (res) {
    res.write(serviceHelper.ensureString(done));
    if (res.flush) res.flush();
  }
}

/**
 * Remove application completely from local node.
 *
 * Split into a synchronous PRELUDE (stamp the app condemned, write the durable
 * teardown record, delete the DB row, broadcast removed) and an async TEARDOWN
 * (the drain + host cleanup). The app is "effectively uninstalled" the instant
 * the prelude finishes - the reconciler can no longer restart it (condemned) and
 * the network has been told it is gone. `background` selects how the teardown
 * runs: true (cancel/expiry) fires it and returns immediately so a sweep is not
 * blocked by a 65-min graceful drain; false (default: redeploy, the REST API,
 * the reverse cascade, force evictions) awaits it so the caller's next step
 * (e.g. a reinstall) sees the teardown finished. The durable doc + boot recovery
 * complete an interrupted teardown after a restart - it always completes.
 *
 * @param {string} app - Application name (or component_app)
 * @param {object} res - Response object for streaming
 * @param {boolean} force - Force removal (skips the in-progress gate)
 * @param {boolean} endResponse - Whether to end response
 * @param {boolean} sendMessage - Whether to broadcast removal to the network
 * @param {boolean} cancelGraceful - Drain components that declared a graceful window
 * @param {boolean} background - Fire the teardown and return (the design's `async`)
 * @returns {Promise<void>}
 */
async function removeAppLocally(app, res, force = false, endResponse = true, sendMessage = false, cancelGraceful = false, background = false, opts = {}) {
  // opts.keepNetwork: a redeploy keeps the app's own docker network (it is unchanged
  // across a same-app redeploy and networkWith consumers stay attached - see specDiff).
  // opts.skipPorts: a redeploy does NOT close ports here - it reconciles the port delta
  // (open new-old, close old-new) itself, leaving unchanged ports untouched. Both default
  // false so removal/cancel/expiry tear the network down and close all ports as before.
  const keepNetwork = opts.keepNetwork === true;
  const skipPorts = opts.skipPorts === true;
  let weSetRemovalFlag = false;
  // the bare app name we claimed in removalsInProgress, captured outside the try so
  // the finally can release exactly that entry (appName is block-scoped to the try)
  let removalName = null;
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

    if (!app) {
      throw new Error('No App specified');
    }

    // Derive the bare app name up front - the per-app removal gate below keys on it
    // (a component removal keys on its parent app, so it serializes with a whole-app
    // removal of the same app).
    const isComponent = app.includes('_');
    const appName = isComponent ? app.split('_')[1] : app;
    const appComponent = app.split('_')[0];

    if (!force) {
      // Per-app gate: block a SECOND removal of the same app, but let removals of
      // DIFFERENT apps proceed concurrently - the node-wide host-mutation lock and
      // the per-container condemned stamp serialize the shared/per-container work,
      // so node-wide removal serialization is no longer needed. A forced removal
      // (cancel/expiry) skips this gate; same-name coordination for the force path
      // (force WAITS on an in-flight same-name removal) is a documented follow-up.
      if (globalState.hasRemovalInProgress(appName)) {
        const warnResponse = messageHelper.createWarningMessage('This application is already undergoing removal. Removal not possible.');
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

    globalState.markRemovalInProgress(appName);
    // Only release the Set entry THIS call added (the finally below), so a
    // concurrent forced removal of the same app cannot clear another call's entry.
    weSetRemovalFlag = true;
    removalName = appName;

    // Cancel-during-install: if this app's install is mid-pull, abort it now so we
    // don't finish downloading gigabytes we are about to tear down (and so the
    // install unwinds via its own rollback rather than racing this teardown).
    const inFlightInstall = globalState.installingApps.get(appName);
    if (inFlightInstall) {
      log.info(`Aborting in-flight install of ${appName} due to removal`);
      inFlightInstall.abort();
    }

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

    // do this temporarily - otherwise we have to move a bunch of functions around
    appSpecifications = await checkAndDecryptAppSpecs(appSpecifications);
    appSpecifications = specificationFormatter(appSpecifications);

    // --- Phase A prelude (holds no shared lock) -----------------------------
    // Build the cleartext per-component teardown descriptors, then make the app
    // "effectively uninstalled" before any container is touched: persist the
    // owed teardown, condemn every component (the reconciler will not restart or
    // recreate a condemned container), drop the in-memory controller verdict,
    // tell the network it is gone, and delete the local DB row. Order is
    // load-bearing - the durable doc is written BEFORE the row is deleted so the
    // owed cleanup is never lost.
    const components = buildTeardownComponents(appSpecifications, isComponent, appComponent, appName);

    const teardownPersisted = await pendingTeardownStore.writeTeardown({
      key: app,
      name: appName,
      networkName: appName,
      isComponent,
      keepNetwork,
      createdAt: Date.now(),
      attempts: 0,
      components: components.map((c) => ({
        identifier: c.identifier, appId: c.appId, componentName: c.componentName, label: c.label, ports: c.ports, repotag: c.repotag,
      })),
    });
    if (!teardownPersisted) {
      // The durable doc is the SOLE record of owed cleanup once the local row is gone.
      // If it could not be persisted, abort BEFORE condemning + deleting the row: a crash
      // during the about-to-start teardown would otherwise leak the app's
      // volume/ufw/UPnP/image/network with no doc for boot recovery to heal. Nothing
      // destructive has run yet, so the app stays installed + uncondemned for a clean retry
      // (the every-8-block expiry sweep re-fires a cancel; a redeploy's awaited remove
      // rejects and rolls back). Throw so the outer catch logs + the finally releases the gate.
      throw new Error(`Aborting removal of ${appName}: could not persist the durable teardown record`);
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const descriptor of components) {
      // eslint-disable-next-line no-await-in-loop
      await appsRuntimeState.setCondemned(descriptor.identifier, true);
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const descriptor of components) {
      if (onComponentRemoved) onComponentRemoved(descriptor.identifier);
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
        // Fire-and-forget: AWAITing this serialized the whole batch cancel inside the
        // explorer block loop - broadcastMessageToAll -> peerManager paces a hardcoded
        // ~500ms + ~25ms/peer, so an N-app owner-group cancel paid ~0.5-2s x N of pure
        // network wait, blocking the explorer from advancing. Nothing below depends on it
        // completing (the runningAppsCache delete + DB row delete + runTeardown are all
        // independent), and 7a068bec7 already treats this broadcast as fire-and-forget.
        fluxCommunicationMessagesSender.broadcastMessageToAll(appRemovedMessage)
          .catch((e) => log.error(`appremoved broadcast for ${appName} failed: ${e.message}`));
        // Remove app from running apps cache
        const { runningAppsCache } = globalState;
        if (runningAppsCache.has(appName)) {
          runningAppsCache.delete(appName);
          log.info(`Removed ${appName} from running apps cache`);
        }
      }
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
    }

    // --- teardown (Phase A drain + Phase B host cleanup) --------------------
    const teardownCtx = {
      key: app, appName, isComponent, components, force, cancelGraceful, keepNetwork, skipPorts, res,
    };
    if (background) {
      // cancel/expiry: don't block the caller on the drain + host cleanup. A
      // backgrounded teardown MUST NOT write to res - the prelude already
      // returned to the caller, which owns ending the response - so null it out
      // regardless of what the caller passed (today they all pass res=null).
      // End the response here in the prelude (the teardown won't), so a future
      // caller that passes a real streaming res with background=true cannot hang.
      runTeardown({ ...teardownCtx, res: null }).catch((error) => log.error(`Background teardown of ${appName} failed: ${error.message}`));
      if (res && endResponse) {
        res.end();
      }
    } else {
      await runTeardown(teardownCtx);
      if (res && endResponse) {
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
    if (weSetRemovalFlag) globalState.removalDone(removalName);
  }
}

/**
 * Tri-state local-row presence for a whole-app name: 'present', 'absent', or
 * 'unknown' (a read error). Boot recovery MUST distinguish these: confirmed
 * absent => owed teardown; confirmed present => installed, do not tear down;
 * unknown => do nothing this boot. A read failure is NEVER treated as absent -
 * that would force a rm -rf of a possibly-live install's volume (irreversible),
 * whereas leaving the owed teardown for the next boot is self-healing.
 *
 * @param {string} appName
 * @returns {Promise<'present'|'absent'|'unknown'>}
 */
async function localAppRowState(appName) {
  try {
    const dbopen = dbHelper.databaseConnection();
    const appsDatabase = dbopen.db(config.database.appslocal.database);
    const row = await dbHelper.findOneInDatabase(appsDatabase, localAppsInformation, { name: appName }, { projection: { _id: 0, name: 1 } });
    return row ? 'present' : 'absent';
  } catch (err) {
    log.error(`Boot recovery: failed to read local row for ${appName}: ${err.message}`);
    return 'unknown';
  }
}

/**
 * Clears the condemned stamp for every component of a doc, so dropping a
 * stale/owed-elsewhere teardown record also lets the reconciler re-adopt a
 * still-installed app. Without this, a component condemned before the doc was
 * dropped stays condemned forever and the reconciler early-bails on it.
 *
 * Returns whether EVERY un-condemn was confirmed. setCondemned throws on a DB
 * write failure (it has no internal catch); a swallowed failure here would leave
 * a component condemned=true while the caller deletes the SOLE recovery record,
 * wedging a live re-installed component out of reconciliation forever - so the
 * caller must gate clearTeardown on this return (mirrors the FINISH path's
 * allDropped gate) and keep the doc for the next boot if any un-condemn failed.
 *
 * @param {Array<object>} comps
 * @returns {Promise<boolean>} true only if every condemned stamp was cleared
 */
async function unCondemnComponents(comps) {
  let allCleared = true;
  // eslint-disable-next-line no-restricted-syntax
  for (const comp of comps) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await appsRuntimeState.setCondemned(comp.identifier, false);
    } catch (error) {
      allCleared = false;
      log.error(`Boot recovery: failed to clear condemned for ${comp.identifier}: ${error.message}`);
    }
  }
  return allCleared;
}

/**
 * Boot recovery, phase 1 (synchronous, MUST run before the reconciler boot gate
 * opens): re-stamp condemned for every component of every owed teardown so a
 * recovered-but-not-yet-finished container can never be restarted. Returns ONLY
 * the docs that still need a teardown replay.
 *
 * A whole-app doc whose local row is BACK ('present') is dropped AND its
 * components un-condemned, without tearing down: a present row means the app is
 * installed and wanted - either re-installed while a teardown was still owed (the
 * cancel-vs-install race), or the removal aborted in the prelude before deleting
 * the row. A force-teardown would rm -rf a live install's volume, so the safe
 * action is to drop the stale record and let the reconciler manage the app. If
 * the row read is 'unknown' (DB blip) the doc is left untouched for a clean retry
 * next boot - never force-torn-down on a guess. (A component-scoped doc keeps the
 * app row, so this guard is whole-app only.) Best-effort; an empty collection yields [].
 *
 * @returns {Promise<Array<object>>} the docs phase 2 should replay
 */
async function stampCondemnedForPendingTeardowns() {
  const docs = await pendingTeardownStore.readAllTeardowns();
  const owed = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const doc of docs) {
    const comps = Array.isArray(doc.components) ? doc.components : [];
    if (!comps.length) {
      // eslint-disable-next-line no-await-in-loop
      await pendingTeardownStore.clearTeardown(doc.key);
      // eslint-disable-next-line no-continue
      continue;
    }
    if (doc.isComponent !== true) {
      // eslint-disable-next-line no-await-in-loop
      const rowState = await localAppRowState(doc.name);
      if (rowState === 'present') {
        log.warn(`Boot recovery: ${doc.name} is installed again (row present) - dropping stale teardown record + un-condemning, NOT tearing it down`);
        // eslint-disable-next-line no-await-in-loop
        const allCleared = await unCondemnComponents(comps);
        if (allCleared) {
          // eslint-disable-next-line no-await-in-loop
          await pendingTeardownStore.clearTeardown(doc.key);
        } else {
          // A swallowed un-condemn would orphan a condemned=true stamp while deleting the
          // SOLE recovery record - wedging the live re-installed component out of
          // reconciliation forever. Keep the doc so the next boot retries the un-condemn
          // (mirrors the FINISH path's allDropped gate).
          log.warn(`Boot recovery: ${doc.name} - not every condemned stamp cleared; keeping the teardown record for the next boot`);
        }
        // eslint-disable-next-line no-continue
        continue;
      }
      if (rowState === 'unknown') {
        // Can't tell present from absent: do nothing this boot (no condemn, no
        // drop, no replay). The doc survives so the next boot retries cleanly -
        // never force a destructive teardown on an unconfirmed read.
        log.warn(`Boot recovery: could not read local row for ${doc.name}; deferring its teardown to a later boot`);
        // eslint-disable-next-line no-continue
        continue;
      }
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const comp of comps) {
      // eslint-disable-next-line no-await-in-loop
      await appsRuntimeState.setCondemned(comp.identifier, true).catch((error) => {
        log.error(`Boot recovery: failed to re-stamp condemned for ${comp.identifier}: ${error.message}`);
      });
    }
    owed.push(doc);
  }
  if (owed.length) log.info(`Boot recovery: re-stamped condemned for ${owed.length} interrupted teardown(s)`);
  return owed;
}

/**
 * Boot recovery, phase 2 (background, AFTER the boot gate settles): replay each
 * owed teardown to completion. The original removal already deleted the DB row
 * and broadcast removal, so this just finishes the drain + host cleanup with
 * force semantics (the app is gone; force-remove any leftover container). Each
 * doc is replayed independently and best-effort - a node must always complete a
 * teardown, so a failure is logged and the durable doc survives for the next
 * boot rather than being abandoned.
 *
 * @param {Array<object>} docs - from stampCondemnedForPendingTeardowns
 * @returns {Promise<void>}
 */
async function resumePendingTeardowns(docs) {
  // eslint-disable-next-line no-restricted-syntax
  for (const doc of docs) {
    const components = Array.isArray(doc.components) ? doc.components : [];
    if (!components.length) {
      // nothing to tear down (shouldn't happen) - drop the stale record
      // eslint-disable-next-line no-await-in-loop
      await pendingTeardownStore.clearTeardown(doc.key);
      // eslint-disable-next-line no-continue
      continue;
    }
    log.warn(`Boot recovery: resuming interrupted teardown of ${doc.name} (${components.length} component(s))`);
    // eslint-disable-next-line no-await-in-loop
    await pendingTeardownStore.bumpAttempts(doc.key);
    // eslint-disable-next-line no-await-in-loop
    await runTeardown({
      key: doc.key,
      appName: doc.name,
      isComponent: doc.isComponent === true,
      components,
      force: true,
      cancelGraceful: false,
      keepNetwork: doc.keepNetwork === true,
      res: null,
    }).catch((error) => log.error(`Boot recovery: teardown of ${doc.name} failed, will retry next boot: ${error.message}`));
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
  removeAppLocallyApi,
  setOnComponentRemoved,
  dropControllerStateForRedeploy,
  stampCondemnedForPendingTeardowns,
  resumePendingTeardowns,
};
