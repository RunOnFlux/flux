const express = require('express');
const eWS = require('express-ws');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');

// see https://github.com/HenningM/express-ws/issues/120
const options = {
  wsOptions: {
    maxPayload: 65535,
  },
};

const app = express();
const expressWs = eWS(app, null, options);

app.use(compression());
app.use(morgan('combined'));
app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
app.use(cors());

require('../routes')(app, expressWs);

module.exports = app;
