// Flux configuration
process.env.NODE_CONFIG_DIR = `${__dirname}/ZelBack/config/`;
const config = require('config');
// const fs = require('fs');
// const https = require('https');
// const path = require('path');
const app = require('./ZelBack/src/lib/server');
const log = require('./ZelBack/src/lib/log');
const serviceManager = require('./ZelBack/src/services/serviceManager');

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
