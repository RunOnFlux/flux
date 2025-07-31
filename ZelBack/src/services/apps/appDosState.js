// Shared DOS state management for apps
// These variables track denial-of-service conditions for applications

const config = require('config');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');

let dosMessage = '';
let dosMountMessage = '';
let dosDuplicateAppMessage = '';
let dosState = 0;

/**
 * Save app DOS state to database.
 */
async function persistAppDosState() {
  try {
    const db = dbHelper.databaseConnection();
    const database = db.db(config.database.local.database);
    const collection = database.collection(config.database.local.collections.dosStates);

    const dosStateDoc = {
      type: 'apps',
      state: dosState,
      message: dosMessage,
      mountMessage: dosMountMessage,
      duplicateAppMessage: dosDuplicateAppMessage,
      updatedAt: new Date(),
    };

    await collection.replaceOne(
      { type: 'apps' },
      dosStateDoc,
      { upsert: true },
    );

    log.info(`App DOS state saved: ${dosState}, message: ${dosMessage}`);
  } catch (error) {
    log.error(`Failed to save app DOS state to database: ${error.message}`);
  }
}

module.exports = {
  // Getters and setters for DOS state
  get dosMessage() { return dosMessage; },
  set dosMessage(value) {
    dosMessage = value;
    persistAppDosState().catch((error) => {
      log.error(`Failed to persist app DOS state: ${error.message}`);
    });
  },

  get dosMountMessage() { return dosMountMessage; },
  set dosMountMessage(value) {
    dosMountMessage = value;
    persistAppDosState().catch((error) => {
      log.error(`Failed to persist app DOS state: ${error.message}`);
    });
  },

  get dosDuplicateAppMessage() { return dosDuplicateAppMessage; },
  set dosDuplicateAppMessage(value) {
    dosDuplicateAppMessage = value;
    persistAppDosState().catch((error) => {
      log.error(`Failed to persist app DOS state: ${error.message}`);
    });
  },

  get dosState() { return dosState; },
  set dosState(value) {
    dosState = value;
    persistAppDosState().catch((error) => {
      log.error(`Failed to persist app DOS state: ${error.message}`);
    });
  },
};
