const daemonServiceAddressRpcs = require('./services/daemonService/daemonServiceAddressRpcs');
const daemonServiceTransactionRpcs = require('./services/daemonService/daemonServiceTransactionRpcs');
const daemonServiceBlockchainRpcs = require('./services/daemonService/daemonServiceBlockchainRpcs');
const daemonServiceBenchmarkRpcs = require('./services/daemonService/daemonServiceBenchmarkRpcs');
const daemonServiceMiningRpcs = require('./services/daemonService/daemonServiceMiningRpcs');
const daemonServiceNetworkRpcs = require('./services/daemonService/daemonServiceNetworkRpcs');
const daemonServiceNodeRpcs = require('./services/daemonService/daemonServiceFluxnodeRpcs');
const daemonServiceWalletRpcs = require('./services/daemonService/daemonServiceWalletRpcs');
const daemonServiceUtilityRpcs = require('./services/daemonService/daemonServiceUtilityRpcs');
const daemonServiceZcashRpcs = require('./services/daemonService/daemonServiceZcashRpcs');
const daemonServiceControlRpcs = require('./services/daemonService/daemonServiceControlRpcs');
const benchmarkService = require('./services/benchmarkService');
const idService = require('./services/idService');
const paymentService = require('./services/paymentService');
const fluxService = require('./services/fluxService');
const fluxCommunication = require('./services/fluxCommunication');
const fluxCommunicationMessagesSender = require('./services/fluxCommunicationMessagesSender');
const {
  asyncRoute, cache, rejectQueryParameters, requireBootSettled,
} = require('./services/utils/routeGuards');
const { alwaysRespond, isLocal, requireHttps } = require('./middlewares');

// App modular services
const appQueryService = require('./services/appQuery/appQueryService');
const resourceQueryService = require('./services/appQuery/resourceQueryService');
const deploymentInfoService = require('./services/appQuery/deploymentInfoService');
const fileQueryService = require('./services/appQuery/fileQueryService');
const fileSystemManager = require('./services/appSystem/fileSystemManager');
const volumeExecutor = require('./services/appSystem/volumeExecutor');
const operationsController = require('./services/appManagement/operationsController');
const cryptographicKeys = require('./services/appMessaging/cryptographicKeys');
const registryManager = require('./services/appDatabase/registryManager');
const appValidator = require('./services/appRequirements/appValidator');
const placementFeasibility = require('./services/appPlacement/placementFeasibility');
const appSpecHelpers = require('./services/utils/appSpecHelpers');
const appInspector = require('./services/appManagement/appInspector');
const appController = require('./services/appManagement/appController');
const appInstaller = require('./services/appLifecycle/appInstaller');
const appUninstaller = require('./services/appLifecycle/appUninstaller');
const advancedWorkflows = require('./services/appLifecycle/advancedWorkflows');
const imageManager = require('./services/appSecurity/imageManager');
const messageVerifier = require('./services/appMessaging/messageVerifier');
const appHashSyncService = require('./services/appMessaging/appHashSyncService');
const monitoringOrchestrator = require('./services/appMonitoring/monitoringOrchestrator');
const systemIntegration = require('./services/appSystem/systemIntegration');

const explorerService = require('./services/explorerService');
const fluxshareService = require('./services/fluxshareService');
const generalService = require('./services/generalService');
const upnpService = require('./services/upnpService');
const syncthingService = require('./services/syncthingService');
const fluxNetworkHelper = require('./services/fluxNetworkHelper');
const portManager = require('./services/appNetwork/portManager');
const enterpriseNodesService = require('./services/enterpriseNodesService');
const backupRestoreService = require('./services/backupRestoreService');
const arcaneAuthService = require('./services/arcaneAuthService');
const appTamperingDetectionService = require('./services/appTamperingDetectionService');
const fluxEventBus = require('./services/utils/fluxEventBus');

module.exports = (app) => {
  // GET PUBLIC methods
  app.get('/daemon/help/:command?', cache('1 hour'), asyncRoute((req, res) => { // accept both help/command and ?command=getinfo. If ommited, default help will be displayed. Other calls works in similar way
    return daemonServiceControlRpcs.help(req, res);
  }));
  app.get('/daemon/getinfo', asyncRoute((req, res) => {
    return daemonServiceControlRpcs.getInfo(req, res);
  }));
  app.get('/daemon/getfluxnodestatus', cache('60 seconds'), asyncRoute((req, res) => {
    return daemonServiceNodeRpcs.getFluxNodeStatusApi(req, res);
  }));
  app.get('/daemon/getzelnodestatus', cache('60 seconds'), asyncRoute((req, res) => { // DEPRECATED
    return daemonServiceNodeRpcs.getFluxNodeStatusApi(req, res);
  }));
  app.get('/daemon/listfluxnodes/:filter?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceNodeRpcs.listFluxNodes(req, res);
  }));
  app.get('/daemon/listzelnodes/:filter?', cache('30 seconds'), asyncRoute((req, res) => { // DEPRECATED
    return daemonServiceNodeRpcs.listFluxNodes(req, res);
  }));
  app.get('/daemon/viewdeterministicfluxnodelist/:filter?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceNodeRpcs.listFluxNodes(req, res);
  }));
  app.get('/daemon/viewdeterministiczelnodelist/:filter?', cache('30 seconds'), asyncRoute((req, res) => { // DEPRECATED
    return daemonServiceNodeRpcs.listFluxNodes(req, res);
  }));
  app.get('/daemon/getfluxnodecount', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceNodeRpcs.getFluxNodeCount(req, res);
  }));
  app.get('/daemon/getzelnodecount', cache('30 seconds'), asyncRoute((req, res) => { // DEPRECATED
    return daemonServiceNodeRpcs.getFluxNodeCount(req, res);
  }));
  app.get('/daemon/getdoslist', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceNodeRpcs.getDOSList(req, res);
  }));
  app.get('/daemon/getstartlist', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceNodeRpcs.getStartList(req, res);
  }));
  app.get('/daemon/fluxnodecurrentwinner', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceNodeRpcs.fluxNodeCurrentWinner(req, res);
  }));
  app.get('/daemon/getbestblockhash', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getBestBlockHash(req, res);
  }));
  app.get('/daemon/getblock/:hashheight?/:verbosity?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getBlock(req, res);
  }));
  app.get('/daemon/getblockchaininfo', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getBlockchainInfo(req, res);
  }));
  app.get('/daemon/getblockcount', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getBlockCount(req, res);
  }));
  app.get('/daemon/getblockdeltas/:hash?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getBlockDeltas(req, res);
  }));
  app.get('/daemon/getblockhashes/:high?/:low?/:noorphans?/:logicaltimes?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getBlockHashes(req, res);
  }));
  app.get('/daemon/getblockhash/:index?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getBlockHash(req, res);
  }));
  app.get('/daemon/getblockheader/:hash?/:verbose?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getBlockHeader(req, res);
  }));
  app.get('/daemon/getchaintips', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getChainTips(req, res);
  }));
  app.get('/daemon/getdifficulty', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getDifficulty(req, res);
  }));
  app.get('/daemon/getmempoolinfo', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getMempoolInfo(req, res);
  }));
  app.get('/daemon/getrawmempool/:verbose?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getRawMemPool(req, res);
  }));
  app.get('/daemon/gettxout/:txid?/:n?/:includemempool?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getTxOut(req, res);
  }));
  app.get('/daemon/gettxoutproof/:txids?/:blockhash?', cache('30 seconds'), asyncRoute((req, res) => { // comma separated list of txids. For example: /gettxoutproof/abc,efg,asd/blockhash
    return daemonServiceBlockchainRpcs.getTxOutProof(req, res);
  }));
  app.get('/daemon/gettxoutsetinfo', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getTxOutSetInfo(req, res);
  }));
  app.get('/daemon/verifytxoutproof/:proof?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.verifyTxOutProof(req, res);
  }));
  app.get('/daemon/getspentinfo/:txid?/:index?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getSpentInfo(req, res);
  }));
  app.get('/daemon/getblocksubsidy/:height?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceMiningRpcs.getBlockSubsidy(req, res);
  }));
  app.get('/daemon/getblocktemplate/:jsonrequestobject?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceMiningRpcs.getBlockTemplate(req, res);
  }));
  app.get('/daemon/getlocalsolps', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceMiningRpcs.getLocalSolPs(req, res);
  }));
  app.get('/daemon/getmininginfo', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceMiningRpcs.getMiningInfo(req, res);
  }));
  app.get('/daemon/getnetworkhashps/:blocks?/:height?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceMiningRpcs.getNetworkHashPs(req, res);
  }));
  app.get('/daemon/getnetworksolps/:blocks?/:height?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceMiningRpcs.getNetworkSolPs(req, res);
  }));
  app.get('/daemon/getconnectioncount', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceNetworkRpcs.getConnectionCount(req, res);
  }));
  app.get('/daemon/getdeprecationinfo', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceNetworkRpcs.getDeprecationInfo(req, res);
  }));
  app.get('/daemon/getnettotals', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceNetworkRpcs.getNetTotals(req, res);
  }));
  app.get('/daemon/getnetworkinfo', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceNetworkRpcs.getNetworkInfo(req, res);
  }));
  app.get('/daemon/getpeerinfo', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceNetworkRpcs.getPeerInfo(req, res);
  }));
  app.get('/daemon/listbanned', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceNetworkRpcs.listBanned(req, res);
  }));
  app.get('/daemon/createrawtransaction/:transactions?/:addresses?/:locktime?/:expiryheight?', asyncRoute((req, res) => {
    return daemonServiceTransactionRpcs.createRawTransaction(req, res);
  }));
  app.get('/daemon/decoderawtransaction/:hexstring?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceTransactionRpcs.decodeRawTransaction(req, res);
  }));
  app.get('/daemon/decodescript/:hex?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceTransactionRpcs.decodeScript(req, res);
  }));
  app.get('/daemon/fundrawtransaction/:hexstring?', asyncRoute((req, res) => {
    return daemonServiceTransactionRpcs.fundRawTransaction(req, res);
  }));
  app.get('/daemon/getrawtransaction/:txid?/:verbose?', asyncRoute((req, res) => {
    return daemonServiceTransactionRpcs.getRawTransaction(req, res);
  }));
  app.get('/daemon/sendrawtransaction/:hexstring?/:allowhighfees?', asyncRoute((req, res) => {
    return daemonServiceTransactionRpcs.sendRawTransaction(req, res);
  }));
  app.get('/daemon/createmultisig/:n?/:keys?', asyncRoute((req, res) => {
    return daemonServiceUtilityRpcs.createMultiSig(req, res);
  }));
  app.get('/daemon/estimatefee/:nblocks?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceUtilityRpcs.estimateFee(req, res);
  }));
  app.get('/daemon/estimatepriority/:nblocks?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceUtilityRpcs.estimatePriority(req, res);
  }));
  app.get('/daemon/validateaddress/:fluxaddress?', asyncRoute((req, res) => {
    return daemonServiceUtilityRpcs.validateAddress(req, res);
  }));
  app.get('/daemon/verifymessage/:fluxaddress?/:signature?/:message?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceUtilityRpcs.verifyMessage(req, res);
  }));
  app.get('/daemon/gettransaction/:txid?/:includewatchonly?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.getTransaction(req, res);
  }));
  app.get('/daemon/zvalidateaddress/:zaddr?', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceUtilityRpcs.zValidateAddress(req, res);
  }));
  app.get('/daemon/getbenchmarks', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBenchmarkRpcs.getBenchmarks(req, res);
  }));
  app.get('/daemon/getbenchstatus', cache('30 seconds'), asyncRoute((req, res) => {
    return daemonServiceBenchmarkRpcs.getBenchStatus(req, res);
  }));

  app.get('/id/loginphrase', asyncRoute((req, res) => {
    return idService.loginPhrase(req, res);
  }));
  app.get('/id/emergencyphrase', asyncRoute((req, res) => {
    return idService.emergencyPhrase(req, res);
  }));
  app.get('/zelid/loginphrase', asyncRoute((req, res) => { // DEPRECATED
    return idService.loginPhrase(req, res);
  }));
  app.get('/zelid/emergencyphrase', asyncRoute((req, res) => { // DEPRECATED
    return idService.emergencyPhrase(req, res);
  }));

  app.get('/flux/nodetier', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxService.getNodeTier(req, res);
  }));
  app.get('/flux/info', cache('60 seconds'), asyncRoute((req, res) => {
    return fluxService.getFluxInfo(req, res);
  }));
  app.get('/flux/timezone', asyncRoute((req, res) => {
    return fluxService.getFluxTimezone(req, res);
  }));
  app.get('/flux/version', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxService.getFluxVersion(req, res);
  }));
  app.get('/flux/nodejsversions', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxService.getNodeJsVersions(req, res);
  }));
  app.get('/flux/ip', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxService.getFluxIP(req, res);
  }));
  app.get('/flux/staticip', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxService.isStaticIPapi(req, res);
  }));
  app.get('/flux/geolocation', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxService.getFluxGeolocation(req, res);
  }));
  app.get('/flux/zelid', cache('30 seconds'), asyncRoute((req, res) => { // DEPERCATED
    return fluxService.getFluxZelID(req, res);
  }));
  app.get('/flux/id', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxService.getFluxZelID(req, res);
  }));
  app.get('/flux/fluxids', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxService.getFluxIds(req, res);
  }));
  app.get('/flux/pgp', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxService.getFluxPGPidentity(req, res);
  }));
  app.get('/flux/kadena', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxService.getFluxKadena(req, res);
  }));
  app.get('/flux/routerip', cache('1 day'), asyncRoute((req, res) => {
    return fluxService.getRouterIP(req, res);
  }));
  app.get('/flux/blockedports', cache('1 day'), asyncRoute((req, res) => {
    return fluxService.getBlockedPorts(req, res);
  }));
  app.get('/flux/apiport', cache('1 day'), asyncRoute((req, res) => {
    return fluxService.getAPIPort(req, res);
  }));
  app.get('/flux/blockedrepositories', cache('1 day'), asyncRoute((req, res) => {
    return fluxService.getBlockedRepositories(req, res);
  }));
  app.get('/flux/enterpriseappowners', cache('1 hour'), asyncRoute((req, res) => {
    return fluxService.getEnterpriseAppOwners(req, res);
  }));
  app.get('/flux/marketplaceurl', cache('1 day'), asyncRoute((req, res) => {
    return fluxService.getMarketplaceURL(req, res);
  }));
  app.get('/flux/restart', asyncRoute((req, res) => {
    return fluxService.restartFluxOS(req, res);
  }));
  app.get('/flux/dosstate', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxNetworkHelper.getDOSState(req, res);
  }));
  app.post('/flux/dosstate', asyncRoute((req, res) => {
    return fluxNetworkHelper.setDOSStateApi(req, res);
  }));
  // New peer endpoints
  app.get('/flux/peers/:filter?', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxCommunication.getPeers(req, res);
  }));
  app.get('/flux/unstablenodes', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxCommunication.getUnstableNodes(req, res);
  }));
  app.get('/flux/peerhistory', asyncRoute((req, res) => {
    return fluxCommunication.getPeerHistory(req, res);
  }));
  app.get('/flux/topology', cache('5 seconds'), asyncRoute((req, res) => {
    return fluxCommunication.getTopology(req, res);
  }));
  app.get('/flux/networkhealth', cache('5 seconds'), asyncRoute((req, res) => {
    return fluxCommunication.getNetworkHealth(req, res);
  }));
  // Deprecated peer endpoints — kept for backward compatibility
  app.get('/flux/connectedpeers', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxCommunication.connectedPeers(req, res);
  }));
  app.get('/flux/connectedpeersinfo', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxCommunication.connectedPeersInfo(req, res);
  }));
  app.get('/flux/incomingconnections', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxNetworkHelper.getIncomingConnections(req, res);
  }));
  app.get('/flux/incomingconnectionsinfo', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxNetworkHelper.getIncomingConnectionsInfo(req, res);
  }));
  app.get('/flux/checkfluxavailability/:ip?/:port?', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxNetworkHelper.checkFluxAvailability(req, res);
  }));
  app.post('/flux/checkappavailability', asyncRoute((req, res) => {
    return fluxNetworkHelper.checkAppAvailability(req, res);
  }));
  app.post('/flux/keepupnpportsopen', asyncRoute((req, res) => {
    return fluxNetworkHelper.keepUPNPPortsOpen(req, res);
  }));
  // Read by another Flux node at this public address, before it installs onto a
  // port. Unauthenticated and reachable by anyone, and EVERY answer is expensive:
  // checkAndDecryptAppSpecs holds no cache of its own, so an uncached request
  // costs two globalAppsMessages queries and a benchd round trip per enterprise
  // app on this node. The cache is the only thing bounding that rate, which is
  // why it is thirty seconds and not the one second its neighbours under /apps
  // take - those list containers, this one decrypts.
  //
  // Thirty seconds of staleness costs nothing here. A sibling's ports change
  // only when it installs or removes an app, and this answer never decides: it
  // narrows the field before the firewall is opened, and the port test that
  // follows is what refuses. The cache keys on the request URL, so the bound
  // holds only while the URL is the endpoint and nothing else - hence the guard.
  app.get('/flux/portsinuse', rejectQueryParameters, cache('30 seconds'), asyncRoute((req, res) => {
    return portManager.portsInUseApi(req, res);
  }));

  // ArcaneOS Authentication Endpoints (HTTPS only)
  app.get('/arcane/authchallenge', requireHttps, asyncRoute(arcaneAuthService.authChallengeHandler));

  // Apps routes - now directly calling modular services
  //
  // Several names below say "apps" and mean something else. listrunningapps and
  // listallapps return CONTAINERS, listappsimages returns IMAGES, and each repeats
  // "apps" inside a path that is already under /apps. The names are wrong and are
  // left wrong deliberately: renaming a v1 route is a 404 for every caller, which is
  // a different and louder break than changing what a response contains, and v2 gets
  // the correct names for free in a new URL space. Do not rename them here.
  //
  // Both container listings are public and answer every caller identically, with
  // {Names, State, Status} built from docker's own fields - which is what lets
  // them keep a cache that answers before any handler runs.
  //
  // Not a filter of listallapps, whatever the name says. This answers "which containers
  // should FDM route to", which is the running ones PLUS any stopped container whose app
  // is mid-backup or mid-restore - a fact that lives in this process's memory and is not
  // on the container, so no caller can derive this list from the one below. FDM's
  // checkAppRunning reads it for every app and matches on Names[0] alone, so dropping a
  // container from here takes that app out of routing.
  app.get('/apps/listrunningapps', cache('15 seconds'), asyncRoute((req, res) => {
    return appQueryService.listRunningAppsApi(req, res);
  }));
  // Read by peers mid-election. Both are unauthenticated, and the API has no rate
  // limiting, so neither may do unbounded backend work per request.
  //
  // heldcomponents still lists docker containers: a component's commitment is
  // in-memory and a FluxOS restart drops it while the container keeps running, so
  // docker is the only thing that answers for a primary that outlived the process
  // holding its intent. Cached at one second - long enough to bound an anonymous
  // caller to one docker call a second, short enough to be meaningless against the
  // tens of seconds this exists to cover. The cache keys on the request URL, so
  // that bound holds only while the URL is the endpoint and nothing else: without
  // the guard a caller varies a parameter and every request is a fresh miss.
  app.get('/apps/heldcomponents', rejectQueryParameters, cache('1 second'), asyncRoute((req, res) => {
    return appQueryService.heldComponents(req, res);
  }));
  // promotedfolders needs no cache: it is served from the set the syncthing monitor
  // already refreshes each pass, so the request touches nothing. Guarded on the
  // same terms as its neighbour - it takes no parameters either, and the two are
  // read by the same callers on the same path.
  app.get('/apps/promotedfolders', rejectQueryParameters, asyncRoute((req, res) => {
    return appQueryService.promotedFolders(req, res);
  }));
  app.get('/apps/listallapps', cache('30 seconds'), asyncRoute((req, res) => {
    return appQueryService.listAllAppsApi(req, res);
  }));
  // Answers the flux team, so it takes no cache: apicache keys an entry on the
  // request URL alone and serves it before the handler runs, which would hand
  // one authorised answer to every caller after it.
  app.get('/apps/listappsimages', asyncRoute((req, res) => {
    return appInspector.listAppsImagesApi(req, res);
  }));
  app.get('/apps/installedapps/:appname?', cache('30 seconds'), asyncRoute((req, res) => {
    return appQueryService.installedApps(req, res);
  }));
  app.get('/apps/availableapps', cache('30 seconds'), asyncRoute((req, res) => {
    return registryManager.availableApps(req, res);
  }));
  app.get('/apps/fluxusage', cache('30 seconds'), asyncRoute((req, res) => {
    return resourceQueryService.fluxUsage(req, res);
  }));
  app.get('/apps/appsresources', cache('30 seconds'), asyncRoute((req, res) => {
    return resourceQueryService.appsResourcesApi(req, res);
  }));
  app.get('/apps/registrationinformation', cache('30 seconds'), asyncRoute((req, res) => {
    return registryManager.registrationInformation(req, res);
  }));
  app.get('/apps/temporarymessages/:hash?', cache('5 seconds'), asyncRoute((req, res) => {
    return messageVerifier.getAppsTemporaryMessages(req, res);
  }));
  app.get('/apps/permanentmessages/:hash?/:owner?/:appname?', cache('2 minutes'), asyncRoute((req, res) => {
    return messageVerifier.getAppsPermanentMessages(req, res);
  }));
  app.get('/apps/globalappsspecifications/:hash?/:owner?/:appname?', cache('30 seconds'), asyncRoute((req, res) => {
    return registryManager.getGlobalAppsSpecifications(req, res);
  }));
  app.get('/apps/latestspecificationversion', cache('5 minutes'), asyncRoute((req, res) => {
    return appQueryService.getlatestApplicationSpecificationAPI(req, res);
  }));
  // Not cached. apicache keys an entry on the URL alone and answers from it
  // before the handler runs, so a privilege-checked route behind one hands the
  // first caller's response to the next without checking them at all. This
  // route's response is also built for one caller in particular - the payload is
  // encrypted to a session key they supply in a header - so there is nothing in
  // it another caller could use even if it were shared.
  app.get('/apps/updatetolatestspecs/:appname', asyncRoute((req, res) => {
    return registryManager.updateApplicationSpecificationAPI(req, res);
  }));
  app.get('/apps/appspecifications/:appname/:decrypt?', asyncRoute((req, res) => {
    return registryManager.getApplicationSpecificationAPI(req, res);
  }));
  // Component names and their election mode, for the flux team. Not cached: the
  // answer depends on who is asking, and a shared cache in front of a
  // privilege-checked route serves one caller's answer to the next.
  app.get('/apps/appcomponentnames/:appname?', asyncRoute((req, res) => {
    return registryManager.getApplicationComponentNamesAPI(req, res);
  }));
  app.get('/apps/appowner/:appname?', cache('30 seconds'), asyncRoute((req, res) => {
    return registryManager.getApplicationOwnerAPI(req, res);
  }));
  app.get('/apps/apporiginalowner/:appname?', cache('30 seconds'), asyncRoute((req, res) => {
    return appQueryService.getApplicationOriginalOwner(req, res);
  }));
  app.get('/apps/messagescount/:appowner?', cache('30 seconds'), asyncRoute((req, res) => {
    return appQueryService.getAppsMessagesCount(req, res);
  }));
  app.get('/apps/hashes', cache('30 seconds'), asyncRoute((req, res) => {
    return registryManager.getAppHashes(req, res);
  }));
  app.get('/apps/location/:appname?', cache('30 seconds'), asyncRoute((req, res) => {
    return registryManager.getAppsLocation(req, res);
  }));
  app.get('/apps/locations', cache('30 seconds'), asyncRoute((req, res) => {
    return registryManager.getAppsLocations(req, res);
  }));
  app.get('/apps/installinglocation/:appname?', cache('30 seconds'), asyncRoute((req, res) => {
    return registryManager.getAppInstallingLocation(req, res);
  }));
  app.get('/apps/installinglocations', cache('30 seconds'), asyncRoute((req, res) => {
    return appQueryService.getAppsInstallingLocations(req, res);
  }));
  app.get('/apps/installingerrorslocation/:appname?', cache('30 seconds'), asyncRoute((req, res) => {
    return registryManager.getAppInstallingErrorsLocation(req, res);
  }));
  app.get('/apps/installingerrorslocations', cache('30 seconds'), asyncRoute((req, res) => {
    return registryManager.getAppsInstallingErrorsLocations(req, res);
  }));
  app.post('/apps/calculateprice', asyncRoute((req, res) => { // returns price in flux for both new registration of app and update of app
    return appSpecHelpers.getAppPrice(req, res);
  }));
  app.post('/apps/calculatefiatandfluxprice', asyncRoute((req, res) => { // returns price in usd and flux for both new registration of app and update of app
    return appSpecHelpers.getAppFiatAndFluxPrice(req, res);
  }));
  app.get('/apps/whitelistedrepositories', cache('30 seconds'), asyncRoute((req, res) => { // deprecated: whitelist retired, always returns []
    return generalService.whitelistedRepositories(req, res);
  }));
  app.post('/apps/verifyappregistrationspecifications', asyncRoute((req, res) => { // returns formatted app specifications
    return appValidator.verifyAppRegistrationParameters(req, res);
  }));
  app.post('/apps/verifyappupdatespecifications', asyncRoute((req, res) => { // returns formatted app specifications
    return appValidator.verifyAppUpdateApi(req, res);
  }));
  app.post('/apps/placementfeasibility', asyncRoute((req, res) => { // fault domains and per-domain instance share for a prospective spec
    return placementFeasibility.placementFeasibilityAPI(req, res);
  }));
  app.get('/apps/placementlocations', rejectQueryParameters, cache('30 seconds'), asyncRoute((req, res) => { // node, fault-domain and tier counts per continent/country
    return placementFeasibility.placementLocationsAPI(req, res);
  }));
  app.get('/apps/deploymentinformation', cache('30 seconds'), asyncRoute((req, res) => {
    return deploymentInfoService.deploymentInformation(req, res);
  }));
  app.get('/apps/enterprisenodes', cache('30 seconds'), asyncRoute((req, res) => {
    return enterpriseNodesService.getEnterpriseNodesAPI(req, res);
  }));
  app.get('/apps/getappspecsusdprice', cache('30 minutes'), asyncRoute((req, res) => {
    return deploymentInfoService.getAppSpecsUSDPrice(req, res);
  }));
  app.get('/apps/tamperingevents/:appname?', cache('30 seconds'), asyncRoute((req, res) => {
    return appTamperingDetectionService.getEvents(req, res);
  }));

  // app.get('/explorer/allutxos', (req, res) => {
  //   explorerService.getAllUtxos(req, res);
  // });
  // app.get('/explorer/alladdresseswithtransactions', (req, res) => {
  //   explorerService.getAllAddressesWithTransactions(req, res);
  // });
  // app.get('/explorer/alladdresses', (req, res) => {
  //   explorerService.getAllAddresses(req, res);
  // });

  app.get('/explorer/utxo/:address?', cache('30 seconds'), asyncRoute((req, res) => {
    return explorerService.getAddressUtxos(req, res);
  }));
  app.get('/explorer/transactions/:address?', cache('30 seconds'), asyncRoute((req, res) => {
    return explorerService.getAddressTransactions(req, res);
  }));
  app.get('/explorer/balance/:address?', cache('30 seconds'), asyncRoute((req, res) => {
    return explorerService.getAddressBalance(req, res);
  }));
  app.get('/explorer/scannedheight', cache('30 seconds'), asyncRoute((req, res) => {
    return explorerService.getScannedHeight(req, res);
  }));
  // app.get('/explorer/fusion/coinbase/all', cache('30 seconds'), (req, res) => {
  //   explorerService.getAllFusionCoinbase(req, res);
  // });
  app.get('/explorer/fusion/coinbase/:address?', cache('30 seconds'), asyncRoute((req, res) => { // deprecated
    return explorerService.getAddressFusionCoinbase(req, res);
  }));

  // GET PROTECTED API - User level
  app.get('/daemon/prioritisetransaction/:txid?/:prioritydelta?/:feedelta?', asyncRoute((req, res) => {
    return daemonServiceMiningRpcs.prioritiseTransaction(req, res);
  }));
  app.get('/daemon/submitblock/:hexdata?/:jsonparametersobject?', asyncRoute((req, res) => {
    return daemonServiceMiningRpcs.submitBlock(req, res);
  }));

  app.get('/id/loggedsessions', asyncRoute((req, res) => {
    return idService.loggedSessions(req, res);
  }));
  app.get('/id/logoutcurrentsession', asyncRoute((req, res) => {
    return idService.logoutCurrentSession(req, res);
  }));
  app.get('/id/logoutallsessions', asyncRoute((req, res) => {
    return idService.logoutAllSessions(req, res);
  }));
  app.get('/zelid/loggedsessions', asyncRoute((req, res) => { // DEPRECATED
    return idService.loggedSessions(req, res);
  }));
  app.get('/zelid/logoutcurrentsession', asyncRoute((req, res) => { // DEPRECATED
    return idService.logoutCurrentSession(req, res);
  }));
  app.get('/zelid/logoutallsessions', asyncRoute((req, res) => { // DEPRECATED
    return idService.logoutAllSessions(req, res);
  }));

  app.get('/benchmark/getstatus', cache('30 seconds'), asyncRoute((req, res) => {
    return benchmarkService.getStatus(req, res);
  }));
  app.get('/benchmark/help/:command?', cache('1 hour'), asyncRoute((req, res) => {
    return benchmarkService.help(req, res);
  }));
  app.get('/benchmark/getbenchmarks', cache('30 seconds'), asyncRoute((req, res) => {
    return benchmarkService.getBenchmarks(req, res);
  }));
  app.get('/benchmark/getstoredbenchmark', cache('1 hour'), asyncRoute((req, res) => {
    return benchmarkService.getStoredBenchmark(req, res);
  }));
  app.get('/benchmark/getinfo', cache('30 seconds'), asyncRoute((req, res) => {
    return benchmarkService.getInfo(req, res);
  }));

  app.get('/syncthing/meta', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getMetaApi(req, res);
  }));
  app.get('/syncthing/deviceid', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getDeviceIdApi(req, res);
  }));
  app.get('/syncthing/health', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getHealthApi(req, res);
  }));
  app.get('/syncthing/system/browse/:current?', asyncRoute((req, res) => {
    return syncthingService.systemBrowse(req, res);
  }));
  app.get('/syncthing/system/connections', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.systemConnections(req, res);
  }));
  app.get('/syncthing/system/debug/:enable?/:disable?', asyncRoute((req, res) => {
    return syncthingService.systemDebug(req, res);
  }));
  app.get('/syncthing/system/discovery/:device?/:addr?', asyncRoute((req, res) => {
    return syncthingService.systemDiscovery(req, res);
  }));
  app.get('/syncthing/system/error/clear', asyncRoute((req, res) => {
    return syncthingService.systemErrorClear(req, res);
  }));
  app.get('/syncthing/system/error/:message?', asyncRoute((req, res) => {
    return syncthingService.systemError(req, res);
  }));
  app.get('/syncthing/system/log/:since?', asyncRoute((req, res) => {
    return syncthingService.systemLog(req, res);
  }));
  app.get('/syncthing/system/logtxt/:since?', asyncRoute((req, res) => {
    return syncthingService.systemLogTxt(req, res);
  }));
  app.get('/syncthing/system/paths', asyncRoute((req, res) => {
    return syncthingService.systemPaths(req, res);
  }));
  app.get('/syncthing/system/pause/:device?', asyncRoute((req, res) => {
    return syncthingService.systemPauseApi(req, res);
  }));
  app.get('/syncthing/system/ping', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.systemPingApi(req, res);
  }));
  app.get('/syncthing/system/reset/:folder?', asyncRoute((req, res) => {
    return syncthingService.systemReset(req, res);
  }));
  app.get('/syncthing/system/restart', asyncRoute((req, res) => {
    return syncthingService.systemRestartApi(req, res);
  }));
  app.get('/syncthing/system/resume/:device?', asyncRoute((req, res) => {
    return syncthingService.systemResumeApi(req, res);
  }));
  app.get('/syncthing/system/shutdown', asyncRoute((req, res) => {
    return syncthingService.systemShutdown(req, res);
  }));
  app.get('/syncthing/system/status', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.systemStatus(req, res);
  }));
  app.get('/syncthing/system/upgrade', asyncRoute((req, res) => {
    return syncthingService.systemUpgrade(req, res);
  }));
  app.get('/syncthing/system/version', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.systemVersionApi(req, res);
  }));
  app.get('/syncthing/config', asyncRoute((req, res) => {
    return syncthingService.getConfigApi(req, res);
  }));
  app.get('/syncthing/config/restart-required', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getConfigRestartRequired(req, res);
  }));
  app.get('/syncthing/config/folders/:id?', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getConfigFoldersApi(req, res);
  }));
  app.get('/syncthing/config/devices/:id?', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getConfigDevicesApi(req, res);
  }));
  app.get('/syncthing/config/defaults/folder', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getConfigDefaultsFolderApi(req, res);
  }));
  app.get('/syncthing/config/defaults/device', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getConfigDefaultsDevice(req, res);
  }));
  app.get('/syncthing/config/defaults/ignores', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getConfigDefaultsIgnores(req, res);
  }));
  app.get('/syncthing/config/options', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getConfigOptionsApi(req, res);
  }));
  app.get('/syncthing/config/ldap', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getConfigLdap(req, res);
  }));
  app.get('/syncthing/config/gui', asyncRoute((req, res) => {
    return syncthingService.getConfigGuiApi(req, res);
  }));
  app.get('/syncthing/stats/device', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.statsDevice(req, res);
  }));
  app.get('/syncthing/stats/folder', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.statsFolder(req, res);
  }));
  app.get('/syncthing/cluster/pending/devices', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getClusterPendigDevices(req, res);
  }));
  app.get('/syncthing/cluster/pending/folders', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getClusterPendigFolders(req, res);
  }));
  app.get('/syncthing/folder/errors/:folder?', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getFolderErrors(req, res);
  }));
  app.get('/syncthing/folder/versions/:folder?', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getFolderVersions(req, res);
  }));
  app.get('/syncthing/db/browse/:folder?/:levels?/:prefix?', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getDbBrowse(req, res);
  }));
  app.get('/syncthing/db/completion/:folder?/:device?', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getDbCompletionApi(req, res);
  }));
  app.get('/syncthing/db/file/:folder?/:file?', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getDbFile(req, res);
  }));
  app.get('/syncthing/db/ignores/:folder?', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getDbIgnores(req, res);
  }));
  app.get('/syncthing/db/localchanged/:folder?', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getDbLocalchanged(req, res);
  }));
  app.get('/syncthing/db/need/:folder?', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getDbNeed(req, res);
  }));
  app.get('/syncthing/db/remoteneed/:folder?/:device?', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getDbRemoteNeed(req, res);
  }));
  app.get('/syncthing/db/status/:folder?', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getDbStatusApi(req, res);
  }));
  app.get('/syncthing/events/disk', asyncRoute((req, res) => {
    return syncthingService.getEventsDisk(req, res);
  }));
  app.get('/syncthing/events/:events?/:since?/:limit?/:timeout?', asyncRoute((req, res) => {
    return syncthingService.getEventsApi(req, res);
  }));
  app.get('/syncthing/svc/random/string/:length?', asyncRoute((req, res) => {
    return syncthingService.getSvcRandomString(req, res);
  }));
  app.get('/syncthing/svc/report', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getSvcReport(req, res);
  }));
  app.get('/syncthing/svc/:deviceid?', cache('30 seconds'), asyncRoute((req, res) => {
    return syncthingService.getSvcDeviceID(req, res);
  }));
  app.get('/syncthing/debug/peercompletion', asyncRoute((req, res) => {
    return syncthingService.debugPeerCompletion(req, res);
  }));
  app.get('/syncthing/debug/httpmetrics', asyncRoute((req, res) => {
    return syncthingService.debugHttpmetrics(req, res);
  }));
  app.get('/syncthing/debug/cpuprof', asyncRoute((req, res) => {
    return syncthingService.debugCpuprof(req, res);
  }));
  app.get('/syncthing/debug/heapprof', asyncRoute((req, res) => {
    return syncthingService.debugHeapprof(req, res);
  }));
  app.get('/syncthing/debug/support', asyncRoute((req, res) => {
    return syncthingService.debugSupport(req, res);
  }));
  app.get('/syncthing/debug/file', asyncRoute((req, res) => {
    return syncthingService.debugFile(req, res);
  }));
  // BACKUP & RESTORE

  app.get('/backup/getvolumedataofcomponent/:appname?/:component?/:multiplier?/:decimal?/:fields?', asyncRoute((req, res) => {
    return backupRestoreService.getVolumeDataOfComponent(req, res);
  }));
  app.get('/backup/getremotefilesize/:fileurl?/:multiplier?/:decimal?/:number?/:appname?', asyncRoute((req, res) => {
    return backupRestoreService.getRemoteFileSize(req, res);
  }));
  app.get('/backup/getlocalbackuplist/:path?/:multiplier?/:decimal?/:number?/:appname?', asyncRoute((req, res) => {
    return backupRestoreService.getLocalBackupList(req, res);
  }));
  app.get('/backup/removebackupfile/:filepath?/:appname?', asyncRoute((req, res) => {
    return backupRestoreService.removeBackupFile(req, res);
  }));
  app.get('/backup/downloadlocalfile/:filepath?/:appname?', asyncRoute((req, res) => {
    return backupRestoreService.downloadLocalFile(req, res);
  }));
  app.post('/apps/appendbackuptask', asyncRoute((req, res) => {
    return advancedWorkflows.appendBackupTask(req, res);
  }));

  app.post('/apps/appendrestoretask', asyncRoute((req, res) => {
    return advancedWorkflows.appendRestoreTask(req, res);
  }));

  app.post('/ioutils/fileupload/:type?/:appname?/:component?/:folder?/:filename?', requireBootSettled, asyncRoute((req, res) => {
    return fileSystemManager.uploadAppsFiles(req, res);
  }));

  // GET PROTECTED API - Fluxnode Owner
  app.get('/daemon/stop', asyncRoute((req, res) => {
    return daemonServiceControlRpcs.stop(req, res);
  }));
  app.get('/daemon/reindex', asyncRoute((req, res) => {
    return fluxService.reindexDaemon(req, res);
  }));
  app.get('/daemon/createfluxnodekey', asyncRoute((req, res) => {
    return daemonServiceNodeRpcs.createFluxNodeKey(req, res);
  }));
  app.get('/daemon/createzelnodekey', asyncRoute((req, res) => { // DEPRECATED
    return daemonServiceNodeRpcs.createFluxNodeKey(req, res);
  }));
  app.get('/daemon/listfluxnodeconf/:filter?', asyncRoute((req, res) => {
    return daemonServiceNodeRpcs.listFluxNodeConf(req, res);
  }));
  app.get('/daemon/listzelnodeconf/:filter?', asyncRoute((req, res) => { // DEPRECATED
    return daemonServiceNodeRpcs.listFluxNodeConf(req, res);
  }));
  app.get('/daemon/getfluxnodeoutputs', asyncRoute((req, res) => {
    return daemonServiceNodeRpcs.getFluxNodeOutputs(req, res);
  }));
  app.get('/daemon/getzelnodeoutputs', asyncRoute((req, res) => { // DEPRECATED
    return daemonServiceNodeRpcs.getFluxNodeOutputs(req, res);
  }));
  app.get('/daemon/startfluxnode/:set?/:lockwallet?/:alias?', asyncRoute((req, res) => {
    return daemonServiceNodeRpcs.startFluxNode(req, res);
  }));
  app.get('/daemon/startzelnode/:set?/:lockwallet?/:alias?', asyncRoute((req, res) => { // DEPRECATED
    return daemonServiceNodeRpcs.startFluxNode(req, res);
  }));
  app.get('/daemon/startdeterministicfluxnode/:alias?/:lockwallet?', asyncRoute((req, res) => {
    return daemonServiceNodeRpcs.startDeterministicFluxNode(req, res);
  }));
  app.get('/daemon/startdeterministiczelnode/:alias?/:lockwallet?', asyncRoute((req, res) => { // DEPRECATED
    return daemonServiceNodeRpcs.startDeterministicFluxNode(req, res);
  }));
  app.get('/daemon/verifychain/:checklevel?/:numblocks?', asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.verifyChain(req, res);
  }));
  app.get('/daemon/addnode/:node?/:command?', asyncRoute((req, res) => {
    return daemonServiceNetworkRpcs.addNode(req, res);
  }));
  app.get('/daemon/clearbanned', asyncRoute((req, res) => {
    return daemonServiceNetworkRpcs.clearBanned(req, res);
  }));
  app.get('/daemon/disconnectnode/:node?', asyncRoute((req, res) => {
    return daemonServiceNetworkRpcs.disconnectNode(req, res);
  }));
  app.get('/daemon/getaddednodeinfo/:dns?/:node?', asyncRoute((req, res) => {
    return daemonServiceNetworkRpcs.getAddedNodeInfo(req, res);
  }));
  app.get('/daemon/setban/:ip?/:command?/:bantime?/:absolute?', asyncRoute((req, res) => {
    return daemonServiceNetworkRpcs.setBan(req, res);
  }));
  app.get('/daemon/signrawtransaction/:hexstring?/:prevtxs?/:privatekeys?/:sighashtype?/:branchid?', asyncRoute((req, res) => {
    return daemonServiceTransactionRpcs.signRawTransaction(req, res);
  }));
  app.get('/daemon/addmultisigaddress/:n?/:keysobject?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.addMultiSigAddress(req, res);
  }));
  app.get('/daemon/backupwallet/:destination?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.backupWallet(req, res);
  }));
  app.get('/daemon/dumpprivkey/:taddr?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.dumpPrivKey(req, res);
  }));
  app.get('/daemon/getbalance/:minconf?/:includewatchonly?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.getBalance(req, res);
  }));
  app.get('/daemon/getnewaddress', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.getNewAddress(req, res);
  }));
  app.get('/daemon/getrawchangeaddress', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.getRawChangeAddress(req, res);
  }));
  app.get('/daemon/getreceivedbyaddress/:fluxaddress?/:minconf?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.getReceivedByAddress(req, res);
  }));
  app.get('/daemon/getunconfirmedbalance', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.getUnconfirmedBalance(req, res);
  }));
  app.get('/daemon/getwalletinfo', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.getWalletInfo(req, res);
  }));
  app.get('/daemon/importaddress/:address?/:label?/:rescan?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.importAddress(req, res);
  }));
  app.get('/daemon/importprivkey/:fluxprivkey?/:label?/:rescan?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.importPrivKey(req, res);
  }));
  app.get('/daemon/importwallet/:filename?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.importWallet(req, res);
  }));
  app.get('/daemon/keypoolrefill/:newsize?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.keyPoolRefill(req, res);
  }));
  app.get('/daemon/listaddressgroupings', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.listAddressGroupings(req, res);
  }));
  app.get('/daemon/listlockunspent', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.listLockUnspent(req, res);
  }));
  app.get('/daemon/listreceivedbyaddress/:minconf?/:includeempty?/:includewatchonly?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.listReceivedByAddress(req, res);
  }));
  app.get('/daemon/listsinceblock/:blockhash?/:targetconfirmations?/:includewatchonly?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.listSinceBlock(req, res);
  }));
  app.get('/daemon/listtransactions/:count?/:from?/:includewatchonly?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.listTransactions(req, res);
  }));
  app.get('/daemon/listunspent/:minconf?/:maxconf?/:addresses?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.listUnspent(req, res);
  }));
  app.get('/daemon/lockunspent/:unlock?/:transactions?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.lockUnspent(req, res);
  }));
  app.get('/daemon/rescanblockchain/:startheight?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.rescanBlockchain(req, res);
  }));
  app.get('/daemon/sendfrom/:tofluxaddress?/:amount?/:minconf?/:comment?/:commentto?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.sendFrom(req, res);
  }));
  app.get('/daemon/sendmany/:amounts?/:minconf?/:comment?/:substractfeefromamount?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.sendMany(req, res);
  }));
  app.get('/daemon/sendtoaddress/:fluxaddress?/:amount?/:comment?/:commentto?/:substractfeefromamount?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.sendToAddress(req, res);
  }));
  app.get('/daemon/settxfee/:amount?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.setTxFee(req, res);
  }));
  app.get('/daemon/signmessage/:taddr?/:message?', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.signMessage(req, res);
  }));
  app.get('/daemon/zexportkey/:zaddr?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zExportKey(req, res);
  }));
  app.get('/daemon/zexportviewingkey/:zaddr?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zExportViewingKey(req, res);
  }));
  app.get('/daemon/zgetbalance/:address?/:minconf?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zGetBalance(req, res);
  }));
  app.get('/daemon/zgetmigrationstatus', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zGetMigrationStatus(req, res);
  }));
  app.get('/daemon/zgetnewaddress/:type?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zGetNewAddress(req, res);
  }));
  app.get('/daemon/zgetoperationresult/:operationid?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zGetOperationResult(req, res);
  }));
  app.get('/daemon/zgetoperationstatus/:operationid?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zGetOperationStatus(req, res);
  }));
  app.get('/daemon/zgettotalbalance/:minconf?/:includewatchonly?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zGetTotalBalance(req, res);
  }));
  app.get('/daemon/zimportkey/:zkey?/:rescan?/:startheight?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zImportKey(req, res);
  }));
  app.get('/daemon/zimportviewingkey/:vkey?/:rescan?/:startheight?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zImportViewingKey(req, res);
  }));
  app.get('/daemon/zimportwallet/:filename?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zImportWallet(req, res);
  }));
  app.get('/daemon/zlistaddresses/:includewatchonly?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zListAddresses(req, res);
  }));
  app.get('/daemon/zlistoperationids', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zListOperationIds(req, res);
  }));
  app.get('/daemon/zlistreceivedbyaddress/:address?/:minconf?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zListReceivedByAddress(req, res);
  }));
  app.get('/daemon/zlistunspent/:minconf?/:maxonf?/:includewatchonly?/:addresses?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zListUnspent(req, res);
  }));
  app.get('/daemon/zmergetoaddress/:fromaddresses?/:toaddress?/:fee?/:transparentlimit?/:shieldedlimit?/:memo?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zMergeToAddress(req, res);
  }));
  app.get('/daemon/zsendmany/:fromaddress?/:amounts?/:minconf?/:fee?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zSendMany(req, res);
  }));
  app.get('/daemon/zsetmigration/:enabled?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zSetMigration(req, res);
  }));
  app.get('/daemon/zshieldcoinbase/:fromaddress?/:toaddress?/:fee?/:limit?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zShieldCoinBase(req, res);
  }));
  app.get('/daemon/zcrawjoinsplit/:rawtx?/:inputs?/:outputs?/:vpubold?/:vpubnew?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zcRawJoinSplit(req, res);
  }));
  app.get('/daemon/zcrawkeygen', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zcRawKeygen(req, res);
  }));
  app.get('/daemon/zcrawreceive/:zcsecretkey?/:encryptednote?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zcRawReceive(req, res);
  }));
  app.get('/daemon/zcsamplejoinsplit', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zcSampleJoinSplit(req, res);
  }));
  app.get('/daemon/getaddresstxids/:address?/:start?/:end?', asyncRoute((req, res) => {
    return daemonServiceAddressRpcs.getSingleAddresssTxids(req, res);
  }));
  app.get('/daemon/getaddressbalance/:address?', asyncRoute((req, res) => {
    return daemonServiceAddressRpcs.getSingleAddressBalance(req, res);
  }));
  app.get('/daemon/getaddressdeltas/:address?/:start?/:end?/:chaininfo?', asyncRoute((req, res) => {
    return daemonServiceAddressRpcs.getSingleAddressDeltas(req, res);
  }));
  app.get('/daemon/getaddressutxos/:address?/:chaininfo?', asyncRoute((req, res) => {
    return daemonServiceAddressRpcs.getSingleAddressUtxos(req, res);
  }));
  app.get('/daemon/getaddressmempool/:address?', asyncRoute((req, res) => {
    return daemonServiceAddressRpcs.getSingleAddressMempool(req, res);
  }));

  app.get('/id/loggedusers', asyncRoute((req, res) => {
    return idService.loggedUsers(req, res);
  }));
  app.get('/id/activeloginphrases', asyncRoute((req, res) => {
    return idService.activeLoginPhrases(req, res);
  }));
  app.get('/id/logoutallusers', asyncRoute((req, res) => {
    return idService.logoutAllUsers(req, res);
  }));
  app.get('/zelid/loggedusers', asyncRoute((req, res) => { // DEPRECATED
    return idService.loggedUsers(req, res);
  }));
  app.get('/zelid/activeloginphrases', asyncRoute((req, res) => { // DEPRECATED
    return idService.activeLoginPhrases(req, res);
  }));
  app.get('/zelid/logoutallusers', asyncRoute((req, res) => { // DEPRECATED
    return idService.logoutAllUsers(req, res);
  }));

  app.get('/flux/adjustkadena/:account?/:chainid?', asyncRoute((req, res) => { // note this essentially rebuilds flux use with caution!
    return fluxService.adjustKadenaAccount(req, res);
  }));
  app.get('/flux/adjustrouterip/:routerip?', asyncRoute((req, res) => { // note this essentially rebuilds flux use with caution!
    return fluxService.adjustRouterIP(req, res);
  }));
  app.post('/flux/adjustblockedports', asyncRoute((req, res) => { // note this essentially rebuilds flux use with caution!
    return fluxService.adjustBlockedPorts(req, res);
  }));
  app.get('/flux/adjustapiport/:apiport?', asyncRoute((req, res) => { // note this essentially rebuilds flux use with caution!
    return fluxService.adjustAPIPort(req, res);
  }));
  app.post('/flux/adjustblockedrepositories', asyncRoute((req, res) => { // note this essentially rebuilds flux use with caution!
    return fluxService.adjustBlockedRepositories(req, res);
  }));
  app.get('/flux/reindexdaemon', asyncRoute((req, res) => {
    return fluxService.reindexDaemon(req, res);
  }));

  app.get('/benchmark/signfluxnodetransaction/:hexstring?', asyncRoute((req, res) => {
    return benchmarkService.signFluxTransaction(req, res);
  }));
  app.get('/benchmark/signzelnodetransaction/:hexstring?', asyncRoute((req, res) => { // DEPRECATED
    return benchmarkService.signFluxTransaction(req, res);
  }));
  app.get('/benchmark/stop', asyncRoute((req, res) => {
    return benchmarkService.stop(req, res);
  }));

  // GET PROTECTED API - FluxTeam
  app.get('/daemon/start', asyncRoute((req, res) => {
    return fluxService.startDaemon(req, res);
  }));
  app.get('/daemon/restart', asyncRoute((req, res) => {
    return fluxService.restartDaemon(req, res);
  }));
  app.get('/daemon/ping', asyncRoute((req, res) => { // we do not want this to be issued by anyone.
    return daemonServiceNetworkRpcs.ping(req, res);
  }));
  app.get('/daemon/zcbenchmark/:benchmarktype?/:samplecount?', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zcBenchmark(req, res);
  }));
  app.get('/daemon/startbenchmark', asyncRoute((req, res) => {
    return daemonServiceBenchmarkRpcs.startBenchmarkD(req, res);
  }));
  app.get('/daemon/stopbenchmark', asyncRoute((req, res) => {
    return daemonServiceBenchmarkRpcs.stopBenchmarkD(req, res);
  }));

  app.get('/flux/startbenchmark', asyncRoute((req, res) => {
    return fluxService.startBenchmark(req, res);
  }));
  app.get('/flux/restartbenchmark', asyncRoute((req, res) => {
    return fluxService.restartBenchmark(req, res);
  }));
  app.get('/flux/startdaemon', asyncRoute((req, res) => {
    return fluxService.startDaemon(req, res);
  }));
  app.get('/flux/restartdaemon', asyncRoute((req, res) => {
    return fluxService.restartDaemon(req, res);
  }));
  // What this node reports it is running, read from the working tree it was deployed
  // from. A diagnostic for whoever switches the branch below, and only that: it is the
  // node's own account of itself, so it answers what is on disk rather than settling
  // whether that is what should be there.
  app.get('/flux/currentbranch', asyncRoute((req, res) => {
    return fluxService.getCurrentBranchApi(req, res);
  }));
  app.get('/flux/currentcommitid', asyncRoute((req, res) => {
    return fluxService.getCurrentCommitIdApi(req, res);
  }));
  app.get('/flux/entermaster', asyncRoute((req, res) => {
    return fluxService.enterMasterApi(req, res);
  }));
  app.get('/flux/enterdevelopment', asyncRoute((req, res) => {
    return fluxService.enterDevelopmentApi(req, res);
  }));
  app.get('/flux/updateflux', asyncRoute((req, res) => { // method shall be called only if flux version is obsolete.
    return fluxService.updateFlux(req, res);
  }));
  app.get('/flux/softupdateflux', asyncRoute((req, res) => { // method shall be called only if flux version is obsolete.
    return fluxService.softUpdateFluxApi(req, res);
  }));
  app.get('/flux/softupdatefluxinstall', asyncRoute((req, res) => { // method shall be called only if flux version is obsolete.
    return fluxService.softUpdateFluxInstallApi(req, res);
  }));
  app.get('/flux/hardupdateflux', asyncRoute((req, res) => { // method shall be called only if flux version is obsolete and updatezeflux is not working correctly
    return fluxService.hardUpdateFlux(req, res);
  }));
  app.get('/flux/rebuildui', asyncRoute((req, res) => {
    return fluxService.rebuildUi(req, res);
  }));
  app.get('/flux/updatedaemon', asyncRoute((req, res) => { // method shall be called only if daemon version is obsolete
    return fluxService.updateDaemon(req, res);
  }));
  app.get('/flux/updatebenchmark', asyncRoute((req, res) => { // method shall be called only if benchamrk version is obsolete
    return fluxService.updateBenchmark(req, res);
  }));
  app.get('/flux/daemondebug', asyncRoute((req, res) => {
    return fluxService.daemonDebug(req, res);
  }));
  app.get('/flux/benchmarkdebug', asyncRoute((req, res) => {
    return fluxService.benchmarkDebug(req, res);
  }));
  app.get('/flux/taildaemondebug', asyncRoute((req, res) => {
    return fluxService.tailDaemonDebug(req, res);
  }));
  app.get('/flux/tailbenchmarkdebug', asyncRoute((req, res) => {
    return fluxService.tailBenchmarkDebug(req, res);
  }));
  app.get('/flux/errorlog', asyncRoute((req, res) => {
    return fluxService.fluxErrorLog(req, res);
  }));
  app.get('/flux/warnlog', asyncRoute((req, res) => {
    return fluxService.fluxWarnLog(req, res);
  }));
  app.get('/flux/debuglog', asyncRoute((req, res) => {
    return fluxService.fluxDebugLog(req, res);
  }));
  app.get('/flux/infolog', asyncRoute((req, res) => {
    return fluxService.fluxInfoLog(req, res);
  }));
  app.get('/flux/tailerrorlog', asyncRoute((req, res) => {
    return fluxService.tailFluxErrorLog(req, res);
  }));
  app.get('/flux/tailwarnlog', asyncRoute((req, res) => {
    return fluxService.tailFluxWarnLog(req, res);
  }));
  app.get('/flux/taildebuglog', asyncRoute((req, res) => {
    return fluxService.tailFluxDebugLog(req, res);
  }));
  app.get('/flux/tailinfolog', asyncRoute((req, res) => {
    return fluxService.tailFluxInfoLog(req, res);
  }));

  app.get('/flux/broadcastmessage/:data?', asyncRoute((req, res) => {
    return fluxCommunicationMessagesSender.broadcastMessageFromUser(req, res);
  }));
  app.get('/flux/broadcastmessagetooutgoing/:data?', asyncRoute((req, res) => {
    return fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUser(req, res);
  }));
  app.get('/flux/broadcastmessagetoincoming/:data?', asyncRoute((req, res) => {
    return fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUser(req, res);
  }));
  app.get('/flux/addpeer/:ip?', asyncRoute((req, res) => {
    return fluxCommunication.addPeer(req, res);
  }));
  app.get('/flux/removepeer/:ip?', asyncRoute((req, res) => {
    return fluxCommunication.removePeer(req, res);
  }));
  app.get('/flux/addoutgoingpeer/:ip?', asyncRoute((req, res) => {
    return fluxCommunication.addOutgoingPeer(req, res);
  }));
  app.get('/flux/removeincomingpeer/:ip?', asyncRoute((req, res) => {
    return fluxCommunication.removeIncomingPeer(req, res);
  }));
  app.get('/flux/startdiscovery', asyncRoute((req, res) => {
    return fluxCommunication.startDiscoveryApi(req, res);
  }));
  app.get('/flux/allowport/:port?', asyncRoute((req, res) => {
    return fluxNetworkHelper.allowPortApi(req, res);
  }));
  app.get('/flux/checkcommunication', asyncRoute((req, res) => {
    return fluxNetworkHelper.isCommunicationEstablished(req, res);
  }));
  app.get('/flux/uptime', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxNetworkHelper.fluxUptime(req, res);
  }));
  app.get('/flux/systemuptime', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxNetworkHelper.fluxSystemUptime(req, res);
  }));
  app.get('/flux/clockdrift', cache('30 seconds'), asyncRoute((req, res) => {
    return fluxNetworkHelper.clockDrift(req, res);
  }));
  app.get('/flux/backendfolder', isLocal, asyncRoute((req, res) => {
    return fluxService.fluxBackendFolder(req, res);
  }));
  app.get('/flux/mapport/:port?', asyncRoute((req, res) => {
    return upnpService.mapPortApi(req, res);
  }));
  app.get('/flux/unmapport/:port?', asyncRoute((req, res) => {
    return upnpService.removeMapPortApi(req, res);
  }));
  app.get('/flux/getmap', asyncRoute((req, res) => {
    return upnpService.getMapApi(req, res);
  }));
  app.get('/flux/getip', asyncRoute((req, res) => {
    return upnpService.getIpApi(req, res);
  }));
  app.get('/flux/getgateway', asyncRoute((req, res) => {
    return upnpService.getGatewayApi(req, res);
  }));
  app.get('/flux/isarcaneos', cache('1 day'), asyncRoute((req, res) => {
    return fluxService.isArcaneOs(req, res);
  }));

  app.get('/benchmark/start', asyncRoute((req, res) => {
    return fluxService.startBenchmark(req, res);
  }));
  app.get('/benchmark/restart', asyncRoute((req, res) => {
    return fluxService.restartBenchmark(req, res);
  }));
  app.get('/benchmark/restartnodebenchmarks', asyncRoute((req, res) => {
    return benchmarkService.restartNodeBenchmarks(req, res);
  }));

  app.get('/explorer/reindex/:reindexapps?', asyncRoute((req, res) => {
    return explorerService.reindexExplorer(req, res);
  }));
  app.get('/explorer/restart', asyncRoute((req, res) => {
    return explorerService.restartBlockProcessing(req, res);
  }));
  app.get('/explorer/stop', asyncRoute((req, res) => {
    return explorerService.stopBlockProcessing(req, res);
  }));
  app.get('/explorer/rescan/:blockheight?/:rescanapps?', asyncRoute((req, res) => {
    return explorerService.rescanExplorer(req, res);
  }));

  app.get('/apps/checkhashes', asyncRoute((req, res) => {
    return appHashSyncService.triggerAppHashesCheckAPI(req, res);
  }));
  app.get('/apps/requestmessage/:hash', asyncRoute((req, res) => {
    return messageVerifier.requestAppMessageAPI(req, res);
  }));
  // alwaysRespond BEFORE requireBootSettled, on all eight app-control routes.
  //
  // Not for the reason it looks like. A 503 from the boot gate cannot collapse
  // into a bodiless 304 whichever way round these go: express's req.fresh
  // returns false unless the status is 2xx or 304, so a conditional request can
  // never turn a 503 into one, whatever ETag it carries. Verified across
  // bootSettled x order x six request shapes.
  //
  // The real reason is smaller: reversed, the 503 goes out with no Cache-Control
  // header at all instead of no-store, because alwaysRespond never runs. Worth
  // keeping, and worth writing down - two middlewares in an order with no stated
  // reason is an invitation to swap them.
  app.get('/apps/appstart/:appname?/:global?', alwaysRespond, requireBootSettled, asyncRoute((req, res) => {
    return appController.appStart(req, res);
  }));
  app.get('/apps/appstop/:appname?/:global?', alwaysRespond, requireBootSettled, asyncRoute((req, res) => {
    return appController.appStop(req, res);
  }));
  app.get('/apps/apprestart/:appname?/:global?', alwaysRespond, requireBootSettled, asyncRoute((req, res) => {
    return appController.appRestart(req, res);
  }));
  // No :global - a kill is deliberately per-node. Its privilege is the same as
  // its siblings' above: every run-state verb asks for appownerorfluxteam, so
  // the node operator can order none of them on an app they only host.
  app.get('/apps/appkill/:appname?', alwaysRespond, requireBootSettled, asyncRoute((req, res) => {
    return appController.appKill(req, res);
  }));
  app.get('/apps/apppause/:appname?/:global?', alwaysRespond, requireBootSettled, asyncRoute((req, res) => {
    return appController.appPause(req, res);
  }));
  app.get('/apps/appunpause/:appname?/:global?', alwaysRespond, requireBootSettled, asyncRoute((req, res) => {
    return appController.appUnpause(req, res);
  }));
  app.get('/apps/apptop/:appname?', asyncRoute((req, res) => {
    return appInspector.appTop(req, res);
  }));
  app.get('/apps/applog/:appname?/:lines?', asyncRoute((req, res) => {
    return appInspector.appLog(req, res);
  }));
  app.get('/apps/applogpolling/:appname?/:lines?/:since?', asyncRoute((req, res) => {
    return appInspector.appLogPolling(req, res);
  }));
  app.get('/apps/appinspect/:appname?', asyncRoute((req, res) => {
    return appInspector.appInspect(req, res);
  }));
  app.get('/apps/appstats/:appname?', asyncRoute((req, res) => {
    return appInspector.appStats(req, res);
  }));
  app.get('/apps/appmonitor/:appname?/:range?', asyncRoute((req, res) => {
    return appInspector.appMonitorAPI(req, res);
  }));
  app.get('/apps/appchanges/:appname?', asyncRoute((req, res) => {
    return appInspector.appChanges(req, res);
  }));
  app.post('/apps/appexec', asyncRoute((req, res) => {
    return appInspector.appExec(req, res);
  }));
  app.get('/apps/appremove/:appname?/:force?/:global?', alwaysRespond, requireBootSettled, asyncRoute((req, res) => {
    return appUninstaller.removeAppLocallyApi(req, res);
  }));
  app.get('/apps/installapplocally/:appname?', requireBootSettled, asyncRoute((req, res) => {
    return appInstaller.installAppLocally(req, res);
  }));
  app.get('/apps/testappinstall/:appname?', requireBootSettled, asyncRoute((req, res) => {
    return appInstaller.testAppInstall(req, res);
  }));
  app.get('/apps/createfluxnetwork', asyncRoute((req, res) => {
    return systemIntegration.createFluxNetworkAPI(req, res);
  }));
  app.get('/apps/rescanglobalappsinformation/:blockheight?/:removelastinformation?', asyncRoute((req, res) => {
    return registryManager.rescanGlobalAppsInformationAPI(req, res);
  }));
  app.get('/apps/reindexglobalappsinformation', asyncRoute((req, res) => {
    return registryManager.reindexGlobalAppsInformationAPI(req, res);
  }));
  app.get('/apps/reindexglobalappslocation', asyncRoute((req, res) => {
    return registryManager.reindexGlobalAppsLocationAPI(req, res);
  }));
  app.get('/apps/redeploy/:appname?/:force?/:global?', alwaysRespond, requireBootSettled, asyncRoute((req, res) => {
    return advancedWorkflows.redeployAPI(req, res);
  }));
  app.get('/apps/redeploycomponent/:appname?/:component?/:force?', alwaysRespond, requireBootSettled, asyncRoute((req, res) => {
    return advancedWorkflows.redeployComponentAPI(req, res);
  }));
  app.get('/apps/reconstructhashes', asyncRoute((req, res) => {
    return registryManager.reconstructAppMessagesHashCollectionAPI(req, res);
  }));
  // alwaysRespond, like the other retired routes: the body is byte-identical on
  // every call, so express fingerprints it with a strong ETag and any caller that
  // revalidates gets an empty 304 from the second call on. Explaining why the
  // endpoint stopped working is the only job these routes have left, and a repeat
  // caller could never read the explanation.
  app.get('/apps/startmonitoring/:appname?', alwaysRespond, asyncRoute((req, res) => {
    return monitoringOrchestrator.startAppMonitoringAPI(req, res);
  }));
  app.get('/apps/stopmonitoring/:appname?/:deletedata?', alwaysRespond, asyncRoute((req, res) => {
    return monitoringOrchestrator.stopAppMonitoringAPI(req, res);
  }));
  app.get('/apps/appmonitorstream/:appname?', alwaysRespond, asyncRoute((req, res) => {
    return monitoringOrchestrator.appMonitorStreamAPI(req, res);
  }));

  app.get('/syncthing/metrics', asyncRoute((req, res) => {
    return syncthingService.getSyncthingMetrics(req, res);
  }));
  app.get('/syncthing/metrics/health', asyncRoute((req, res) => {
    return syncthingService.getSyncthingHealthSummary(req, res);
  }));
  app.get('/syncthing/metrics/history/:limit?', asyncRoute((req, res) => {
    return syncthingService.getSyncthingMetricsHistory(req, res);
  }));
  app.get('/syncthing/peer/diagnostics', asyncRoute((req, res) => {
    return syncthingService.getPeerSyncDiagnosticsApi(req, res);
  }));

  // POST PUBLIC methods route
  // ArcaneOS Authentication Endpoints (HTTPS only)
  app.post('/arcane/configsync', requireHttps, asyncRoute(arcaneAuthService.configSyncHandler));

  app.post('/id/verifylogin', asyncRoute((req, res) => {
    return idService.verifyLogin(req, res);
  }));
  app.post('/id/providesign', asyncRoute((req, res) => {
    return idService.provideSign(req, res);
  }));
  app.post('/id/checkprivilege', asyncRoute((req, res) => {
    return idService.checkLoggedUser(req, res);
  }));
  app.post('/zelid/verifylogin', asyncRoute((req, res) => { // DEPRECATED
    return idService.verifyLogin(req, res);
  }));
  app.post('/zelid/providesign', asyncRoute((req, res) => { // DEPRECATED
    return idService.provideSign(req, res);
  }));
  app.post('/zelid/checkprivilege', asyncRoute((req, res) => { // DEPRECATED
    return idService.checkLoggedUser(req, res);
  }));

  // Payment request routes
  app.get('/payment/paymentrequest', asyncRoute((req, res) => {
    return paymentService.paymentRequest(req, res);
  }));
  app.post('/payment/verifypayment', asyncRoute((req, res) => {
    return paymentService.verifyPayment(req, res);
  }));

  app.post('/daemon/createrawtransaction', asyncRoute((req, res) => {
    return daemonServiceTransactionRpcs.createRawTransactionPost(req, res);
  }));
  app.post('/daemon/decoderawtransaction', asyncRoute((req, res) => {
    return daemonServiceTransactionRpcs.decodeRawTransactionPost(req, res);
  }));
  app.post('/daemon/decodescript', asyncRoute((req, res) => {
    return daemonServiceTransactionRpcs.decodeScriptPost(req, res);
  }));
  app.post('/daemon/fundrawtransaction', asyncRoute((req, res) => {
    return daemonServiceTransactionRpcs.fundRawTransactionPost(req, res);
  }));
  app.post('/daemon/sendrawtransaction', asyncRoute((req, res) => {
    return daemonServiceTransactionRpcs.sendRawTransactionPost(req, res);
  }));
  app.post('/daemon/createmultisig', asyncRoute((req, res) => {
    return daemonServiceUtilityRpcs.createMultiSigPost(req, res);
  }));
  app.post('/daemon/verifymessage', asyncRoute((req, res) => {
    return daemonServiceUtilityRpcs.verifyMessagePost(req, res);
  }));
  app.post('/daemon/getblockhashes', asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getBlockHashesPost(req, res);
  }));
  app.post('/daemon/getspentinfo', asyncRoute((req, res) => {
    return daemonServiceBlockchainRpcs.getSpentInfoPost(req, res);
  }));
  app.post('/daemon/getaddresstxids', asyncRoute((req, res) => {
    return daemonServiceAddressRpcs.getAddressTxids(req, res);
  }));
  app.post('/daemon/getaddressbalance', asyncRoute((req, res) => {
    return daemonServiceAddressRpcs.getAddressBalance(req, res);
  }));
  app.post('/daemon/getaddressdeltas', asyncRoute((req, res) => {
    return daemonServiceAddressRpcs.getAddressDeltas(req, res);
  }));
  app.post('/daemon/getaddressutxos', asyncRoute((req, res) => {
    return daemonServiceAddressRpcs.getAddressUtxos(req, res);
  }));
  app.post('/daemon/getaddressmempool', asyncRoute((req, res) => {
    return daemonServiceAddressRpcs.getAddressMempool(req, res);
  }));
  app.get('/flux/streamchainpreparation', asyncRoute((req, res) => {
    return fluxService.streamChainPreparation(req, res);
  }));
  app.post('/flux/streamchain', asyncRoute((req, res) => {
    return fluxService.streamChain(req, res);
  }));

  // POST PROTECTED API - USER LEVEL
  app.post('/id/logoutspecificsession', asyncRoute((req, res) => { // requires the knowledge of a session loginPhrase so users level is sufficient and user cannot logout another user as he does not know the loginPhrase.
    return idService.logoutSpecificSession(req, res);
  }));
  app.post('/zelid/logoutspecificsession', asyncRoute((req, res) => { // DEPRECATED
    return idService.logoutSpecificSession(req, res);
  }));

  app.post('/daemon/submitblock', asyncRoute((req, res) => {
    return daemonServiceMiningRpcs.submitBlockPost(req, res);
  }));

  app.post('/apps/checkdockerexistance', asyncRoute((req, res) => {
    return imageManager.checkDockerAccessibility(req, res);
  }));
  app.post('/apps/appregister', asyncRoute((req, res) => {
    return registryManager.registerAppGlobalyApi(req, res);
  }));
  app.post('/apps/appupdate', asyncRoute((req, res) => {
    return advancedWorkflows.updateAppGlobalyApi(req, res);
  }));
  app.post('/apps/getpublickey', asyncRoute((req, res) => {
    return cryptographicKeys.getPublicKey(req, res);
  }));

  // POST PROTECTED API - FluxNode owner level
  app.post('/daemon/signrawtransaction', asyncRoute((req, res) => {
    return daemonServiceTransactionRpcs.signRawTransactionPost(req, res);
  }));
  app.post('/daemon/addmultisigaddress', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.addMultiSigAddressPost(req, res);
  }));
  app.post('/daemon/sendfrom', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.sendFromPost(req, res);
  }));
  app.post('/daemon/sendmany', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.sendManyPost(req, res);
  }));
  app.post('/daemon/sendtoaddress', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.sendToAddressPost(req, res);
  }));
  app.post('/daemon/signmessage', asyncRoute((req, res) => {
    return daemonServiceWalletRpcs.signMessagePost(req, res);
  }));
  app.post('/daemon/zsendmany', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zSendManyPost(req, res);
  }));
  app.post('/daemon/zcrawjoinsplit', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zcRawJoinSplitPost(req, res);
  }));
  app.post('/daemon/zcrawreceive', asyncRoute((req, res) => {
    return daemonServiceZcashRpcs.zcRawReceivePost(req, res);
  }));

  app.post('/benchmark/signfluxnodetransaction', asyncRoute((req, res) => {
    return benchmarkService.signFluxTransactionPost(req, res);
  }));
  app.post('/benchmark/signzelnodetransaction', asyncRoute((req, res) => { // DEPRECATED
    return benchmarkService.signFluxTransactionPost(req, res);
  }));

  // POST PROTECTED API - FluxTeam
  app.post('/flux/broadcastmessage', asyncRoute((req, res) => {
    return fluxCommunicationMessagesSender.broadcastMessageFromUserPost(req, res);
  }));
  app.post('/flux/broadcastmessagetooutgoing', asyncRoute((req, res) => {
    return fluxCommunicationMessagesSender.broadcastMessageToOutgoingFromUserPost(req, res);
  }));
  app.post('/flux/broadcastmessagetoincoming', asyncRoute((req, res) => {
    return fluxCommunicationMessagesSender.broadcastMessageToIncomingFromUserPost(req, res);
  }));

  app.post('/syncthing/system/error', asyncRoute((req, res) => {
    return syncthingService.postSystemError(req, res);
  }));
  app.post('/syncthing/system/upgrade', asyncRoute((req, res) => {
    return syncthingService.postSystemUpgrade(req, res);
  }));
  app.post('/syncthing/config', asyncRoute((req, res) => {
    return syncthingService.postConfig(req, res);
  }));
  app.post('/syncthing/config/folders', asyncRoute((req, res) => {
    return syncthingService.postConfigFolders(req, res);
  }));
  app.post('/syncthing/config/devices', asyncRoute((req, res) => {
    return syncthingService.postConfigDevices(req, res);
  }));
  app.post('/syncthing/config/defaults/folder', asyncRoute((req, res) => {
    return syncthingService.postConfigDefaultsFolder(req, res);
  }));
  app.post('/syncthing/config/defaults/device', asyncRoute((req, res) => {
    return syncthingService.postConfigDefaultsDevice(req, res);
  }));
  app.post('/syncthing/config/defaults/ignores', asyncRoute((req, res) => {
    return syncthingService.postConfigDefaultsIgnores(req, res);
  }));
  app.post('/syncthing/config/options', asyncRoute((req, res) => {
    return syncthingService.postConfigOptions(req, res);
  }));
  app.post('/syncthing/config/gui', asyncRoute((req, res) => {
    return syncthingService.postConfigGui(req, res);
  }));
  app.post('/syncthing/config/ldap', asyncRoute((req, res) => {
    return syncthingService.postConfigLdap(req, res);
  }));
  app.post('/syncthing/cluster/pending/devices', asyncRoute((req, res) => {
    return syncthingService.postClusterPendigDevices(req, res);
  }));
  app.post('/syncthing/cluster/pending/folders', asyncRoute((req, res) => {
    return syncthingService.postClusterPendigFolders(req, res);
  }));
  app.post('/syncthing/folder/versions', asyncRoute((req, res) => {
    return syncthingService.postFolderVersions(req, res);
  }));
  app.post('/syncthing/db/ignores', asyncRoute((req, res) => {
    return syncthingService.postDbIgnores(req, res);
  }));
  app.post('/syncthing/db/override', asyncRoute((req, res) => {
    return syncthingService.postDbOverride(req, res);
  }));
  app.post('/syncthing/db/prio', asyncRoute((req, res) => {
    return syncthingService.postDbPrio(req, res);
  }));
  app.post('/syncthing/db/revert', asyncRoute((req, res) => {
    return syncthingService.postDbRevert(req, res);
  }));
  app.post('/syncthing/db/scan', asyncRoute((req, res) => {
    return syncthingService.postDbScan(req, res);
  }));

  // FluxShare
  app.get('/apps/fluxshare/getfile/:file?/:token?', asyncRoute((req, res) => {
    return fluxshareService.fluxShareDownloadFile(req, res);
  }));
  app.get('/apps/fluxshare/getfolder/:folder?', asyncRoute((req, res) => {
    return fluxshareService.fluxShareGetFolder(req, res);
  }));
  app.get('/apps/fluxshare/createfolder/:folder?', asyncRoute((req, res) => {
    return fluxshareService.fluxShareCreateFolder(req, res);
  }));
  app.post('/apps/fluxshare/uploadfile/:folder?', asyncRoute((req, res) => {
    return fluxshareService.fluxShareUpload(req, res);
  }));
  app.get('/apps/fluxshare/removefile/:file?', asyncRoute((req, res) => {
    return fluxshareService.fluxShareRemoveFile(req, res);
  }));
  app.get('/apps/fluxshare/removefolder/:folder?', asyncRoute((req, res) => {
    return fluxshareService.fluxShareRemoveFolder(req, res);
  }));
  app.get('/apps/fluxshare/fileexists/:file?', asyncRoute((req, res) => {
    return fluxshareService.fluxShareFileExists(req, res);
  }));
  app.get('/apps/fluxshare/stats', asyncRoute((req, res) => {
    return fluxshareService.fluxShareStorageStats(req, res);
  }));
  app.get('/apps/fluxshare/sharefile/:file?', asyncRoute((req, res) => {
    return fluxshareService.fluxShareShareFile(req, res);
  }));
  app.get('/apps/fluxshare/unsharefile/:file?', asyncRoute((req, res) => {
    return fluxshareService.fluxShareUnshareFile(req, res);
  }));
  app.get('/apps/fluxshare/sharedfiles', asyncRoute((req, res) => {
    return fluxshareService.fluxShareGetSharedFiles(req, res);
  }));
  app.get('/apps/fluxshare/rename/:oldpath?/:newname?', asyncRoute((req, res) => {
    return fluxshareService.fluxShareRename(req, res);
  }));
  app.get('/apps/fluxshare/downloadfolder/:folder?', asyncRoute((req, res) => {
    return fluxshareService.fluxShareDownloadFolder(req, res);
  }));
  // Handing the file operation image to a node that cannot reach the registry.
  // Open to other Flux nodes rather than to an owner: it carries no app data,
  // and a node needing it has nobody to authenticate as.
  app.get('/apps/fileoperationimage/:imageid', asyncRoute((req, res) => {
    return volumeExecutor.serveImageToPeer(req, res);
  }));
  // Volume Browser
  app.get('/apps/getfolderinfo/:appname?/:component?/:folder?', asyncRoute((req, res) => {
    return fileQueryService.getAppsFolder(req, res);
  }));
  app.get('/apps/createfolder/:appname?/:component?/:folder?', requireBootSettled, asyncRoute((req, res) => {
    return fileSystemManager.createAppsFolder(req, res);
  }));
  app.get('/apps/renameobject/:appname?/:component?/:oldpath?/:newname?', requireBootSettled, asyncRoute((req, res) => {
    return fileSystemManager.renameAppsObject(req, res);
  }));
  app.get('/apps/removeobject/:appname?/:component?/:object?', requireBootSettled, asyncRoute((req, res) => {
    return fileSystemManager.removeAppsObject(req, res);
  }));
  // Every endpoint that answers 202 points here: one status resource, one
  // status enum, one error shape, so a client polls the same way whatever it
  // started.
  app.get('/apps/operations/:jobId', asyncRoute((req, res) => {
    return operationsController.getOperation(req, res);
  }));
  app.delete('/apps/operations/:jobId', asyncRoute((req, res) => {
    return operationsController.cancelOperation(req, res);
  }));
  // POST, with the operands in a JSON body:
  //   { appname, component, source, destination, overwrite? }
  //
  // Not GET. These create, overwrite and destroy, and a GET may be replayed by
  // a proxy, a retry or a refresh - `overwrite: true` sitting in a URL is a
  // destructive operation waiting to be repeated. Thirty of the /apps/ GET
  // routes in this file are served through apicache, which makes a cached
  // destructive GET one config line away rather than impossible. A path also
  // puts every filename into the access log and the URL length limit.
  //
  // It matches the endpoints that already answer 202 here - imagepreflight,
  // playground and imagecache are all POST - rather than the older file API
  // whose GET shape these otherwise sit beside.
  //
  // `destination` is the full target path INCLUDING the new name, not the
  // parent directory, so copy and move share -T semantics and there is no
  // paste-into versus paste-as ambiguity.
  //
  // All four answer 202 with a jobId to poll at /apps/operations/:jobId. Move
  // included, even though its visible part is a rename: paste is one gesture in
  // a file browser, and cut-paste returning a result while copy-paste returns a
  // job would put two response shapes inside one user action.
  app.post('/apps/moveobject', requireBootSettled, asyncRoute((req, res) => {
    return fileSystemManager.moveAppsObject(req, res);
  }));
  app.post('/apps/copyobject', requireBootSettled, asyncRoute((req, res) => {
    return fileSystemManager.copyAppsObject(req, res);
  }));
  app.post('/apps/compressobject', requireBootSettled, asyncRoute((req, res) => {
    return fileSystemManager.compressAppsObject(req, res);
  }));
  app.post('/apps/extractobject', requireBootSettled, asyncRoute((req, res) => {
    return fileSystemManager.extractAppsObject(req, res);
  }));
  app.get('/apps/downloadfile/:appname?/:component?/:file?', asyncRoute((req, res) => {
    return fileSystemManager.downloadAppsFile(req, res);
  }));
  app.get('/apps/downloadfolder/:appname?/:component?/:folder?', asyncRoute((req, res) => {
    return fileSystemManager.downloadAppsFolder(req, res);
  }));
  app.get('/explorer/issynced', cache('30 seconds'), asyncRoute((req, res) => {
    return explorerService.isExplorerSynced(req, res);
  }));

  app.get('/flux/eventstream', asyncRoute((req, res) => {
    return fluxEventBus.sseHandler(req, res);
  }));

  // Cadence, read rather than streamed - see the rule at the top of
  // fluxEventBus.js. 404s in production, like the stream above.
  app.get('/flux/testcounters', asyncRoute((req, res) => {
    return fluxEventBus.countersHandler(req, res);
  }));
};
