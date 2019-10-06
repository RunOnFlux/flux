const zelcashService = require('./services/zelcashService');
const zelidService = require('./services/zelidService');
const zelnodeService = require('./services/zelnodeService');

module.exports = (app) => {
  // GET PUBLIC methods
  app.get('/zelcash/help/:command?', (req, res) => { // accept both help/command and ?command=getinfo. If ommited, default help will be displayed. Other calls works in similar way
    zelcashService.help(req, res);
  });
  app.get('/zelcash/getinfo', (req, res) => {
    zelcashService.getInfo(req, res);
  });
  app.get('/zelcash/getzelnodestatus', (req, res) => {
    zelcashService.getZelnNodeStatus(req, res);
  });
  app.get('/zelcash/listzelnodes', (req, res) => {
    zelcashService.listZelNodes(req, res);
  });
  app.get('/zelcash/znsync/:mode?', (req, res) => {
    zelcashService.znsync(req, res);
  });
  app.get('/zelcash/getnodebenchmarks', (req, res) => {
    zelcashService.getNodeBenchmarks(req, res);
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
    zelcashService.getBlockHah(req, res);
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
  app.get('/zelcash/createrawtransaction/:transactions?/:addresses?/:locktime?/:expiryheight?', (req, res) => { // todo make this post too
    zelcashService.createRawTransaction(req, res);
  });
  app.get('/zelcash/decoderawtransaction/:hexstring?', (req, res) => { // todo make this post too
    zelcashService.decodeRawTransaction(req, res);
  });
  app.get('/zelcash/decodescript/:hex?', (req, res) => { // todo make this post too
    zelcashService.decodeScript(req, res);
  });
  app.get('/zelcash/fundrawtransaction/:hexstring?', (req, res) => { // todo make this post too
    zelcashService.fundRawTransaction(req, res);
  });
  app.get('/zelcash/getrawtransaction/:txid?/:verbose?', (req, res) => { // todo make this post too
    zelcashService.getRawTransaction(req, res);
  });
  app.get('/zelcash/sendrawtransaction/:hexstring?/:allowhighfees?', (req, res) => { // todo make this post too
    zelcashService.sendRawTransaction(req, res);
  });
  app.get('/zelcash/createmultisig/:n?/:keys?', (req, res) => { // todo make this post too
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
  app.get('/zelcash/zvalidateaddress/:zaddr?', (req, res) => {
    zelcashService.zValidateAddress(req, res);
  });
  app.get('/zelid/loginphrase', (req, res) => {
    zelidService.loginPhrase(req, res);
  });
  app.get('/zelnode/version', (req, res) => {
    zelnodeService.getFluxVersion(req, res);
  });

  // GET PROTECTED API - User level
  app.get('/zelcash/prioritisetransaction/:txid?/:prioritydelta?/:feedelta?', (req, res) => {
    zelcashService.prioritiseTransaction(req, res);
  });
  app.get('/zelcash/submitblock/:hexdata?/:jsonparametersobject?', (req, res) => { // todo make it post too
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

  // GET PROTECTED API - ZelNode Owner
  app.get('/zelcash/stop', (req, res) => {
    zelcashService.stop(req, res);
  });
  app.get('/zelcash/createzelnodekey', (req, res) => {
    zelcashService.createZelNodeKey(req, res);
  });
  app.get('/zelcash/createzelnodebroadcast/:command?/:alias?', (req, res) => {
    zelcashService.createZelNodeBroadcast(req, res);
  });
  app.get('/zelcash/listzelnodeconf', (req, res) => {
    zelcashService.listZelNodeConf(req, res);
  });
  app.get('/zelcash/getzelnodeoutputs', (req, res) => {
    zelcashService.listZelNodeConf(req, res);
  });
  app.get('/zelcash/startzelnode/:set?/:lockwallet?/:alias?', (req, res) => {
    zelcashService.startZelNode(req, res);
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
  app.get('/zelcash/signrawtransaction/:hexstring?/:prevtxs?/:privatekeys?/:sighashtype?/:branchid?', (req, res) => { // todo make this post too
    zelcashService.signRawTransaction(req, res);
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
  app.get('/zelnode/startZelCash', (req, res) => {
    zelnodeService.startZelCash(req, res);
  });

  // GET PROTECTED API - ZelTeam
  app.get('/zelcash/ping', (req, res) => { // we do not want this to be issued by anyone.
    zelcashService.ping(req, res);
  });
  app.get('/zelnode/updateflux', (req, res) => { // method shall be called only if zelflux version is obsolete.
    zelnodeService.updateFlux(req, res);
  });
  app.get('/zelnode/rebuildzelfront', (req, res) => {
    zelnodeService.rebuildZelFront(req, res);
  });
  app.get('/zelnode/updatezelcash', (req, res) => { // method shall be called only if zelcash version is obsolete
    zelnodeService.updateZelCash(req, res);
  });

  // POST PUBLIC methods route
  app.post('/zelid/verifylogin', (req, res) => {
    zelidService.verifyLogin(req, res);
  });

  // POST PROTECTED API - USER LEVEL
  app.post('/zelid/logoutspecificsession', (req, res) => { // requires the knowledge of a session loginPhrase so users level is sufficient and user cannot logout another user as he does not know the loginPhrase.
    zelidService.logoutSpecificSession(req, res);
  });

  // WebSockets PUBLIC
  app.ws('/ws/zelid/:loginphrase', (ws, req) => {
    zelidService.wsRespondLoginPhrase(ws, req);
  });
};
