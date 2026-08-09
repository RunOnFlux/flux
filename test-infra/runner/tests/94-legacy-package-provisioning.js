// A legacy node provisions its own packages; an Arcane node never does, because
// monitorSystem returns on sight of FLUXOS_PATH. Both regimes a legacy node can
// boot into are covered here:
//
//   seeded    - the packages are already there, which is every boot after the
//               first. The checks must run and decide to do nothing.
//   unseeded  - the packages are absent, which is the first boot. The checks must
//               install them, from the repository the fleet serves.
//
// The assertions are on the `system:packages-checked` payload rather than on the
// packages alone, and that is the whole point of the event: on a seeded node the
// packages are present whether or not the checks ever ran, so presence proves
// nothing about the code under test. `installed: []` proves the pass happened and
// found its work done, which is a different fact from silence.
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { waitForPackagesChecked } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// ca-certificates is checked too, but the image satisfies it in both regimes and
// the entrypoint never purges it - removing it would break TLS before FluxOS ran.
const SEEDED_PACKAGES = ['chrony', 'syncthing', 'netcat-openbsd'];

// A first boot installs for real, and the apt queue runs one command at a time
// with a lock wait of its own behind each. The seeded node answers in seconds
// because it does nothing; this one has actual work to do.
const INSTALL_TIMEOUT_MS = 480000;

async function installedVersion(client, systemPackage) {
  const { stdout } = await execInContainer(
    client.container,
    `dpkg-query --showformat='\${Version}|\${Status}' --show ${systemPackage} 2>/dev/null || true`,
  );
  const [version, status] = stdout.replace(/'/g, '').trim().split('|');
  return status === 'install ok installed' ? version : '';
}

describe('94 legacy package provisioning', function suite() {
  this.timeout(600000);

  describe('a seeded node', () => {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function hook() {
      env = await createTestEnv({
        hookCtx: this, nodes: 1, legacyNodes: [0], tickerAutostart: false,
      });
    });

    after(async () => {
      await env?.teardown();
    });

    it('runs its package checks and installs nothing', async () => {
      const event = await waitForPackagesChecked(env.clients[0]);
      expect(event.data.installed).to.deep.equal([]);
    });

    it('has every package the image seeded', async () => {
      for (const systemPackage of SEEDED_PACKAGES) {
        const version = await installedVersion(env.clients[0], systemPackage);
        expect(version, `${systemPackage} should be installed`).to.not.equal('');
      }
    });

    it('carries syncthing as a dpkg package, the way a node does', async () => {
      // The image installed it from the repository rather than unpacking a release
      // tarball, so dpkg knows about it - which is what getPackageVersion reads. A
      // tarball leaves that query empty and the version check with nothing to
      // compare, so it would ask for an install on a node that already has one.
      const version = await installedVersion(env.clients[0], 'syncthing');
      expect(version).to.match(/^\d+\.\d+\.\d+/);
    });
  });

  describe('an unseeded node', () => {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function hook() {
      env = await createTestEnv({
        hookCtx: this, nodes: 1, legacyNodes: [0], tickerAutostart: false, aptSeeded: false,
      });
    });

    after(async () => {
      await env?.teardown();
    });

    it('installs what it is missing, and says so', async () => {
      // Asserted from the event, not from a probe taken before and after: the
      // install runs inside the boot, so any probe racing it would sometimes read
      // the finished state and pass without the install having been observed.
      const event = await waitForPackagesChecked(env.clients[0], () => true, INSTALL_TIMEOUT_MS);
      expect(event.data.installed).to.have.members(SEEDED_PACKAGES);
    });

    it('ends up with the same packages a seeded node starts with', async () => {
      await waitForPackagesChecked(env.clients[0], () => true, INSTALL_TIMEOUT_MS);
      for (const systemPackage of SEEDED_PACKAGES) {
        const version = await installedVersion(env.clients[0], systemPackage);
        expect(version, `${systemPackage} should be installed`).to.not.equal('');
      }
    });
  });
});
