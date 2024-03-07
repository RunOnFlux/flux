const express = require('express');
const eWS = require('express-ws');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');

const log = require('./log');

const expressWs = eWS(express());
const { app } = expressWs;

const logger = (req, res, next) => {
  log.info(`\n\n${req.method}\n${req.url}\n${req.ip}\n`)
  next();
};

app.use(compression());
app.use(morgan('combined'));
app.use(logger());
app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
app.use(cors());

require('../routes')(app, expressWs);

module.exports = app;
