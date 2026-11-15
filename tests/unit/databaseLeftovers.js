const path = require('path');
const dbHelper = require('../../ZelBack/src/services/dbHelper');

// Root hooks for the unit suite (mocha --require, beside tests/init.js).
//
// A file that opens the real database closes it in its own after hook
// (dbTestHelper.releaseMongo). A client left open keeps its monitor's timers
// running through every later file, where a test that fakes timers for the
// whole process captures them. After each file's own after hooks, a connection
// still open is closed and the file named; the run fails at the end with every
// such file.

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
  afterAll() {
    if (leftOpen.length) {
      throw new Error(`these files left the database connection open (close it in the file's after hook with dbHelper.closeDbConnection()): ${leftOpen.join(', ')}`);
    }
  },
};
