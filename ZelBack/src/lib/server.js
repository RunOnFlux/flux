const express = require('express');
// const eWS = require('express-ws');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const routeBuilder = require('../routes');

const app = express();
// const expressWs = eWS(app, null, options);

app.use(compression());
app.use(morgan('combined'));
app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
app.use(cors());

routeBuilder(app);

module.exports = app;
