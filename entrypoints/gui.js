const path = require('node:path');

const compression = require('compression');
const express = require('express');

const log = require('../lib/log');

const logger = () => {
  return (req, res, next) => {
    log.debug({ url: req.url, method: req.method, ip: req.ip.replace('::ffff:', '') }, "Incomming GUI request:")
    next();
  }
};

const homeApp = express();
homeApp.use(logger());

let server;
let currentPort;

function runServer(port) {
  server = homeApp.listen(port, () => {
    currentPort = port;
    log.info(`Flux HomeUI running on port: ${port}!`);
  })
  server.on('error', function (err) { log.error(err) });
}

function initiate(port, options = {}) {
  if (server && !options.reload) return;

  if (options.reload) {
    reload(port, options);
    return;
  }

  const homePath = path.join(__dirname, '../HomeUI/dist');

  homeApp.use(compression());
  homeApp.use(express.static(homePath));

  homeApp.get('/robots.txt', (_, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nDisallow: /');
  });

  homeApp.get('*', (_, res) => {
    res.sendFile(path.join(homePath, 'index.html'));
  });

  runServer(port);
}

async function reload(port, options = {}) {
  if (!options.force && currentPort === port) return;

  if (server) await server.close();
  runServer(port);
}

module.exports = {
  initiate,
  reload
}

// testing
if (!module.parent) {
  initiate(16187);
  // setTimeout(() => reload(16197), 10 * 1000);
}
