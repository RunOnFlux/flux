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
const advancedWorkflows = require('./advancedWorkflows');
const upnpService = require('../upnpService');
const fluxNetworkHelper = require('../fluxNetworkHelper');
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const { availableApps } = require('../appDatabase/registryManager');
const { checkAndDecryptAppSpecs } = require('../utils/enterpriseHelper');
const { specificationFormatter } = require('../utils/appSpecHelpers');
const { stopAppMonitoring } = require('../appManagement/appInspector');

const fluxDirPath = process.env.FLUXOS_PATH || path.join(process.env.HOME, 'zelflux')
const appsFolderPath = process.env.FLUX_APPS_FOLDER || path.join(fluxDirPath, 'ZelApps');
const appsFolder = `${appsFolderPath}/`;
const cmdAsync = util.promisify(nodecmd.run);
const crontabLoad = util.promisify(systemcrontab.load);

/**
 * Hard uninstall application (complete removal)
 * @param {string} appName - Application name
 * @param {string} appId - Application ID
 * @param {object} appSpecifications - App specifications
 * @param {boolean} isComponent - Whether this is a component
 * @param {object} res - Response object for streaming
 * @param {function} stopAppMonitoring - Function to stop monitoring
 * @returns {Promise<object>} Uninstallation result
 */
async function appUninstallHard(appName, appId, appSpecifications, isComponent, res, stopAppMonitoring) {
  const stopStatus = {
    status: isComponent ? `Stopping Flux App Component ${appSpecifications.name}...` : `Stopping Flux App ${appName}...`,
  };
  log.info(stopStatus);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus));
    if (res.flush) res.flush();
  }
  let monitoredName = appName;
  if (isComponent) {
    monitoredName = `${appSpecifications.name}_${appName}`;
  }
  if (stopAppMonitoring) {
    stopAppMonitoring(monitoredName, true);
  }

  await dockerService.appDockerStop(appId).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
  });
  const stopStatus2 = {
    status: isComponent ? `Flux App Component ${appSpecifications.name} stopped` : `Flux App ${appName} stopped`,
  };
  log.info(stopStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus2));
    if (res.flush) res.flush();
  }

  try {
    await advancedWorkflows.stopSyncthingApp(monitoredName, res, false);
  } catch (error) {
    log.error(`Error stopping Syncthing app: ${error.message}`);
  }

  const removeStatus = {
    status: isComponent ? `Removing Flux App component ${appSpecifications.name} container...` : `Removing Flux App ${appName} container...`,
  };
  log.info(removeStatus);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus));
    if (res.flush) res.flush();
  }
  await dockerService.appDockerRemove(appId).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    log.error(errorResponse);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
  });
  const removeStatus2 = {
    status: isComponent ? `Flux App component ${appSpecifications.name} container removed` : `Flux App ${appName} container removed`,
  };
  log.info(removeStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus2));
    if (res.flush) res.flush();
  }

  const imageStatus = {
    status: isComponent ? `Removing Flux App component ${appSpecifications.name} image...` : `Removing Flux App ${appName} image...`,
  };
  log.info(imageStatus);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus));
    if (res.flush) res.flush();
  }
  await dockerService.appDockerImageRemove(appSpecifications.repotag).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    log.error(errorResponse);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
  });
  const imageStatus2 = {
    status: isComponent ? `Flux App component ${appSpecifications.name} image operations done` : `Flux App ${appName} image operations done`,
  };
  log.info(imageStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus2));
    if (res.flush) res.flush();
  }

  const portStatus = {
    status: isComponent ? `Denying Flux App component ${appSpecifications.name} ports...` : `Denying Flux App ${appName} ports...`,
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
    // v1 compatibility
  } else if (appSpecifications.port) {
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
    status: isComponent ? `Ports of component ${appSpecifications.name} denied` : `Ports of ${appName} denied`,
  };
  log.info(portStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(portStatus2));
    if (res.flush) res.flush();
  }

  const unmountStatus = {
    status: isComponent ? `Unmounting volume of component ${appName}...` : `Unmounting volume of ${appName}...`,
  };
  log.info(unmountStatus);
  if (res) {
    res.write(serviceHelper.ensureString(unmountStatus));
    if (res.flush) res.flush();
  }
  const execUnmount = `sudo umount ${appsFolder + appId}`;
  const execSuccess = await cmdAsync(execUnmount).catch((e) => {
    log.error(e);
    const unmountStatus3 = {
      status: isComponent ? `An error occured while unmounting component ${appSpecifications.name} storage. Continuing...` : `An error occured while unmounting ${appName} storage. Continuing...`,
    };
    log.info(unmountStatus3);
    if (res) {
      res.write(serviceHelper.ensureString(unmountStatus3));
      if (res.flush) res.flush();
    }
  });
  if (execSuccess) {
    const unmountStatus2 = {
      status: isComponent ? `Volume of component ${appSpecifications.name} unmounted` : `Volume of ${appName} unmounted`,
    };
    log.info(unmountStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(unmountStatus2));
      if (res.flush) res.flush();
    }
  }

  const cleaningStatus = {
    status: isComponent ? `Cleaning up component ${appSpecifications.name} data...` : `Cleaning up ${appName} data...`,
  };
  log.info(cleaningStatus);
  if (res) {
    res.write(serviceHelper.ensureString(cleaningStatus));
    if (res.flush) res.flush();
  }
  const execDelete = `sudo rm -rf ${appsFolder + appId}`;
  await cmdAsync(execDelete).catch((e) => {
    log.error(e);
    const cleaningStatusE = {
      status: isComponent ? `An error occured while cleaning component ${appSpecifications.name} data. Continuing...` : `An error occured while cleaning ${appName} data. Continuing...`,
    };
    log.info(cleaningStatusE);
    if (res) {
      res.write(serviceHelper.ensureString(cleaningStatusE));
      if (res.flush) res.flush();
    }
  });
  const cleaningStatus2 = {
    status: isComponent ? `Data of component ${appSpecifications.name} cleaned` : `Data of ${appName} cleaned`,
  };
  log.info(cleaningStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(cleaningStatus2));
    if (res.flush) res.flush();
  }

  let volumepath;
  // CRONTAB
  const cronStatus = {
    status: 'Adjusting crontab...',
  };
  log.info(cronStatus);
  if (res) {
    res.write(serviceHelper.ensureString(cronStatus));
    if (res.flush) res.flush();
  }

  const crontab = await crontabLoad().catch((e) => {
    log.error(e);
    const cronE = {
      status: 'An error occured while loading crontab. Continuing...',
    };
    log.info(cronE);
    if (res) {
      res.write(serviceHelper.ensureString(cronE));
      if (res.flush) res.flush();
    }
  });
  if (crontab) {
    const jobs = crontab.jobs();
    // find correct cronjob
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
    // remove the job
    if (jobToRemove) {
      crontab.remove(jobToRemove);
      // save
      try {
        crontab.save();
      } catch (e) {
        log.error(e);
        const cronE = {
          status: 'An error occured while saving crontab. Continuing...',
        };
        log.info(cronE);
        if (res) {
          res.write(serviceHelper.ensureString(cronE));
          if (res.flush) res.flush();
        }
      }
      const cronStatusDone = {
        status: 'Crontab Adjusted.',
      };
      log.info(cronStatusDone);
      if (res) {
        res.write(serviceHelper.ensureString(cronStatusDone));
        if (res.flush) res.flush();
      }
    } else {
      const cronStatusNotFound = {
        status: 'Crontab not found.',
      };
      log.info(cronStatusNotFound);
      if (res) {
        res.write(serviceHelper.ensureString(cronStatusNotFound));
        if (res.flush) res.flush();
      }
    }
  }

  if (volumepath) {
    const cleaningVolumeStatus = {
      status: isComponent ? `Cleaning up data volume of ${appSpecifications.name}...` : `Cleaning up data volume of ${appName}...`,
    };
    log.info(cleaningVolumeStatus);
    if (res) {
      res.write(serviceHelper.ensureString(cleaningVolumeStatus));
      if (res.flush) res.flush();
    }
    const execVolumeDelete = `sudo rm -rf ${volumepath}`;
    await cmdAsync(execVolumeDelete).catch((e) => {
      log.error(e);
      const cleaningVolumeStatusE = {
        status: isComponent ? `An error occured while cleaning component ${appSpecifications.name} volume. Continuing...` : `An error occured while cleaning ${appName} volume. Continuing...`,
      };
      log.info(cleaningVolumeStatusE);
      if (res) {
        res.write(serviceHelper.ensureString(cleaningVolumeStatusE));
        if (res.flush) res.flush();
      }
    });
    const cleaningVolumeStatus2 = {
      status: isComponent ? `Volume of component ${appSpecifications.name} cleaned` : `Volume of ${appName} cleaned`,
    };
    log.info(cleaningVolumeStatus2);
    if (res) {
      res.write(serviceHelper.ensureString(cleaningVolumeStatus2));
      if (res.flush) res.flush();
    }
  }
  const appRemovalResponse = {
    status: isComponent ? `Flux App component ${appSpecifications.name} of ${appName} was successfuly removed` : `Flux App ${appName} was successfuly removed`,
  };
  log.info(appRemovalResponse);
  if (res) {
    res.write(serviceHelper.ensureString(appRemovalResponse));
    if (res.flush) res.flush();
  }
}

/**
 * Soft uninstall application (container removal only)
 * @param {string} appName - Application name
 * @param {string} appId - Application ID
 * @param {object} appSpecifications - App specifications
 * @param {boolean} isComponent - Whether this is a component
 * @param {object} res - Response object for streaming
 * @param {function} stopAppMonitoring - Function to stop monitoring
 * @returns {Promise<object>} Uninstallation result
 */
async function appUninstallSoft(appName, appId, appSpecifications, isComponent, res, stopAppMonitoring) {
  const stopStatus = {
    status: isComponent ? `Stopping Flux App Component ${appSpecifications.name}...` : `Stopping Flux App ${appName}...`,
  };
  log.info(stopStatus);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus));
    if (res.flush) res.flush();
  }
  let monitoredName = appName;
  if (isComponent) {
    monitoredName = `${appSpecifications.name}_${appName}`;
  }
  if (stopAppMonitoring) {
    stopAppMonitoring(monitoredName, false);
  }
  await dockerService.appDockerStop(appId).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
  });

  const stopStatus2 = {
    status: isComponent ? `Flux App Component ${appSpecifications.name} stopped` : `Flux App ${appName} stopped`,
  };
  log.info(stopStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(stopStatus2));
    if (res.flush) res.flush();
  }

  const removeStatus = {
    status: isComponent ? `Removing Flux App component ${appSpecifications.name} container...` : `Removing Flux App ${appName} container...`,
  };
  log.info(removeStatus);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus));
    if (res.flush) res.flush();
  }

  await dockerService.appDockerRemove(appId);

  const removeStatus2 = {
    status: isComponent ? `Flux App component ${appSpecifications.name} container removed` : `Flux App ${appName} container removed`,
  };
  log.info(removeStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(removeStatus2));
    if (res.flush) res.flush();
  }

  const imageStatus = {
    status: isComponent ? `Removing Flux App component ${appSpecifications.name} image...` : `Removing Flux App ${appName} image...`,
  };
  log.info(imageStatus);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus));
    if (res.flush) res.flush();
  }
  await dockerService.appDockerImageRemove(appSpecifications.repotag).catch((error) => {
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    log.error(errorResponse);
    if (res) {
      res.write(serviceHelper.ensureString(errorResponse));
      if (res.flush) res.flush();
    }
  });
  const imageStatus2 = {
    status: isComponent ? `Flux App component ${appSpecifications.name} image operations done` : `Flux App ${appName} image operations done`,
  };
  log.info(imageStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(imageStatus2));
    if (res.flush) res.flush();
  }

  const portStatus = {
    status: isComponent ? `Denying Flux App component ${appSpecifications.name} ports...` : `Denying Flux App ${appName} ports...`,
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
    // v1 compatibility
  } else if (appSpecifications.port) {
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
    status: isComponent ? `Ports of component ${appSpecifications.name} denied` : `Ports of ${appName} denied`,
  };
  log.info(portStatus2);
  if (res) {
    res.write(serviceHelper.ensureString(portStatus2));
    if (res.flush) res.flush();
  }
  const appRemovalResponse = {
    status: isComponent ? `Flux App component ${appSpecifications.name} of ${appName} was successfuly removed` : `Flux App ${appName} was successfuly removed`,
  };
  log.info(appRemovalResponse);
  if (res) {
    res.write(serviceHelper.ensureString(appRemovalResponse));
    if (res.flush) res.flush();
  }
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
async function removeAppLocally(app, res, force = false, endResponse = true, sendMessage = false) {
  try {
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

    globalState.removalInProgress = true;

    if (!app) {
      throw new Error('No App specified');
    }

    let isComponent = app.includes('_');
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
            const specifications = message.appSpecifications || message.zelAppSpecifications;
            return specifications.name === appName;
          });
          let currentSpecifications;
          appMessages.forEach((message) => {
            if (!currentSpecifications || message.height > currentSpecifications.height) {
              currentSpecifications = message;
            }
          });
          if (currentSpecifications && currentSpecifications.height) {
            appSpecifications = currentSpecifications.appSpecifications || currentSpecifications.zelAppSpecifications;
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
        isComponent = true;
        appId = dockerService.getAppIdentifier(`${appComposedComponent.name}_${appSpecifications.name}`);
        const appComponentSpecifications = appComposedComponent;
        // eslint-disable-next-line no-await-in-loop
        await appUninstallHard(appName, appId, appComponentSpecifications, isComponent, res, stopAppMonitoring);
      }
      isComponent = false;
    } else if (isComponent) {
      const componentSpecifications = appSpecifications.compose.find((component) => component.name === appComponent);
      await appUninstallHard(appName, appId, componentSpecifications, isComponent, res, stopAppMonitoring);
    } else {
      await appUninstallHard(appName, appId, appSpecifications, isComponent, res, stopAppMonitoring);
    }

    if (sendMessage) {
      const ip = await fluxNetworkHelper.getMyFluxIPandPort();
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
        await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(appRemovedMessage);
        await serviceHelper.delay(500);
        await fluxCommunicationMessagesSender.broadcastMessageToIncoming(appRemovedMessage);
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
      await dockerService.removeFluxAppDockerNetwork(appName).catch((error) => log.error(error));
      const dockerNetworkStatus2 = {
        status: 'Docker network cleaned',
      };
      log.info(dockerNetworkStatus2);
      if (res) {
        res.write(serviceHelper.ensureString(dockerNetworkStatus2));
        if (res.flush) res.flush();
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
 * @param {object} globalStateRef - Global state reference
 * @param {function} stopAppMonitoring - Function to stop monitoring
 * @returns {Promise<void>}
 */
async function softRemoveAppLocally(app, res, globalStateRef, stopAppMonitoring) {
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

    let isComponent = app.includes('_');
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
        isComponent = true;
        appId = dockerService.getAppIdentifier(`${appComposedComponent.name}_${appSpecifications.name}`);
        const appComponentSpecifications = appComposedComponent;
        // eslint-disable-next-line no-await-in-loop
        await appUninstallSoft(appName, appId, appComponentSpecifications, isComponent, res, stopAppMonitoring);
      }
      isComponent = false;
    } else if (isComponent) {
      const componentSpecifications = appSpecifications.compose.find((component) => component.name === appComponent);
      await appUninstallSoft(appName, appId, componentSpecifications, isComponent, res, stopAppMonitoring);
    } else {
      await appUninstallSoft(appName, appId, appSpecifications, isComponent, res, stopAppMonitoring);
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

    if (global) {
      const executeAppGlobalCommand = require('../appsService').executeAppGlobalCommand;
      executeAppGlobalCommand(appname, 'appremove', req.headers.zelidauth); // do not wait
      const appResponse = messageHelper.createSuccessMessage(`${appname} queried for global reinstallation`);
      return res.json(appResponse);
    }

    // Set response headers for streaming
    res.setHeader('Content-Type', 'application/json');

    await removeAppLocally(appname, res, force, true, true);
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
  appUninstallHard,
  appUninstallSoft,
  removeAppLocally,
  softRemoveAppLocally,
  removeAppLocallyApi,
};