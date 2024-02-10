const express = require('express');
const eWS = require('express-ws');
const cors = require('cors');
const morgan = require('morgan');

function handleError(middleware, req, res, next) {
  middleware(req, res, (err) => {
    if (err) {
      return res.sendStatus(400);
    }

    next();
  });
}

const expressWs = eWS(express());
const { app } = expressWs;

app.use(morgan('combined'));
app.use(cors());
app.use((req, res, next) => {
  handleError(express.json(), req, res, next);
});

require('../routes')(app, expressWs);

module.exports = app;
