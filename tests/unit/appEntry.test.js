// An entry point pins four environment variables before its first require, and what
// they are worth is only visible in a process that actually loaded it. So this loads
// each real entry point in a child, and reads the environment back out.
//
// A child rather than an in-process require: both pull the service tree, which leaves
// timers and connections open, and those must not outlive one test. The require.main
// guard in each is what makes loading it safe at all - without it the child would
// start a node.
//
// Both are covered because both are entry points. app.js is what fluxos.service runs,
// and apiServer.js self-starts under `require.main === module`, so a process can begin
// at either and has to answer the same way whichever it began at.

const { expect } = require('chai');
const path = require('path');
const { execFile } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');

const ENTRY_POINTS = [
  { name: 'app.js', file: path.join(repoRoot, 'app.js') },
  { name: 'apiServer.js', file: path.join(repoRoot, 'apiServer.js') },
];

// The child starts with every one of these already set, and set wrongly. A value taken
// from the environment changes what the node discloses without any file saying so, which
// is the whole reason the pins assign rather than default. Seeded here so each assertion
// below can fail: against an inherited environment they would all pass on absence.
const HOSTILE_ENV = {
  NODE_ENV: 'development',
  NODE_CONFIG_ENV: 'production',
  NODE_CONFIG: '{"fluxSpecifics":{"apiPort":9999}}',
  NODE_CONFIG_DIR: '/tmp/not-the-pinned-config-directory',
};

/**
 * Loads a real entry point in a child process and reports what it left behind.
 * @param {string} entryFile - absolute path to the entry point
 * @returns {Promise<{env: object, stderr: string}>}
 */
function loadEntryPoint(entryFile) {
  const script = `require(${JSON.stringify(entryFile)});
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
        reject(new Error(`${entryFile} could not be loaded: ${error.message}\n${stderr}`));
        return;
      }
      resolve({ env: JSON.parse(stdout), stderr });
    });
  });
}

ENTRY_POINTS.forEach(({ name, file }) => {
  describe(`the entry point: ${name}`, function () {
    this.timeout(90000);

    let loaded;

    before(async () => {
      loaded = await loadEntryPoint(file);
    });

    // Express hands a caller the exception stack instead of the status text, and
    // apicache stamps its version onto every cached response, unless this says
    // production. Both read it after the entry point has loaded, so the assertion is
    // on the value the entry point leaves set.
    it('runs the node in production mode, whatever the environment asked for', () => {
      expect(loaded.env.NODE_ENV).to.equal('production');
    });

    // node-config names its deployment from the environment, preferring this variable
    // to NODE_ENV, and prints a warning for a name it has no file for. ZelBack/config
    // holds default.js alone, so production must not reach it. That is why the two are
    // pinned together and neither is pinned on its own.
    it('leaves the config deployment where it was, and says nothing on startup', () => {
      expect(loaded.env.NODE_CONFIG_ENV).to.equal('development');
      expect(loaded.stderr).to.not.contain('did not match any deployment config file names');
    });

    // A config directory that moves, or a NODE_CONFIG merged over every file, redirects
    // an endpoint without changing a single line of the node's own code.
    //
    // Asserted on the process rather than on the file that set it: what matters is the
    // state a loaded entry point is in, not which line put it there.
    it('pins the config directory and closes the one that is merged over it', () => {
      expect(loaded.env.NODE_CONFIG_DIR).to.equal(`${repoRoot}/ZelBack/config/`);
      expect(loaded.env.NODE_CONFIG).to.equal(null);
    });
  });
});
