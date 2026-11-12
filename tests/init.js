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
  },
};

// Every suite gets a globalState in its default state. It is a singleton shared
// by the whole process, and a suite that sets a flag or fills a cache used to
// leave it for whichever suite ran next - which is how a reconciler test came to
// depend on a redeploy test's leftovers, and why one added test could turn four
// unrelated ones red.
// eslint-disable-next-line global-require
const { resetGlobalState } = require('./unit/fixtures/globalState');

// A stall of the process, rather than of a test's own work, is reported with the
// test running and what held it (stallWatch.js).
const stallWatch = require('./stallWatch');

// A file that opens the real database closes it in its own after hook. A client
// left open keeps its monitor's timers running through every later file, where a
// test that fakes timers for the whole process captures them and spends real time
// running them. After each file's own after hooks, a connection still open is
// closed and the file named; the run fails at the end with every such file.
const dbHelper = require('../ZelBack/src/services/dbHelper');

const leftOpen = [];

async function closeWhatTheFileLeft(file) {
  if (!dbHelper.databaseConnection()) return;
  leftOpen.push(path.relative(process.cwd(), file));
  await dbHelper.closeDbConnection();
}

exports.mochaHooks = {
  beforeAll() {
    // The check runs as the last after hook of each file's last top-level suite.
    const lastSuiteOfFile = new Map();
    this.test.parent.suites.forEach((suite) => lastSuiteOfFile.set(suite.file, suite));
    lastSuiteOfFile.forEach((suite, file) => suite.afterAll(() => closeWhatTheFileLeft(file)));
  },
  beforeEach() {
    stallWatch.testStarted(this.currentTest.fullTitle());
    resetGlobalState();
  },
  async afterAll() {
    if (leftOpen.length) {
      throw new Error(`these files left the database connection open (close it in the file's after hook with dbHelper.closeDbConnection()): ${leftOpen.join(', ')}`);
    }
  },
};
