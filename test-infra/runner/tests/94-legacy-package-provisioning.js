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
import { waitForPackagesChecked, waitForAptCommand } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

// ca-certificates is checked too, but the image satisfies it in both regimes and
// the entrypoint never purges it - removing it would break TLS before FluxOS ran.
const SEEDED_PACKAGES = ['chrony', 'syncthing', 'netcat-openbsd'];

// A first boot installs for real, and the apt queue runs one command at a time
// with a lock wait of its own behind each. The seeded node answers in seconds
// because it does nothing; this one has actual work to do.
const INSTALL_TIMEOUT_MS = 480000;

// Bounded by measurement, not by fear. The whole suite - three fleets, boots and
// real installs - runs green in under a minute, because the repository is a
// file:// directory in the image rather than a network mirror. A regression here
// is a queue that stopped, so the wait is pure dead time: keep it short enough
// that a red arrives promptly and generous enough that a loaded box cannot
// invent one.
const RESUMED_PROVISION_TIMEOUT_MS = 120000;

// An event arrives the moment the command finishes, so this bounds a fact rather
// than a poll: generous against a slow boot, and nothing like the dead time of
// waiting to conclude that something never happened.
const APT_EVENT_TIMEOUT_MS = 90000;

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

  // The third regime a real node boots into, and the one nothing covered: the
  // packages are missing AND apt-get update fails. Every legacy boot queues an
  // update ahead of the installs, so a node that cannot survive one failing never
  // provisions itself at all - and an unreachable mirror, an expired repository
  // key or a DNS blip is an ordinary Tuesday, not an exotic fault.
  //
  // The apt queue halts on a final failure and the cache monitor resumes it, and
  // for a failed update it resumes SYNCHRONOUSLY, from inside the emit. A halt
  // written after that emit undid the resume: the queue stopped with every
  // install still queued behind it, nothing restarted it, and monitorSystem's
  // allSettled never settled - so `system:packages-checked` was never published
  // and chrony, syncthing and netcat never installed until FluxOS restarted.
  //
  // Asserted off the event bus, in order, because that is what it is for: the
  // update failing and an apt command completing after it are both FACTS the
  // product states, so the test reads them rather than inferring the second from
  // packages appearing on disk some time later. The first wait doubles as the
  // non-vacuity check - if the update did not fail, there is no such event and
  // nothing below it can pass for the wrong reason.
  describe('a node whose apt-get update fails', () => {
    let env;
    dumpLogsOnFailure(() => env);

    before(async function hook() {
      env = await createTestEnv({
        hookCtx: this,
        nodes: 1,
        legacyNodes: [0],
        tickerAutostart: false,
        aptSeeded: false,
        aptBadSource: true,
      });
    });

    after(async () => {
      await env?.teardown();
    });

    it('carries on to the work behind an update that failed', async () => {
      // Two facts off the bus, in order, rather than packages appearing on disk
      // minutes later: the update failed, and an apt command completed AFTER it.
      // The second is the whole property - the queue survived - and afterId is
      // what makes it "after" rather than "at some point".
      const failed = await waitForAptCommand(
        env.clients[0],
        (d) => d.command === 'update' && d.ok === false,
        APT_EVENT_TIMEOUT_MS,
      );

      const next = await waitForAptCommand(
        env.clients[0],
        (d) => d.ok === true,
        APT_EVENT_TIMEOUT_MS,
        { afterId: failed.id },
      );

      expect(next.data.command, 'the command after the failed update must be real work').to.equal('install');
    });

    it('reports the checks as complete, not merely done quietly', async () => {
      // The event above proves the queue kept running; this proves monitorSystem's
      // allSettled actually settled, which is the half that strands its caller.
      const event = await waitForPackagesChecked(env.clients[0], () => true, RESUMED_PROVISION_TIMEOUT_MS);
      expect(event.data.installed).to.have.members(SEEDED_PACKAGES);
    });

    it('ends up with the packages it was missing', async () => {
      await waitForPackagesChecked(env.clients[0], () => true, RESUMED_PROVISION_TIMEOUT_MS);
      for (const systemPackage of SEEDED_PACKAGES) {
        // eslint-disable-next-line no-await-in-loop
        const version = await installedVersion(env.clients[0], systemPackage);
        expect(version, `${systemPackage} should be installed`).to.not.equal('');
      }
    });
  });
});
