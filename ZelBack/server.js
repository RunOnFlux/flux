// ZelBack configuration
const config = require('config');
const fs = require('fs');
const https = require('https');
const app = require('./src/lib/server.js');
const log = require('./src/lib/log');
const communication = require('./src/services/zelfluxCommunication');

const key = fs.readFileSync(`${__dirname}../../certs/selfsigned.key`, 'utf8');
const cert = fs.readFileSync(`${__dirname}../../certs/selfsigned.crt`, 'utf8');
const credentials = { key, cert };
const httpsServer = https.createServer(credentials, app);

httpsServer.listen(config.server.apiporthttps, () => {
  log.info(`ZelBack https listening on port ${config.server.apiporthttps}!`);
});

app.listen(config.server.apiport, () => {
  log.info(`ZelBack listening on port ${config.server.apiport}!`);
  communication.startFluxFunctions();
});
