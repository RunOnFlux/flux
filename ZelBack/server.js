// Flux configuration
process.env.NODE_CONFIG_DIR = `${__dirname}/config/`;
const config = require('config');
// const fs = require('fs');
// const https = require('https');
// const path = require('path');
const app = require('./src/lib/server.js');
const log = require('./src/lib/log');
const serviceManager = require('./src/services/serviceManager');

// const key = fs.readFileSync(path.join(__dirname, '../certs/selfsigned.key'), 'utf8');
// const cert = fs.readFileSync(path.join(__dirname, '../certs/selfsigned.crt'), 'utf8');
// const credentials = { key, cert };
// const httpsServer = https.createServer(credentials, app);

// httpsServer.listen(config.server.apiporthttps, () => {
//   log.info(`Flux https listening on port ${config.server.apiporthttps}!`);
// });

app.listen(config.server.apiport, () => {
  log.info(`Flux listening on port ${config.server.apiport}!`);
  serviceManager.startFluxFunctions();
});
