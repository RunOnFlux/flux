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

// Every suite gets a globalState in its default state. It is a singleton shared
// by the whole process, and a suite that sets a flag or fills a cache used to
// leave it for whichever suite ran next - which is how a reconciler test came to
// depend on a redeploy test's leftovers, and why one added test could turn four
// unrelated ones red.
// eslint-disable-next-line global-require
const { resetGlobalState } = require('./unit/fixtures/globalState');

exports.mochaHooks = {
  beforeEach() {
    resetGlobalState();
  },
};
