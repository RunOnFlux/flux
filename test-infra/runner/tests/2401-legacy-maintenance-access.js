// Maintenance SSH access on a legacy node, end to end on systemd-mode nodes: the
// fluxadm account, its passwordless sudo, the configured keys and a dedicated sshd
// unit on apiport - 5, reached over the fleet network with a real ssh client.
//
// The node under test is legacy (no FLUXOS_PATH, and the daemon stub reports it
// as not attested). Its peer is an Arcane node with the same key list configured,
// which must end up with none of it, and which doubles as the ssh client.
//
// Keys are changed the way a release changes them: the node's config is rewritten
// and FluxOS restarted, and the reconcile pass that runs at start converges the
// node on the new list. Every wait is for the login itself to change, never for a
// file, because a login is what the feature is for.
//
// Each run generates its keypairs on the runner and deletes them at teardown; no
// key is stored in the repo.
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestEnv } from '../framework/test-env.js';
import { execInContainer } from '../framework/container.js';
import { setSystemSecure } from '../framework/daemon-control.js';
import { getSubnetConfig } from '../framework/subnet-config.js';
import { restartFluxos, unitState, journalCount } from '../framework/systemd-control.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const LEGACY = 0;
const ARCANE = 1;

const KEY_NAMES = ['current', 'next', 'stranger'];

// apiport 16127 - 5
const SSH_PORT = 16122;
const CLIENT_KEY_DIR = '/root/.fluxadm-keys';
const PASS_RECONCILED = 'fluxadm access - reconcile pass reconciled';

const MANAGED_FILES = [
  '/etc/ssh/fluxadm_sshd_config',
  '/etc/systemd/system/fluxadm-sshd.service',
  '/etc/sudoers.d/fluxadm',
  '/home/fluxadm/.ssh/authorized_keys',
];

// The first pass installs openssh-server through the node's apt queue, behind
// whatever the boot's own package checks still have queued.
const FIRST_ACCESS_TIMEOUT_MS = 300000;
const CONVERGE_TIMEOUT_MS = 180000;

const subnet = getSubnetConfig();

describe('2401 legacy node maintenance access', function suite() {
  this.timeout(900000);

  let env;
  let legacy;
  let arcane;
  let legacyIp;
  let keyDir;
  const publicKeys = {};
  dumpLogsOnFailure(() => env);

  function generateKeys() {
    keyDir = mkdtempSync(join(tmpdir(), 'flux-e2e-fluxadm-'));
    for (const name of KEY_NAMES) {
      const keyPath = join(keyDir, name);
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `flux-e2e-fluxadm-${name}`, '-f', keyPath]);
      publicKeys[name] = readFileSync(`${keyPath}.pub`, 'utf-8').trim();
    }
  }

  const publicKey = (name) => publicKeys[name];

  // The command's own result, so a refusal and a success are both facts: the
  // remote prints the uid sudo runs as, which is 0 only when the login, the key
  // and the sudoers drop-in all worked.
  async function login(keyName) {
    const { stdout, exitCode } = await execInContainer(arcane.container, [
      'ssh', '-i', `${CLIENT_KEY_DIR}/${keyName}`, '-p', String(SSH_PORT),
      '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR',
      `fluxadm@${legacyIp}`, 'sudo -n id -u',
    ]);
    return exitCode === 0 && stdout.trim() === '0';
  }

  async function passCount() {
    return journalCount(legacy.container, 'fluxos', PASS_RECONCILED, { processOnly: true });
  }

  // A release that ships a new key list: the config FluxOS reads at start is
  // rewritten, and FluxOS restarts. Returns once a pass has completed on it.
  async function releaseKeys(names) {
    const keys = JSON.stringify(names.map(publicKey));
    const before = await passCount();
    const write = await execInContainer(legacy.container, [
      'node', '-e',
      'const f = "/flux/ZelBack/config/local.js"; const c = require(f);'
      + ' c.fluxadm = { ...(c.fluxadm ?? {}), sshAuthorizedKeys: JSON.parse(process.argv[1]) };'
      + ' require("fs").writeFileSync(f, `module.exports = ${JSON.stringify(c, null, 2)};\\n`);',
      keys,
    ]);
    expect(write.exitCode, `config rewrite failed: ${write.stderr}`).to.equal(0);
    await restartFluxos(legacy.container);
    await waitFor(async () => (await passCount()) > before, {
      timeout: CONVERGE_TIMEOUT_MS, interval: 2000, label: 'a reconcile pass on the new key list',
    });
  }

  async function managedState() {
    const { stdout } = await execInContainer(legacy.container,
      `stat -c '%n %Y %s' ${MANAGED_FILES.join(' ')}; systemctl show -p MainPID --value fluxadm-sshd.service`);
    return stdout.trim();
  }

  before(async function hook() {
    generateKeys();
    env = await createTestEnv({
      hookCtx: this,
      nodes: 2,
      legacyNodes: [LEGACY],
      systemdMode: true,
      tickerAutostart: false,
      configOverrides: { fluxadm: { sshAuthorizedKeys: [publicKey('current')] } },
    });
    legacy = env.clients[LEGACY];
    arcane = env.clients[ARCANE];
    legacyIp = subnet.nodeIp(LEGACY + 1);

    const keyDirMade = await execInContainer(arcane.container, `install -d -m 700 ${CLIENT_KEY_DIR}`);
    expect(keyDirMade.exitCode, `client key dir failed: ${keyDirMade.stderr}`).to.equal(0);
    await arcane.container.copyContentToContainer(KEY_NAMES.map((name) => ({
      content: readFileSync(join(keyDir, name)),
      target: `${CLIENT_KEY_DIR}/${name}`,
      mode: 0o600,
    })));

    // Every node boots attested, so the boot's own pass skipped. Marked legacy and
    // restarted, the node's next start is its first pass as a legacy node.
    await setSystemSecure(legacyIp, false);
    await restartFluxos(legacy.container);
  });

  after(async () => {
    await env?.teardown();
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
  });

  it('boots both nodes with systemd as init and FluxOS as a unit', async () => {
    for (const client of [legacy, arcane]) {
      const { stdout } = await execInContainer(client.container, 'cat /proc/1/comm');
      expect(stdout.trim()).to.equal('systemd');
      expect(await unitState(client.container, 'fluxos')).to.equal('active');
    }
  });

  it('lets a configured key in, with passwordless sudo', async () => {
    await waitFor(() => login('current'), {
      timeout: FIRST_ACCESS_TIMEOUT_MS, interval: 3000, label: 'login with the configured key',
    });
  });

  it('refuses a key that is not configured', async () => {
    expect(await login('current'), 'the configured key must still log in').to.equal(true);
    expect(await login('stranger')).to.equal(false);
  });

  it('runs the maintenance sshd as its own unit, on apiport - 5', async () => {
    expect(await unitState(legacy.container, 'fluxadm-sshd.service')).to.equal('active');
    const { stdout } = await execInContainer(legacy.container, `ss -Hltn 'sport = :${SSH_PORT}'`);
    expect(stdout.trim(), `nothing listening on ${SSH_PORT}`).to.not.equal('');
  });

  it('installs nothing on an Arcane node with the same key list', async () => {
    const probe = 'id fluxadm >/dev/null 2>&1 && echo user; '
      + 'test -e /etc/systemd/system/fluxadm-sshd.service && echo unit; '
      + `ss -Hltn 'sport = :${SSH_PORT}' | grep -q . && echo listener; true`;
    const onLegacy = await execInContainer(legacy.container, probe);
    expect(onLegacy.stdout.trim().split('\n'), 'the probe must see the install where it exists')
      .to.deep.equal(['user', 'unit', 'listener']);
    const onArcane = await execInContainer(arcane.container, probe);
    expect(onArcane.stdout.trim()).to.equal('');
  });

  it('changes nothing on a pass with nothing to change', async () => {
    const before = await managedState();
    await releaseKeys(['current']);
    expect(await managedState()).to.equal(before);
    expect(await login('current')).to.equal(true);
  });

  it('lets both keys in while a rotation overlaps them', async () => {
    await releaseKeys(['current', 'next']);
    await waitFor(() => login('next'), {
      timeout: CONVERGE_TIMEOUT_MS, interval: 3000, label: 'login with the incoming key',
    });
    expect(await login('current'), 'the outgoing key must still log in during the overlap').to.equal(true);
  });

  it('refuses the old key once the rotation completes', async () => {
    await releaseKeys(['next']);
    await waitFor(async () => !(await login('current')), {
      timeout: CONVERGE_TIMEOUT_MS, interval: 3000, label: 'the outgoing key refused',
    });
    expect(await login('next'), 'the incoming key must still log in').to.equal(true);
  });

  it('refuses every key once the list is empty, and stops the sshd', async () => {
    expect(await login('next'), 'the key must log in before the list is emptied').to.equal(true);
    await releaseKeys([]);
    await waitFor(async () => !(await login('next')), {
      timeout: CONVERGE_TIMEOUT_MS, interval: 3000, label: 'login refused after the list emptied',
    });
    const { stdout } = await execInContainer(legacy.container,
      `test -e /etc/systemd/system/fluxadm-sshd.service && echo unit; ss -Hltn 'sport = :${SSH_PORT}' | grep -q . && echo listener; true`);
    expect(stdout.trim()).to.equal('');
  });
});
