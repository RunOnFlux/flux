const zelcashService = require('./services/zelcashService');
const zelidService = require('./services/zelidService');
const zelnodeService = require('./services/zelnodeService');

module.exports = (app) => {
  // GET PUBLIC methods
  app.get('/zelcash/help', (req, res) => {
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
  app.get('/zelcash/znsync/:option?', (req, res) => { // accept both znsync/status and znsync?option=status. STATUS is public, otherwise zelnode owner
    zelcashService.znsync(req, res);
  });
  app.get('/zelcash/getnodebenchmarks', (req, res) => {
    zelcashService.getNodeBenchmarks(req, res);
  });
  app.get('/zelid/loginphrase', (req, res) => {
    zelidService.loginPhrase(req, res);
  });
  app.get('/zelnode/version', (req, res) => {
    zelnodeService.getFluxVersion(req, res);
  });

  // GET PROTECTED API - User level
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
  app.get('/zelcash/listzelnodeconf', (req, res) => {
    zelcashService.listZelNodeConf(req, res);
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
  app.get('/zelnode/updateflux', (req, res) => { // method shall be called only if flux version is obsolete.
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
  app.post('/zelid/logoutspecificsession', (req, res) => { // requires the knowledge of session loginPhrase so user level is sufficient and user cannot logout another user as he does not know the loginPhrase.
    zelidService.logoutSpecificSession(req, res);
  });

  // WebSockets PUBLIC
  app.ws('/ws/zelid/:loginphrase', (ws, req) => {
    zelidService.wsRespondLoginPhrase(ws, req);
  });
};
