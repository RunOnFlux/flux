const express = require('express')
const enableWs = require('express-ws')
const bodyParser = require('body-parser')
const cors = require('cors')
const morgan = require('morgan')

const app = express()
enableWs(app)
app.use(morgan('combined'))
app.use(bodyParser.json())
app.use(cors())

require('../routes')(app)

module.exports = app
