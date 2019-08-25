// ZelBack configuration
const config = require('config')
const app = require('./ZelBack/src/lib/server.js')
const log = require('./ZelBack/src/lib/log')

app.listen(config.server.localport, () => {
  log.info(`ZelBack running on port ${config.server.localport}!`)
})

// ZelFront configuration
const path = require('path')
const express = require('express')
const zelfront = path.join(__dirname, './ZelFront/dist')

const ZelBackApp = express()
ZelBackApp.use(express.static(zelfront))

ZelBackApp.get('*', (req, res) => {
  res.sendFile(path.join(zelfront, 'index.html'))
})

ZelBackApp.listen(config.server.zelfrontport, () => {
  log.info(`ZelFront running on port ${config.server.zelfrontport}!`)
})
