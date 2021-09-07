process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;
// Flux Home configuration
const config = require('config');
const compression = require('compression');
const path = require('path');
const express = require('express');

const home = path.join(__dirname, './HomeUI/dist');

const homeApp = express();
homeApp.use(compression());
homeApp.use(express.static(home));

homeApp.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /');
});

homeApp.get('*', (req, res) => {
  res.sendFile(path.join(home, 'index.html'));
});

homeApp.listen(config.server.homeport, () => {
  console.log(`Flux Home running on port ${config.server.homeport}!`);
});
