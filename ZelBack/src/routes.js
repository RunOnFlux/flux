const zelcashService = require('./services/zelcashService');
const zelbenchService = require('./services/zelbenchService');
const zelidService = require('./services/zelidService');
const zelnodeService = require('./services/zelnodeService');
const zelfluxCommunication = require('./services/zelfluxCommunication');
const zelappsService = require('./services/zelappsService');
const explorerService = require('./services/explorerService');

module.exports = (app, expressWs) => {
  // GET PUBLIC methods
  app.get('/zelcash/help/:command?', (req, res) => { // accept both help/command and ?command=getinfo. If ommited, default help will be displayed. Other calls works in similar way
    zelcashService.help(req, res);
  });
  app.get('/zelcash/getinfo', (req, res) => {
    zelcashService.getInfo(req, res);
  });
  app.get('/zelcash/getzelnodestatus', (req, res) => {
    zelcashService.getZelNodeStatus(req, res);
  });
  app.get('/zelcash/listzelnodes/:filter?', (req, res) => {
    zelcashService.listZelNodes(req, res);
  });
  app.get('/zelcash/viewdeterministiczelnodelist/:filter?', (req, res) => {
    zelcashService.viewDeterministicZelNodeList(req, res);
  });
  app.get('/zelcash/znsync/:mode?', (req, res) => {
    zelcashService.znsync(req, res);
  });
  app.get('/zelcash/decodezelnodebroadcast/:hexstring?', (req, res) => {
    zelcashService.decodeZelNodeBroadcast(req, res);
  });
  app.get('/zelcash/getzelnodecount', (req, res) => {
    zelcashService.getZelNodeCount(req, res);
  });
  app.get('/zelcash/getzelnodescores/:blocks?', (req, res) => { // defaults to 10
    zelcashService.getZelNodeScores(req, res);
  });
  app.get('/zelcash/getzelnodewinners/:blocks?/:filter?', (req, res) => {
    zelcashService.getZelNodeWinners(req, res);
  });
  app.get('/zelcash/relayzelnodebroadcast/:hexstring?', (req, res) => {
    zelcashService.relayZelNodeBroadcast(req, res);
  });
  app.get('/zelcash/spork/:name?/:value?', (req, res) => {
    zelcashService.spork(req, res);
  });
  app.get('/zelcash/zelnodecurrentwinner', (req, res) => {
    zelcashService.zelNodeCurrentWinner(req, res);
  });
  app.get('/zelcash/zelnodedebug', (req, res) => {
    zelcashService.zelNodeDebug(req, res);
  });
  app.get('/zelcash/getbestblockhash', (req, res) => {
    zelcashService.getBestBlockHash(req, res);
  });
  app.get('/zelcash/getblock/:hashheight?/:verbosity?', (req, res) => {
    zelcashService.getBlock(req, res);
  });
  app.get('/zelcash/getblockchaininfo', (req, res) => {
    zelcashService.getBlockchainInfo(req, res);
  });
  app.get('/zelcash/getblockcount', (req, res) => {
    zelcashService.getBlockCount(req, res);
  });
  app.get('/zelcash/getblockhash/:index?', (req, res) => {
    zelcashService.getBlockHash(req, res);
  });
  app.get('/zelcash/getblockheader/:hash?/:verbose?', (req, res) => {
    zelcashService.getBlockHeader(req, res);
  });
  app.get('/zelcash/getchaintips', (req, res) => {
    zelcashService.getChainTips(req, res);
  });
  app.get('/zelcash/getdifficulty', (req, res) => {
    zelcashService.getDifficulty(req, res);
  });
  app.get('/zelcash/getmempoolinfo', (req, res) => {
    zelcashService.getMempoolInfo(req, res);
  });
  app.get('/zelcash/getrawmempool/:verbose?', (req, res) => {
    zelcashService.getRawMemPool(req, res);
  });
  app.get('/zelcash/gettxout/:txid?/:n?/:includemempool?', (req, res) => {
    zelcashService.getTxOut(req, res);
  });
  app.get('/zelcash/gettxoutproof/:txids?/:blockhash?', (req, res) => { // comma separated list of txids. For example: /gettxoutproof/abc,efg,asd/blockhash
    zelcashService.getTxOutProof(req, res);
  });
  app.get('/zelcash/gettxoutsetinfo', (req, res) => {
    zelcashService.getTxOutSetInfo(req, res);
  });
  app.get('/zelcash/verifytxoutproof/:proof?', (req, res) => {
    zelcashService.verifyTxOutProof(req, res);
  });
  app.get('/zelcash/getblocksubsidy/:height?', (req, res) => {
    zelcashService.getBlockSubsidy(req, res);
  });
  app.get('/zelcash/getblocktemplate/:jsonrequestobject?', (req, res) => {
    zelcashService.getBlockTemplate(req, res);
  });
  app.get('/zelcash/getlocalsolps', (req, res) => {
    zelcashService.getLocalSolPs(req, res);
  });
  app.get('/zelcash/getmininginfo', (req, res) => {
    zelcashService.getMiningInfo(req, res);
  });
  app.get('/zelcash/getnetworkhashps/:blocks?/:height?', (req, res) => {
    zelcashService.getNetworkHashPs(req, res);
  });
  app.get('/zelcash/getnetworksolps/:blocks?/:height?', (req, res) => {
    zelcashService.getNetworkSolPs(req, res);
  });
  app.get('/zelcash/getconnectioncount', (req, res) => {
    zelcashService.getConnectionCount(req, res);
  });
  app.get('/zelcash/getdeprecationinfo', (req, res) => {
    zelcashService.getDeprecationInfo(req, res);
  });
  app.get('/zelcash/getnettotals', (req, res) => {
    zelcashService.getNetTotals(req, res);
  });
  app.get('/zelcash/getnetworkinfo', (req, res) => {
    zelcashService.getNetworkInfo(req, res);
  });
  app.get('/zelcash/getpeerinfo', (req, res) => {
    zelcashService.getPeerInfo(req, res);
  });
  app.get('/zelcash/listbanned', (req, res) => {
    zelcashService.listBanned(req, res);
  });
  app.get('/zelcash/createrawtransaction/:transactions?/:addresses?/:locktime?/:expiryheight?', (req, res) => {
    zelcashService.createRawTransaction(req, res);
  });
  app.get('/zelcash/decoderawtransaction/:hexstring?', (req, res) => {
    zelcashService.decodeRawTransaction(req, res);
  });
  app.get('/zelcash/decodescript/:hex?', (req, res) => {
    zelcashService.decodeScript(req, res);
  });
  app.get('/zelcash/fundrawtransaction/:hexstring?', (req, res) => {
    zelcashService.fundRawTransaction(req, res);
  });
  app.get('/zelcash/getrawtransaction/:txid?/:verbose?', (req, res) => {
    zelcashService.getRawTransaction(req, res);
  });
  app.get('/zelcash/sendrawtransaction/:hexstring?/:allowhighfees?', (req, res) => {
    zelcashService.sendRawTransaction(req, res);
  });
  app.get('/zelcash/createmultisig/:n?/:keys?', (req, res) => {
    zelcashService.createMultiSig(req, res);
  });
  app.get('/zelcash/estimatefee/:nblocks?', (req, res) => {
    zelcashService.estimateFee(req, res);
  });
  app.get('/zelcash/estimatepriority/:nblocks?', (req, res) => {
    zelcashService.estimatePriority(req, res);
  });
  app.get('/zelcash/validateaddress/:zelcashaddress?', (req, res) => {
    zelcashService.validateAddress(req, res);
  });
  app.get('/zelcash/verifymessage/:zelcashaddress?/:signature?/:message?', (req, res) => {
    zelcashService.verifyMessage(req, res);
  });
  app.get('/zelcash/gettransaction/:txid?/:includewatchonly?', (req, res) => {
    zelcashService.getTransaction(req, res);
  });
  app.get('/zelcash/zvalidateaddress/:zaddr?', (req, res) => {
    zelcashService.zValidateAddress(req, res);
  });
  app.get('/zelcash/getbenchmarks', (req, res) => {
    zelcashService.getBenchmarks(req, res);
  });
  app.get('/zelcash/getbenchstatus', (req, res) => {
    zelcashService.getBenchStatus(req, res);
  });

  app.get('/zelid/loginphrase', (req, res) => {
    zelidService.loginPhrase(req, res);
  });
  app.get('/zelid/emergencyphrase', (req, res) => {
    zelidService.emergencyPhrase(req, res);
  });

  app.get('/zelflux/info', (req, res) => {
    zelnodeService.getZelFluxInfo(req, res);
  });
  app.get('/zelflux/timezone', (req, res) => {
    zelnodeService.getZelFluxTimezone(req, res);
  });
  app.get('/zelflux/version', (req, res) => {
    zelnodeService.getZelFluxVersion(req, res);
  });
  app.get('/zelflux/ip', (req, res) => {
    zelnodeService.getZelFluxIP(req, res);
  });
  app.get('/zelflux/zelid', (req, res) => {
    zelnodeService.getZelFluxZelID(req, res);
  });
  app.get('/zelflux/dosstate', (req, res) => {
    zelfluxCommunication.getDOSState(req, res);
  });
  app.get('/zelflux/connectedpeers', (req, res) => {
    zelfluxCommunication.connectedPeers(req, res);
  });
  app.get('/zelflux/connectedpeersinfo', (req, res) => {
    zelfluxCommunication.connectedPeersInfo(req, res);
  });
  app.get('/zelflux/incomingconnections', (req, res) => {
    zelfluxCommunication.getIncomingConnections(req, res, expressWs.getWss('/ws/zelflux'));
  });
  app.get('/zelflux/incomingconnectionsinfo', (req, res) => {
    zelfluxCommunication.getIncomingConnectionsInfo(req, res, expressWs.getWss('/ws/zelflux'));
  });
  app.get('/zelflux/checkfluxavailability/:ip?', (req, res) => {
    zelfluxCommunication.checkFluxAvailability(req, res);
  });

  app.get('/zelapps/listrunningzelapps', (req, res) => {
    zelappsService.listRunningZelApps(req, res);
  });
  app.get('/zelapps/listallzelapps', (req, res) => {
    zelappsService.listAllZelApps(req, res);
  });
  app.get('/zelapps/listzelappsimages', (req, res) => {
    zelappsService.listZelAppsImages(req, res);
  });
  app.get('/zelapps/installedzelapps', (req, res) => {
    zelappsService.installedZelApps(req, res);
  });
  app.get('/zelapps/availablezelapps', (req, res) => {
    zelappsService.availableZelApps(req, res);
  });
  app.get('/zelapps/zelshare/getfile/:file?', (req, res) => {
    zelappsService.zelShareFile(req, res);
  });
  app.get('/zelapps/zelfluxusage', (req, res) => {
    zelappsService.zelFluxUsage(req, res);
  });
  app.get('/zelapps/zelappsresources', (req, res) => {
    zelappsService.zelappsResources(req, res);
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
  // app.get('/explorer/zelnodetransactions', (req, res) => {
  //   explorerService.getAllZelNodeTransactions(req, res);
  // });
  // filter can be IP, address, collateralHash.
  app.get('/explorer/zelnodetxs/:filter?', (req, res) => {
    explorerService.getFilteredZelNodeTxs(req, res);
  });
  app.get('/explorer/utxo/:address?', (req, res) => {
    explorerService.getAddressUtxos(req, res);
  });
  app.get('/explorer/transactions/:address?', (req, res) => {
    explorerService.getAddressTransactions(req, res);
  });
  app.get('/explorer/balance/:address?', (req, res) => {
    explorerService.getAddressBalance(req, res);
  });
  app.get('/explorer/scannedheight', (req, res) => {
    explorerService.getScannedHeight(req, res);
  });

  // GET PROTECTED API - User level
  app.get('/zelcash/prioritisetransaction/:txid?/:prioritydelta?/:feedelta?', (req, res) => {
    zelcashService.prioritiseTransaction(req, res);
  });
  app.get('/zelcash/submitblock/:hexdata?/:jsonparametersobject?', (req, res) => {
    zelcashService.submitBlock(req, res);
  });

  app.get('/zelid/loggedsessions', (req, res) => {
    zelidService.loggedSessions(req, res);
  });
  app.get('/zelid/logoutcurrentsession', (req, res) => {
    zelidService.logoutCurrentSession(req, res);
  });
  app.get('/zelid/logoutallsessions', (req, res) => {
    zelidService.logoutAllSessions(req, res);
  });

  app.get('/zelbench/getstatus', (req, res) => {
    zelbenchService.getStatus(req, res);
  });
  app.get('/zelbench/help', (req, res) => {
    zelbenchService.help(req, res);
  });
  app.get('/zelbench/getbenchmarks', (req, res) => {
    zelbenchService.getBenchmarks(req, res);
  });
  app.get('/zelbench/getinfo', (req, res) => {
    zelbenchService.getInfo(req, res);
  });

  // GET PROTECTED API - ZelNode Owner
  app.get('/zelcash/stop', (req, res) => {
    zelcashService.stop(req, res);
  });
  app.get('/zelcash/reindex', (req, res) => {
    zelnodeService.reindexZelCash(req, res);
  });
  app.get('/zelcash/createzelnodekey', (req, res) => {
    zelcashService.createZelNodeKey(req, res);
  });
  app.get('/zelcash/createzelnodebroadcast/:command?/:alias?', (req, res) => {
    zelcashService.createZelNodeBroadcast(req, res);
  });
  app.get('/zelcash/listzelnodeconf/:filter?', (req, res) => {
    zelcashService.listZelNodeConf(req, res);
  });
  app.get('/zelcash/getzelnodeoutputs', (req, res) => {
    zelcashService.getZelNodeOutputs(req, res);
  });
  app.get('/zelcash/startzelnode/:set?/:lockwallet?/:alias?', (req, res) => {
    zelcashService.startZelNode(req, res);
  });
  app.get('/zelcash/startdeterministiczelnode/:alias?/:lockwallet?', (req, res) => {
    zelcashService.startDeterministicZelNode(req, res);
  });
  app.get('/zelcash/verifychain/:checklevel?/:numblocks?', (req, res) => {
    zelcashService.verifyChain(req, res);
  });
  app.get('/zelcash/addnode/:node?/:command?', (req, res) => {
    zelcashService.addNode(req, res);
  });
  app.get('/zelcash/clearbanned', (req, res) => {
    zelcashService.clearBanned(req, res);
  });
  app.get('/zelcash/disconnectnode/:node?', (req, res) => {
    zelcashService.disconnectNode(req, res);
  });
  app.get('/zelcash/getaddednodeinfo/:dns?/:node?', (req, res) => {
    zelcashService.getAddedNodeInfo(req, res);
  });
  app.get('/zelcash/setban/:ip?/:command?/:bantime?/:absolute?', (req, res) => {
    zelcashService.setBan(req, res);
  });
  app.get('/zelcash/signrawtransaction/:hexstring?/:prevtxs?/:privatekeys?/:sighashtype?/:branchid?', (req, res) => {
    zelcashService.signRawTransaction(req, res);
  });
  app.get('/zelcash/addmultisigaddress/:n?/:keysobject?', (req, res) => {
    zelcashService.addMultiSigAddress(req, res);
  });
  app.get('/zelcash/backupwallet/:destination?', (req, res) => {
    zelcashService.backupWallet(req, res);
  });
  app.get('/zelcash/dumpprivkey/:taddr?', (req, res) => {
    zelcashService.dumpPrivKey(req, res);
  });
  app.get('/zelcash/getbalance/:minconf?/:includewatchonly?', (req, res) => {
    zelcashService.getBalance(req, res);
  });
  app.get('/zelcash/getnewaddress', (req, res) => {
    zelcashService.getNewAddress(req, res);
  });
  app.get('/zelcash/getrawchangeaddress', (req, res) => {
    zelcashService.getRawChangeAddress(req, res);
  });
  app.get('/zelcash/getreceivedbyaddress/:zelcashaddress?/:minconf?', (req, res) => {
    zelcashService.getReceivedByAddress(req, res);
  });
  app.get('/zelcash/getunconfirmedbalance', (req, res) => {
    zelcashService.getUnconfirmedBalance(req, res);
  });
  app.get('/zelcash/getwalletinfo', (req, res) => {
    zelcashService.getWalletInfo(req, res);
  });
  app.get('/zelcash/importaddress/:address?/:label?/:rescan?', (req, res) => {
    zelcashService.importAddress(req, res);
  });
  app.get('/zelcash/importprivkey/:zelcashprivkey?/:label?/:rescan?', (req, res) => {
    zelcashService.importPrivKey(req, res);
  });
  app.get('/zelcash/importwallet/:filename?', (req, res) => {
    zelcashService.importWallet(req, res);
  });
  app.get('/zelcash/keypoolrefill/:newsize?', (req, res) => {
    zelcashService.keyPoolRefill(req, res);
  });
  app.get('/zelcash/listaddressgroupings', (req, res) => {
    zelcashService.listAddressGroupings(req, res);
  });
  app.get('/zelcash/listlockunspent', (req, res) => {
    zelcashService.listLockUnspent(req, res);
  });
  app.get('/zelcash/listreceivedbyaddress/:minconf?/:includeempty?/:includewatchonly?', (req, res) => {
    zelcashService.listReceivedByAddress(req, res);
  });
  app.get('/zelcash/listsinceblock/:blockhash?/:targetconfirmations?/:includewatchonly?', (req, res) => {
    zelcashService.listSinceBlock(req, res);
  });
  app.get('/zelcash/listtransactions/:count?/:from?/:includewatchonly?', (req, res) => {
    zelcashService.listTransactions(req, res);
  });
  app.get('/zelcash/listunspent/:minconf?/:maxconf?/:addresses?', (req, res) => {
    zelcashService.listUnspent(req, res);
  });
  app.get('/zelcash/lockunspent/:unlock?/:transactions?', (req, res) => {
    zelcashService.lockUnspent(req, res);
  });
  app.get('/zelcash/rescanblockchain/:startheight?', (req, res) => {
    zelcashService.rescanBlockchain(req, res);
  });
  app.get('/zelcash/sendfrom/:tozelcashaddress?/:amount?/:minconf?/:comment?/:commentto?', (req, res) => {
    zelcashService.sendFrom(req, res);
  });
  app.get('/zelcash/sendmany/:amounts?/:minconf?/:comment?/:substractfeefromamount?', (req, res) => {
    zelcashService.sendMany(req, res);
  });
  app.get('/zelcash/sendtoaddress/:zelcashaddress?/:amount?/:comment?/:commentto?/:substractfeefromamount?', (req, res) => {
    zelcashService.sendToAddress(req, res);
  });
  app.get('/zelcash/settxfee/:amount?', (req, res) => {
    zelcashService.setTxFee(req, res);
  });
  app.get('/zelcash/signmessage/:taddr?/:message?', (req, res) => {
    zelcashService.signMessage(req, res);
  });
  app.get('/zelcash/zexportkey/:zaddr?', (req, res) => {
    zelcashService.zExportKey(req, res);
  });
  app.get('/zelcash/zexportviewingkey/:zaddr?', (req, res) => {
    zelcashService.zExportViewingKey(req, res);
  });
  app.get('/zelcash/zgetbalance/:address?/:minconf?', (req, res) => {
    zelcashService.zGetBalance(req, res);
  });
  app.get('/zelcash/zgetmigrationstatus', (req, res) => {
    zelcashService.zGetMigrationStatus(req, res);
  });
  app.get('/zelcash/zgetnewaddress/:type?', (req, res) => {
    zelcashService.zGetNewAddress(req, res);
  });
  app.get('/zelcash/zgetoperationresult/:operationid?', (req, res) => {
    zelcashService.zGetOperationResult(req, res);
  });
  app.get('/zelcash/zgetoperationstatus/:operationid?', (req, res) => {
    zelcashService.zGetOperationStatus(req, res);
  });
  app.get('/zelcash/zgettotalbalance/:minconf?/:includewatchonly?', (req, res) => {
    zelcashService.zGetTotalBalance(req, res);
  });
  app.get('/zelcash/zimportkey/:zkey?/:rescan?/:startheight?', (req, res) => {
    zelcashService.zImportKey(req, res);
  });
  app.get('/zelcash/zimportviewingkey/:vkey?/:rescan?/:startheight?', (req, res) => {
    zelcashService.zImportViewingKey(req, res);
  });
  app.get('/zelcash/zimportwallet/:filename?', (req, res) => {
    zelcashService.zImportWallet(req, res);
  });
  app.get('/zelcash/zlistaddresses/:includewatchonly?', (req, res) => {
    zelcashService.zListAddresses(req, res);
  });
  app.get('/zelcash/zlistoperationids', (req, res) => {
    zelcashService.zListOperationIds(req, res);
  });
  app.get('/zelcash/zlistreceivedbyaddress/:address?/:minconf?', (req, res) => {
    zelcashService.zListReceivedByAddress(req, res);
  });
  app.get('/zelcash/zlistunspent/:minconf?/:maxonf?/:includewatchonly?/:addresses?', (req, res) => {
    zelcashService.zListUnspent(req, res);
  });
  app.get('/zelcash/zmergetoaddress/:fromaddresses?/:toaddress?/:fee?/:transparentlimit?/:shieldedlimit?/:memo?', (req, res) => {
    zelcashService.zMergeToAddress(req, res);
  });
  app.get('/zelcash/zsendmany/:fromaddress?/:amounts?/:minconf?/:fee?', (req, res) => {
    zelcashService.zSendMany(req, res);
  });
  app.get('/zelcash/zsetmigration/:enabled?', (req, res) => {
    zelcashService.zSetMigration(req, res);
  });
  app.get('/zelcash/zshieldcoinbase/:fromaddress?/:toaddress?/:fee?/:limit?', (req, res) => {
    zelcashService.zShieldCoinBase(req, res);
  });
  app.get('/zelcash/zcrawjoinsplit/:rawtx?/:inputs?/:outputs?/:vpubold?/:vpubnew?', (req, res) => {
    zelcashService.zcRawJoinSplit(req, res);
  });
  app.get('/zelcash/zcrawkeygen', (req, res) => {
    zelcashService.zcRawKeygen(req, res);
  });
  app.get('/zelcash/zcrawreceive/:zcsecretkey?/:encryptednote?', (req, res) => {
    zelcashService.zcRawReceive(req, res);
  });
  app.get('/zelcash/zcsamplejoinsplit', (req, res) => {
    zelcashService.zcSampleJoinSplit(req, res);
  });

  app.get('/zelid/loggedusers', (req, res) => {
    zelidService.loggedUsers(req, res);
  });
  app.get('/zelid/activeloginphrases', (req, res) => {
    zelidService.activeLoginPhrases(req, res);
  });
  app.get('/zelid/logoutallusers', (req, res) => {
    zelidService.logoutAllUsers(req, res);
  });

  app.get('/zelnode/startzelcash', (req, res) => {
    zelnodeService.startZelCash(req, res);
  });
  app.get('/zelnode/restartzelcash', (req, res) => {
    zelnodeService.restartZelCash(req, res);
  });
  app.get('/zelnode/reindexzelcash', (req, res) => {
    zelnodeService.reindexZelCash(req, res);
  });

  app.get('/zelbench/signzelnodetransaction/:hexstring?', (req, res) => {
    zelbenchService.signZelNodeTransaction(req, res);
  });
  app.get('/zelbench/stop', (req, res) => {
    zelbenchService.stop(req, res);
  });

  // GET PROTECTED API - ZelTeam
  app.get('/zelcash/start', (req, res) => {
    zelnodeService.startZelCash(req, res);
  });
  app.get('/zelcash/restart', (req, res) => {
    zelnodeService.restartZelCash(req, res);
  });
  app.get('/zelcash/ping', (req, res) => { // we do not want this to be issued by anyone.
    zelcashService.ping(req, res);
  });
  app.get('/zelcash/zcbenchmark/:benchmarktype?/:samplecount?', (req, res) => {
    zelcashService.zcBenchmark(req, res);
  });
  app.get('/zelcash/startzelbenchd', (req, res) => {
    zelcashService.startZelBenchD(req, res);
  });
  app.get('/zelcash/stopzelbenchd', (req, res) => {
    zelcashService.stopZelBenchD(req, res);
  });

  app.get('/zelnode/updatezelflux', (req, res) => { // method shall be called only if zelflux version is obsolete.
    zelnodeService.updateZelFlux(req, res);
  });
  app.get('/zelnode/hardupdatezelflux', (req, res) => { // method shall be called only if zelflux version is obsolete and updatezeflux is not working correctly
    zelnodeService.hardUpdateZelFlux(req, res);
  });
  app.get('/zelnode/rebuildzelfront', (req, res) => {
    zelnodeService.rebuildZelFront(req, res);
  });
  app.get('/zelnode/updatezelcash', (req, res) => { // method shall be called only if zelcash version is obsolete
    zelnodeService.updateZelCash(req, res);
  });
  app.get('/zelnode/updatezelbench', (req, res) => { // method shall be called only if zelbench version is obsolete
    zelnodeService.updateZelBench(req, res);
  });
  app.get('/zelnode/zelcashdebug', (req, res) => {
    zelnodeService.zelcashDebug(req, res);
  });
  app.get('/zelnode/zelbenchdebug', (req, res) => {
    zelnodeService.zelbenchDebug(req, res);
  });
  app.get('/zelnode/zelfluxerrorlog', (req, res) => {
    zelnodeService.zelfluxErrorLog(req, res);
  });

  app.get('/zelflux/broadcastmessage/:data?', (req, res) => {
    zelfluxCommunication.broadcastMessageFromUser(req, res);
  });
  app.get('/zelflux/broadcastmessagetooutgoing/:data?', (req, res) => {
    zelfluxCommunication.broadcastMessageToOutgoingFromUser(req, res);
  });
  app.get('/zelflux/broadcastmessagetoincoming/:data?', (req, res) => {
    zelfluxCommunication.broadcastMessageToIncomingFromUser(req, res);
  });
  app.get('/zelflux/addpeer/:ip?', (req, res) => {
    zelfluxCommunication.addPeer(req, res);
  });
  app.get('/zelflux/removepeer/:ip?', (req, res) => {
    zelfluxCommunication.removePeer(req, res);
  });
  app.get('/zelflux/removeincomingpeer/:ip?', (req, res) => {
    zelfluxCommunication.removeIncomingPeer(req, res, expressWs.getWss('/ws/zelflux'));
  });
  app.get('/zelflux/allowport/:port?', (req, res) => {
    zelfluxCommunication.allowPortApi(req, res);
  });
  app.get('/zelflux/checkcommunication', (req, res) => {
    zelfluxCommunication.isCommunicationEstablished(req, res);
  });

  app.get('/zelbench/restartnodebenchmarks', (req, res) => {
    zelbenchService.restartNodeBenchmarks(req, res);
  });

  app.get('/explorer/reindex', (req, res) => {
    explorerService.reindexExplorer(req, res);
  });
  app.get('/explorer/restart', (req, res) => {
    explorerService.restartBlockProcessing(req, res);
  });
  app.get('/explorer/stop', (req, res) => {
    explorerService.stopBlockProcessing(req, res);
  });
  app.get('/explorer/rescan/:blockheight?', (req, res) => {
    explorerService.rescanExplorer(req, res);
  });

  app.get('/zelapps/zelapppull/:repotag?', (req, res) => { // TODO make me post, needs redoing
    zelappsService.zelAppPull(req, res);
  });
  app.get('/zelapps/zelappstart/:container?', (req, res) => {
    zelappsService.zelAppStart(req, res);
  });
  app.get('/zelapps/zelappstop/:container?', (req, res) => {
    zelappsService.zelAppStop(req, res);
  });
  app.get('/zelapps/restartzelapp/:container?', (req, res) => {
    zelappsService.zelAppRestart(req, res);
  });
  app.get('/zelapps/zelappkill/:container?', (req, res) => {
    zelappsService.zelAppKill(req, res);
  });
  app.get('/zelapps/zelappcontainerremove/:container?', (req, res) => {
    zelappsService.zelAppRemove(req, res);
  });
  app.get('/zelapps/zelapppause/:container?', (req, res) => {
    zelappsService.zelAppPause(req, res);
  });
  app.get('/zelapps/zelappunpause/:container?', (req, res) => {
    zelappsService.zelAppUnpause(req, res);
  });
  app.get('/zelapps/zelapptop/:container?', (req, res) => {
    zelappsService.zelAppTop(req, res);
  });
  app.get('/zelapps/zelapplog/:container?', (req, res) => {
    zelappsService.zelAppLog(req, res);
  });
  app.get('/zelapps/zelappinspect/:container?', (req, res) => { // TODO this shall require app owner privilege for all information
    zelappsService.zelAppInspect(req, res);
  });
  app.get('/zelapps/zelappupdate/:container?/:cpus?/:memory?', (req, res) => { // TODO this shall require app owner privilege for all information
    zelappsService.zelAppUpdate(req, res);
  });
  app.get('/zelapps/zelappexec/:container?/:cmd?/:env?', (req, res) => { // todo post, privileges
    zelappsService.zelAppExec(req, res);
  });
  app.get('/zelapps/zelappremove/:zelapp?', (req, res) => {
    zelappsService.removeZelAppLocallyApi(req, res);
  });
  app.get('/zelapps/zelappimageremove/:image?', (req, res) => {
    zelappsService.zelAppImageRemove(req, res);
  });
  app.get('/zelapps/zelapptemporarylocalregister/foldingathome', (req, res) => {
    zelappsService.temporaryZelAppRegisterFunctionForFoldingAtHome(req, res);
  });
  app.get('/zelapps/createzelfluxnetwork', (req, res) => {
    zelappsService.createZelFluxNetwork(req, res);
  });

  // POST PUBLIC methods route
  app.post('/zelid/verifylogin', (req, res) => {
    zelidService.verifyLogin(req, res);
  });

  app.post('/zelcash/createrawtransaction', (req, res) => {
    zelcashService.createRawTransactionPost(req, res);
  });
  app.post('/zelcash/decoderawtransaction', (req, res) => {
    zelcashService.decodeRawTransactionPost(req, res);
  });
  app.post('/zelcash/decodescript', (req, res) => {
    zelcashService.decodeScriptPost(req, res);
  });
  app.post('/zelcash/fundrawtransaction', (req, res) => {
    zelcashService.fundRawTransactionPost(req, res);
  });
  app.post('/zelcash/sendrawtransaction', (req, res) => {
    zelcashService.sendRawTransactionPost(req, res);
  });
  app.post('/zelcash/createmultisig', (req, res) => {
    zelcashService.createMultiSigPost(req, res);
  });
  app.post('/zelcash/verifymessage', (req, res) => {
    zelcashService.verifyMessagePost(req, res);
  });

  app.post('/zelapps/zelappregister', (req, res) => {
    zelappsService.registerZelAppGlobalyApi(req, res);
  });

  // POST PROTECTED API - USER LEVEL
  app.post('/zelid/logoutspecificsession', (req, res) => { // requires the knowledge of a session loginPhrase so users level is sufficient and user cannot logout another user as he does not know the loginPhrase.
    zelidService.logoutSpecificSession(req, res);
  });

  app.post('/zelcash/submitblock', (req, res) => {
    zelcashService.submitBlockPost(req, res);
  });

  // POST PROTECTED API - ZelNode owner level
  app.post('/zelcash/signrawtransaction', (req, res) => {
    zelcashService.signRawTransactionPost(req, res);
  });
  app.post('/zelcash/addmultisigaddress', (req, res) => {
    zelcashService.addMultiSigAddressPost(req, res);
  });
  app.post('/zelcash/sendfrom', (req, res) => {
    zelcashService.sendFromPost(req, res);
  });
  app.post('/zelcash/sendmany', (req, res) => {
    zelcashService.sendManyPost(req, res);
  });
  app.post('/zelcash/sendtoaddress', (req, res) => {
    zelcashService.sendToAddressPost(req, res);
  });
  app.post('/zelcash/signmessage', (req, res) => {
    zelcashService.signMessagePost(req, res);
  });
  app.post('/zelcash/zsendmany', (req, res) => {
    zelcashService.zSendManyPost(req, res);
  });
  app.post('/zelcash/zcrawjoinsplit', (req, res) => {
    zelcashService.zcRawJoinSplitPost(req, res);
  });
  app.post('/zelcash/zcrawreceive', (req, res) => {
    zelcashService.zcRawReceivePost(req, res);
  });

  app.post('/zelbench/signzelnodetransaction', (req, res) => {
    zelbenchService.signZelNodeTransactionPost(req, res);
  });

  // POST PROTECTED API - ZelTeam
  app.post('/zelflux/broadcastmessage', (req, res) => {
    zelfluxCommunication.broadcastMessageFromUserPost(req, res);
  });
  app.post('/zelflux/broadcastmessagetooutgoing', (req, res) => {
    zelfluxCommunication.broadcastMessageToOutgoingFromUserPost(req, res);
  });
  app.post('/zelflux/broadcastmessagetoincoming', (req, res) => {
    zelfluxCommunication.broadcastMessageToIncomingFromUserPost(req, res);
  });

  // WebSockets PUBLIC
  app.ws('/ws/zelid/:loginphrase', (ws, req) => {
    zelidService.wsRespondLoginPhrase(ws, req);
  });

  // communication between multiple zelflux solution is on this:
  app.ws('/ws/zelflux', (ws, req) => {
    zelfluxCommunication.handleIncomingConnection(ws, req, expressWs.getWss('/ws/zelflux'));
  });
};
