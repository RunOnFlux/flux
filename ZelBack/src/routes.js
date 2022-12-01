const apicache = require('apicache');

const daemonServiceAddressRpcs = require('./services/daemonService/daemonServiceAddressRpcs');
const daemonServiceTransactionRpcs = require('./services/daemonService/daemonServiceTransactionRpcs');
const daemonServiceBlockchainRpcs = require('./services/daemonService/daemonServiceBlockchainRpcs');
const daemonServiceBenchmarkRpcs = require('./services/daemonService/daemonServiceBenchmarkRpcs');
const daemonServiceMiningRpcs = require('./services/daemonService/daemonServiceMiningRpcs');
const daemonServiceNetworkRpcs = require('./services/daemonService/daemonServiceNetworkRpcs');
const daemonServiceZelnodeRpcs = require('./services/daemonService/daemonServiceZelnodeRpcs');
const daemonServiceWalletRpcs = require('./services/daemonService/daemonServiceWalletRpcs');
const daemonServiceUtilityRpcs = require('./services/daemonService/daemonServiceUtilityRpcs');
const daemonServiceZcashRpcs = require('./services/daemonService/daemonServiceZcashRpcs');
const daemonServiceControlRpcs = require('./services/daemonService/daemonServiceControlRpcs');
const benchmarkService = require('./services/benchmarkService');
const idService = require('./services/idService');
const fluxService = require('./services/fluxService');
const fluxCommunication = require('./services/fluxCommunication');
const fluxCommunicationMessagesSender = require('./services/fluxCommunicationMessagesSender');
const appsService = require('./services/appsService');
const explorerService = require('./services/explorerService');
const fluxshareService = require('./services/fluxshareService');
const generalService = require('./services/generalService');
const upnpService = require('./services/upnpService');
const syncthingService = require('./services/syncthingService');
const fluxNetworkHelper = require('./services/fluxNetworkHelper');

function isLocal(req, res, next) {
  const remote = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || req.headers['x-forwarded-for'];
  if (remote === 'localhost' || remote === '127.0.0.1' || remote === '::ffff:127.0.0.1' || remote === '::1') return next();
  return res.status(401).send('Access denied');
}

const cache = apicache.middleware;

module.exports = (app, expressWs) => {
  // GET PUBLIC methods
  app.get('/daemon/help/:command?', cache('1 hour'), (req, res) => { // accept both help/command and ?command=getinfo. If ommited, default help will be displayed. Other calls works in similar way
    daemonServiceControlRpcs.help(req, res);
  });
  app.get('/daemon/getinfo', cache('30 seconds'), (req, res) => {
    daemonServiceControlRpcs.getInfo(req, res);
  });
  app.get('/daemon/getzelnodestatus', cache('30 seconds'), (req, res) => {
    daemonServiceZelnodeRpcs.getZelNodeStatus(req, res);
  });
  app.get('/daemon/listzelnodes/:filter?', cache('30 seconds'), (req, res) => {
    daemonServiceZelnodeRpcs.listZelNodes(req, res);
  });
  app.get('/daemon/viewdeterministiczelnodelist/:filter?', cache('30 seconds'), (req, res) => {
    daemonServiceZelnodeRpcs.viewDeterministicZelNodeList(req, res);
  });
  app.get('/daemon/znsync/:mode?', cache('30 seconds'), (req, res) => {
    daemonServiceZelnodeRpcs.znsync(req, res);
  });
  app.get('/daemon/decodezelnodebroadcast/:hexstring?', cache('30 seconds'), (req, res) => {
    daemonServiceZelnodeRpcs.decodeZelNodeBroadcast(req, res);
  });
  app.get('/daemon/getzelnodecount', cache('30 seconds'), (req, res) => {
    daemonServiceZelnodeRpcs.getZelNodeCount(req, res);
  });
  app.get('/daemon/getdoslist', cache('30 seconds'), (req, res) => {
    daemonServiceZelnodeRpcs.getDOSList(req, res);
  });
  app.get('/daemon/getstartlist', cache('30 seconds'), (req, res) => {
    daemonServiceZelnodeRpcs.getStartList(req, res);
  });
  app.get('/daemon/getzelnodescores/:blocks?', cache('30 seconds'), (req, res) => { // defaults to 10
    daemonServiceZelnodeRpcs.getZelNodeScores(req, res);
  });
  app.get('/daemon/getzelnodewinners/:blocks?/:filter?', cache('30 seconds'), (req, res) => {
    daemonServiceZelnodeRpcs.getZelNodeWinners(req, res);
  });
  app.get('/daemon/relayzelnodebroadcast/:hexstring?', cache('30 seconds'), (req, res) => {
    daemonServiceZelnodeRpcs.relayZelNodeBroadcast(req, res);
  });
  app.get('/daemon/spork/:name?/:value?', cache('30 seconds'), (req, res) => {
    daemonServiceZelnodeRpcs.spork(req, res);
  });
  app.get('/daemon/fluxcurrentwinner', cache('30 seconds'), (req, res) => {
    daemonServiceZelnodeRpcs.zelNodeCurrentWinner(req, res);
  });
  app.get('/daemon/fluxdebug', cache('30 seconds'), (req, res) => {
    daemonServiceZelnodeRpcs.zelNodeDebug(req, res);
  });
  app.get('/daemon/getbestblockhash', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.getBestBlockHash(req, res);
  });
  app.get('/daemon/getblock/:hashheight?/:verbosity?', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.getBlock(req, res);
  });
  app.get('/daemon/getblockchaininfo', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.getBlockchainInfo(req, res);
  });
  app.get('/daemon/getblockcount', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.getBlockCount(req, res);
  });
  app.get('/daemon/getblockdeltas/:hash?', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.getBlockDeltas(req, res);
  });
  app.get('/daemon/getblockhashes/:high?/:low?/:noorphans?/:logicaltimes?', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.getBlockHashes(req, res);
  });
  app.get('/daemon/getblockhash/:index?', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.getBlockHash(req, res);
  });
  app.get('/daemon/getblockheader/:hash?/:verbose?', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.getBlockHeader(req, res);
  });
  app.get('/daemon/getchaintips', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.getChainTips(req, res);
  });
  app.get('/daemon/getdifficulty', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.getDifficulty(req, res);
  });
  app.get('/daemon/getmempoolinfo', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.getMempoolInfo(req, res);
  });
  app.get('/daemon/getrawmempool/:verbose?', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.getRawMemPool(req, res);
  });
  app.get('/daemon/gettxout/:txid?/:n?/:includemempool?', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.getTxOut(req, res);
  });
  app.get('/daemon/gettxoutproof/:txids?/:blockhash?', cache('30 seconds'), (req, res) => { // comma separated list of txids. For example: /gettxoutproof/abc,efg,asd/blockhash
    daemonServiceBlockchainRpcs.getTxOutProof(req, res);
  });
  app.get('/daemon/gettxoutsetinfo', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.getTxOutSetInfo(req, res);
  });
  app.get('/daemon/verifytxoutproof/:proof?', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.verifyTxOutProof(req, res);
  });
  app.get('/daemon/getspentinfo/:txid?/:index?', cache('30 seconds'), (req, res) => {
    daemonServiceBlockchainRpcs.getSpentInfo(req, res);
  });
  app.get('/daemon/getblocksubsidy/:height?', cache('30 seconds'), (req, res) => {
    daemonServiceMiningRpcs.getBlockSubsidy(req, res);
  });
  app.get('/daemon/getblocktemplate/:jsonrequestobject?', cache('30 seconds'), (req, res) => {
    daemonServiceMiningRpcs.getBlockTemplate(req, res);
  });
  app.get('/daemon/getlocalsolps', cache('30 seconds'), (req, res) => {
    daemonServiceMiningRpcs.getLocalSolPs(req, res);
  });
  app.get('/daemon/getmininginfo', cache('30 seconds'), (req, res) => {
    daemonServiceMiningRpcs.getMiningInfo(req, res);
  });
  app.get('/daemon/getnetworkhashps/:blocks?/:height?', cache('30 seconds'), (req, res) => {
    daemonServiceMiningRpcs.getNetworkHashPs(req, res);
  });
  app.get('/daemon/getnetworksolps/:blocks?/:height?', cache('30 seconds'), (req, res) => {
    daemonServiceMiningRpcs.getNetworkSolPs(req, res);
  });
  app.get('/daemon/getconnectioncount', cache('30 seconds'), (req, res) => {
    daemonServiceNetworkRpcs.getConnectionCount(req, res);
  });
  app.get('/daemon/getdeprecationinfo', cache('30 seconds'), (req, res) => {
    daemonServiceNetworkRpcs.getDeprecationInfo(req, res);
  });
  app.get('/daemon/getnettotals', cache('30 seconds'), (req, res) => {
    daemonServiceNetworkRpcs.getNetTotals(req, res);
  });
  app.get('/daemon/getnetworkinfo', cache('30 seconds'), (req, res) => {
    daemonServiceNetworkRpcs.getNetworkInfo(req, res);
  });
  app.get('/daemon/getpeerinfo', cache('30 seconds'), (req, res) => {
    daemonServiceNetworkRpcs.getPeerInfo(req, res);
  });
  app.get('/daemon/listbanned', cache('30 seconds'), (req, res) => {
    daemonServiceNetworkRpcs.listBanned(req, res);
  });
  app.get('/daemon/createrawtransaction/:transactions?/:addresses?/:locktime?/:expiryheight?', (req, res) => {
    daemonServiceTransactionRpcs.createRawTransaction(req, res);
  });
  app.get('/daemon/decoderawtransaction/:hexstring?', cache('30 seconds'), (req, res) => {
    daemonServiceTransactionRpcs.decodeRawTransaction(req, res);
  });
  app.get('/daemon/decodescript/:hex?', cache('30 seconds'), (req, res) => {
    daemonServiceTransactionRpcs.decodeScript(req, res);
  });
  app.get('/daemon/fundrawtransaction/:hexstring?', (req, res) => {
    daemonServiceTransactionRpcs.fundRawTransaction(req, res);
  });
  app.get('/daemon/getrawtransaction/:txid?/:verbose?', (req, res) => {
    daemonServiceTransactionRpcs.getRawTransaction(req, res);
  });
  app.get('/daemon/sendrawtransaction/:hexstring?/:allowhighfees?', (req, res) => {
    daemonServiceTransactionRpcs.sendRawTransaction(req, res);
  });
  app.get('/daemon/createmultisig/:n?/:keys?', (req, res) => {
    daemonServiceUtilityRpcs.createMultiSig(req, res);
  });
  app.get('/daemon/estimatefee/:nblocks?', cache('30 seconds'), (req, res) => {
    daemonServiceUtilityRpcs.estimateFee(req, res);
  });
  app.get('/daemon/estimatepriority/:nblocks?', cache('30 seconds'), (req, res) => {
    daemonServiceUtilityRpcs.estimatePriority(req, res);
  });
  app.get('/daemon/validateaddress/:zelcashaddress?', cache('30 seconds'), (req, res) => {
    daemonServiceUtilityRpcs.validateAddress(req, res);
  });
  app.get('/daemon/verifymessage/:zelcashaddress?/:signature?/:message?', cache('30 seconds'), (req, res) => {
    daemonServiceUtilityRpcs.verifyMessage(req, res);
  });
  app.get('/daemon/gettransaction/:txid?/:includewatchonly?', cache('30 seconds'), (req, res) => {
    daemonServiceWalletRpcs.getTransaction(req, res);
  });
  app.get('/daemon/zvalidateaddress/:zaddr?', cache('30 seconds'), (req, res) => {
    daemonServiceUtilityRpcs.zValidateAddress(req, res);
  });
  app.get('/daemon/getbenchmarks', cache('30 seconds'), (req, res) => {
    daemonServiceBenchmarkRpcs.getBenchmarks(req, res);
  });
  app.get('/daemon/getbenchstatus', cache('30 seconds'), (req, res) => {
    daemonServiceBenchmarkRpcs.getBenchStatus(req, res);
  });

  app.get('/id/loginphrase', (req, res) => {
    idService.loginPhrase(req, res);
  });
  app.get('/id/emergencyphrase', (req, res) => {
    idService.emergencyPhrase(req, res);
  });
  app.get('/zelid/loginphrase', (req, res) => {
    idService.loginPhrase(req, res);
  });
  app.get('/zelid/emergencyphrase', (req, res) => {
    idService.emergencyPhrase(req, res);
  });

  app.get('/flux/nodetier', cache('30 seconds'), (req, res) => {
    fluxService.getNodeTier(req, res);
  });
  app.get('/flux/info', cache('60 seconds'), (req, res) => {
    fluxService.getFluxInfo(req, res);
  });
  app.get('/flux/timezone', (req, res) => {
    fluxService.getFluxTimezone(req, res);
  });
  app.get('/flux/version', cache('30 seconds'), (req, res) => {
    fluxService.getFluxVersion(req, res);
  });
  app.get('/flux/ip', cache('30 seconds'), (req, res) => {
    fluxService.getFluxIP(req, res);
  });
  app.get('/flux/zelid', cache('30 seconds'), (req, res) => {
    fluxService.getFluxZelID(req, res);
  });
  app.get('/flux/id', cache('30 seconds'), (req, res) => {
    fluxService.getFluxZelID(req, res);
  });
  app.get('/flux/cruxid', cache('30 seconds'), (req, res) => {
    fluxService.getFluxCruxID(req, res);
  });
  app.get('/flux/kadena', cache('30 seconds'), (req, res) => {
    fluxService.getFluxKadena(req, res);
  });
  app.get('/flux/dosstate', cache('30 seconds'), (req, res) => {
    fluxNetworkHelper.getDOSState(req, res);
  });
  app.get('/flux/connectedpeers', cache('30 seconds'), (req, res) => {
    fluxCommunication.connectedPeers(req, res);
  });
  app.get('/flux/connectedpeersinfo', cache('30 seconds'), (req, res) => {
    fluxCommunication.connectedPeersInfo(req, res);
  });
  app.get('/flux/incomingconnections', cache('30 seconds'), (req, res) => {
    fluxNetworkHelper.getIncomingConnections(req, res, expressWs.getWss('/ws/flux'));
  });
  app.get('/flux/incomingconnectionsinfo', cache('30 seconds'), (req, res) => {
    fluxNetworkHelper.getIncomingConnectionsInfo(req, res, expressWs.getWss('/ws/flux'));
  });
  app.get('/flux/checkfluxavailability/:ip?/:port?', cache('30 seconds'), (req, res) => {
    fluxNetworkHelper.checkFluxAvailability(req, res);
  });

  app.get('/apps/listrunningapps', cache('30 seconds'), (req, res) => {
    appsService.listRunningApps(req, res);
  });
  app.get('/apps/listallapps', cache('30 seconds'), (req, res) => {
    appsService.listAllApps(req, res);
  });
  app.get('/apps/listappsimages', cache('30 seconds'), (req, res) => {
    appsService.listAppsImages(req, res);
  });
  app.get('/apps/installedapps/:appname?', cache('30 seconds'), (req, res) => {
    appsService.installedApps(req, res);
  });
  app.get('/apps/availableapps', cache('30 seconds'), (req, res) => {
    appsService.availableApps(req, res);
  });
  app.get('/apps/fluxusage', cache('30 seconds'), (req, res) => {
    appsService.fluxUsage(req, res);
  });
  app.get('/apps/appsresources', cache('30 seconds'), (req, res) => {
    appsService.appsResources(req, res);
  });
  app.get('/apps/registrationinformation', cache('30 seconds'), (req, res) => {
    appsService.registrationInformation(req, res);
  });
  app.get('/apps/temporarymessages/:hash?', cache('5 seconds'), (req, res) => {
    appsService.getAppsTemporaryMessages(req, res);
  });
  app.get('/apps/permanentmessages/:hash?', cache('30 seconds'), (req, res) => {
    appsService.getAppsPermanentMessages(req, res);
  });
  app.get('/apps/globalappsspecifications', cache('30 seconds'), (req, res) => {
    appsService.getGlobalAppsSpecifications(req, res);
  });
  app.get('/apps/appspecifications/:appname?', cache('30 seconds'), (req, res) => {
    appsService.getApplicationSpecificationAPI(req, res);
  });
  app.get('/apps/appowner/:appname?', cache('30 seconds'), (req, res) => {
    appsService.getApplicationOwnerAPI(req, res);
  });
  app.get('/apps/hashes', cache('30 seconds'), (req, res) => {
    appsService.getAppHashes(req, res);
  });
  app.get('/apps/location/:appname?', cache('30 seconds'), (req, res) => {
    appsService.getAppsLocation(req, res);
  });
  app.get('/apps/locations', cache('30 seconds'), (req, res) => {
    appsService.getAppsLocations(req, res);
  });
  app.post('/apps/calculateprice', (req, res) => { // returns price in zel for both new registration of app and update of app
    appsService.getAppPrice(req, res);
  });
  app.get('/apps/whitelistedrepositories', cache('30 seconds'), (req, res) => {
    generalService.whitelistedRepositories(req, res);
  });
  app.post('/apps/verifyappregistrationspecifications', (req, res) => { // returns formatted app specifications
    appsService.verifyAppRegistrationParameters(req, res);
  });
  app.post('/apps/verifyappupdatespecifications', (req, res) => { // returns formatted app specifications
    appsService.verifyAppUpdateParameters(req, res);
  });
  app.get('/apps/deploymentinformation', cache('30 seconds'), (req, res) => {
    appsService.deploymentInformation(req, res);
  });

  // app.get('/explorer/allutxos', (req, res) => {
  //   explorerService.getAllUtxos(req, res);
  // });
  // app.get('/explorer/alladdresseswithtransactions', (req, res) => {
  //   explorerService.getAllAddressesWithTransactions(req, res);
  // });
  // app.get('/explorer/alladdresses', (req, res) => {
  //   explorerService.getAllAddresses(req, res);
  // });
  // app.get('/explorer/fluxtransactions', (req, res) => {
  //   explorerService.getAllFluxTransactions(req, res);
  // });
  // filter can be IP, address, collateralHash.
  app.get('/explorer/fluxtxs/:filter?', cache('30 seconds'), (req, res) => {
    explorerService.getFilteredFluxTxs(req, res);
  });
  app.get('/explorer/utxo/:address?', cache('30 seconds'), (req, res) => {
    explorerService.getAddressUtxos(req, res);
  });
  app.get('/explorer/transactions/:address?', cache('30 seconds'), (req, res) => {
    explorerService.getAddressTransactions(req, res);
  });
  app.get('/explorer/balance/:address?', cache('30 seconds'), (req, res) => {
    explorerService.getAddressBalance(req, res);
  });
  app.get('/explorer/scannedheight', cache('30 seconds'), (req, res) => {
    explorerService.getScannedHeight(req, res);
  });
  // app.get('/explorer/fusion/coinbase/all', cache('30 seconds'), (req, res) => {
  //   explorerService.getAllFusionCoinbase(req, res);
  // });
  app.get('/explorer/fusion/coinbase/:address?', cache('30 seconds'), (req, res) => { // deprecated
    explorerService.getAddressFusionCoinbase(req, res);
  });

  // GET PROTECTED API - User level
  app.get('/daemon/prioritisetransaction/:txid?/:prioritydelta?/:feedelta?', cache('30 seconds'), (req, res) => {
    daemonServiceMiningRpcs.prioritiseTransaction(req, res);
  });
  app.get('/daemon/submitblock/:hexdata?/:jsonparametersobject?', cache('30 seconds'), (req, res) => {
    daemonServiceMiningRpcs.submitBlock(req, res);
  });

  app.get('/id/loggedsessions', cache('30 seconds'), (req, res) => {
    idService.loggedSessions(req, res);
  });
  app.get('/id/logoutcurrentsession', cache('30 seconds'), (req, res) => {
    idService.logoutCurrentSession(req, res);
  });
  app.get('/id/logoutallsessions', cache('30 seconds'), (req, res) => {
    idService.logoutAllSessions(req, res);
  });
  app.get('/zelid/loggedsessions', cache('30 seconds'), (req, res) => {
    idService.loggedSessions(req, res);
  });
  app.get('/zelid/logoutcurrentsession', cache('30 seconds'), (req, res) => {
    idService.logoutCurrentSession(req, res);
  });
  app.get('/zelid/logoutallsessions', cache('30 seconds'), (req, res) => {
    idService.logoutAllSessions(req, res);
  });

  app.get('/benchmark/getstatus', cache('30 seconds'), (req, res) => {
    benchmarkService.getStatus(req, res);
  });
  app.get('/benchmark/help/:command?', cache('1 hour'), (req, res) => {
    benchmarkService.help(req, res);
  });
  app.get('/benchmark/getbenchmarks', cache('30 seconds'), (req, res) => {
    benchmarkService.getBenchmarks(req, res);
  });
  app.get('/benchmark/getinfo', cache('30 seconds'), (req, res) => {
    benchmarkService.getInfo(req, res);
  });

  app.get('/syncthing/meta', cache('30 seconds'), (req, res) => {
    syncthingService.getMeta(req, res);
  });
  app.get('/syncthing/deviceid', cache('30 seconds'), (req, res) => {
    syncthingService.getDeviceID(req, res);
  });
  app.get('/syncthing/health', cache('30 seconds'), (req, res) => {
    syncthingService.getHealth(req, res);
  });
  app.get('/syncthing/system/browse/:current?', cache('30 seconds'), (req, res) => {
    syncthingService.systemBrowse(req, res);
  });
  app.get('/syncthing/system/connections', cache('30 seconds'), (req, res) => {
    syncthingService.systemConnections(req, res);
  });
  app.get('/syncthing/system/debug/:enable?/:disable?', cache('30 seconds'), (req, res) => {
    syncthingService.systemDebug(req, res);
  });
  app.get('/syncthing/system/discovery/:device?/:addr?', cache('30 seconds'), (req, res) => {
    syncthingService.systemDiscovery(req, res);
  });
  app.get('/syncthing/system/error/clear', cache('30 seconds'), (req, res) => {
    syncthingService.systemErrorClear(req, res);
  });
  app.get('/syncthing/system/error/:message?', cache('30 seconds'), (req, res) => {
    syncthingService.systemError(req, res);
  });
  app.get('/syncthing/system/error/:message?', cache('30 seconds'), (req, res) => {
    syncthingService.systemError(req, res);
  });
  app.get('/syncthing/system/log/:since?', cache('30 seconds'), (req, res) => {
    syncthingService.systemLog(req, res);
  });
  app.get('/syncthing/system/logtxt/:since?', cache('30 seconds'), (req, res) => {
    syncthingService.systemLogTxt(req, res);
  });
  app.get('/syncthing/system/paths', cache('30 seconds'), (req, res) => {
    syncthingService.systemPaths(req, res);
  });
  app.get('/syncthing/system/pause/:device?', cache('30 seconds'), (req, res) => {
    syncthingService.systemPause(req, res);
  });
  app.get('/syncthing/system/ping', cache('30 seconds'), (req, res) => {
    syncthingService.systemPing(req, res);
  });
  app.get('/syncthing/system/reset/:folder?', cache('30 seconds'), (req, res) => {
    syncthingService.systemReset(req, res);
  });
  app.get('/syncthing/system/restart', cache('30 seconds'), (req, res) => {
    syncthingService.systemRestart(req, res);
  });
  app.get('/syncthing/system/resume/:device?', cache('30 seconds'), (req, res) => {
    syncthingService.systemResume(req, res);
  });
  app.get('/syncthing/system/shutdown', cache('30 seconds'), (req, res) => {
    syncthingService.systemShutdown(req, res);
  });
  app.get('/syncthing/system/status', cache('30 seconds'), (req, res) => {
    syncthingService.systemStatus(req, res);
  });
  app.get('/syncthing/system/upgrade', cache('30 seconds'), (req, res) => {
    syncthingService.systemUpgrade(req, res);
  });
  app.get('/syncthing/system/version', cache('30 seconds'), (req, res) => {
    syncthingService.systemVersion(req, res);
  });
  app.get('/syncthing/config', cache('30 seconds'), (req, res) => {
    syncthingService.getConfig(req, res);
  });
  app.get('/syncthing/config/restart-required', cache('30 seconds'), (req, res) => {
    syncthingService.getConfigRestartRequired(req, res);
  });
  app.get('/syncthing/config/folders/:id?', cache('30 seconds'), (req, res) => {
    syncthingService.getConfigFolders(req, res);
  });
  app.get('/syncthing/config/devices/:id?', cache('30 seconds'), (req, res) => {
    syncthingService.getConfigDevices(req, res);
  });
  app.get('/syncthing/config/defaults/folder', cache('30 seconds'), (req, res) => {
    syncthingService.getConfigDefaultsFolder(req, res);
  });
  app.get('/syncthing/config/defaults/device', cache('30 seconds'), (req, res) => {
    syncthingService.getConfigDefaultsDevice(req, res);
  });
  app.get('/syncthing/config/defaults/ignores', cache('30 seconds'), (req, res) => {
    syncthingService.getConfigDefaultsIgnores(req, res);
  });
  app.get('/syncthing/config/options', cache('30 seconds'), (req, res) => {
    syncthingService.getConfigOptions(req, res);
  });
  app.get('/syncthing/config/ldap', cache('30 seconds'), (req, res) => {
    syncthingService.getConfigLdap(req, res);
  });
  app.get('/syncthing/config/gui', cache('30 seconds'), (req, res) => {
    syncthingService.getConfigGui(req, res);
  });
  app.get('/syncthing/stats/device', cache('30 seconds'), (req, res) => {
    syncthingService.statsDevice(req, res);
  });
  app.get('/syncthing/stats/folder', cache('30 seconds'), (req, res) => {
    syncthingService.statsFolder(req, res);
  });
  app.get('/syncthing/cluster/pending/devices', cache('30 seconds'), (req, res) => {
    syncthingService.getClusterPendigDevices(req, res);
  });
  app.get('/syncthing/cluster/pending/folders', cache('30 seconds'), (req, res) => {
    syncthingService.getClusterPendigFolders(req, res);
  });
  app.get('/syncthing/folder/errors/:folder?', cache('30 seconds'), (req, res) => {
    syncthingService.getFolderErrors(req, res);
  });
  app.get('/syncthing/folder/versions/:folder?', cache('30 seconds'), (req, res) => {
    syncthingService.getFolderVersions(req, res);
  });
  app.get('/syncthing/db/browse/:folder?/:levels?/:prefix?', cache('30 seconds'), (req, res) => {
    syncthingService.getDbBrowse(req, res);
  });
  app.get('/syncthing/db/completion/:folder?/:device?', cache('30 seconds'), (req, res) => {
    syncthingService.getDbCompletion(req, res);
  });
  app.get('/syncthing/db/file/:folder?/:file?', cache('30 seconds'), (req, res) => {
    syncthingService.getDbFile(req, res);
  });
  app.get('/syncthing/db/ignores/:folder?', cache('30 seconds'), (req, res) => {
    syncthingService.getDbIgnores(req, res);
  });
  app.get('/syncthing/db/localchanged/:folder?', cache('30 seconds'), (req, res) => {
    syncthingService.getDbLocalchanged(req, res);
  });
  app.get('/syncthing/db/need/:folder?', cache('30 seconds'), (req, res) => {
    syncthingService.getDbNeed(req, res);
  });
  app.get('/syncthing/db/remoteneed/:folder?/:device?', cache('30 seconds'), (req, res) => {
    syncthingService.getDbRemoteNeed(req, res);
  });
  app.get('/syncthing/db/status/:folder?', cache('30 seconds'), (req, res) => {
    syncthingService.getDbStatus(req, res);
  });
  app.get('/syncthing/events/disk', cache('30 seconds'), (req, res) => {
    syncthingService.getEventsDisk(req, res);
  });
  app.get('/syncthing/events/:events?/:since?/:limit?/:timeout?', cache('30 seconds'), (req, res) => {
    syncthingService.getEvents(req, res);
  });
  app.get('/syncthing/svc/random/string/:length?', cache('30 seconds'), (req, res) => {
    syncthingService.getSvcRandomString(req, res);
  });
  app.get('/syncthing/svc/report', cache('30 seconds'), (req, res) => {
    syncthingService.getSvcReport(req, res);
  });
  app.get('/syncthing/svc/:deviceid?', cache('30 seconds'), (req, res) => {
    syncthingService.getSvcDeviceID(req, res);
  });
  app.get('/syncthing/debug/peerCompletion', cache('30 seconds'), (req, res) => {
    syncthingService.debugPeerCompletion(req, res);
  });
  app.get('/syncthing/debug/httpmetrics', cache('30 seconds'), (req, res) => {
    syncthingService.debugHttpmetrics(req, res);
  });
  app.get('/syncthing/debug/cpuprof', cache('30 seconds'), (req, res) => {
    syncthingService.debugCpuprof(req, res);
  });
  app.get('/syncthing/debug/heapprof', cache('30 seconds'), (req, res) => {
    syncthingService.debugHeapprof(req, res);
  });
  app.get('/syncthing/debug/support', cache('30 seconds'), (req, res) => {
    syncthingService.debugSupport(req, res);
  });
  app.get('/syncthing/debug/file', cache('30 seconds'), (req, res) => {
    syncthingService.debugFile(req, res);
  });

  // GET PROTECTED API - ZelNode Owner
  app.get('/daemon/stop', (req, res) => {
    daemonServiceControlRpcs.stop(req, res);
  });
  app.get('/daemon/reindex', (req, res) => {
    fluxService.reindexDaemon(req, res);
  });
  app.get('/daemon/createzelnodekey', (req, res) => {
    daemonServiceZelnodeRpcs.createZelNodeKey(req, res);
  });
  app.get('/daemon/createzelnodebroadcast/:command?/:alias?', (req, res) => {
    daemonServiceZelnodeRpcs.createZelNodeBroadcast(req, res);
  });
  app.get('/daemon/listzelnodeconf/:filter?', (req, res) => {
    daemonServiceZelnodeRpcs.listZelNodeConf(req, res);
  });
  app.get('/daemon/getzelnodeoutputs', (req, res) => {
    daemonServiceZelnodeRpcs.getZelNodeOutputs(req, res);
  });
  app.get('/daemon/startzelnode/:set?/:lockwallet?/:alias?', (req, res) => {
    daemonServiceZelnodeRpcs.startZelNode(req, res);
  });
  app.get('/daemon/startdeterministiczelnode/:alias?/:lockwallet?', (req, res) => {
    daemonServiceZelnodeRpcs.startDeterministicZelNode(req, res);
  });
  app.get('/daemon/verifychain/:checklevel?/:numblocks?', (req, res) => {
    daemonServiceBlockchainRpcs.verifyChain(req, res);
  });
  app.get('/daemon/addnode/:node?/:command?', (req, res) => {
    daemonServiceNetworkRpcs.addNode(req, res);
  });
  app.get('/daemon/clearbanned', (req, res) => {
    daemonServiceNetworkRpcs.clearBanned(req, res);
  });
  app.get('/daemon/disconnectnode/:node?', (req, res) => {
    daemonServiceNetworkRpcs.disconnectNode(req, res);
  });
  app.get('/daemon/getaddednodeinfo/:dns?/:node?', (req, res) => {
    daemonServiceNetworkRpcs.getAddedNodeInfo(req, res);
  });
  app.get('/daemon/setban/:ip?/:command?/:bantime?/:absolute?', (req, res) => {
    daemonServiceNetworkRpcs.setBan(req, res);
  });
  app.get('/daemon/signrawtransaction/:hexstring?/:prevtxs?/:privatekeys?/:sighashtype?/:branchid?', (req, res) => {
    daemonServiceTransactionRpcs.signRawTransaction(req, res);
  });
  app.get('/daemon/addmultisigaddress/:n?/:keysobject?', (req, res) => {
    daemonServiceWalletRpcs.addMultiSigAddress(req, res);
  });
  app.get('/daemon/backupwallet/:destination?', (req, res) => {
    daemonServiceWalletRpcs.backupWallet(req, res);
  });
  app.get('/daemon/dumpprivkey/:taddr?', (req, res) => {
    daemonServiceWalletRpcs.dumpPrivKey(req, res);
  });
  app.get('/daemon/getbalance/:minconf?/:includewatchonly?', (req, res) => {
    daemonServiceWalletRpcs.getBalance(req, res);
  });
  app.get('/daemon/getnewaddress', (req, res) => {
    daemonServiceWalletRpcs.getNewAddress(req, res);
  });
  app.get('/daemon/getrawchangeaddress', (req, res) => {
    daemonServiceWalletRpcs.getRawChangeAddress(req, res);
  });
  app.get('/daemon/getreceivedbyaddress/:zelcashaddress?/:minconf?', (req, res) => {
    daemonServiceWalletRpcs.getReceivedByAddress(req, res);
  });
  app.get('/daemon/getunconfirmedbalance', (req, res) => {
    daemonServiceWalletRpcs.getUnconfirmedBalance(req, res);
  });
  app.get('/daemon/getwalletinfo', (req, res) => {
    daemonServiceWalletRpcs.getWalletInfo(req, res);
  });
  app.get('/daemon/importaddress/:address?/:label?/:rescan?', (req, res) => {
    daemonServiceWalletRpcs.importAddress(req, res);
  });
  app.get('/daemon/importprivkey/:zelcashprivkey?/:label?/:rescan?', (req, res) => {
    daemonServiceWalletRpcs.importPrivKey(req, res);
  });
  app.get('/daemon/importwallet/:filename?', (req, res) => {
    daemonServiceWalletRpcs.importWallet(req, res);
  });
  app.get('/daemon/keypoolrefill/:newsize?', (req, res) => {
    daemonServiceWalletRpcs.keyPoolRefill(req, res);
  });
  app.get('/daemon/listaddressgroupings', (req, res) => {
    daemonServiceWalletRpcs.listAddressGroupings(req, res);
  });
  app.get('/daemon/listlockunspent', (req, res) => {
    daemonServiceWalletRpcs.listLockUnspent(req, res);
  });
  app.get('/daemon/listreceivedbyaddress/:minconf?/:includeempty?/:includewatchonly?', (req, res) => {
    daemonServiceWalletRpcs.listReceivedByAddress(req, res);
  });
  app.get('/daemon/listsinceblock/:blockhash?/:targetconfirmations?/:includewatchonly?', (req, res) => {
    daemonServiceWalletRpcs.listSinceBlock(req, res);
  });
  app.get('/daemon/listtransactions/:count?/:from?/:includewatchonly?', (req, res) => {
    daemonServiceWalletRpcs.listTransactions(req, res);
  });
  app.get('/daemon/listunspent/:minconf?/:maxconf?/:addresses?', (req, res) => {
    daemonServiceWalletRpcs.listUnspent(req, res);
  });
  app.get('/daemon/lockunspent/:unlock?/:transactions?', (req, res) => {
    daemonServiceWalletRpcs.lockUnspent(req, res);
  });
  app.get('/daemon/rescanblockchain/:startheight?', (req, res) => {
    daemonServiceWalletRpcs.rescanBlockchain(req, res);
  });
  app.get('/daemon/sendfrom/:tozelcashaddress?/:amount?/:minconf?/:comment?/:commentto?', (req, res) => {
    daemonServiceWalletRpcs.sendFrom(req, res);
  });
  app.get('/daemon/sendmany/:amounts?/:minconf?/:comment?/:substractfeefromamount?', (req, res) => {
    daemonServiceWalletRpcs.sendMany(req, res);
  });
  app.get('/daemon/sendtoaddress/:zelcashaddress?/:amount?/:comment?/:commentto?/:substractfeefromamount?', (req, res) => {
    daemonServiceWalletRpcs.sendToAddress(req, res);
  });
  app.get('/daemon/settxfee/:amount?', (req, res) => {
    daemonServiceWalletRpcs.setTxFee(req, res);
  });
  app.get('/daemon/signmessage/:taddr?/:message?', (req, res) => {
    daemonServiceWalletRpcs.signMessage(req, res);
  });
  app.get('/daemon/zexportkey/:zaddr?', (req, res) => {
    daemonServiceZcashRpcs.zExportKey(req, res);
  });
  app.get('/daemon/zexportviewingkey/:zaddr?', (req, res) => {
    daemonServiceZcashRpcs.zExportViewingKey(req, res);
  });
  app.get('/daemon/zgetbalance/:address?/:minconf?', (req, res) => {
    daemonServiceZcashRpcs.zGetBalance(req, res);
  });
  app.get('/daemon/zgetmigrationstatus', (req, res) => {
    daemonServiceZcashRpcs.zGetMigrationStatus(req, res);
  });
  app.get('/daemon/zgetnewaddress/:type?', (req, res) => {
    daemonServiceZcashRpcs.zGetNewAddress(req, res);
  });
  app.get('/daemon/zgetoperationresult/:operationid?', (req, res) => {
    daemonServiceZcashRpcs.zGetOperationResult(req, res);
  });
  app.get('/daemon/zgetoperationstatus/:operationid?', (req, res) => {
    daemonServiceZcashRpcs.zGetOperationStatus(req, res);
  });
  app.get('/daemon/zgettotalbalance/:minconf?/:includewatchonly?', (req, res) => {
    daemonServiceZcashRpcs.zGetTotalBalance(req, res);
  });
  app.get('/daemon/zimportkey/:zkey?/:rescan?/:startheight?', (req, res) => {
    daemonServiceZcashRpcs.zImportKey(req, res);
  });
  app.get('/daemon/zimportviewingkey/:vkey?/:rescan?/:startheight?', (req, res) => {
    daemonServiceZcashRpcs.zImportViewingKey(req, res);
  });
  app.get('/daemon/zimportwallet/:filename?', (req, res) => {
    daemonServiceZcashRpcs.zImportWallet(req, res);
  });
  app.get('/daemon/zlistaddresses/:includewatchonly?', (req, res) => {
    daemonServiceZcashRpcs.zListAddresses(req, res);
  });
  app.get('/daemon/zlistoperationids', (req, res) => {
    daemonServiceZcashRpcs.zListOperationIds(req, res);
  });
  app.get('/daemon/zlistreceivedbyaddress/:address?/:minconf?', (req, res) => {
    daemonServiceZcashRpcs.zListReceivedByAddress(req, res);
  });
  app.get('/daemon/zlistunspent/:minconf?/:maxonf?/:includewatchonly?/:addresses?', (req, res) => {
    daemonServiceZcashRpcs.zListUnspent(req, res);
  });
  app.get('/daemon/zmergetoaddress/:fromaddresses?/:toaddress?/:fee?/:transparentlimit?/:shieldedlimit?/:memo?', (req, res) => {
    daemonServiceZcashRpcs.zMergeToAddress(req, res);
  });
  app.get('/daemon/zsendmany/:fromaddress?/:amounts?/:minconf?/:fee?', (req, res) => {
    daemonServiceZcashRpcs.zSendMany(req, res);
  });
  app.get('/daemon/zsetmigration/:enabled?', (req, res) => {
    daemonServiceZcashRpcs.zSetMigration(req, res);
  });
  app.get('/daemon/zshieldcoinbase/:fromaddress?/:toaddress?/:fee?/:limit?', (req, res) => {
    daemonServiceZcashRpcs.zShieldCoinBase(req, res);
  });
  app.get('/daemon/zcrawjoinsplit/:rawtx?/:inputs?/:outputs?/:vpubold?/:vpubnew?', (req, res) => {
    daemonServiceZcashRpcs.zcRawJoinSplit(req, res);
  });
  app.get('/daemon/zcrawkeygen', (req, res) => {
    daemonServiceZcashRpcs.zcRawKeygen(req, res);
  });
  app.get('/daemon/zcrawreceive/:zcsecretkey?/:encryptednote?', (req, res) => {
    daemonServiceZcashRpcs.zcRawReceive(req, res);
  });
  app.get('/daemon/zcsamplejoinsplit', (req, res) => {
    daemonServiceZcashRpcs.zcSampleJoinSplit(req, res);
  });
  app.get('/daemon/getaddresstxids/:address?/:start?/:end?', (req, res) => {
    daemonServiceAddressRpcs.getSingleAddresssTxids(req, res);
  });
  app.get('/daemon/getaddressbalance/:address?', (req, res) => {
    daemonServiceAddressRpcs.getSingleAddressBalance(req, res);
  });
  app.get('/daemon/getaddressdeltas/:address?/:start?/:end?/:chaininfo?', (req, res) => {
    daemonServiceAddressRpcs.getSingleAddressDeltas(req, res);
  });
  app.get('/daemon/getaddressutxos/:address?/:chaininfo?', (req, res) => {
    daemonServiceAddressRpcs.getSingleAddressUtxos(req, res);
  });
  app.get('/daemon/getaddressmempool/:address?', (req, res) => {
    daemonServiceAddressRpcs.getSingleAddressMempool(req, res);
  });

  app.get('/id/loggedusers', (req, res) => {
    idService.loggedUsers(req, res);
  });
  app.get('/id/activeloginphrases', (req, res) => {
    idService.activeLoginPhrases(req, res);
  });
  app.get('/id/logoutallusers', (req, res) => {
    idService.logoutAllUsers(req, res);
  });
  app.get('/zelid/loggedusers', (req, res) => {
    idService.loggedUsers(req, res);
  });
  app.get('/zelid/activeloginphrases', (req, res) => {
    idService.activeLoginPhrases(req, res);
  });
  app.get('/zelid/logoutallusers', (req, res) => {
    idService.logoutAllUsers(req, res);
  });

  app.get('/flux/adjustcruxid/:cruxid?', (req, res) => { // note this essentially rebuilds flux use with caution!
    fluxService.adjustCruxID(req, res);
  });
  app.get('/flux/adjustkadena/:account?/:chainid?', (req, res) => { // note this essentially rebuilds flux use with caution!
    fluxService.adjustKadenaAccount(req, res);
  });
  app.get('/flux/reindexdaemon', (req, res) => {
    fluxService.reindexDaemon(req, res);
  });

  app.get('/benchmark/signzelnodetransaction/:hexstring?', (req, res) => {
    benchmarkService.signFluxTransaction(req, res);
  });
  app.get('/benchmark/stop', (req, res) => {
    benchmarkService.stop(req, res);
  });

  // GET PROTECTED API - FluxTeam
  app.get('/daemon/start', (req, res) => {
    fluxService.startDaemon(req, res);
  });
  app.get('/daemon/restart', (req, res) => {
    fluxService.restartDaemon(req, res);
  });
  app.get('/daemon/ping', (req, res) => { // we do not want this to be issued by anyone.
    daemonServiceNetworkRpcs.ping(req, res);
  });
  app.get('/daemon/zcbenchmark/:benchmarktype?/:samplecount?', (req, res) => {
    daemonServiceZcashRpcs.zcBenchmark(req, res);
  });
  app.get('/daemon/startbenchmark', (req, res) => {
    daemonServiceBenchmarkRpcs.startBenchmarkD(req, res);
  });
  app.get('/daemon/stopbenchmark', (req, res) => {
    daemonServiceBenchmarkRpcs.stopBenchmarkD(req, res);
  });

  app.get('/flux/startbenchmark', (req, res) => {
    fluxService.startBenchmark(req, res);
  });
  app.get('/flux/restartbenchmark', (req, res) => {
    fluxService.restartBenchmark(req, res);
  });
  app.get('/flux/startdaemon', (req, res) => {
    fluxService.startDaemon(req, res);
  });
  app.get('/flux/restartdaemon', (req, res) => {
    fluxService.restartDaemon(req, res);
  });
  app.get('/flux/updateflux', (req, res) => { // method shall be called only if flux version is obsolete.
    fluxService.updateFlux(req, res);
  });
  app.get('/flux/softupdateflux', (req, res) => { // method shall be called only if flux version is obsolete.
    fluxService.softUpdateFlux(req, res);
  });
  app.get('/flux/softupdatefluxinstall', (req, res) => { // method shall be called only if flux version is obsolete.
    fluxService.softUpdateFluxInstall(req, res);
  });
  app.get('/flux/hardupdateflux', (req, res) => { // method shall be called only if flux version is obsolete and updatezeflux is not working correctly
    fluxService.hardUpdateFlux(req, res);
  });
  app.get('/flux/rebuildhome', (req, res) => {
    fluxService.rebuildHome(req, res);
  });
  app.get('/flux/updatedaemon', (req, res) => { // method shall be called only if daemon version is obsolete
    fluxService.updateDaemon(req, res);
  });
  app.get('/flux/updatebenchmark', (req, res) => { // method shall be called only if benchamrk version is obsolete
    fluxService.updateBenchmark(req, res);
  });
  app.get('/flux/daemondebug', (req, res) => {
    fluxService.daemonDebug(req, res);
  });
  app.get('/flux/benchmarkdebug', (req, res) => {
    fluxService.benchmarkDebug(req, res);
  });
  app.get('/flux/taildaemondebug', (req, res) => {
    fluxService.tailDaemonDebug(req, res);
  });
  app.get('/flux/tailbenchmarkdebug', (req, res) => {
    fluxService.tailBenchmarkDebug(req, res);
  });
  app.get('/flux/errorlog', (req, res) => {
    fluxService.fluxErrorLog(req, res);
  });
  app.get('/flux/warnlog', (req, res) => {
    fluxService.fluxWarnLog(req, res);
  });
  app.get('/flux/debuglog', (req, res) => {
    fluxService.fluxDebugLog(req, res);
  });
  app.get('/flux/infolog', (req, res) => {
    fluxService.fluxInfoLog(req, res);
  });
  app.get('/flux/tailerrorlog', (req, res) => {
    fluxService.tailFluxErrorLog(req, res);
  });
  app.get('/flux/tailwarnlog', (req, res) => {
    fluxService.tailFluxWarnLog(req, res);
  });
  app.get('/flux/taildebuglog', (req, res) => {
    fluxService.tailFluxDebugLog(req, res);
  });
  app.get('/flux/tailinfolog', (req, res) => {
    fluxService.tailFluxInfoLog(req, res);
  });

  app.get('/flux/broadcastmessage/:data?', (req, res) => {
    fluxCommunicationMessagesSender.broadcastMessageFromUser(req, res);
  });
  app.get('/flux/broadcastmessagetooutgoing/:data?', (req, res) => {
    fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUser(req, res);
  });
  app.get('/flux/broadcastmessagetoincoming/:data?', (req, res) => {
    fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUser(req, res);
  });
  app.get('/flux/addpeer/:ip?', (req, res) => {
    fluxCommunication.addPeer(req, res);
  });
  app.get('/flux/removepeer/:ip?', (req, res) => {
    fluxCommunication.removePeer(req, res);
  });
  app.get('/flux/removeincomingpeer/:ip?', (req, res) => {
    fluxCommunication.removeIncomingPeer(req, res, expressWs.getWss('/ws/flux'));
  });
  app.get('/flux/allowport/:port?', (req, res) => {
    fluxNetworkHelper.allowPortApi(req, res);
  });
  app.get('/flux/checkcommunication', (req, res) => {
    fluxNetworkHelper.isCommunicationEstablished(req, res);
  });
  app.get('/flux/uptime', (req, res) => {
    fluxNetworkHelper.fluxUptime(req, res);
  });
  app.get('/flux/backendfolder', isLocal, (req, res) => {
    fluxService.fluxBackendFolder(req, res);
  });
  app.get('/flux/mapport/:port?', (req, res) => {
    upnpService.mapPortApi(req, res);
  });
  app.get('/flux/unmapport/:port?', (req, res) => {
    upnpService.removeMapPortApi(req, res);
  });
  app.get('/flux/getmap', (req, res) => {
    upnpService.getMapApi(req, res);
  });
  app.get('/flux/getip', (req, res) => {
    upnpService.getIpApi(req, res);
  });
  app.get('/flux/getgateway', (req, res) => {
    upnpService.getGatewayApi(req, res);
  });

  app.get('/benchmark/start', (req, res) => {
    fluxService.startBenchmark(req, res);
  });
  app.get('/benchmark/restart', (req, res) => {
    fluxService.restartBenchmark(req, res);
  });
  app.get('/benchmark/restartnodebenchmarks', (req, res) => {
    benchmarkService.restartNodeBenchmarks(req, res);
  });

  app.get('/explorer/reindex/:reindexapps?', (req, res) => {
    explorerService.reindexExplorer(req, res);
  });
  app.get('/explorer/restart', (req, res) => {
    explorerService.restartBlockProcessing(req, res);
  });
  app.get('/explorer/stop', (req, res) => {
    explorerService.stopBlockProcessing(req, res);
  });
  app.get('/explorer/rescan/:blockheight?/:rescanapps?', (req, res) => {
    explorerService.rescanExplorer(req, res);
  });

  app.get('/apps/appstart/:appname?/:global?', (req, res) => {
    appsService.appStart(req, res);
  });
  app.get('/apps/appstop/:appname?/:global?', (req, res) => {
    appsService.appStop(req, res);
  });
  app.get('/apps/apprestart/:appname?/:global?', (req, res) => {
    appsService.appRestart(req, res);
  });
  app.get('/apps/apppause/:appname?/:global?', (req, res) => {
    appsService.appPause(req, res);
  });
  app.get('/apps/appunpause/:appname?/:global?', (req, res) => {
    appsService.appUnpause(req, res);
  });
  app.get('/apps/apptop/:appname?', (req, res) => {
    appsService.appTop(req, res);
  });
  app.get('/apps/applog/:appname?/:lines?', (req, res) => {
    appsService.appLog(req, res);
  });
  app.get('/apps/appinspect/:appname?', (req, res) => {
    appsService.appInspect(req, res);
  });
  app.get('/apps/appstats/:appname?', (req, res) => {
    appsService.appStats(req, res);
  });
  app.get('/apps/appmonitor/:appname?', (req, res) => {
    appsService.appMonitor(req, res);
  });
  app.get('/apps/appmonitorstream/:appname?', (req, res) => {
    appsService.appMonitorStream(req, res);
  });
  app.get('/apps/appchanges/:appname?', (req, res) => {
    appsService.appChanges(req, res);
  });
  app.post('/apps/appexec', (req, res) => {
    appsService.appExec(req, res);
  });
  app.get('/apps/appremove/:appname?/:force?/:global?', (req, res) => {
    appsService.removeAppLocallyApi(req, res);
  });
  app.get('/apps/installtemporarylocalapp/:appname?', (req, res) => {
    appsService.installTemporaryLocalApplication(req, res);
  });
  app.get('/apps/createfluxnetwork', (req, res) => {
    appsService.createFluxNetworkAPI(req, res);
  });
  app.get('/apps/rescanglobalappsinformation/:blockheight?/:removelastinformation?', (req, res) => {
    appsService.rescanGlobalAppsInformationAPI(req, res);
  });
  app.get('/apps/reindexglobalappsinformation', (req, res) => {
    appsService.reindexGlobalAppsInformationAPI(req, res);
  });
  app.get('/apps/reindexglobalappslocation', (req, res) => {
    appsService.reindexGlobalAppsLocationAPI(req, res);
  });
  app.get('/apps/redeploy/:appname?/:force?/:global?', (req, res) => {
    appsService.redeployAPI(req, res);
  });
  app.get('/apps/reconstructhashes', (req, res) => {
    appsService.reconstructAppMessagesHashCollectionAPI(req, res);
  });
  app.get('/apps/startmonitoring/:appname?', (req, res) => {
    appsService.startAppMonitoringAPI(req, res);
  });
  app.get('/apps/stopmonitoring/:appname?/:deletedata?', (req, res) => {
    appsService.stopAppMonitoringAPI(req, res);
  });

  // POST PUBLIC methods route
  app.post('/id/verifylogin', (req, res) => {
    idService.verifyLogin(req, res);
  });
  app.post('/id/providesign', (req, res) => {
    idService.provideSign(req, res);
  });
  app.post('/id/checkprivilege', (req, res) => {
    idService.checkLoggedUser(req, res);
  });
  app.post('/zelid/verifylogin', (req, res) => {
    idService.verifyLogin(req, res);
  });
  app.post('/zelid/providesign', (req, res) => {
    idService.provideSign(req, res);
  });
  app.post('/zelid/checkprivilege', (req, res) => {
    idService.checkLoggedUser(req, res);
  });

  app.post('/daemon/createrawtransaction', (req, res) => {
    daemonServiceTransactionRpcs.createRawTransactionPost(req, res);
  });
  app.post('/daemon/decoderawtransaction', (req, res) => {
    daemonServiceTransactionRpcs.decodeRawTransactionPost(req, res);
  });
  app.post('/daemon/decodescript', (req, res) => {
    daemonServiceTransactionRpcs.decodeScriptPost(req, res);
  });
  app.post('/daemon/fundrawtransaction', (req, res) => {
    daemonServiceTransactionRpcs.fundRawTransactionPost(req, res);
  });
  app.post('/daemon/sendrawtransaction', (req, res) => {
    daemonServiceTransactionRpcs.sendRawTransactionPost(req, res);
  });
  app.post('/daemon/createmultisig', (req, res) => {
    daemonServiceUtilityRpcs.createMultiSigPost(req, res);
  });
  app.post('/daemon/verifymessage', (req, res) => {
    daemonServiceUtilityRpcs.verifyMessagePost(req, res);
  });
  app.post('/daemon/getblockhashes', (req, res) => {
    daemonServiceBlockchainRpcs.getBlockHashesPost(req, res);
  });
  app.post('/daemon/getspentinfo', (req, res) => {
    daemonServiceBlockchainRpcs.getSpentInfoPost(req, res);
  });
  app.post('/daemon/getaddresstxids', (req, res) => {
    daemonServiceAddressRpcs.getAddressTxids(req, res);
  });
  app.post('/daemon/getaddressbalance', (req, res) => {
    daemonServiceAddressRpcs.getAddressBalance(req, res);
  });
  app.post('/daemon/getaddressdeltas', (req, res) => {
    daemonServiceAddressRpcs.getAddressDeltas(req, res);
  });
  app.post('/daemon/getaddressutxos', (req, res) => {
    daemonServiceAddressRpcs.getAddressUtxos(req, res);
  });
  app.post('/daemon/getaddressmempool', (req, res) => {
    daemonServiceAddressRpcs.getAddressMempool(req, res);
  });

  // POST PROTECTED API - USER LEVEL
  app.post('/id/logoutspecificsession', (req, res) => { // requires the knowledge of a session loginPhrase so users level is sufficient and user cannot logout another user as he does not know the loginPhrase.
    idService.logoutSpecificSession(req, res);
  });
  app.post('/zelid/logoutspecificsession', (req, res) => { // requires the knowledge of a session loginPhrase so users level is sufficient and user cannot logout another user as he does not know the loginPhrase.
    idService.logoutSpecificSession(req, res);
  });

  app.post('/daemon/submitblock', (req, res) => {
    daemonServiceMiningRpcs.submitBlockPost(req, res);
  });

  app.post('/apps/checkdockerexistance', (req, res) => {
    appsService.checkDockerAccessibility(req, res);
  });
  app.post('/apps/appregister', (req, res) => {
    appsService.registerAppGlobalyApi(req, res);
  });
  app.post('/apps/appupdate', (req, res) => {
    appsService.updateAppGlobalyApi(req, res);
  });

  // POST PROTECTED API - ZelNode owner level
  app.post('/daemon/signrawtransaction', (req, res) => {
    daemonServiceTransactionRpcs.signRawTransactionPost(req, res);
  });
  app.post('/daemon/addmultisigaddress', (req, res) => {
    daemonServiceWalletRpcs.addMultiSigAddressPost(req, res);
  });
  app.post('/daemon/sendfrom', (req, res) => {
    daemonServiceWalletRpcs.sendFromPost(req, res);
  });
  app.post('/daemon/sendmany', (req, res) => {
    daemonServiceWalletRpcs.sendManyPost(req, res);
  });
  app.post('/daemon/sendtoaddress', (req, res) => {
    daemonServiceWalletRpcs.sendToAddressPost(req, res);
  });
  app.post('/daemon/signmessage', (req, res) => {
    daemonServiceWalletRpcs.signMessagePost(req, res);
  });
  app.post('/daemon/zsendmany', (req, res) => {
    daemonServiceZcashRpcs.zSendManyPost(req, res);
  });
  app.post('/daemon/zcrawjoinsplit', (req, res) => {
    daemonServiceZcashRpcs.zcRawJoinSplitPost(req, res);
  });
  app.post('/daemon/zcrawreceive', (req, res) => {
    daemonServiceZcashRpcs.zcRawReceivePost(req, res);
  });

  app.post('/benchmark/signzelnodetransaction', (req, res) => {
    benchmarkService.signFluxTransactionPost(req, res);
  });

  // POST PROTECTED API - FluxTeam
  app.post('/flux/broadcastmessage', (req, res) => {
    fluxCommunicationMessagesSender.broadcastMessageFromUserPost(req, res);
  });
  app.post('/flux/broadcastmessagetooutgoing', (req, res) => {
    fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUserPost(req, res);
  });
  app.post('/flux/broadcastmessagetoincoming', (req, res) => {
    fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUserPost(req, res);
  });

  app.post('/syncthing/system/error', (req, res) => {
    syncthingService.postSystemError(req, res);
  });
  app.get('/syncthing/system/upgrade', (req, res) => {
    syncthingService.postSystemUpgrade(req, res);
  });
  app.post('/syncthing/config', (req, res) => {
    syncthingService.postConfig(req, res);
  });
  app.post('/syncthing/config/folders', (req, res) => {
    syncthingService.postConfigFolders(req, res);
  });
  app.post('/syncthing/config/devices', (req, res) => {
    syncthingService.postConfigDevices(req, res);
  });
  app.post('/syncthing/config/defaults/folder', (req, res) => {
    syncthingService.postConfigDefaultsFolder(req, res);
  });
  app.post('/syncthing/config/defaults/device', (req, res) => {
    syncthingService.postConfigDefaultsDevice(req, res);
  });
  app.post('/syncthing/config/defaults/ignores', (req, res) => {
    syncthingService.postConfigDefaultsIgnores(req, res);
  });
  app.post('/syncthing/config/options', (req, res) => {
    syncthingService.postConfigOptions(req, res);
  });
  app.post('/syncthing/config/gui', (req, res) => {
    syncthingService.postConfigGui(req, res);
  });
  app.post('/syncthing/config/ldap', (req, res) => {
    syncthingService.postConfigLdap(req, res);
  });
  app.post('/syncthing/cluster/pending/devices', (req, res) => {
    syncthingService.postClusterPendigDevices(req, res);
  });
  app.post('/syncthing/cluster/pending/folders', (req, res) => {
    syncthingService.postClusterPendigFolders(req, res);
  });
  app.post('/syncthing/folder/versions', (req, res) => {
    syncthingService.postFolderVersions(req, res);
  });
  app.post('/syncthing/db/ignores', (req, res) => {
    syncthingService.postDbIgnores(req, res);
  });
  app.post('/syncthing/db/override', (req, res) => {
    syncthingService.postDbOverride(req, res);
  });
  app.post('/syncthing/db/prio', (req, res) => {
    syncthingService.postDbPrio(req, res);
  });
  app.post('/syncthing/db/revert', (req, res) => {
    syncthingService.postDbRevert(req, res);
  });
  app.post('/syncthing/db/scan', (req, res) => {
    syncthingService.postDbScan(req, res);
  });

  // WebSockets PUBLIC
  app.ws('/ws/id/:loginphrase', (ws, req) => {
    idService.wsRespondLoginPhrase(ws, req);
  });
  app.ws('/ws/zelid/:loginphrase', (ws, req) => {
    idService.wsRespondLoginPhrase(ws, req);
  });
  app.ws('/ws/sign/:message', (ws, req) => {
    idService.wsRespondSignature(ws, req);
  });

  // communication between multiple flux solution is on this:
  app.ws('/ws/flux', (ws, req) => {
    fluxCommunication.handleIncomingConnection(ws, req, expressWs.getWss('/ws/flux'));
  });

  // FluxShare
  app.get('/apps/fluxshare/getfile/:file?/:token?', (req, res) => {
    fluxshareService.fluxShareDownloadFile(req, res);
  });
  app.get('/apps/fluxshare/getfolder/:folder?', (req, res) => {
    fluxshareService.fluxShareGetFolder(req, res);
  });
  app.get('/apps/fluxshare/createfolder/:folder?', (req, res) => {
    fluxshareService.fluxShareCreateFolder(req, res);
  });
  app.post('/apps/fluxshare/uploadfile/:folder?', (req, res) => {
    fluxshareService.fluxShareUpload(req, res);
  });
  app.get('/apps/fluxshare/removefile/:file?', (req, res) => {
    fluxshareService.fluxShareRemoveFile(req, res);
  });
  app.get('/apps/fluxshare/removefolder/:folder?', (req, res) => {
    fluxshareService.fluxShareRemoveFolder(req, res);
  });
  app.get('/apps/fluxshare/fileexists/:file?', (req, res) => {
    fluxshareService.fluxShareFileExists(req, res);
  });
  app.get('/apps/fluxshare/stats', (req, res) => {
    fluxshareService.fluxShareStorageStats(req, res);
  });
  app.get('/apps/fluxshare/sharefile/:file?', (req, res) => {
    fluxshareService.fluxShareShareFile(req, res);
  });
  app.get('/apps/fluxshare/unsharefile/:file?', (req, res) => {
    fluxshareService.fluxShareUnshareFile(req, res);
  });
  app.get('/apps/fluxshare/sharedfiles', (req, res) => {
    fluxshareService.fluxShareGetSharedFiles(req, res);
  });
  app.get('/apps/fluxshare/rename/:oldpath?/:newname?', (req, res) => {
    fluxshareService.fluxShareRename(req, res);
  });
  app.get('/apps/fluxshare/downloadfolder/:folder?', (req, res) => {
    fluxshareService.fluxShareDownloadFolder(req, res);
  });
};
