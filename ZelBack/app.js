
const http = require('http')
const config = require('config')
const app = require('./src/lib/server.js')
const log = require('./src/lib/log')

const server = http.createServer(app)

server.listen(config.server.localport, () => {
  log.info(`App listening on port ${config.server.localport}!`)
})
