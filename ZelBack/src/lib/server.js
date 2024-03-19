const express = require('express');
const eWS = require('express-ws');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');

const log = require('../../../lib/log');

const expressWs = eWS(express());
const { app } = expressWs;

const logger = () => (req, _, next) => {
  log.debug({ url: req.url, method: req.method, ip: req.ip.replace('::ffff:', '') }, 'Incomming API request:');
  next();
};

app.use(compression());
app.use(morgan('combined'));
app.use(logger);
app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
app.use(cors());

require('../routes')(app, expressWs);

module.exports = app;
