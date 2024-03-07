const express = require('express');
const eWS = require('express-ws');
const cors = require('cors');

const log = require('./log');
const morgan = require('morgan');
const compression = require('compression');

const log = require('./log');

const expressWs = eWS(express());
const { app } = expressWs;

const logger = () => {
  return (req, res, next) => {
    log.info({ url: req.url, method: req.method, ip: req.ip });
    next();
  }
};

app.use(logger());
app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
app.use(cors());

require('../routes')(app, expressWs);

module.exports = app;
