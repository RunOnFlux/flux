const express = require('express');
const eWS = require('express-ws');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');

const expressWs = eWS(express());
const { app } = expressWs;

app.use(compression());
app.use(morgan('combined'));
app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
app.use(cors());

require('../routes')(app, expressWs);

module.exports = app;
