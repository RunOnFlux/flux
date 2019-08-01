const defaultService = require('./services/defaultService')

module.exports = (app) => {
  // GET methods
  app.get('/', (req, res) => {
    defaultService.defaultResponse(req, res)
  })
  // POST methods route
}
