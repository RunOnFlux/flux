const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const syncthingService = require('../syncthingService');
const { appsFolder } = require('../utils/appConstants');
const { OWNED_FOLDER_SETTINGS } = require('./syncthingMonitorHelpers');

// How long a primary start waits for a type change syncthing did not answer to
// show in its config. Syncthing applies a type change by restarting the folder;
// the start claim keeps peers off the component for the whole wait.
const FOLDER_TYPE_SETTLE_MS = 60 * 1000;
const FOLDER_TYPE_POLL_MS = 1000;

/**
 * Whether a folder's configured type becomes `folderType` within `settleMs`.
 * @param {string} folderPath
 * @param {string} folderType
 * @param {number} settleMs
 * @returns {Promise<boolean>}
 */
async function folderTypeSettles(folderPath, folderType, settleMs) {
  const deadline = Date.now() + settleMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(FOLDER_TYPE_POLL_MS);
    // eslint-disable-next-line no-await-in-loop
    const folders = await syncthingService.getConfigFolders().catch(() => null);
    if (folders?.find((f) => f.path === folderPath)?.type === folderType) return true;
  }
  return false;
}

/**
 * Helper function to change syncthing folder type
 *
 * A write syncthing did not answer is not a refusal: it may still apply. With
 * `settleMs`, such a write succeeds if the folder shows the type within that
 * time. A write syncthing answered with an error fails at once.
 * @param {string} folderId - Syncthing folder ID (e.g., appId)
 * @param {string} folderType - 'receiveonly' or 'sendreceive'
 * @param {{settleMs?: number}} [options]
 * @returns {Promise<boolean>} - true if successful, false otherwise
 */
async function changeSyncthingFolderType(folderId, folderType, { settleMs = 0 } = {}) {
  try {

    // Get current folder configuration
    const folders = await syncthingService.getConfigFolders();

    // Find the folder by path
    // Syncthing syncs the entire appId folder (includes all subdirectories)
    const folderPath = `${appsFolder}${folderId}`;
    const folder = folders.find((f) => f.path === folderPath);

    if (!folder) {
      log.error(`Syncthing folder not found for path: ${folderPath}`);
      return false;
    }

    // Check if already in desired mode
    // The election asserts a standby's type on every pass, so an unchanged
    // folder is the common case and says nothing worth logging.
    if (folder.type === folderType) {
      return true;
    }

    log.info(`Changing syncthing folder ${folderId} to ${folderType} mode`);

    // Update folder type using PATCH
    const patchData = { type: folderType, ...OWNED_FOLDER_SETTINGS };
    const updateResponse = await syncthingService.adjustConfigFolders('patch', patchData, folder.id);

    if (updateResponse.status === 'success') {
      log.info(`Successfully changed syncthing folder ${folderId} to ${folderType} mode`);
      return true;
    }
    if (settleMs > 0 && updateResponse.data?.httpStatus === null) {
      log.warn(`Syncthing did not answer the change of folder ${folderId} to ${folderType} mode, waiting up to ${settleMs}ms for it to apply`);
      if (await folderTypeSettles(folderPath, folderType, settleMs)) {
        log.info(`Syncthing folder ${folderId} is in ${folderType} mode`);
        return true;
      }
    }
    log.error(`Failed to change syncthing folder type: ${JSON.stringify(updateResponse)}`);
    return false;
  } catch (error) {
    log.error(`Error changing syncthing folder type for ${folderId}: ${error.message}`);
    return false;
  }
}

module.exports = {
  FOLDER_TYPE_SETTLE_MS,
  changeSyncthingFolderType,
};
