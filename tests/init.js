const fs = require('fs');
const path = require('path');

// Ensure log files exist so the log module doesn't throw ENOENT during tests
for (const name of ['error.log', 'debug.log', 'warn.log']) {
  const p = path.join(process.cwd(), name);
  if (!fs.existsSync(p)) fs.writeFileSync(p, '');
}

globalThis.userconfig = {
  initial: {
    ipaddress: '127.0.0.1',
    zelid: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
    kadena: 'kadena:3a2e6166907d0c2fb28a16cd6966a705de129e8358b9872d9cefe694e910d5b2?chainid=0',
    testnet: false,
    development: false,
    apiport: 16127,
    routerIP: '',
    pgpPrivateKey: '',
    pgpPublicKey: '',
    blockedPorts: [],
    blockedRepositories: [],
  },
};
