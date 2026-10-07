// A harness node rejoins the mesh on every FluxOS start after the first, as a
// production node does. The harness boots each fleet with discovery off and
// starts it once the fleet is up (env.startDiscovery); a node it has started
// keeps starting discovery itself from then on, whether FluxOS comes back by a
// respawn, through pm2, or with its container.
//
//   mark   - this node's discovery has been started; applied at once.
//   apply  - re-applied over a config the entrypoint has just rewritten.

const fs = require('fs');

const MARKER = '/flux/.rejoin-discovery';
const CONFIG = '/flux/ZelBack/config/local.js';

const [mode] = process.argv.slice(2);
if (mode === 'mark') {
  fs.writeFileSync(MARKER, '');
} else if (mode !== 'apply') {
  console.error('rejoin-discovery: mode must be mark or apply');
  process.exit(2);
}
if (!fs.existsSync(MARKER)) process.exit(0);

const config = fs.existsSync(CONFIG) ? require(CONFIG) : {};
config.fluxapps = { ...(config.fluxapps || {}), discoveryAutostart: true };
fs.writeFileSync(CONFIG, `module.exports = ${JSON.stringify(config, null, 2)};\n`);
