const apicache = require('apicache');

const daemonService = require('./services/daemonService');
const benchmarkService = require('./services/benchmarkService');
const idService = require('./services/idService');
const fluxService = require('./services/fluxService');
const fluxCommunication = require('./services/fluxCommunication');
const appsService = require('./services/appsService');
const explorerService = require('./services/explorerService');

const cache = apicache.middleware;

module.exports = (app, expressWs) => {
  // GET PUBLIC methods
  app.get('/daemon/help/:command?', cache('1 hour'), (req, res) => { // accept both help/command and ?command=getinfo. If ommited, default help will be displayed. Other calls works in similar way
    daemonService.help(req, res);
  });
  app.get('/daemon/getinfo', cache('30 seconds'), (req, res) => {
    daemonService.getInfo(req, res);
  });
  app.get('/daemon/getzelnodestatus', cache('30 seconds'), (req, res) => {
    daemonService.getZelNodeStatus(req, res);
  });
  app.get('/daemon/listzelnodes/:filter?', cache('30 seconds'), (req, res) => {
    daemonService.listZelNodes(req, res);
  });
  app.get('/daemon/viewdeterministiczelnodelist/:filter?', cache('30 seconds'), (req, res) => {
    daemonService.viewDeterministicZelNodeList(req, res);
  });
  app.get('/daemon/znsync/:mode?', cache('30 seconds'), (req, res) => {
    daemonService.znsync(req, res);
  });
  app.get('/daemon/decodezelnodebroadcast/:hexstring?', cache('30 seconds'), (req, res) => {
    daemonService.decodeZelNodeBroadcast(req, res);
  });
  app.get('/daemon/getzelnodecount', cache('30 seconds'), (req, res) => {
    daemonService.getZelNodeCount(req, res);
  });
  app.get('/daemon/getdoslist', cache('30 seconds'), (req, res) => {
    daemonService.getDOSList(req, res);
  });
  app.get('/daemon/getstartlist', cache('30 seconds'), (req, res) => {
    daemonService.getStartList(req, res);
  });
  app.get('/daemon/getzelnodescores/:blocks?', cache('30 seconds'), (req, res) => { // defaults to 10
    daemonService.getZelNodeScores(req, res);
  });
  app.get('/daemon/getzelnodewinners/:blocks?/:filter?', cache('30 seconds'), (req, res) => {
    daemonService.getZelNodeWinners(req, res);
  });
  app.get('/daemon/relayzelnodebroadcast/:hexstring?', cache('30 seconds'), (req, res) => {
    daemonService.relayZelNodeBroadcast(req, res);
  });
  app.get('/daemon/spork/:name?/:value?', cache('30 seconds'), (req, res) => {
    daemonService.spork(req, res);
  });
  app.get('/daemon/fluxcurrentwinner', cache('30 seconds'), (req, res) => {
    daemonService.zelNodeCurrentWinner(req, res);
  });
  app.get('/daemon/fluxdebug', cache('30 seconds'), (req, res) => {
    daemonService.zelNodeDebug(req, res);
  });
  app.get('/daemon/getbestblockhash', cache('30 seconds'), (req, res) => {
    daemonService.getBestBlockHash(req, res);
  });
  app.get('/daemon/getblock/:hashheight?/:verbosity?', cache('30 seconds'), (req, res) => {
    daemonService.getBlock(req, res);
  });
  app.get('/daemon/getblockchaininfo', cache('30 seconds'), (req, res) => {
    daemonService.getBlockchainInfo(req, res);
  });
  app.get('/daemon/getblockcount', cache('30 seconds'), (req, res) => {
    daemonService.getBlockCount(req, res);
  });
  app.get('/daemon/getblockhash/:index?', cache('30 seconds'), (req, res) => {
    daemonService.getBlockHash(req, res);
  });
  app.get('/daemon/getblockheader/:hash?/:verbose?', cache('30 seconds'), (req, res) => {
    daemonService.getBlockHeader(req, res);
  });
  app.get('/daemon/getchaintips', cache('30 seconds'), (req, res) => {
    daemonService.getChainTips(req, res);
  });
  app.get('/daemon/getdifficulty', cache('30 seconds'), (req, res) => {
    daemonService.getDifficulty(req, res);
  });
  app.get('/daemon/getmempoolinfo', cache('30 seconds'), (req, res) => {
    daemonService.getMempoolInfo(req, res);
  });
  app.get('/daemon/getrawmempool/:verbose?', cache('30 seconds'), (req, res) => {
    daemonService.getRawMemPool(req, res);
  });
  app.get('/daemon/gettxout/:txid?/:n?/:includemempool?', cache('30 seconds'), (req, res) => {
    daemonService.getTxOut(req, res);
  });
  app.get('/daemon/gettxoutproof/:txids?/:blockhash?', cache('30 seconds'), (req, res) => { // comma separated list of txids. For example: /gettxoutproof/abc,efg,asd/blockhash
    daemonService.getTxOutProof(req, res);
  });
  app.get('/daemon/gettxoutsetinfo', cache('30 seconds'), (req, res) => {
    daemonService.getTxOutSetInfo(req, res);
  });
  app.get('/daemon/verifytxoutproof/:proof?', cache('30 seconds'), (req, res) => {
    daemonService.verifyTxOutProof(req, res);
  });
  app.get('/daemon/getblocksubsidy/:height?', cache('30 seconds'), (req, res) => {
    daemonService.getBlockSubsidy(req, res);
  });
  app.get('/daemon/getblocktemplate/:jsonrequestobject?', cache('30 seconds'), (req, res) => {
    daemonService.getBlockTemplate(req, res);
  });
  app.get('/daemon/getlocalsolps', cache('30 seconds'), (req, res) => {
    daemonService.getLocalSolPs(req, res);
  });
  app.get('/daemon/getmininginfo', cache('30 seconds'), (req, res) => {
    daemonService.getMiningInfo(req, res);
  });
  app.get('/daemon/getnetworkhashps/:blocks?/:height?', cache('30 seconds'), (req, res) => {
    daemonService.getNetworkHashPs(req, res);
  });
  app.get('/daemon/getnetworksolps/:blocks?/:height?', cache('30 seconds'), (req, res) => {
    daemonService.getNetworkSolPs(req, res);
  });
  app.get('/daemon/getconnectioncount', cache('30 seconds'), (req, res) => {
    daemonService.getConnectionCount(req, res);
  });
  app.get('/daemon/getdeprecationinfo', cache('30 seconds'), (req, res) => {
    daemonService.getDeprecationInfo(req, res);
  });
  app.get('/daemon/getnettotals', cache('30 seconds'), (req, res) => {
    daemonService.getNetTotals(req, res);
  });
  app.get('/daemon/getnetworkinfo', cache('30 seconds'), (req, res) => {
    daemonService.getNetworkInfo(req, res);
  });
  app.get('/daemon/getpeerinfo', cache('30 seconds'), (req, res) => {
    daemonService.getPeerInfo(req, res);
  });
  app.get('/daemon/listbanned', cache('30 seconds'), (req, res) => {
    daemonService.listBanned(req, res);
  });
  app.get('/daemon/createrawtransaction/:transactions?/:addresses?/:locktime?/:expiryheight?', (req, res) => {
    daemonService.createRawTransaction(req, res);
  });
  app.get('/daemon/decoderawtransaction/:hexstring?', cache('30 seconds'), (req, res) => {
    daemonService.decodeRawTransaction(req, res);
  });
  app.get('/daemon/decodescript/:hex?', cache('30 seconds'), (req, res) => {
    daemonService.decodeScript(req, res);
  });
  app.get('/daemon/fundrawtransaction/:hexstring?', (req, res) => {
    daemonService.fundRawTransaction(req, res);
  });
  app.get('/daemon/getrawtransaction/:txid?/:verbose?', (req, res) => {
    daemonService.getRawTransaction(req, res);
  });
  app.get('/daemon/sendrawtransaction/:hexstring?/:allowhighfees?', (req, res) => {
    daemonService.sendRawTransaction(req, res);
  });
  app.get('/daemon/createmultisig/:n?/:keys?', (req, res) => {
    daemonService.createMultiSig(req, res);
  });
  app.get('/daemon/estimatefee/:nblocks?', cache('30 seconds'), (req, res) => {
    daemonService.estimateFee(req, res);
  });
  app.get('/daemon/estimatepriority/:nblocks?', cache('30 seconds'), (req, res) => {
    daemonService.estimatePriority(req, res);
  });
  app.get('/daemon/validateaddress/:zelcashaddress?', cache('30 seconds'), (req, res) => {
    daemonService.validateAddress(req, res);
  });
  app.get('/daemon/verifymessage/:zelcashaddress?/:signature?/:message?', cache('30 seconds'), (req, res) => {
    daemonService.verifyMessage(req, res);
  });
  app.get('/daemon/gettransaction/:txid?/:includewatchonly?', cache('30 seconds'), (req, res) => {
    daemonService.getTransaction(req, res);
  });
  app.get('/daemon/zvalidateaddress/:zaddr?', cache('30 seconds'), (req, res) => {
    daemonService.zValidateAddress(req, res);
  });
  app.get('/daemon/getbenchmarks', cache('30 seconds'), (req, res) => {
    daemonService.getBenchmarks(req, res);
  });
  app.get('/daemon/getbenchstatus', cache('30 seconds'), (req, res) => {
    daemonService.getBenchStatus(req, res);
  });

  app.get('/id/loginphrase', (req, res) => {
    idService.loginPhrase(req, res);
  });
  app.get('/id/emergencyphrase', (req, res) => {
    idService.emergencyPhrase(req, res);
  });

  app.get('/flux/info', cache('30 seconds'), (req, res) => {
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
  app.get('/flux/cruxid', cache('30 seconds'), (req, res) => {
    fluxService.getFluxCruxID(req, res);
  });
  app.get('/flux/kadena', cache('30 seconds'), (req, res) => {
    fluxService.getFluxKadena(req, res);
  });
  app.get('/flux/dosstate', cache('30 seconds'), (req, res) => {
    fluxCommunication.getDOSState(req, res);
  });
  app.get('/flux/connectedpeers', cache('30 seconds'), (req, res) => {
    fluxCommunication.connectedPeers(req, res);
  });
  app.get('/flux/connectedpeersinfo', cache('30 seconds'), (req, res) => {
    fluxCommunication.connectedPeersInfo(req, res);
  });
  app.get('/flux/incomingconnections', cache('30 seconds'), (req, res) => {
    fluxCommunication.getIncomingConnections(req, res, expressWs.getWss('/ws/flux'));
  });
  app.get('/flux/incomingconnectionsinfo', cache('30 seconds'), (req, res) => {
    fluxCommunication.getIncomingConnectionsInfo(req, res, expressWs.getWss('/ws/flux'));
  });
  app.get('/flux/checkfluxavailability/:ip?', cache('30 seconds'), (req, res) => {
    fluxCommunication.checkFluxAvailability(req, res);
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
  app.get('/apps/temporarymessages', cache('30 seconds'), (req, res) => {
    appsService.getAppsTemporaryMessages(req, res);
  });
  app.get('/apps/permanentmessages', cache('30 seconds'), (req, res) => {
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
    appsService.whitelistedRepositories(req, res);
  });
  app.get('/apps/whitelistedzelids', cache('30 seconds'), (req, res) => {
    appsService.whitelistedZelIDs(req, res);
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

  // GET PROTECTED API - User level
  app.get('/daemon/prioritisetransaction/:txid?/:prioritydelta?/:feedelta?', cache('30 seconds'), (req, res) => {
    daemonService.prioritiseTransaction(req, res);
  });
  app.get('/daemon/submitblock/:hexdata?/:jsonparametersobject?', cache('30 seconds'), (req, res) => {
    daemonService.submitBlock(req, res);
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

  // GET PROTECTED API - ZelNode Owner
  app.get('/daemon/stop', (req, res) => {
    daemonService.stop(req, res);
  });
  app.get('/daemon/reindex', (req, res) => {
    fluxService.reindexDaemon(req, res);
  });
  app.get('/daemon/createzelnodekey', (req, res) => {
    daemonService.createZelNodeKey(req, res);
  });
  app.get('/daemon/createzelnodebroadcast/:command?/:alias?', (req, res) => {
    daemonService.createZelNodeBroadcast(req, res);
  });
  app.get('/daemon/listzelnodeconf/:filter?', (req, res) => {
    daemonService.listZelNodeConf(req, res);
  });
  app.get('/daemon/getzelnodeoutputs', (req, res) => {
    daemonService.getZelNodeOutputs(req, res);
  });
  app.get('/daemon/startzelnode/:set?/:lockwallet?/:alias?', (req, res) => {
    daemonService.startZelNode(req, res);
  });
  app.get('/daemon/startdeterministiczelnode/:alias?/:lockwallet?', (req, res) => {
    daemonService.startDeterministicZelNode(req, res);
  });
  app.get('/daemon/verifychain/:checklevel?/:numblocks?', (req, res) => {
    daemonService.verifyChain(req, res);
  });
  app.get('/daemon/addnode/:node?/:command?', (req, res) => {
    daemonService.addNode(req, res);
  });
  app.get('/daemon/clearbanned', (req, res) => {
    daemonService.clearBanned(req, res);
  });
  app.get('/daemon/disconnectnode/:node?', (req, res) => {
    daemonService.disconnectNode(req, res);
  });
  app.get('/daemon/getaddednodeinfo/:dns?/:node?', (req, res) => {
    daemonService.getAddedNodeInfo(req, res);
  });
  app.get('/daemon/setban/:ip?/:command?/:bantime?/:absolute?', (req, res) => {
    daemonService.setBan(req, res);
  });
  app.get('/daemon/signrawtransaction/:hexstring?/:prevtxs?/:privatekeys?/:sighashtype?/:branchid?', (req, res) => {
    daemonService.signRawTransaction(req, res);
  });
  app.get('/daemon/addmultisigaddress/:n?/:keysobject?', (req, res) => {
    daemonService.addMultiSigAddress(req, res);
  });
  app.get('/daemon/backupwallet/:destination?', (req, res) => {
    daemonService.backupWallet(req, res);
  });
  app.get('/daemon/dumpprivkey/:taddr?', (req, res) => {
    daemonService.dumpPrivKey(req, res);
  });
  app.get('/daemon/getbalance/:minconf?/:includewatchonly?', (req, res) => {
    daemonService.getBalance(req, res);
  });
  app.get('/daemon/getnewaddress', (req, res) => {
    daemonService.getNewAddress(req, res);
  });
  app.get('/daemon/getrawchangeaddress', (req, res) => {
    daemonService.getRawChangeAddress(req, res);
  });
  app.get('/daemon/getreceivedbyaddress/:zelcashaddress?/:minconf?', (req, res) => {
    daemonService.getReceivedByAddress(req, res);
  });
  app.get('/daemon/getunconfirmedbalance', (req, res) => {
    daemonService.getUnconfirmedBalance(req, res);
  });
  app.get('/daemon/getwalletinfo', (req, res) => {
    daemonService.getWalletInfo(req, res);
  });
  app.get('/daemon/importaddress/:address?/:label?/:rescan?', (req, res) => {
    daemonService.importAddress(req, res);
  });
  app.get('/daemon/importprivkey/:zelcashprivkey?/:label?/:rescan?', (req, res) => {
    daemonService.importPrivKey(req, res);
  });
  app.get('/daemon/importwallet/:filename?', (req, res) => {
    daemonService.importWallet(req, res);
  });
  app.get('/daemon/keypoolrefill/:newsize?', (req, res) => {
    daemonService.keyPoolRefill(req, res);
  });
  app.get('/daemon/listaddressgroupings', (req, res) => {
    daemonService.listAddressGroupings(req, res);
  });
  app.get('/daemon/listlockunspent', (req, res) => {
    daemonService.listLockUnspent(req, res);
  });
  app.get('/daemon/listreceivedbyaddress/:minconf?/:includeempty?/:includewatchonly?', (req, res) => {
    daemonService.listReceivedByAddress(req, res);
  });
  app.get('/daemon/listsinceblock/:blockhash?/:targetconfirmations?/:includewatchonly?', (req, res) => {
    daemonService.listSinceBlock(req, res);
  });
  app.get('/daemon/listtransactions/:count?/:from?/:includewatchonly?', (req, res) => {
    daemonService.listTransactions(req, res);
  });
  app.get('/daemon/listunspent/:minconf?/:maxconf?/:addresses?', (req, res) => {
    daemonService.listUnspent(req, res);
  });
  app.get('/daemon/lockunspent/:unlock?/:transactions?', (req, res) => {
    daemonService.lockUnspent(req, res);
  });
  app.get('/daemon/rescanblockchain/:startheight?', (req, res) => {
    daemonService.rescanBlockchain(req, res);
  });
  app.get('/daemon/sendfrom/:tozelcashaddress?/:amount?/:minconf?/:comment?/:commentto?', (req, res) => {
    daemonService.sendFrom(req, res);
  });
  app.get('/daemon/sendmany/:amounts?/:minconf?/:comment?/:substractfeefromamount?', (req, res) => {
    daemonService.sendMany(req, res);
  });
  app.get('/daemon/sendtoaddress/:zelcashaddress?/:amount?/:comment?/:commentto?/:substractfeefromamount?', (req, res) => {
    daemonService.sendToAddress(req, res);
  });
  app.get('/daemon/settxfee/:amount?', (req, res) => {
    daemonService.setTxFee(req, res);
  });
  app.get('/daemon/signmessage/:taddr?/:message?', (req, res) => {
    daemonService.signMessage(req, res);
  });
  app.get('/daemon/zexportkey/:zaddr?', (req, res) => {
    daemonService.zExportKey(req, res);
  });
  app.get('/daemon/zexportviewingkey/:zaddr?', (req, res) => {
    daemonService.zExportViewingKey(req, res);
  });
  app.get('/daemon/zgetbalance/:address?/:minconf?', (req, res) => {
    daemonService.zGetBalance(req, res);
  });
  app.get('/daemon/zgetmigrationstatus', (req, res) => {
    daemonService.zGetMigrationStatus(req, res);
  });
  app.get('/daemon/zgetnewaddress/:type?', (req, res) => {
    daemonService.zGetNewAddress(req, res);
  });
  app.get('/daemon/zgetoperationresult/:operationid?', (req, res) => {
    daemonService.zGetOperationResult(req, res);
  });
  app.get('/daemon/zgetoperationstatus/:operationid?', (req, res) => {
    daemonService.zGetOperationStatus(req, res);
  });
  app.get('/daemon/zgettotalbalance/:minconf?/:includewatchonly?', (req, res) => {
    daemonService.zGetTotalBalance(req, res);
  });
  app.get('/daemon/zimportkey/:zkey?/:rescan?/:startheight?', (req, res) => {
    daemonService.zImportKey(req, res);
  });
  app.get('/daemon/zimportviewingkey/:vkey?/:rescan?/:startheight?', (req, res) => {
    daemonService.zImportViewingKey(req, res);
  });
  app.get('/daemon/zimportwallet/:filename?', (req, res) => {
    daemonService.zImportWallet(req, res);
  });
  app.get('/daemon/zlistaddresses/:includewatchonly?', (req, res) => {
    daemonService.zListAddresses(req, res);
  });
  app.get('/daemon/zlistoperationids', (req, res) => {
    daemonService.zListOperationIds(req, res);
  });
  app.get('/daemon/zlistreceivedbyaddress/:address?/:minconf?', (req, res) => {
    daemonService.zListReceivedByAddress(req, res);
  });
  app.get('/daemon/zlistunspent/:minconf?/:maxonf?/:includewatchonly?/:addresses?', (req, res) => {
    daemonService.zListUnspent(req, res);
  });
  app.get('/daemon/zmergetoaddress/:fromaddresses?/:toaddress?/:fee?/:transparentlimit?/:shieldedlimit?/:memo?', (req, res) => {
    daemonService.zMergeToAddress(req, res);
  });
  app.get('/daemon/zsendmany/:fromaddress?/:amounts?/:minconf?/:fee?', (req, res) => {
    daemonService.zSendMany(req, res);
  });
  app.get('/daemon/zsetmigration/:enabled?', (req, res) => {
    daemonService.zSetMigration(req, res);
  });
  app.get('/daemon/zshieldcoinbase/:fromaddress?/:toaddress?/:fee?/:limit?', (req, res) => {
    daemonService.zShieldCoinBase(req, res);
  });
  app.get('/daemon/zcrawjoinsplit/:rawtx?/:inputs?/:outputs?/:vpubold?/:vpubnew?', (req, res) => {
    daemonService.zcRawJoinSplit(req, res);
  });
  app.get('/daemon/zcrawkeygen', (req, res) => {
    daemonService.zcRawKeygen(req, res);
  });
  app.get('/daemon/zcrawreceive/:zcsecretkey?/:encryptednote?', (req, res) => {
    daemonService.zcRawReceive(req, res);
  });
  app.get('/daemon/zcsamplejoinsplit', (req, res) => {
    daemonService.zcSampleJoinSplit(req, res);
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
    daemonService.ping(req, res);
  });
  app.get('/daemon/zcbenchmark/:benchmarktype?/:samplecount?', (req, res) => {
    daemonService.zcBenchmark(req, res);
  });
  app.get('/daemon/startbenchmark', (req, res) => {
    daemonService.startBenchmarkD(req, res);
  });
  app.get('/daemon/stopbenchmark', (req, res) => {
    daemonService.stopBenchmarkD(req, res);
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
    fluxCommunication.broadcastMessageFromUser(req, res);
  });
  app.get('/flux/broadcastmessagetooutgoing/:data?', (req, res) => {
    fluxCommunication.broadcastMessageToOutgoingFromUser(req, res);
  });
  app.get('/flux/broadcastmessagetoincoming/:data?', (req, res) => {
    fluxCommunication.broadcastMessageToIncomingFromUser(req, res);
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
    fluxCommunication.allowPortApi(req, res);
  });
  app.get('/flux/checkcommunication', (req, res) => {
    fluxCommunication.isCommunicationEstablished(req, res);
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

  app.get('/apps/appstart/:appname?', (req, res) => {
    appsService.appStart(req, res);
  });
  app.get('/apps/appstop/:appname?', (req, res) => {
    appsService.appStop(req, res);
  });
  app.get('/apps/apprestart/:appname?', (req, res) => {
    appsService.appRestart(req, res);
  });
  app.get('/apps/apppause/:appname?', (req, res) => {
    appsService.appPause(req, res);
  });
  app.get('/apps/appunpause/:appname?', (req, res) => {
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
  app.get('/apps/appchanges/:appname?', (req, res) => {
    appsService.appChanges(req, res);
  });
  app.post('/apps/appexec', (req, res) => {
    appsService.appExec(req, res);
  });
  app.get('/apps/appremove/:appname?/:force?', (req, res) => {
    appsService.removeAppLocallyApi(req, res);
  });
  app.get('/apps/installtemporarylocalapp/FoldingAtHomeB', (req, res) => {
    appsService.installTemporaryLocalApplication(req, res, 'FoldingAtHomeB');
  });
  app.get('/apps/installtemporarylocalapp/KadenaChainWebNode', (req, res) => {
    appsService.installTemporaryLocalApplication(req, res, 'KadenaChainWebNode');
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
  app.get('/apps/redeploy/:appname?/:force?', (req, res) => {
    appsService.redeployAPI(req, res);
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

  app.post('/daemon/createrawtransaction', (req, res) => {
    daemonService.createRawTransactionPost(req, res);
  });
  app.post('/daemon/decoderawtransaction', (req, res) => {
    daemonService.decodeRawTransactionPost(req, res);
  });
  app.post('/daemon/decodescript', (req, res) => {
    daemonService.decodeScriptPost(req, res);
  });
  app.post('/daemon/fundrawtransaction', (req, res) => {
    daemonService.fundRawTransactionPost(req, res);
  });
  app.post('/daemon/sendrawtransaction', (req, res) => {
    daemonService.sendRawTransactionPost(req, res);
  });
  app.post('/daemon/createmultisig', (req, res) => {
    daemonService.createMultiSigPost(req, res);
  });
  app.post('/daemon/verifymessage', (req, res) => {
    daemonService.verifyMessagePost(req, res);
  });

  // POST PROTECTED API - USER LEVEL
  app.post('/id/logoutspecificsession', (req, res) => { // requires the knowledge of a session loginPhrase so users level is sufficient and user cannot logout another user as he does not know the loginPhrase.
    idService.logoutSpecificSession(req, res);
  });

  app.post('/daemon/submitblock', (req, res) => {
    daemonService.submitBlockPost(req, res);
  });

  app.post('/apps/checkdockerexistance', async (req, res) => {
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
    daemonService.signRawTransactionPost(req, res);
  });
  app.post('/daemon/addmultisigaddress', (req, res) => {
    daemonService.addMultiSigAddressPost(req, res);
  });
  app.post('/daemon/sendfrom', (req, res) => {
    daemonService.sendFromPost(req, res);
  });
  app.post('/daemon/sendmany', (req, res) => {
    daemonService.sendManyPost(req, res);
  });
  app.post('/daemon/sendtoaddress', (req, res) => {
    daemonService.sendToAddressPost(req, res);
  });
  app.post('/daemon/signmessage', (req, res) => {
    daemonService.signMessagePost(req, res);
  });
  app.post('/daemon/zsendmany', (req, res) => {
    daemonService.zSendManyPost(req, res);
  });
  app.post('/daemon/zcrawjoinsplit', (req, res) => {
    daemonService.zcRawJoinSplitPost(req, res);
  });
  app.post('/daemon/zcrawreceive', (req, res) => {
    daemonService.zcRawReceivePost(req, res);
  });

  app.post('/benchmark/signzelnodetransaction', (req, res) => {
    benchmarkService.signFluxTransactionPost(req, res);
  });

  // POST PROTECTED API - FluxTeam
  app.post('/flux/broadcastmessage', (req, res) => {
    fluxCommunication.broadcastMessageFromUserPost(req, res);
  });
  app.post('/flux/broadcastmessagetooutgoing', (req, res) => {
    fluxCommunication.broadcastMessageToOutgoingFromUserPost(req, res);
  });
  app.post('/flux/broadcastmessagetoincoming', (req, res) => {
    fluxCommunication.broadcastMessageToIncomingFromUserPost(req, res);
  });

  // WebSockets PUBLIC
  app.ws('/ws/id/:loginphrase', (ws, req) => {
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
    appsService.fluxShareDownloadFile(req, res);
  });
  app.get('/apps/fluxshare/getfolder/:folder?', (req, res) => {
    appsService.fluxShareGetFolder(req, res);
  });
  app.get('/apps/fluxshare/createfolder/:folder?', (req, res) => {
    appsService.fluxShareCreateFolder(req, res);
  });
  app.post('/apps/fluxshare/uploadfile/:folder?', (req, res) => {
    appsService.fluxShareUpload(req, res);
  });
  app.get('/apps/fluxshare/removefile/:file?', (req, res) => {
    appsService.fluxShareRemoveFile(req, res);
  });
  app.get('/apps/fluxshare/removefolder/:folder?', (req, res) => {
    appsService.fluxShareRemoveFolder(req, res);
  });
  app.get('/apps/fluxshare/fileexists/:file?', (req, res) => {
    appsService.fluxShareFileExists(req, res);
  });
  app.get('/apps/fluxshare/stats', (req, res) => {
    appsService.fluxShareStorageStats(req, res);
  });
  app.get('/apps/fluxshare/sharefile/:file?', (req, res) => {
    appsService.fluxShareShareFile(req, res);
  });
  app.get('/apps/fluxshare/unsharefile/:file?', (req, res) => {
    appsService.fluxShareUnshareFile(req, res);
  });
  app.get('/apps/fluxshare/sharedfiles', (req, res) => {
    appsService.fluxShareGetSharedFiles(req, res);
  });
  app.get('/apps/fluxshare/rename/:oldpath?/:newname?', (req, res) => {
    appsService.fluxShareRename(req, res);
  });
  app.get('/apps/fluxshare/downloadfolder/:folder?', (req, res) => {
    appsService.fluxShareDownloadFolder(req, res);
  });
};
