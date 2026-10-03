// Maintenance SSH access on a legacy node, end to end on systemd-mode nodes: the
// fluxadm account, its passwordless sudo, the configured keys and a dedicated sshd
// unit on apiport - 5, reached over the fleet network with a real ssh client.
//
// Two legacy nodes (no FLUXOS_PATH, and the daemon stub reports them as not
// attested): one with no sshd, which installs openssh-server for the feature and
// must not start the sshd the package ships, and one whose operator already runs
// sshd on port 22, which must be left exactly as it was. Their peer is an Arcane
// node with the same key list configured, which must end up with none of it, and
// which doubles as the ssh client.
//
// Keys are changed the way a release changes them: the node's config is rewritten
// and FluxOS restarted, and the reconcile pass that runs at start converges the
// node on the new list. Every wait is for the login itself to change, never for a
// file, because a login is what the feature is for.
//
// The node without sshd is firewalled as the legacy installer leaves a node, so
// the maintenance port's own rate-limit rule is installed and removed for real.
// The installer already allows the whole 16100-16199 range, so a login says
// nothing about that rule: the rule itself is what is asserted.
//
// A list that drops a key ends every open maintenance session, together with what
// it runs through sudo. The node without sshd has no pam_systemd, so its sessions
// stay in the maintenance unit's cgroup; the operator's node installs
// libpam-systemd with its sshd, so its sessions get their own logind scope. Each
// node proves one of the two ways a session is ended.
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
const OPERATOR_SSHD = 1;
const ARCANE = 2;

const KEY_NAMES = ['current', 'next', 'stranger'];

// apiport 16127 - 5
const SSH_PORT = 16122;
const CLIENT_KEY_DIR = '/root/.fluxadm-keys';
const PASS_RECONCILED = 'fluxadm access - reconcile pass reconciled';

const MANAGED_FILES = [
  '/etc/ssh/fluxadm_sshd_config',
  '/etc/systemd/system/fluxadm-sshd.service',
  '/etc/sudoers.d/fluxadm',
  '/etc/ssh/fluxadm_authorized_keys',
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
  let operator;
  let arcane;
  let legacyIp;
  let operatorIp;
  let keyDir;
  let operatorSshdBefore;
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
  async function loginResult(keyName, { ip = legacyIp, port = SSH_PORT, user = 'fluxadm' } = {}) {
    const result = await execInContainer(arcane.container, [
      'ssh', '-i', `${CLIENT_KEY_DIR}/${keyName}`, '-p', String(port),
      '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR',
      `${user}@${ip}`, 'sudo -n id -u',
    ]);
    return { ...result, ok: result.exitCode === 0 && result.stdout.trim() === '0' };
  }

  async function login(keyName, options) {
    return (await loginResult(keyName, options)).ok;
  }

  // For a wait on a login that must succeed: a failed attempt throws what the
  // remote said, which the wait reports if it times out.
  async function loginOrThrow(keyName, options) {
    const { ok, exitCode, stdout, stderr } = await loginResult(keyName, options);
    if (!ok) throw new Error(`login exit ${exitCode}, stdout ${JSON.stringify(stdout)}, stderr ${JSON.stringify(stderr)}`);
    return true;
  }

  // An ssh session held open from the client, running a uniquely numbered sleep
  // through sudo on the node. Returns that root process's cgroup once it runs.
  async function openSession(client, ip, keyName, tag, { port = SSH_PORT, user = 'fluxadm' } = {}) {
    const started = await execInContainer(arcane.container, [
      'setsid', '-f', 'ssh', '-n', '-i', `${CLIENT_KEY_DIR}/${keyName}`, '-p', String(port),
      '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR',
      `${user}@${ip}`, `sudo -n sleep ${tag}`,
    ]);
    expect(started.exitCode, `session ${tag} did not start: ${started.stderr}`).to.equal(0);
    let cgroup = null;
    await waitFor(async () => {
      cgroup = await sessionCgroup(client, tag);
      return cgroup !== null;
    }, { timeout: 30000, interval: 1000, label: `session ${tag} running` });
    return cgroup;
  }

  // The cgroup of a session's sudo child, or null once it no longer runs.
  async function sessionCgroup(client, tag) {
    const { stdout } = await execInContainer(client.container,
      `p=$(pgrep -x -f 'sleep ${tag}' | head -1); test -n "$p" && cat /proc/$p/cgroup; true`);
    return stdout.trim() || null;
  }

  async function maintenanceRule() {
    const { stdout } = await execInContainer(legacy.container, 'ufw status verbose; true');
    return new RegExp(`^${SSH_PORT}/tcp\\s+LIMIT IN\\s+Anywhere\\s*$`, 'm').test(stdout);
  }

  async function port22Listening(client) {
    const { stdout } = await execInContainer(client.container, "ss -Hltn 'sport = :22'");
    return stdout.trim() !== '';
  }

  // The operator's sshd as the operator sees it: its units, its running process,
  // its config and its port.
  async function operatorSshdState() {
    const { stdout } = await execInContainer(operator.container,
      'systemctl is-enabled ssh.service ssh.socket; systemctl is-active ssh.service ssh.socket; '
      + "systemctl show -p MainPID --value ssh.service; sha256sum /etc/ssh/sshd_config; ss -Hltn 'sport = :22'; true");
    return stdout.trim();
  }

  // The operator's own sshd, installed with libpam-systemd as on a server and
  // running before FluxOS ever treats the node as legacy, with the stranger key
  // authorized for root: a login on port 22 that must keep working, and that
  // proves port 22 is reachable at all.
  async function startOperatorSshd() {
    const { exitCode, stderr } = await execInContainer(operator.container, [
      'sh', '-c',
      'DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y openssh-server libpam-systemd'
      + ' && install -d -m 700 /root/.ssh && printf \'%s\\n\' "$1" > /root/.ssh/authorized_keys',
      'sh', publicKey('stranger'),
    ]);
    expect(exitCode, `operator sshd install failed: ${stderr}`).to.equal(0);
    await waitFor(() => loginOrThrow('stranger', { ip: operatorIp, port: 22, user: 'root' }), {
      timeout: CONVERGE_TIMEOUT_MS, interval: 3000, label: "a root login on the operator's sshd",
    });
  }

  async function passCount(client) {
    return journalCount(client.container, 'fluxos', PASS_RECONCILED, { processOnly: true });
  }

  // A release that ships a new key list: the config FluxOS reads at start is
  // rewritten, and FluxOS restarts. Returns once a pass has completed on it.
  async function releaseKeys(names, client = legacy) {
    const keys = JSON.stringify(names.map(publicKey));
    const before = await passCount(client);
    const write = await execInContainer(client.container, [
      'node', '-e',
      'const f = "/flux/ZelBack/config/local.js"; const c = require(f);'
      + ' c.fluxadm = { ...(c.fluxadm ?? {}), sshAuthorizedKeys: JSON.parse(process.argv[1]) };'
      + ' require("fs").writeFileSync(f, `module.exports = ${JSON.stringify(c, null, 2)};\\n`);',
      keys,
    ]);
    expect(write.exitCode, `config rewrite failed: ${write.stderr}`).to.equal(0);
    await restartFluxos(client.container);
    await waitFor(async () => (await passCount(client)) > before, {
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
      nodes: 3,
      legacyNodes: [LEGACY, OPERATOR_SSHD],
      firewall: [LEGACY],
      systemdMode: true,
      tickerAutostart: false,
      configOverrides: { fluxadm: { sshAuthorizedKeys: [publicKey('current')] } },
    });
    legacy = env.clients[LEGACY];
    operator = env.clients[OPERATOR_SSHD];
    arcane = env.clients[ARCANE];
    legacyIp = subnet.nodeIp(LEGACY + 1);
    operatorIp = subnet.nodeIp(OPERATOR_SSHD + 1);

    const keyDirMade = await execInContainer(arcane.container, `install -d -m 700 ${CLIENT_KEY_DIR}`);
    expect(keyDirMade.exitCode, `client key dir failed: ${keyDirMade.stderr}`).to.equal(0);
    await arcane.container.copyContentToContainer(KEY_NAMES.map((name) => ({
      content: readFileSync(join(keyDir, name)),
      target: `${CLIENT_KEY_DIR}/${name}`,
      mode: 0o600,
    })));

    await startOperatorSshd();
    operatorSshdBefore = await operatorSshdState();

    // Every node boots attested, so the boot's own pass skipped. Marked legacy and
    // restarted, each node's next start is its first pass as a legacy node.
    for (const [client, ip] of [[legacy, legacyIp], [operator, operatorIp]]) {
      await setSystemSecure(ip, false);
      await restartFluxos(client.container);
    }
  });

  after(async () => {
    await env?.teardown();
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
  });

  it('boots every node with systemd as init and FluxOS as a unit', async () => {
    for (const client of [legacy, operator, arcane]) {
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

  it('installs openssh-server without starting the sshd it ships', async () => {
    const { stdout } = await execInContainer(legacy.container,
      'test -x /usr/sbin/sshd && echo installed; '
      + 'systemctl is-enabled ssh.service ssh.socket; systemctl is-active ssh.service ssh.socket; true');
    expect(stdout.trim().split('\n')).to.deep.equal(['installed', 'disabled', 'disabled', 'inactive', 'inactive']);
    expect(await port22Listening(legacy), 'nothing may listen on port 22').to.equal(false);
  });

  it('lets the configured key in on a node whose operator runs sshd', async () => {
    await waitFor(() => login('current', { ip: operatorIp }), {
      timeout: CONVERGE_TIMEOUT_MS, interval: 3000, label: "login with the configured key beside the operator's sshd",
    });
  });

  it("leaves the operator's sshd as it was, and the maintenance key off it", async () => {
    expect(await operatorSshdState()).to.equal(operatorSshdBefore);
    expect(await port22Listening(operator), "the operator's sshd must still listen on port 22").to.equal(true);
    expect(await login('stranger', { ip: operatorIp, port: 22, user: 'root' }),
      "the operator's own login on port 22 must still work").to.equal(true);
    expect(await login('current', { ip: operatorIp, port: 22 })).to.equal(false);
  });

  it("ends a maintenance session in its logind scope when a key is dropped, and not the operator's", async () => {
    const maintenance = await openSession(operator, operatorIp, 'current', 7003);
    expect(maintenance, 'with pam_systemd a session gets its own logind scope').to.match(/\/session-[^/]+\.scope$/);
    const operatorsOwn = await openSession(operator, operatorIp, 'stranger', 7004, { port: 22, user: 'root' });
    await releaseKeys(['next'], operator);
    expect(await sessionCgroup(operator, 7003), 'dropping a key must end the session and its sudo child').to.equal(null);
    expect(await sessionCgroup(operator, 7004), "the operator's own session must survive").to.equal(operatorsOwn);
  });

  it('refuses a key that is not configured', async () => {
    expect(await login('current'), 'the configured key must still log in').to.equal(true);
    expect(await login('stranger')).to.equal(false);
  });

  it('rate-limits the maintenance port in the firewall', async () => {
    expect(await maintenanceRule()).to.equal(true);
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

  it('lets both keys in while a rotation overlaps them, and keeps open sessions', async () => {
    const cgroup = await openSession(legacy, legacyIp, 'current', 7001);
    expect(cgroup, "without pam_systemd a session stays in the maintenance unit's cgroup")
      .to.match(/\/fluxadm-sshd\.service$/);
    await releaseKeys(['current', 'next']);
    expect(await sessionCgroup(legacy, 7001), 'adding a key must not end an open session').to.equal(cgroup);
    await waitFor(() => login('next'), {
      timeout: CONVERGE_TIMEOUT_MS, interval: 3000, label: 'login with the incoming key',
    });
    expect(await login('current'), 'the outgoing key must still log in during the overlap').to.equal(true);
  });

  it('refuses the old key once the rotation completes, and ends open sessions', async () => {
    expect(await sessionCgroup(legacy, 7001), 'the session must be open before the key is dropped').to.not.equal(null);
    await releaseKeys(['next']);
    expect(await sessionCgroup(legacy, 7001), 'dropping a key must end the session and its sudo child').to.equal(null);
    await waitFor(async () => !(await login('current')), {
      timeout: CONVERGE_TIMEOUT_MS, interval: 3000, label: 'the outgoing key refused',
    });
    expect(await login('next'), 'the incoming key must still log in').to.equal(true);
  });

  it('refuses every key once the list is empty, and removes everything it installed', async () => {
    expect(await login('next'), 'the key must log in before the list is emptied').to.equal(true);
    await openSession(legacy, legacyIp, 'next', 7002);
    await releaseKeys([]);
    expect(await sessionCgroup(legacy, 7002), 'emptying the list must end the session').to.equal(null);
    expect(await maintenanceRule(), 'emptying the list must remove the firewall rule').to.equal(false);
    await waitFor(async () => !(await login('next')), {
      timeout: CONVERGE_TIMEOUT_MS, interval: 3000, label: 'login refused after the list emptied',
    });
    const { stdout } = await execInContainer(legacy.container,
      'test -e /etc/systemd/system/fluxadm-sshd.service && echo unit; test -e /etc/ssh/fluxadm_authorized_keys && echo keys; '
      + 'id fluxadm >/dev/null 2>&1 && echo user; test -e /home/fluxadm && echo home; test -e /etc/sudoers.d/fluxadm && echo sudoers; '
      + `ss -Hltn 'sport = :${SSH_PORT}' | grep -q . && echo listener; true`);
    expect(stdout.trim()).to.equal('');
  });
});
