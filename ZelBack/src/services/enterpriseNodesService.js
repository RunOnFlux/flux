const config = require('config');
const fluxCommunicationUtils = require('./fluxCommunicationUtils');
const messageHelper = require('./messageHelper');
const dbHelper = require('./dbHelper');
const log = require('../lib/log');

const globalAppsInformation = config.database.appsglobal.collections.appsInformation;

/**
 * To get enterprise nodes list
 * @returns {array} return enterprise node list
 */
async function getEnterpriseList() {
  try {
    const nodeList = await fluxCommunicationUtils.deterministicFluxList();
    const enterpriseList = []; // txhash, outidx, pubkey, score, ip, payment_address?, tier,
    // user collateralization, 200k in flux nodes is most trusted, get 500 points
    // 200k flux in nodes, is most trusted, 5 * 40, 200 * 1, get 500 points
    // collaterals older than 1 year are the most reliable get 500 points 1 year is 720 * 365 = 262800 blocks
    // KYCd public keys are the most trusted node ops. Get bonus 1000 points.
    // node tier collateralization - 2, 15, 30 points (cumulus, nimbus, stratus points)
    // if node is having port defined, exclude from enterprise list. This is because we require unique ip per app, otherwise a port clash will occur
    // a node will always prioritize its assigned app for deployment
    // get global app list specs and see if some app is specified to be locked for our node. If yes, decrease trust score by 25%
    // private image requires api key. We use IP (not collateral as of size limitations and as of easiness to obtain pgp) to determine a list where app will be spawned. Only those IPs can run the app - if the pgp can decrypt
    // v7: nodes field - array of IPs that can run the app, that should be able to decode the app.
    // each component now has secrets possibility - env variables field that gets encrypted by the IPs pgps
    // each component now has  repoauth username:token or auth token. - encrypted field for pulling private docker image
    const dbopen = dbHelper.databaseConnection();
    const database = dbopen.db(config.database.appsglobal.database);
    const query = { version: { $gte: 7 } };
    const projection = { projection: { _id: 0 } };
    const globalApps = await dbHelper.findInDatabase(database, globalAppsInformation, query, projection); // get apps v7
    const globalAppsScoped = globalApps.filter((apps) => apps.nodes.length); // only enterprise apps
    const isAlreadyEnterprised = {}; // ip/collateral: points
    globalAppsScoped.forEach((app) => {
      app.nodes.forEach((node) => {
        if (isAlreadyEnterprised[node]) {
          isAlreadyEnterprised[node] += 1;
        } else {
          isAlreadyEnterprised[node] = 1;
        }
      });
    });
    const currentTime = new Date().getTime();
    const collateralized = {}; // pubkey: points
    nodeList.forEach((node) => {
      let value = 0;
      if (node.tier === 'CUMULUS') {
        value = 1;
      } else if (node.tier === 'NIMBUS') {
        value = 12.5;
      } else if (node.tier === 'STRATUS') {
        value = 40;
      }
      if (collateralized[node.pubkey]) {
        collateralized[node.pubkey] += value;
      } else {
        collateralized[node.pubkey] = value;
      }
    });
    nodeList.forEach((node) => {
      const nodeInfo = {
        tier: node.tier,
        payment_address: node.payment_address,
        txhash: node.txhash,
        outidx: node.outidx,
        pubkey: node.pubkey,
        ip: node.ip,
      };
      let collateralPoints = 0;
      if (nodeInfo.tier === 'CUMULUS') {
        collateralPoints = 2;
      } else if (nodeInfo.tier === 'NIMBUS') {
        collateralPoints = 15;
      } else if (nodeInfo.tier === 'STRATUS') {
        collateralPoints = 30;
      }
      let maturityPoints = 0;
      const maxMaturity = 500;
      const activationTime = node.activesince * 1000;
      const timeDifference = currentTime - activationTime; // always positive integer
      let portion = timeDifference / 31556926000; // one year
      if (portion > 1) portion = 1;
      maturityPoints = Math.floor(maxMaturity * portion);
      let pubKeyPoints = 0;
      if (collateralized[node.pubkey]) {
        let points = collateralized[node.pubkey];
        if (points > 200) points = 200;
        points *= 2.5;
        pubKeyPoints = Math.floor(points);
      }
      let enterprisePoints = 0;
      const enterpriseNodesPubKees = config.enterprisePublicKeys;
      if (enterpriseNodesPubKees.includes(nodeInfo.pubkey)) {
        enterprisePoints = 2000;
      }
      nodeInfo.collateralPoints = collateralPoints;
      nodeInfo.maturityPoints = maturityPoints;
      nodeInfo.pubKeyPoints = pubKeyPoints;
      nodeInfo.enterprisePoints = enterprisePoints;
      let enterpriseApps = 0;
      if (isAlreadyEnterprised[nodeInfo.ip]) {
        enterpriseApps += isAlreadyEnterprised[nodeInfo.ip];
      }
      if (isAlreadyEnterprised[`${nodeInfo.txhash}:${nodeInfo.outidx}`]) {
        enterpriseApps += isAlreadyEnterprised[`${nodeInfo.txhash}:${nodeInfo.outidx}`];
      }
      nodeInfo.enterpriseApps = enterpriseApps;
      let enterpriseScore = collateralPoints + maturityPoints + pubKeyPoints + enterprisePoints;
      for (let i = 0; i < enterpriseApps; i += 1) {
        enterpriseScore *= 0.75; // reduce score by 25%
      }
      nodeInfo.score = Math.floor(enterpriseScore);
      if (nodeInfo.ip && !nodeInfo.ip.includes(':')) {
        enterpriseList.push(nodeInfo);
      }
    });
    enterpriseList.sort((a, b) => {
      if (a.score > b.score) return -1;
      if (a.score < b.score) return 1;
      return 0;
    });
    return enterpriseList;
  } catch (error) {
    log.error(error);
    return [];
  }
}

/**
 * To get list of enterprise nodes via API request.
 * @param {object} req Request.
 * @param {object} res Response.
 */
async function getEnterpriseNodesAPI(req, res) {
  try {
    const nodes = await getEnterpriseList();
    const response = messageHelper.createDataMessage(nodes);
    return res ? res.json(response) : response;
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

module.exports = {
  getEnterpriseList,
  getEnterpriseNodesAPI,
};
