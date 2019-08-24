const zelcashService = require('./services/zelcashService')
const zelidService = require('./services/zelidService')

module.exports = (app) => {
  // GET PUBLIC methods
  app.get('/getinfo', (req, res) => {
    zelcashService.getInfo(req, res)
  })
  app.get('/getzelnodestatus', (req, res) => {
    zelcashService.getZelnNodeStatus(req, res)
  })
  app.get('/zelid/loginphrase', (req, res) => {
    zelidService.loginPhrase(req, res)
  })

  // GET PROTECTED API - User level
  app.get('/zelid/logoutcurrentsession', (req, res) => {
    zelidService.logoutCurrentSession(req, res)
  })
  app.get('/zelid/logoutallsessions', (req, res) => {
    zelidService.logoutAllSessions(req, res)
  })

  // GET PROTECTED API - ZelNode Owner
  app.get('/zelid/loggedusers', (req, res) => {
    zelidService.loggedUsers(req, res)
  })
  app.get('/zelid/activeloginphrases', (req, res) => {
    zelidService.activeLoginPhrases(req, res)
  })
  app.get('/zelid/logoutallusers', (req, res) => {
    zelidService.logoutAllUsers(req, res)
  })

  // POST PUBLIC methods route
  app.post('/zelid/verifylogin', (req, res) => {
    zelidService.verifyLogin(req, res)
  })

  // WebSockets PUBLIC
  app.ws('/ws/zelid/:loginphrase', (ws, req) => {
    zelidService.wsRespondLoginPhrase(ws, req)
  })
}
