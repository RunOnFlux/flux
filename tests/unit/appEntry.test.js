// The entry point pins four environment variables before its first require, and
// what they are worth is only visible in a process that actually loaded it. So
// this loads the real app.js in a child, and reads the environment back out.
//
// A child rather than an in-process require: app.js pulls the whole service tree,
// which leaves timers and connections open, and those must not outlive one test.
// The require.main guard in app.js is what makes loading it safe at all - without
// it the child would start a node.

const { expect } = require('chai');
const path = require('path');
const { execFile } = require('child_process');

const appPath = path.join(__dirname, '..', '..', 'app.js');

// The child starts with every one of these already set, and set wrongly. The
// environment is not hashed, so a value taken from it is a change to what the node
// discloses that tamper detection cannot see - which is the whole reason app.js
// assigns rather than defaults. Seeded here so each assertion below can fail:
// against an inherited environment they would all pass on absence.
const HOSTILE_ENV = {
  NODE_ENV: 'development',
  NODE_CONFIG_ENV: 'production',
  NODE_CONFIG: '{"fluxSpecifics":{"apiPort":9999}}',
  NODE_CONFIG_DIR: '/tmp/not-the-directory-fluxbench-hashes',
};

/**
 * Loads the real app.js in a child process and reports what it left behind.
 * @returns {Promise<{env: object, stderr: string}>}
 */
function loadEntryPoint() {
  const script = `require(${JSON.stringify(appPath)});
    process.stdout.write(JSON.stringify({
      NODE_ENV: process.env.NODE_ENV ?? null,
      NODE_CONFIG_ENV: process.env.NODE_CONFIG_ENV ?? null,
      NODE_CONFIG: process.env.NODE_CONFIG ?? null,
      NODE_CONFIG_DIR: process.env.NODE_CONFIG_DIR ?? null,
    }));
    process.exit(0);`;

  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...HOSTILE_ENV };
    execFile(process.execPath, ['-e', script], { env, timeout: 60000 }, (error, stdout, stderr) => {
      if (error && !stdout) {
        reject(new Error(`app.js could not be loaded: ${error.message}\n${stderr}`));
        return;
      }
      resolve({ env: JSON.parse(stdout), stderr });
    });
  });
}

describe('the entry point', function () {
  this.timeout(90000);

  let loaded;

  before(async () => {
    loaded = await loadEntryPoint();
  });

  // Express hands a caller the exception stack instead of the status text, and
  // apicache stamps its version onto every cached response, unless this says
  // production. Both read it after app.js has loaded, so the assertion is on the
  // value the entry point leaves set.
  it('runs the node in production mode, whatever the environment asked for', () => {
    expect(loaded.env.NODE_ENV).to.equal('production');
  });

  // node-config names its deployment from the environment, preferring this
  // variable to NODE_ENV, and prints a warning for a name it has no file for.
  // ZelBack/config holds default.js alone, so production must not reach it.
  it('leaves the config deployment where it was, and says nothing on startup', () => {
    expect(loaded.env.NODE_CONFIG_ENV).to.equal('development');
    expect(loaded.stderr).to.not.contain('did not match any deployment config file names');
  });

  // The two doors app.js already closed. A config directory that moves, or a
  // NODE_CONFIG merged over every file, redirects an endpoint without touching
  // anything fluxbench hashes.
  //
  // Asserted on the process, not on one file: apiServer.js repeats both lines, and
  // app.js loads it, so reverting either file alone leaves this green. It pins the
  // state a loaded entry point must be in, which is the property worth keeping -
  // not which line put it there.
  it('pins the config directory and closes the one that is merged over it', () => {
    expect(loaded.env.NODE_CONFIG_DIR).to.equal(`${path.join(__dirname, '..', '..')}/ZelBack/config/`);
    expect(loaded.env.NODE_CONFIG).to.equal(null);
  });
});
