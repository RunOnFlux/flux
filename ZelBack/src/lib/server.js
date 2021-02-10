const express = require('express');
const compression = require('compression');
const eWS = require('express-ws');
const bodyParser = require('body-parser');
const cors = require('cors');
const morgan = require('morgan');

const expressWs = eWS(express());
const { app } = expressWs;

app.use(morgan('combined'));
app.use(bodyParser.json());
app.use(cors());
app.use(compression);

require('../routes')(app, expressWs);

module.exports = app;
