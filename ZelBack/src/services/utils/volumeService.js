const util = require('util');
const { exec } = require('child_process');
const dockerService = require('../dockerService');
const log = require('../../lib/log');
const { appsFolder } = require('./appConstants');

const cmdAsync = util.promisify(exec);

async function verifyAppVolumeMount(appName, isComponent, componentName) {
  const identifier = isComponent ? `${componentName}_${appName}` : appName;
  const appId = dockerService.getAppIdentifier(identifier);
  const mountPath = `${appsFolder}${appId}`;

  try {
    const { stdout } = await cmdAsync(`mount | grep "${mountPath}"`);
    if (stdout && stdout.includes(mountPath)) {
      log.info(`Volume mount verified for ${identifier} at ${mountPath}`);
      return true;
    }
  } catch (error) {
    const errorMessage = `Volume mount verification failed for ${mountPath}. Mount does not exist or is not accessible.`;
    log.error(`${errorMessage} Details: ${error.message}`);
    throw new Error(errorMessage);
  }

  throw new Error(`Volume mount verification failed for ${mountPath}. Mount does not exist or is not accessible.`);
}

module.exports = {
  verifyAppVolumeMount,
};
