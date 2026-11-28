/**
 * The v1 route table: every route as data, registered by routeBuilder.
 *
 * A route is its method and path, its guards (by name), its cache, its limit
 * (by name), and its handler: a service module and the name of the function in
 * it that answers. routeBuilder registers guards, then the cache, then the
 * limit, then the handler, and calls the module's function by name on each
 * request.
 */

const daemonServiceAddressRpcs = require('./services/daemonService/daemonServiceAddressRpcs');
const daemonServiceTransactionRpcs = require('./services/daemonService/daemonServiceTransactionRpcs');
const daemonServiceBlockchainRpcs = require('./services/daemonService/daemonServiceBlockchainRpcs');
const daemonServiceBenchmarkRpcs = require('./services/daemonService/daemonServiceBenchmarkRpcs');
const daemonServiceMiningRpcs = require('./services/daemonService/daemonServiceMiningRpcs');
const daemonServiceNetworkRpcs = require('./services/daemonService/daemonServiceNetworkRpcs');
const daemonServiceNodeRpcs = require('./services/daemonService/daemonServiceFluxnodeRpcs');
const daemonServiceUtilityRpcs = require('./services/daemonService/daemonServiceUtilityRpcs');
const daemonServiceControlRpcs = require('./services/daemonService/daemonServiceControlRpcs');
const benchmarkService = require('./services/benchmarkService');
const idService = require('./services/idService');
const nodeHealthService = require('./services/nodeHealthService');
const fluxService = require('./services/fluxService');
const fluxCommunication = require('./services/fluxCommunication');
const fluxshareService = require('./services/fluxshareService');
const paymentRelayService = require('./services/paymentRelayService');
const fluxCommunicationMessagesSender = require('./services/fluxCommunicationMessagesSender');
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
const permanentMessageLog = require('./services/appMessaging/permanentMessageLog');
const monitoringOrchestrator = require('./services/appMonitoring/monitoringOrchestrator');
const systemIntegration = require('./services/appSystem/systemIntegration');
const explorerService = require('./services/explorerService');
const generalService = require('./services/generalService');
const upnpService = require('./services/upnpService');
const syncthingService = require('./services/syncthingService');
const fluxNetworkHelper = require('./services/fluxNetworkHelper');
const portManager = require('./services/appNetwork/portManager');
const peerIdentityService = require('./services/peerIdentityService');
const outboundPathService = require('./services/outboundPathService');
const enterpriseNodesService = require('./services/enterpriseNodesService');
const backupRestoreService = require('./services/backupRestoreService');
const appTamperingDetectionService = require('./services/appTamperingDetectionService');
const uplinkService = require('./services/uplinkService');
const kernelService = require('./services/kernelService');
const fluxEventBus = require('./services/utils/fluxEventBus');

module.exports = [
  // GET PUBLIC methods
  { method: 'get', path: '/daemon/help/:command?', cache: '1 hour', module: daemonServiceControlRpcs, fn: 'help' }, // accept both help/command and ?command=getinfo. If ommited, default help will be displayed. Other calls works in similar way
  { method: 'get', path: '/daemon/getinfo', module: daemonServiceControlRpcs, fn: 'getInfo' },
  { method: 'get', path: '/daemon/getfluxnodestatus', cache: '60 seconds', module: daemonServiceNodeRpcs, fn: 'getFluxNodeStatusApi' },
  { method: 'get', path: '/daemon/getzelnodestatus', cache: '60 seconds', module: daemonServiceNodeRpcs, fn: 'getFluxNodeStatusApi' }, // DEPRECATED
  { method: 'get', path: '/daemon/listfluxnodes/:filter?', cache: '30 seconds', module: daemonServiceNodeRpcs, fn: 'listFluxNodes' },
  { method: 'get', path: '/daemon/listzelnodes/:filter?', cache: '30 seconds', module: daemonServiceNodeRpcs, fn: 'listFluxNodes' }, // DEPRECATED
  { method: 'get', path: '/daemon/viewdeterministicfluxnodelist/:filter?', cache: '30 seconds', module: daemonServiceNodeRpcs, fn: 'listFluxNodes' },
  { method: 'get', path: '/daemon/viewdeterministiczelnodelist/:filter?', cache: '30 seconds', module: daemonServiceNodeRpcs, fn: 'listFluxNodes' }, // DEPRECATED
  { method: 'get', path: '/daemon/getfluxnodecount', cache: '30 seconds', module: daemonServiceNodeRpcs, fn: 'getFluxNodeCount' },
  { method: 'get', path: '/daemon/getzelnodecount', cache: '30 seconds', module: daemonServiceNodeRpcs, fn: 'getFluxNodeCount' }, // DEPRECATED
  { method: 'get', path: '/daemon/getdoslist', cache: '30 seconds', module: daemonServiceNodeRpcs, fn: 'getDOSList' },
  { method: 'get', path: '/daemon/getstartlist', cache: '30 seconds', module: daemonServiceNodeRpcs, fn: 'getStartList' },
  { method: 'get', path: '/daemon/fluxnodecurrentwinner', cache: '30 seconds', module: daemonServiceNodeRpcs, fn: 'fluxNodeCurrentWinner' },
  { method: 'get', path: '/daemon/getbestblockhash', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'getBestBlockHash' },
  { method: 'get', path: '/daemon/getblock/:hashheight?/:verbosity?', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'getBlock' },
  { method: 'get', path: '/daemon/getblockchaininfo', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'getBlockchainInfo' },
  { method: 'get', path: '/daemon/getblockcount', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'getBlockCount' },
  { method: 'get', path: '/daemon/getblockdeltas/:hash?', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'getBlockDeltas' },
  { method: 'get', path: '/daemon/getblockhashes/:high?/:low?/:noorphans?/:logicaltimes?', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'getBlockHashes' },
  { method: 'get', path: '/daemon/getblockhash/:index?', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'getBlockHash' },
  { method: 'get', path: '/daemon/getblockheader/:hash?/:verbose?', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'getBlockHeader' },
  { method: 'get', path: '/daemon/getdifficulty', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'getDifficulty' },
  { method: 'get', path: '/daemon/getmempoolinfo', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'getMempoolInfo' },
  { method: 'get', path: '/daemon/getrawmempool/:verbose?', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'getRawMemPool' },
  { method: 'get', path: '/daemon/gettxout/:txid?/:n?/:includemempool?', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'getTxOut' },
  { method: 'get', path: '/daemon/gettxoutproof/:txids?/:blockhash?', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'getTxOutProof' }, // comma separated list of txids. For example: /gettxoutproof/abc,efg,asd/blockhash
  { method: 'get', path: '/daemon/gettxoutsetinfo', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'getTxOutSetInfo' },
  { method: 'get', path: '/daemon/verifytxoutproof/:proof?', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'verifyTxOutProof' },
  { method: 'get', path: '/daemon/getspentinfo/:txid?/:index?', cache: '30 seconds', module: daemonServiceBlockchainRpcs, fn: 'getSpentInfo' },
  { method: 'get', path: '/daemon/getblocksubsidy/:height?', cache: '30 seconds', module: daemonServiceMiningRpcs, fn: 'getBlockSubsidy' },
  { method: 'get', path: '/daemon/getblocktemplate/:jsonrequestobject?', cache: '30 seconds', module: daemonServiceMiningRpcs, fn: 'getBlockTemplate' },
  { method: 'get', path: '/daemon/getlocalsolps', cache: '30 seconds', module: daemonServiceMiningRpcs, fn: 'getLocalSolPs' },
  { method: 'get', path: '/daemon/getmininginfo', cache: '30 seconds', module: daemonServiceMiningRpcs, fn: 'getMiningInfo' },
  { method: 'get', path: '/daemon/getnetworkhashps/:blocks?/:height?', cache: '30 seconds', module: daemonServiceMiningRpcs, fn: 'getNetworkHashPs' },
  { method: 'get', path: '/daemon/getnetworksolps/:blocks?/:height?', cache: '30 seconds', module: daemonServiceMiningRpcs, fn: 'getNetworkSolPs' },
  { method: 'get', path: '/daemon/getconnectioncount', cache: '30 seconds', module: daemonServiceNetworkRpcs, fn: 'getConnectionCount' },
  { method: 'get', path: '/daemon/getdeprecationinfo', cache: '30 seconds', module: daemonServiceNetworkRpcs, fn: 'getDeprecationInfo' },
  { method: 'get', path: '/daemon/getnettotals', cache: '30 seconds', module: daemonServiceNetworkRpcs, fn: 'getNetTotals' },
  { method: 'get', path: '/daemon/getnetworkinfo', cache: '30 seconds', module: daemonServiceNetworkRpcs, fn: 'getNetworkInfo' },
  { method: 'get', path: '/daemon/getpeerinfo', cache: '30 seconds', module: daemonServiceNetworkRpcs, fn: 'getPeerInfo' },
  { method: 'get', path: '/daemon/listbanned', cache: '30 seconds', module: daemonServiceNetworkRpcs, fn: 'listBanned' },
  { method: 'get', path: '/daemon/createrawtransaction/:transactions?/:addresses?/:locktime?/:expiryheight?', module: daemonServiceTransactionRpcs, fn: 'createRawTransaction' },
  { method: 'get', path: '/daemon/decoderawtransaction/:hexstring?', cache: '30 seconds', module: daemonServiceTransactionRpcs, fn: 'decodeRawTransaction' },
  { method: 'get', path: '/daemon/decodescript/:hex?', cache: '30 seconds', module: daemonServiceTransactionRpcs, fn: 'decodeScript' },
  { method: 'get', path: '/daemon/getrawtransaction/:txid?/:verbose?', module: daemonServiceTransactionRpcs, fn: 'getRawTransaction' },
  { method: 'get', path: '/daemon/sendrawtransaction/:hexstring?/:allowhighfees?', module: daemonServiceTransactionRpcs, fn: 'sendRawTransaction' },
  { method: 'get', path: '/daemon/getaddresstxids/:address?/:start?/:end?', module: daemonServiceAddressRpcs, fn: 'getSingleAddresssTxids' },
  { method: 'get', path: '/daemon/getaddressbalance/:address?', module: daemonServiceAddressRpcs, fn: 'getSingleAddressBalance' },
  { method: 'get', path: '/daemon/getaddressdeltas/:address?/:start?/:end?/:chaininfo?', module: daemonServiceAddressRpcs, fn: 'getSingleAddressDeltas' },
  { method: 'get', path: '/daemon/getaddressutxos/:address?/:chaininfo?', module: daemonServiceAddressRpcs, fn: 'getSingleAddressUtxos' },
  { method: 'get', path: '/daemon/getaddressmempool/:address?', module: daemonServiceAddressRpcs, fn: 'getSingleAddressMempool' },
  { method: 'get', path: '/daemon/createmultisig/:n?/:keys?', module: daemonServiceUtilityRpcs, fn: 'createMultiSig' },
  { method: 'get', path: '/daemon/estimatefee/:nblocks?', cache: '30 seconds', module: daemonServiceUtilityRpcs, fn: 'estimateFee' },
  { method: 'get', path: '/daemon/estimatepriority/:nblocks?', cache: '30 seconds', module: daemonServiceUtilityRpcs, fn: 'estimatePriority' },
  { method: 'get', path: '/daemon/validateaddress/:fluxaddress?', module: daemonServiceUtilityRpcs, fn: 'validateAddress' },
  { method: 'get', path: '/daemon/verifymessage/:fluxaddress?/:signature?/:message?', cache: '30 seconds', module: daemonServiceUtilityRpcs, fn: 'verifyMessage' },
  { method: 'get', path: '/daemon/zvalidateaddress/:zaddr?', cache: '30 seconds', module: daemonServiceUtilityRpcs, fn: 'zValidateAddress' },
  { method: 'get', path: '/daemon/getbenchmarks', cache: '30 seconds', module: daemonServiceBenchmarkRpcs, fn: 'getBenchmarks' },
  { method: 'get', path: '/daemon/getbenchstatus', cache: '30 seconds', module: daemonServiceBenchmarkRpcs, fn: 'getBenchStatus' },
  { method: 'get', path: '/id/loginphrase', module: idService, fn: 'loginPhrase' },
  { method: 'get', path: '/id/emergencyphrase', module: idService, fn: 'emergencyPhrase' },
  { method: 'get', path: '/zelid/loginphrase', module: idService, fn: 'loginPhrase' }, // DEPRECATED
  { method: 'get', path: '/zelid/emergencyphrase', module: idService, fn: 'emergencyPhrase' }, // DEPRECATED
  { method: 'get', path: '/flux/nodetier', cache: '30 seconds', module: fluxService, fn: 'getNodeTier' },
  { method: 'get', path: '/flux/info', guards: ['requireDatabase'], cache: '60 seconds', module: fluxService, fn: 'getFluxInfo' },
  { method: 'get', path: '/flux/timezone', module: fluxService, fn: 'getFluxTimezone' },
  { method: 'get', path: '/flux/version', cache: '30 seconds', module: fluxService, fn: 'getFluxVersion' },
  { method: 'get', path: '/flux/nodejsversions', cache: '30 seconds', module: fluxService, fn: 'getNodeJsVersions' },
  { method: 'get', path: '/flux/ip', cache: '30 seconds', module: fluxService, fn: 'getFluxIP' },
  { method: 'get', path: '/flux/staticip', cache: '30 seconds', module: fluxService, fn: 'isStaticIPapi' },
  { method: 'get', path: '/flux/geolocation', cache: '30 seconds', module: fluxService, fn: 'getFluxGeolocation' },
  // Uncached: the answer depends on who is asking.
  { method: 'get', path: '/flux/uplink', guards: ['rejectQueryParameters'], module: uplinkService, fn: 'uplinkAPI' },
  { method: 'get', path: '/flux/kernel', guards: ['rejectQueryParameters'], cache: '60 seconds', module: kernelService, fn: 'kernelAPI' },
  { method: 'get', path: '/flux/zelid', cache: '30 seconds', module: fluxService, fn: 'getFluxZelID' }, // DEPERCATED
  { method: 'get', path: '/flux/id', cache: '30 seconds', module: fluxService, fn: 'getFluxZelID' },
  { method: 'get', path: '/flux/fluxids', cache: '30 seconds', module: fluxService, fn: 'getFluxIds' },
  { method: 'get', path: '/flux/pgp', cache: '30 seconds', module: fluxService, fn: 'getFluxPGPidentity' },
  { method: 'get', path: '/flux/kadena', cache: '30 seconds', module: fluxService, fn: 'getFluxKadena' },
  { method: 'get', path: '/flux/routerip', cache: '1 day', module: fluxService, fn: 'getRouterIP' },
  { method: 'get', path: '/flux/apiport', module: fluxService, fn: 'getAPIPort' },
  { method: 'get', path: '/flux/enterpriseappowners', cache: '1 hour', module: fluxService, fn: 'getEnterpriseAppOwners' },
  { method: 'get', path: '/flux/marketplaceurl', cache: '1 day', module: fluxService, fn: 'getMarketplaceURL' },
  { method: 'get', path: '/flux/restart', module: fluxService, fn: 'restartFluxOS' },
  { method: 'get', path: '/flux/dosstate', cache: '30 seconds', module: fluxNetworkHelper, fn: 'getDOSState' },
  { method: 'get', path: '/flux/health', cache: '30 seconds', module: nodeHealthService, fn: 'nodeHealth' },
  { method: 'post', path: '/flux/dosstate', module: fluxNetworkHelper, fn: 'setDOSStateApi' },
  // New peer endpoints
  { method: 'get', path: '/flux/peers/:filter?', cache: '30 seconds', module: fluxCommunication, fn: 'getPeers' },
  { method: 'get', path: '/flux/unstablenodes', cache: '30 seconds', module: fluxCommunication, fn: 'getUnstableNodes' },
  { method: 'get', path: '/flux/peerhistory', module: fluxCommunication, fn: 'getPeerHistory' },
  { method: 'get', path: '/flux/topology', cache: '5 seconds', module: fluxCommunication, fn: 'getTopology' },
  { method: 'get', path: '/flux/networkhealth', cache: '5 seconds', module: fluxCommunication, fn: 'getNetworkHealth' },
  { method: 'get', path: '/flux/networkpaths', module: fluxCommunication, fn: 'getNetworkPaths' },
  // Deprecated peer endpoints — kept for backward compatibility
  { method: 'get', path: '/flux/connectedpeers', cache: '30 seconds', module: fluxCommunication, fn: 'connectedPeers' },
  { method: 'get', path: '/flux/connectedpeersinfo', cache: '30 seconds', module: fluxCommunication, fn: 'connectedPeersInfo' },
  { method: 'get', path: '/flux/incomingconnections', cache: '30 seconds', module: fluxNetworkHelper, fn: 'getIncomingConnections' },
  { method: 'get', path: '/flux/incomingconnectionsinfo', cache: '30 seconds', module: fluxNetworkHelper, fn: 'getIncomingConnectionsInfo' },
  // Not cached: the answer is whether this node lists the address and reaches it
  // now, and the nodes that ask act on it.
  { method: 'get', path: '/flux/checkfluxavailability/:ip?/:port?', module: fluxNetworkHelper, fn: 'checkFluxAvailability' },
  { method: 'post', path: '/flux/checkappavailability', module: fluxNetworkHelper, fn: 'checkAppAvailability' },
  { method: 'post', path: '/flux/keepupnpportsopen', module: fluxNetworkHelper, fn: 'keepUPNPPortsOpen' },
  // POST because the ask carries a signature, which makes it a body and not a
  // URL. No cache() follows from that: apicache keys on the URL alone, so it
  // would answer every different ask alike and answer it before the handler ran
  // - and it caches only GETs regardless. portsInUse caches the value instead.
  // No rejectQueryParameters, because with the ask in the body there is no URL
  // surface for a query string to reach.
  //
  // What this endpoint is for, who may call it and why it is signed is on
  // portsInUseApi, with the code that enforces it.
  { method: 'post', path: '/flux/portsinuse', module: portManager, fn: 'portsInUseApi' },
  // Which node this is, signed over the caller's challenge. POST because the
  // challenge is a body, and uncached because every answer is to one challenge:
  // a cached one would be a recording, which is what the challenge exists to
  // refuse.
  { method: 'post', path: '/flux/identity', module: peerIdentityService, fn: 'identityAnswerAPI' },
  // Whether this node's calls to other nodes reach them. Served from the state
  // the scheduled check holds, so a request does no work.
  { method: 'get', path: '/flux/outboundpath', guards: ['rejectQueryParameters'], module: outboundPathService, fn: 'outboundPathAPI' },
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
  { method: 'get', path: '/apps/listrunningapps', cache: '15 seconds', module: appQueryService, fn: 'listRunningAppsApi' },
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
  { method: 'get', path: '/apps/heldcomponents', guards: ['rejectQueryParameters'], cache: '1 second', module: appQueryService, fn: 'heldComponents' },
  // The same list signed for the caller, over the challenge its body carries, so
  // the caller can show that the node it dialled is the node that answered. Not
  // cached here: each answer is for one call, and the handler bounds the docker
  // read behind it instead.
  { method: 'post', path: '/apps/heldcomponents', module: appQueryService, fn: 'heldComponentsAnswer' },
  // promotedfolders needs no cache: it is served from the set the syncthing monitor
  // already refreshes each pass, so the request touches nothing. Guarded on the
  // same terms as its neighbour - it takes no parameters either, and the two are
  // read by the same callers on the same path.
  { method: 'get', path: '/apps/promotedfolders', guards: ['rejectQueryParameters'], module: appQueryService, fn: 'promotedFolders' },
  // The same answer with what each receive-only folder HOLDS, which is a size and a
  // last-write time per app and therefore the tenant's. A caller signs as a node on the
  // deterministic list, or holds Flux team privilege; one that does neither is answered
  // without it rather than refused, because a peer too old to sign is not doing anything
  // wrong. POST because a signature needs a body to be over. Signed back over the
  // challenge the body carries, as heldcomponents is.
  { method: 'post', path: '/apps/promotedfolders', module: appQueryService, fn: 'promotedFolderHoldings' },
  // Answers a node or the Flux team, on the terms of the holdings above, so it takes no
  // cache either.
  { method: 'post', path: '/apps/folderrecords', module: appQueryService, fn: 'folderRecords' },
  { method: 'get', path: '/apps/listallapps', cache: '30 seconds', module: appQueryService, fn: 'listAllAppsApi' },
  // Answers the flux team, so it takes no cache: apicache keys an entry on the
  // request URL alone and serves it before the handler runs, which would hand
  // one authorised answer to every caller after it.
  { method: 'get', path: '/apps/listappsimages', module: appInspector, fn: 'listAppsImagesApi' },
  { method: 'get', path: '/apps/installedapps/:appname?', cache: '30 seconds', module: appQueryService, fn: 'installedApps' },
  { method: 'get', path: '/apps/availableapps', cache: '30 seconds', module: registryManager, fn: 'availableApps' },
  { method: 'get', path: '/apps/fluxusage', cache: '30 seconds', module: resourceQueryService, fn: 'fluxUsage' },
  { method: 'get', path: '/apps/appsresources', cache: '30 seconds', module: resourceQueryService, fn: 'appsResourcesApi' },
  { method: 'get', path: '/apps/registrationinformation', cache: '30 seconds', module: registryManager, fn: 'registrationInformation' },
  { method: 'get', path: '/apps/temporarymessages/:hash?', cache: '5 seconds', module: messageVerifier, fn: 'getAppsTemporaryMessages' },
  { method: 'get', path: '/apps/permanentmessages/:hash?/:owner?/:appname?', cache: '2 minutes', limit: 'permanentMessageQuery', module: messageVerifier, fn: 'getAppsPermanentMessages' },
  // Streamed from the database as it is read, so it takes no cache: an entry would hold the whole
  // body in memory.
  { method: 'get', path: '/apps/permanentmessagesbyheight', limit: 'permanentMessageLog', module: permanentMessageLog, fn: 'getPermanentMessagesByHeightAPI' },
  { method: 'get', path: '/apps/globalappsspecifications/:hash?/:owner?/:appname?', guards: ['requireRegistryReady'], cache: '30 seconds', module: registryManager, fn: 'getGlobalAppsSpecifications' },
  { method: 'get', path: '/apps/latestspecificationversion', cache: '5 minutes', module: appQueryService, fn: 'getlatestApplicationSpecificationAPI' },
  // Not cached. apicache keys an entry on the URL alone and answers from it
  // before the handler runs, so a privilege-checked route behind one hands the
  // first caller's response to the next without checking them at all. This
  // route's response is also built for one caller in particular - the payload is
  // encrypted to a session key they supply in a header - so there is nothing in
  // it another caller could use even if it were shared.
  { method: 'get', path: '/apps/updatetolatestspecs/:appname', module: registryManager, fn: 'updateApplicationSpecificationAPI' },
  { method: 'get', path: '/apps/appspecifications/:appname/:decrypt?', guards: ['requireRegistryReady'], module: registryManager, fn: 'getApplicationSpecificationAPI' },
  // Component names and their election mode, for the flux team. Not cached: the
  // answer depends on who is asking, and a shared cache in front of a
  // privilege-checked route serves one caller's answer to the next.
  { method: 'get', path: '/apps/appcomponentnames/:appname?', guards: ['requireRegistryReady'], module: registryManager, fn: 'getApplicationComponentNamesAPI' },
  { method: 'get', path: '/apps/appowner/:appname?', guards: ['requireRegistryReady'], cache: '30 seconds', module: registryManager, fn: 'getApplicationOwnerAPI' },
  { method: 'get', path: '/apps/apporiginalowner/:appname?', cache: '30 seconds', module: appQueryService, fn: 'getApplicationOriginalOwner' },
  { method: 'get', path: '/apps/messagescount/:appowner?', cache: '30 seconds', module: appQueryService, fn: 'getAppsMessagesCount' },
  { method: 'get', path: '/apps/hashes', cache: '30 seconds', module: registryManager, fn: 'getAppHashes' },
  { method: 'get', path: '/apps/registrystatus', guards: ['rejectQueryParameters'], cache: '10 seconds', module: registryManager, fn: 'getRegistryStatus' },
  { method: 'get', path: '/apps/location/:appname?', guards: ['requireAppStateReady'], cache: '30 seconds', module: registryManager, fn: 'getAppsLocation' },
  { method: 'get', path: '/apps/locations', guards: ['requireAppStateReady'], cache: '30 seconds', module: registryManager, fn: 'getAppsLocations' },
  { method: 'get', path: '/apps/installinglocation/:appname?', guards: ['requireAppStateReady'], cache: '30 seconds', module: registryManager, fn: 'getAppInstallingLocation' },
  { method: 'get', path: '/apps/installinglocations', guards: ['requireAppStateReady'], cache: '30 seconds', module: appQueryService, fn: 'getAppsInstallingLocations' },
  { method: 'get', path: '/apps/installingerrorslocation/:appname?', guards: ['requireAppStateReady'], cache: '30 seconds', module: registryManager, fn: 'getAppInstallingErrorsLocation' },
  { method: 'get', path: '/apps/installingerrorslocations', guards: ['requireAppStateReady'], cache: '30 seconds', module: registryManager, fn: 'getAppsInstallingErrorsLocations' },
  { method: 'post', path: '/apps/calculateprice', guards: ['refuseBannedCaller'], module: appSpecHelpers, fn: 'getAppPrice' }, // returns price in flux for both new registration of app and update of app
  { method: 'post', path: '/apps/calculatefiatandfluxprice', guards: ['refuseBannedCaller'], module: appSpecHelpers, fn: 'getAppFiatAndFluxPrice' }, // returns price in usd and flux for both new registration of app and update of app
  { method: 'get', path: '/apps/whitelistedrepositories', cache: '30 seconds', module: generalService, fn: 'whitelistedRepositories' }, // deprecated: whitelist retired, always returns []
  { method: 'post', path: '/apps/verifyappregistrationspecifications', guards: ['refuseBannedCaller'], module: appValidator, fn: 'verifyAppRegistrationParameters' }, // returns formatted app specifications
  { method: 'post', path: '/apps/verifyappupdatespecifications', guards: ['refuseBannedCaller'], module: appValidator, fn: 'verifyAppUpdateApi' }, // returns formatted app specifications
  { method: 'post', path: '/apps/placementfeasibility', guards: ['refuseBannedCaller'], module: placementFeasibility, fn: 'placementFeasibilityAPI' }, // fault domains and per-domain instance share for a prospective spec
  { method: 'get', path: '/apps/placementlocations', guards: ['rejectQueryParameters'], cache: '30 seconds', module: placementFeasibility, fn: 'placementLocationsAPI' }, // node, fault-domain and tier counts per continent/country
  { method: 'get', path: '/apps/deploymentinformation', cache: '30 seconds', module: deploymentInfoService, fn: 'deploymentInformation' },
  { method: 'get', path: '/apps/enterprisenodes', cache: '30 seconds', module: enterpriseNodesService, fn: 'getEnterpriseNodesAPI' },
  { method: 'get', path: '/apps/getappspecsusdprice', cache: '30 minutes', module: deploymentInfoService, fn: 'getAppSpecsUSDPrice' },
  { method: 'get', path: '/apps/tamperingevents/:appname?', cache: '30 seconds', module: appTamperingDetectionService, fn: 'getEvents' },
  // app.get('/explorer/allutxos', (req, res) => {
  //   explorerService.getAllUtxos(req, res);
  // });
  // app.get('/explorer/alladdresseswithtransactions', (req, res) => {
  //   explorerService.getAllAddressesWithTransactions(req, res);
  // });
  // app.get('/explorer/alladdresses', (req, res) => {
  //   explorerService.getAllAddresses(req, res);
  // });
  { method: 'get', path: '/explorer/utxo/:address?', cache: '30 seconds', module: explorerService, fn: 'getAddressUtxos' },
  { method: 'get', path: '/explorer/transactions/:address?', cache: '30 seconds', module: explorerService, fn: 'getAddressTransactions' },
  { method: 'get', path: '/explorer/balance/:address?', cache: '30 seconds', module: explorerService, fn: 'getAddressBalance' },
  { method: 'get', path: '/explorer/scannedheight', cache: '30 seconds', module: explorerService, fn: 'getScannedHeight' },
  // app.get('/explorer/fusion/coinbase/all', cache('30 seconds'), (req, res) => {
  //   explorerService.getAllFusionCoinbase(req, res);
  // });
  { method: 'get', path: '/explorer/fusion/coinbase/:address?', cache: '30 seconds', module: explorerService, fn: 'getAddressFusionCoinbase' }, // deprecated
  // GET PROTECTED API - Node operator or flux team level
  { method: 'get', path: '/daemon/prioritisetransaction/:txid?/:prioritydelta?/:feedelta?', module: daemonServiceMiningRpcs, fn: 'prioritiseTransaction' },
  // GET PROTECTED API - User level
  { method: 'get', path: '/daemon/submitblock/:hexdata?/:jsonparametersobject?', module: daemonServiceMiningRpcs, fn: 'submitBlock' },
  { method: 'get', path: '/id/loggedsessions', module: idService, fn: 'loggedSessions' },
  { method: 'get', path: '/id/logoutcurrentsession', module: idService, fn: 'logoutCurrentSession' },
  { method: 'get', path: '/id/logoutallsessions', module: idService, fn: 'logoutAllSessions' },
  { method: 'get', path: '/zelid/loggedsessions', module: idService, fn: 'loggedSessions' }, // DEPRECATED
  { method: 'get', path: '/zelid/logoutcurrentsession', module: idService, fn: 'logoutCurrentSession' }, // DEPRECATED
  { method: 'get', path: '/zelid/logoutallsessions', module: idService, fn: 'logoutAllSessions' }, // DEPRECATED
  { method: 'get', path: '/benchmark/getstatus', cache: '30 seconds', module: benchmarkService, fn: 'getStatus' },
  { method: 'get', path: '/benchmark/help/:command?', cache: '1 hour', module: benchmarkService, fn: 'help' },
  { method: 'get', path: '/benchmark/getbenchmarks', cache: '30 seconds', module: benchmarkService, fn: 'getBenchmarks' },
  { method: 'get', path: '/benchmark/getstoredbenchmark', cache: '1 hour', module: benchmarkService, fn: 'getStoredBenchmark' },
  { method: 'get', path: '/benchmark/getinfo', cache: '30 seconds', module: benchmarkService, fn: 'getInfo' },
  { method: 'get', path: '/syncthing/deviceid', cache: '30 seconds', module: syncthingService, fn: 'getDeviceIdApi' },
  // BACKUP & RESTORE
  { method: 'get', path: '/backup/getvolumedataofcomponent/:appname?/:component?/:multiplier?/:decimal?/:fields?', module: backupRestoreService, fn: 'getVolumeDataOfComponent' },
  { method: 'get', path: '/backup/getremotefilesize/:fileurl?/:multiplier?/:decimal?/:number?/:appname?', module: backupRestoreService, fn: 'getRemoteFileSize' },
  { method: 'get', path: '/backup/getlocalbackuplist/:path?/:multiplier?/:decimal?/:number?/:appname?', module: backupRestoreService, fn: 'getLocalBackupList' },
  { method: 'get', path: '/backup/removebackupfile/:filepath?/:appname?', module: backupRestoreService, fn: 'removeBackupFile' },
  { method: 'get', path: '/backup/downloadlocalfile/:filepath?/:appname?', module: backupRestoreService, fn: 'downloadLocalFile' },
  { method: 'post', path: '/apps/appendbackuptask', module: advancedWorkflows, fn: 'appendBackupTask' },
  { method: 'post', path: '/apps/appendrestoretask', module: advancedWorkflows, fn: 'appendRestoreTask' },
  { method: 'post', path: '/ioutils/fileupload/:type?/:appname?/:component?/:folder?/:filename?', guards: ['requireBootSettled'], module: fileSystemManager, fn: 'uploadAppsFiles' },
  // GET PROTECTED API - Fluxnode Owner
  { method: 'get', path: '/daemon/stop', module: fluxService, fn: 'stopDaemon' },
  { method: 'get', path: '/daemon/reindex', module: fluxService, fn: 'reindexDaemon' },
  { method: 'get', path: '/daemon/createfluxnodekey', module: daemonServiceNodeRpcs, fn: 'createFluxNodeKey' },
  { method: 'get', path: '/daemon/createzelnodekey', module: daemonServiceNodeRpcs, fn: 'createFluxNodeKey' }, // DEPRECATED
  { method: 'get', path: '/daemon/listfluxnodeconf/:filter?', module: daemonServiceNodeRpcs, fn: 'listFluxNodeConf' },
  { method: 'get', path: '/daemon/listzelnodeconf/:filter?', module: daemonServiceNodeRpcs, fn: 'listFluxNodeConf' }, // DEPRECATED
  { method: 'get', path: '/daemon/getfluxnodeoutputs', module: daemonServiceNodeRpcs, fn: 'getFluxNodeOutputs' },
  { method: 'get', path: '/daemon/getzelnodeoutputs', module: daemonServiceNodeRpcs, fn: 'getFluxNodeOutputs' }, // DEPRECATED
  { method: 'get', path: '/daemon/startfluxnode/:set?/:lockwallet?/:alias?', module: daemonServiceNodeRpcs, fn: 'startFluxNode' },
  { method: 'get', path: '/daemon/startzelnode/:set?/:lockwallet?/:alias?', module: daemonServiceNodeRpcs, fn: 'startFluxNode' }, // DEPRECATED
  { method: 'get', path: '/daemon/startdeterministicfluxnode/:alias?/:lockwallet?', module: daemonServiceNodeRpcs, fn: 'startDeterministicFluxNode' },
  { method: 'get', path: '/daemon/startdeterministiczelnode/:alias?/:lockwallet?', module: daemonServiceNodeRpcs, fn: 'startDeterministicFluxNode' }, // DEPRECATED
  { method: 'get', path: '/daemon/verifychain/:checklevel?/:numblocks?', module: daemonServiceBlockchainRpcs, fn: 'verifyChain' },
  { method: 'get', path: '/daemon/addnode/:node?/:command?', module: daemonServiceNetworkRpcs, fn: 'addNode' },
  { method: 'get', path: '/daemon/clearbanned', module: daemonServiceNetworkRpcs, fn: 'clearBanned' },
  { method: 'get', path: '/daemon/disconnectnode/:node?', module: daemonServiceNetworkRpcs, fn: 'disconnectNode' },
  { method: 'get', path: '/daemon/getaddednodeinfo/:dns?/:node?', module: daemonServiceNetworkRpcs, fn: 'getAddedNodeInfo' },
  { method: 'get', path: '/daemon/setban/:ip?/:command?/:bantime?/:absolute?', module: daemonServiceNetworkRpcs, fn: 'setBan' },
  { method: 'get', path: '/id/loggedusers', module: idService, fn: 'loggedUsers' },
  { method: 'get', path: '/id/activeloginphrases', module: idService, fn: 'activeLoginPhrases' },
  { method: 'get', path: '/id/logoutallusers', module: idService, fn: 'logoutAllUsers' },
  { method: 'get', path: '/zelid/loggedusers', module: idService, fn: 'loggedUsers' }, // DEPRECATED
  { method: 'get', path: '/zelid/activeloginphrases', module: idService, fn: 'activeLoginPhrases' }, // DEPRECATED
  { method: 'get', path: '/zelid/logoutallusers', module: idService, fn: 'logoutAllUsers' }, // DEPRECATED
  { method: 'get', path: '/flux/adjustkadena/:account?/:chainid?', module: fluxService, fn: 'adjustKadenaAccount' }, // note this essentially rebuilds flux use with caution!
  { method: 'get', path: '/flux/adjustrouterip/:routerip?', module: fluxService, fn: 'adjustRouterIP' }, // note this essentially rebuilds flux use with caution!
  { method: 'get', path: '/flux/adjustapiport/:apiport?', module: fluxService, fn: 'adjustAPIPort' }, // note this essentially rebuilds flux use with caution!
  { method: 'get', path: '/flux/reindexdaemon', module: fluxService, fn: 'reindexDaemon' },
  { method: 'get', path: '/benchmark/signfluxnodetransaction/:hexstring?', module: benchmarkService, fn: 'signFluxTransaction' },
  { method: 'get', path: '/benchmark/signzelnodetransaction/:hexstring?', module: benchmarkService, fn: 'signFluxTransaction' }, // DEPRECATED
  { method: 'get', path: '/benchmark/stop', module: fluxService, fn: 'stopBenchmark' },
  // GET PROTECTED API - FluxTeam
  { method: 'get', path: '/daemon/start', module: fluxService, fn: 'startDaemon' },
  { method: 'get', path: '/daemon/restart', module: fluxService, fn: 'restartDaemon' },
  { method: 'get', path: '/daemon/ping', module: daemonServiceNetworkRpcs, fn: 'ping' }, // we do not want this to be issued by anyone.
  { method: 'get', path: '/daemon/startbenchmark', module: fluxService, fn: 'startBenchmarkByDaemon' },
  { method: 'get', path: '/daemon/stopbenchmark', module: fluxService, fn: 'stopBenchmarkByDaemon' },
  { method: 'get', path: '/flux/startbenchmark', module: fluxService, fn: 'startBenchmark' },
  { method: 'get', path: '/flux/restartbenchmark', module: fluxService, fn: 'restartBenchmark' },
  { method: 'get', path: '/flux/startdaemon', module: fluxService, fn: 'startDaemon' },
  { method: 'get', path: '/flux/restartdaemon', module: fluxService, fn: 'restartDaemon' },
  // What this node reports it is running, read from the working tree it was deployed
  // from. A diagnostic for whoever switches the branch below, and only that: it is the
  // node's own account of itself, so it answers what is on disk rather than settling
  // whether that is what should be there.
  { method: 'get', path: '/flux/currentbranch', module: fluxService, fn: 'getCurrentBranchApi' },
  { method: 'get', path: '/flux/currentcommitid', module: fluxService, fn: 'getCurrentCommitIdApi' },
  { method: 'get', path: '/flux/entermaster', module: fluxService, fn: 'enterMasterApi' },
  { method: 'get', path: '/flux/enterdevelopment', module: fluxService, fn: 'enterDevelopmentApi' },
  { method: 'get', path: '/flux/updateflux', module: fluxService, fn: 'updateFlux' }, // method shall be called only if flux version is obsolete.
  { method: 'get', path: '/flux/softupdateflux', module: fluxService, fn: 'softUpdateFluxApi' }, // method shall be called only if flux version is obsolete.
  { method: 'get', path: '/flux/softupdatefluxinstall', module: fluxService, fn: 'softUpdateFluxInstallApi' }, // method shall be called only if flux version is obsolete.
  { method: 'get', path: '/flux/hardupdateflux', module: fluxService, fn: 'hardUpdateFlux' }, // method shall be called only if flux version is obsolete and updatezeflux is not working correctly
  { method: 'get', path: '/flux/rebuildui', module: fluxService, fn: 'rebuildUi' },
  { method: 'get', path: '/flux/updatedaemon', module: fluxService, fn: 'updateDaemon' }, // method shall be called only if daemon version is obsolete
  { method: 'get', path: '/flux/updatebenchmark', module: fluxService, fn: 'updateBenchmark' }, // method shall be called only if benchamrk version is obsolete
  { method: 'get', path: '/flux/daemondebug', module: fluxService, fn: 'daemonDebug' },
  { method: 'get', path: '/flux/benchmarkdebug', module: fluxService, fn: 'benchmarkDebug' },
  { method: 'get', path: '/flux/taildaemondebug', module: fluxService, fn: 'tailDaemonDebug' },
  { method: 'get', path: '/flux/tailbenchmarkdebug', module: fluxService, fn: 'tailBenchmarkDebug' },
  { method: 'get', path: '/flux/errorlog', module: fluxService, fn: 'fluxErrorLog' },
  { method: 'get', path: '/flux/warnlog', module: fluxService, fn: 'fluxWarnLog' },
  { method: 'get', path: '/flux/debuglog', module: fluxService, fn: 'fluxDebugLog' },
  { method: 'get', path: '/flux/infolog', module: fluxService, fn: 'fluxInfoLog' },
  { method: 'get', path: '/flux/tailerrorlog', module: fluxService, fn: 'tailFluxErrorLog' },
  { method: 'get', path: '/flux/tailwarnlog', module: fluxService, fn: 'tailFluxWarnLog' },
  { method: 'get', path: '/flux/taildebuglog', module: fluxService, fn: 'tailFluxDebugLog' },
  { method: 'get', path: '/flux/tailinfolog', module: fluxService, fn: 'tailFluxInfoLog' },
  { method: 'get', path: '/flux/broadcastmessage/:data?', module: fluxCommunicationMessagesSender, fn: 'broadcastMessageFromUser' },
  { method: 'get', path: '/flux/broadcastmessagetooutgoing/:data?', module: fluxCommunicationMessagesSender, fn: 'broadcastMessageToOutgoingFromUser' },
  { method: 'get', path: '/flux/broadcastmessagetoincoming/:data?', module: fluxCommunicationMessagesSender, fn: 'broadcastMessageToIncomingFromUser' },
  { method: 'get', path: '/flux/addpeer/:ip?', module: fluxCommunication, fn: 'addPeer' },
  { method: 'get', path: '/flux/removepeer/:ip?', module: fluxCommunication, fn: 'removePeer' },
  { method: 'get', path: '/flux/addoutgoingpeer/:ip?', module: fluxCommunication, fn: 'addOutgoingPeer' },
  { method: 'get', path: '/flux/removeincomingpeer/:ip?', module: fluxCommunication, fn: 'removeIncomingPeer' },
  { method: 'get', path: '/flux/startdiscovery', module: fluxCommunication, fn: 'startDiscoveryApi' },
  { method: 'get', path: '/flux/allowport/:port?', module: fluxNetworkHelper, fn: 'allowPortApi' },
  { method: 'get', path: '/flux/checkcommunication', module: fluxNetworkHelper, fn: 'isCommunicationEstablished' },
  { method: 'get', path: '/flux/uptime', cache: '30 seconds', module: fluxNetworkHelper, fn: 'fluxUptime' },
  { method: 'get', path: '/flux/systemuptime', cache: '30 seconds', module: fluxNetworkHelper, fn: 'fluxSystemUptime' },
  { method: 'get', path: '/flux/clockdrift', cache: '30 seconds', module: fluxNetworkHelper, fn: 'clockDrift' },
  { method: 'get', path: '/flux/backendfolder', guards: ['isLocal'], module: fluxService, fn: 'fluxBackendFolder' },
  { method: 'get', path: '/flux/mapport/:port?', module: upnpService, fn: 'mapPortApi' },
  { method: 'get', path: '/flux/unmapport/:port?', module: upnpService, fn: 'removeMapPortApi' },
  { method: 'get', path: '/flux/getmap', module: upnpService, fn: 'getMapApi' },
  { method: 'get', path: '/flux/getip', module: upnpService, fn: 'getIpApi' },
  { method: 'get', path: '/flux/getgateway', module: upnpService, fn: 'getGatewayApi' },
  { method: 'get', path: '/flux/isarcaneos', cache: '1 day', module: fluxService, fn: 'isArcaneOs' },
  { method: 'get', path: '/benchmark/start', module: fluxService, fn: 'startBenchmark' },
  { method: 'get', path: '/benchmark/restart', module: fluxService, fn: 'restartBenchmark' },
  { method: 'get', path: '/benchmark/restartnodebenchmarks', module: benchmarkService, fn: 'restartNodeBenchmarks' },
  { method: 'get', path: '/explorer/reindex/:reindexapps?', module: explorerService, fn: 'reindexExplorer' },
  { method: 'get', path: '/explorer/start', module: explorerService, fn: 'startBlockProcessing' },
  { method: 'get', path: '/explorer/restart', module: explorerService, fn: 'restartBlockProcessing' },
  { method: 'get', path: '/explorer/stop', module: explorerService, fn: 'stopBlockProcessing' },
  { method: 'get', path: '/explorer/rescan/:blockheight?/:rescanapps?', module: explorerService, fn: 'rescanExplorer' },
  { method: 'get', path: '/apps/checkhashes', module: appHashSyncService, fn: 'triggerAppHashesCheckAPI' },
  { method: 'get', path: '/apps/requestmessage/:hash', module: messageVerifier, fn: 'requestAppMessageAPI' },
  // Whether each component of an app runs here, and why one does not.
  { method: 'get', path: '/apps/componentstates/:appname?', module: appController, fn: 'componentStates' },
  // App-control routes run alwaysRespond before requireBootSettled, so the boot
  // gate's 503 also carries Cache-Control: no-store.
  { method: 'get', path: '/apps/appstart/:appname?/:global?', guards: ['alwaysRespond', 'requireBootSettled'], module: appController, fn: 'appStart' },
  { method: 'get', path: '/apps/appstop/:appname?/:global?', guards: ['alwaysRespond', 'requireBootSettled'], module: appController, fn: 'appStop' },
  { method: 'get', path: '/apps/apprestart/:appname?/:global?', guards: ['alwaysRespond', 'requireBootSettled'], module: appController, fn: 'appRestart' },
  // No :global - a kill is deliberately per-node. Its privilege is the same as
  // its siblings' above: every run-state verb asks for appownerorfluxteam, so
  // the node operator can order none of them on an app they only host.
  { method: 'get', path: '/apps/appkill/:appname?', guards: ['alwaysRespond', 'requireBootSettled'], module: appController, fn: 'appKill' },
  { method: 'get', path: '/apps/apppause/:appname?/:global?', guards: ['alwaysRespond', 'requireBootSettled'], module: appController, fn: 'appPause' },
  { method: 'get', path: '/apps/appunpause/:appname?/:global?', guards: ['alwaysRespond', 'requireBootSettled'], module: appController, fn: 'appUnpause' },
  { method: 'get', path: '/apps/apptop/:appname?', module: appInspector, fn: 'appTop' },
  { method: 'get', path: '/apps/applog/:appname?/:lines?', module: appInspector, fn: 'appLog' },
  { method: 'get', path: '/apps/applogpolling/:appname?/:lines?/:since?', module: appInspector, fn: 'appLogPolling' },
  { method: 'get', path: '/apps/appinspect/:appname?', module: appInspector, fn: 'appInspect' },
  { method: 'get', path: '/apps/appstats/:appname?', module: appInspector, fn: 'appStats' },
  { method: 'get', path: '/apps/appmonitor/:appname?/:range?', module: appInspector, fn: 'appMonitorAPI' },
  { method: 'get', path: '/apps/appchanges/:appname?', module: appInspector, fn: 'appChanges' },
  { method: 'post', path: '/apps/appexec', module: appInspector, fn: 'appExec' },
  { method: 'get', path: '/apps/appremove/:appname?/:force?/:global?', guards: ['alwaysRespond', 'requireBootSettled'], module: appUninstaller, fn: 'removeAppLocallyApi' },
  { method: 'get', path: '/apps/installapplocally/:appname?', guards: ['requireBootSettled', 'requirePolicyReady'], module: appInstaller, fn: 'installAppLocally' },
  { method: 'get', path: '/apps/testappinstall/:appname?', guards: ['refuseBannedCaller', 'requireBootSettled', 'requirePolicyReady'], module: appInstaller, fn: 'testAppInstall' },
  { method: 'get', path: '/apps/createfluxnetwork', module: systemIntegration, fn: 'createFluxNetworkAPI' },
  { method: 'get', path: '/apps/rescanglobalappsinformation/:blockheight?/:removelastinformation?', module: registryManager, fn: 'rescanGlobalAppsInformationAPI' },
  { method: 'get', path: '/apps/reindexglobalappsinformation', module: registryManager, fn: 'reindexGlobalAppsInformationAPI' },
  { method: 'get', path: '/apps/reindexglobalappslocation', module: registryManager, fn: 'reindexGlobalAppsLocationAPI' },
  { method: 'get', path: '/apps/redeploy/:appname?/:force?/:global?', guards: ['alwaysRespond', 'requireBootSettled', 'requirePolicyReady'], module: advancedWorkflows, fn: 'redeployAPI' },
  { method: 'get', path: '/apps/redeploycomponent/:appname?/:component?/:force?', guards: ['alwaysRespond', 'requireBootSettled', 'requirePolicyReady'], module: advancedWorkflows, fn: 'redeployComponentAPI' },
  { method: 'get', path: '/apps/reconstructhashes', module: registryManager, fn: 'reconstructAppMessagesHashCollectionAPI' },
  // alwaysRespond, like the other retired routes: the body is byte-identical on
  // every call, so express fingerprints it with a strong ETag and any caller that
  // revalidates gets an empty 304 from the second call on. Explaining why the
  // endpoint stopped working is the only job these routes have left, and a repeat
  // caller could never read the explanation.
  { method: 'get', path: '/apps/startmonitoring/:appname?', guards: ['alwaysRespond'], module: monitoringOrchestrator, fn: 'startAppMonitoringAPI' },
  { method: 'get', path: '/apps/stopmonitoring/:appname?/:deletedata?', guards: ['alwaysRespond'], module: monitoringOrchestrator, fn: 'stopAppMonitoringAPI' },
  { method: 'get', path: '/apps/appmonitorstream/:appname?', guards: ['alwaysRespond'], module: monitoringOrchestrator, fn: 'appMonitorStreamAPI' },
  { method: 'get', path: '/syncthing/metrics', module: syncthingService, fn: 'getSyncthingMetrics' },
  { method: 'get', path: '/syncthing/metrics/health', module: syncthingService, fn: 'getSyncthingHealthSummary' },
  { method: 'get', path: '/syncthing/metrics/history/:limit?', module: syncthingService, fn: 'getSyncthingMetricsHistory' },
  { method: 'get', path: '/syncthing/peer/diagnostics', module: syncthingService, fn: 'getPeerSyncDiagnosticsApi' },
  // POST PUBLIC methods route
  { method: 'post', path: '/id/verifylogin', module: idService, fn: 'verifyLogin' },
  { method: 'post', path: '/id/providesign', module: idService, fn: 'provideSign' },
  { method: 'post', path: '/id/checkprivilege', module: idService, fn: 'checkLoggedUser' },
  { method: 'post', path: '/zelid/verifylogin', module: idService, fn: 'verifyLogin' }, // DEPRECATED
  { method: 'post', path: '/zelid/providesign', module: idService, fn: 'provideSign' }, // DEPRECATED
  { method: 'post', path: '/zelid/checkprivilege', module: idService, fn: 'checkLoggedUser' }, // DEPRECATED
  // The rendezvous a wallet posts to, addressed by the sites that open it.
  { method: 'get', path: '/payment/paymentrequest', module: paymentRelayService, fn: 'paymentRequest' },
  { method: 'post', path: '/payment/verifypayment', module: paymentRelayService, fn: 'receivePaymentCallback' },
  { method: 'post', path: '/daemon/createrawtransaction', module: daemonServiceTransactionRpcs, fn: 'createRawTransactionPost' },
  { method: 'post', path: '/daemon/decoderawtransaction', module: daemonServiceTransactionRpcs, fn: 'decodeRawTransactionPost' },
  { method: 'post', path: '/daemon/decodescript', module: daemonServiceTransactionRpcs, fn: 'decodeScriptPost' },
  { method: 'post', path: '/daemon/sendrawtransaction', module: daemonServiceTransactionRpcs, fn: 'sendRawTransactionPost' },
  { method: 'post', path: '/daemon/createmultisig', module: daemonServiceUtilityRpcs, fn: 'createMultiSigPost' },
  { method: 'post', path: '/daemon/verifymessage', module: daemonServiceUtilityRpcs, fn: 'verifyMessagePost' },
  { method: 'post', path: '/daemon/getblockhashes', module: daemonServiceBlockchainRpcs, fn: 'getBlockHashesPost' },
  { method: 'post', path: '/daemon/getspentinfo', module: daemonServiceBlockchainRpcs, fn: 'getSpentInfoPost' },
  { method: 'post', path: '/daemon/getaddresstxids', module: daemonServiceAddressRpcs, fn: 'getAddressTxids' },
  { method: 'post', path: '/daemon/getaddressbalance', module: daemonServiceAddressRpcs, fn: 'getAddressBalance' },
  { method: 'post', path: '/daemon/getaddressdeltas', module: daemonServiceAddressRpcs, fn: 'getAddressDeltas' },
  { method: 'post', path: '/daemon/getaddressutxos', module: daemonServiceAddressRpcs, fn: 'getAddressUtxos' },
  { method: 'post', path: '/daemon/getaddressmempool', module: daemonServiceAddressRpcs, fn: 'getAddressMempool' },
  { method: 'get', path: '/flux/streamchainpreparation', module: fluxService, fn: 'streamChainPreparation' },
  { method: 'post', path: '/flux/streamchain', module: fluxService, fn: 'streamChain' },
  // POST PROTECTED API - USER LEVEL
  { method: 'post', path: '/id/logoutspecificsession', module: idService, fn: 'logoutSpecificSession' }, // requires the knowledge of a session loginPhrase so users level is sufficient and user cannot logout another user as he does not know the loginPhrase.
  { method: 'post', path: '/zelid/logoutspecificsession', module: idService, fn: 'logoutSpecificSession' }, // DEPRECATED
  { method: 'post', path: '/daemon/submitblock', module: daemonServiceMiningRpcs, fn: 'submitBlockPost' },
  { method: 'post', path: '/apps/checkdockerexistance', guards: ['refuseBannedCaller'], module: imageManager, fn: 'checkDockerAccessibility' },
  { method: 'post', path: '/apps/appregister', guards: ['refuseBannedCaller'], module: registryManager, fn: 'registerAppGlobalyApi' },
  { method: 'post', path: '/apps/appupdate', guards: ['refuseBannedCaller'], module: advancedWorkflows, fn: 'updateAppGlobalyApi' },
  { method: 'post', path: '/apps/getpublickey', guards: ['refuseBannedCaller'], module: cryptographicKeys, fn: 'getPublicKey' },
  // POST PROTECTED API - FluxNode owner level
  { method: 'post', path: '/benchmark/signfluxnodetransaction', module: benchmarkService, fn: 'signFluxTransactionPost' },
  { method: 'post', path: '/benchmark/signzelnodetransaction', module: benchmarkService, fn: 'signFluxTransactionPost' }, // DEPRECATED
  // POST PROTECTED API - FluxTeam
  { method: 'post', path: '/flux/broadcastmessage', module: fluxCommunicationMessagesSender, fn: 'broadcastMessageFromUserPost' },
  { method: 'post', path: '/flux/broadcastmessagetooutgoing', module: fluxCommunicationMessagesSender, fn: 'broadcastMessageToOutgoingFromUserPost' },
  { method: 'post', path: '/flux/broadcastmessagetoincoming', module: fluxCommunicationMessagesSender, fn: 'broadcastMessageToIncomingFromUserPost' },
  // What is left of FluxShare: an operator collects the files a previous
  // release let them put on the node. Read only, and the node's operator only -
  // the token that served a file to whoever held the link is gone with the rest.
  { method: 'get', path: '/apps/fluxshare/getfolder/:folder?', module: fluxshareService, fn: 'fluxShareGetFolder' },
  { method: 'get', path: '/apps/fluxshare/getfile/:file?', module: fluxshareService, fn: 'fluxShareDownloadFile' },
  // Handing the file operation image to a node that cannot reach the registry.
  // Open to other Flux nodes rather than to an owner: it carries no app data,
  // and a node needing it has nobody to authenticate as.
  { method: 'get', path: '/apps/fileoperationimage/:imageid', module: volumeExecutor, fn: 'serveImageToPeer' },
  // Volume Browser
  { method: 'get', path: '/apps/getfolderinfo/:appname?/:component?/:folder?', module: fileQueryService, fn: 'getAppsFolder' },
  { method: 'get', path: '/apps/createfolder/:appname?/:component?/:folder?', guards: ['requireBootSettled'], module: fileSystemManager, fn: 'createAppsFolder' },
  { method: 'get', path: '/apps/renameobject/:appname?/:component?/:oldpath?/:newname?', guards: ['requireBootSettled'], module: fileSystemManager, fn: 'renameAppsObject' },
  { method: 'get', path: '/apps/removeobject/:appname?/:component?/:object?', guards: ['requireBootSettled'], module: fileSystemManager, fn: 'removeAppsObject' },
  // Every endpoint that answers 202 points here: one status resource, one
  // status enum, one error shape, so a client polls the same way whatever it
  // started.
  { method: 'get', path: '/apps/operations/:jobId', module: operationsController, fn: 'getOperation' },
  { method: 'delete', path: '/apps/operations/:jobId', module: operationsController, fn: 'cancelOperation' },
  // POST, with the operands in a JSON body:
  //   { appname, component, source, destination, overwrite? }
  //
  // compressobject also takes `source` as a list of entries, and archives each
  // by its path from the deepest folder holding all of them.
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
  { method: 'post', path: '/apps/moveobject', guards: ['requireBootSettled'], module: fileSystemManager, fn: 'moveAppsObject' },
  { method: 'post', path: '/apps/copyobject', guards: ['requireBootSettled'], module: fileSystemManager, fn: 'copyAppsObject' },
  { method: 'post', path: '/apps/compressobject', guards: ['requireBootSettled'], module: fileSystemManager, fn: 'compressAppsObject' },
  { method: 'post', path: '/apps/extractobject', guards: ['requireBootSettled'], module: fileSystemManager, fn: 'extractAppsObject' },
  { method: 'get', path: '/apps/downloadfile/:appname?/:component?/:file?', module: fileSystemManager, fn: 'downloadAppsFile' },
  { method: 'get', path: '/apps/downloadfolder/:appname?/:component?/:folder?', module: fileSystemManager, fn: 'downloadAppsFolder' },
  { method: 'get', path: '/explorer/issynced', cache: '30 seconds', module: explorerService, fn: 'isExplorerSynced' },
  { method: 'get', path: '/flux/eventstream', module: fluxEventBus, fn: 'sseHandler' },
  // Cadence, read rather than streamed - see the rule at the top of
  // fluxEventBus.js. 404s in production, like the stream above.
  { method: 'get', path: '/flux/testcounters', module: fluxEventBus, fn: 'countersHandler' },
  // Pauses a named code path while a test holds a window open - see
  // checkpoint() in fluxEventBus.js. 404s in production, like the counters.
  { method: 'post', path: '/flux/testcheckpoints', module: fluxEventBus, fn: 'checkpointsHandler' },
  // State, read at the moment of asking - see the rule at the top of
  // fluxEventBus.js. Uncached by design. 404s in production, like the routes above.
  { method: 'get', path: '/flux/teststate/:name', module: fluxEventBus, fn: 'snapshotHandler' },
];
