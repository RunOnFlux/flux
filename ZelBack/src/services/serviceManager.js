const config = require('config');
const log = require('../lib/log');

const serviceHelper = require('./serviceHelper');
const explorerService = require('./explorerService');
const zelfluxCommunication = require('./zelfluxCommunication');
const zelappsService = require('./zelappsService');

async function startFluxFunctions() {
  try {
    log.info('Initiating MongoDB connection');
    await serviceHelper.initiateDB(); // either true or throws error
    log.info('DB connected');
    log.info('Preparing local database...');
    const db = serviceHelper.databaseConnection();
    const database = db.db(config.database.local.database);
    await serviceHelper.dropCollection(database, config.database.local.collections.activeLoginPhrases).catch((error) => {
      if (error.message !== 'ns not found') {
        log.error(error);
      }
    });
    await serviceHelper.dropCollection(database, config.database.local.collections.activeSignatures).catch((error) => {
      if (error.message !== 'ns not found') {
        log.error(error);
      }
    });
    await database.collection(config.database.local.collections.activeLoginPhrases).createIndex({ createdAt: 1 }, { expireAfterSeconds: 900 });
    await database.collection(config.database.local.collections.activeSignatures).createIndex({ createdAt: 1 }, { expireAfterSeconds: 900 });
    log.info('Local database prepared');
    log.info('Preparing temporary database...');
    // no need to drop temporary messages
    const databaseTemp = db.db(config.database.zelappsglobal.database);
    await databaseTemp.collection(config.database.zelappsglobal.collections.zelappsTemporaryMessages).createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 });
    log.info('Temporary database prepared');
    zelfluxCommunication.adjustFirewall();
    zelfluxCommunication.fluxDisovery();
    log.info('Flux Discovery started');
    zelfluxCommunication.keepConnectionsAlive();
    zelfluxCommunication.keepIncomingConnectionsAlive();
    zelfluxCommunication.checkDeterministicNodesCollisions();
    setInterval(() => {
      zelfluxCommunication.checkDeterministicNodesCollisions();
    }, 60000);
    log.info('Flux checks operational');
    explorerService.initiateBlockProcessor(true, true);
    setInterval(() => { // every 8 mins (4 blocks)
      zelappsService.continuousZelAppHashesCheck();
    }, 8 * 60 * 1000);
    log.info('Flux Block Processing Service started');
  } catch (e) {
    log.error(e);
    setTimeout(() => {
      startFluxFunctions();
    }, 15000);
  }
}

module.exports = {
  startFluxFunctions,
};
