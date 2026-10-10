// Maintenance SSH access on a legacy node, end to end on systemd-mode nodes: the
// fluxadm account, its passwordless sudo, the configured keys and a dedicated sshd
// unit on apiport - 5, reached over the fleet network with a real ssh client.
//
// Two legacy nodes (no FLUXOS_PATH, and the daemon stub reports them as not
// attested): one with no sshd, which installs openssh-server for the feature and
// must not start the sshd the package ships, and one whose node owner already runs
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
// Four more legacy nodes without sshd each have FluxOS's openssh-server install go
// wrong: on a node with a broken dpkg state, apt fails after the package is
// configured; FluxOS is killed after the package is installed, and between unpack
// and configure (a dpkg hook); and, on a node whose owner had sshd enabled and
// then removed the package without purging it, apt fails after the package is
// configured. A reboot of each must find the package's own sshd disabled and
// nothing on port 22.
//
// A list that drops a key ends every open maintenance session, together with what
// it runs through sudo. The node without sshd has no pam_systemd, so its sessions
// stay in their connection's session unit; the node with the node owner's sshd
// installs libpam-systemd with it, so its sessions get their own logind scope. Each
// node proves one of the two ways a session is ended.
//
// Each run generates its keypairs on the runner and holds them in memory: the files
// ssh-keygen writes are deleted as soon as they are read, so no key outlives the
// run on the runner whatever stops it, and none is stored in the repo.
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
import { restartFluxos, unitState } from '../framework/systemd-control.js';
import { waitFor } from '../framework/wait.js';
import { dumpLogsOnFailure } from '../framework/log-on-failure.js';

const LEGACY = 0;
const NODE_OWNER_SSHD = 1;
const ARCANE = 2;
const APT_FAILS = 3;
const KILLED_INSTALLED = 4;
const KILLED_UNPACKED = 5;
const OWNER_REMOVED = 6;
const FAULTED = [APT_FAILS, KILLED_INSTALLED, KILLED_UNPACKED, OWNER_REMOVED];

const KEY_NAMES = ['current', 'next', 'stranger'];

// apiport 16127 - 5
const SSH_PORT = 16122;
const CLIENT_KEY_DIR = '/root/.fluxadm-keys';

const SSHD_PRESET = '/etc/systemd/system-preset/00-fluxadm.preset';
const POLICY_RC = '/usr/sbin/policy-rc.d';

const MANAGED_FILES = [
  '/etc/ssh/fluxadm_sshd_config',
  '/etc/systemd/system/fluxadm-sshd.socket',
  '/etc/systemd/system/fluxadm-sshd@.service',
  '/etc/sudoers.d/fluxadm',
  '/etc/ssh/fluxadm_authorized_keys',
];

// A ceiling for a pass that never reports: a pass deferred while the legacy
// confirmation is pending retries five minutes later.
const PASS_TIMEOUT_MS = 360000;
const CONVERGE_TIMEOUT_MS = 180000;

const subnet = getSubnetConfig();

describe('2401 legacy node maintenance access', function suite() {
  this.timeout(900000);

  let env;
  let legacy;
  let owner;
  let arcane;
  let legacyIp;
  let ownerIp;
  let ownerSshdBefore;
  // Each legacy node's last event before the restart that made it legacy.
  const legacyStartedAfter = new Map();
  const publicKeys = {};
  const privateKeys = {};
  dumpLogsOnFailure(() => env);

  function generateKeys() {
    const keyDir = mkdtempSync(join(tmpdir(), 'flux-e2e-fluxadm-'));
    try {
      for (const name of KEY_NAMES) {
        const keyPath = join(keyDir, name);
        execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `flux-e2e-fluxadm-${name}`, '-f', keyPath]);
        publicKeys[name] = readFileSync(`${keyPath}.pub`, 'utf-8').trim();
        privateKeys[name] = readFileSync(keyPath);
      }
    } finally {
      rmSync(keyDir, { recursive: true, force: true });
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

  // A login the sshd answered and refused for its key, as opposed to one that
  // found nothing listening, which would fail the same login for another reason.
  async function refusedForKey(keyName, options) {
    const { exitCode, stderr } = await loginResult(keyName, options);
    return { refused: exitCode === 255 && /Permission denied \(publickey\)/.test(stderr), stderr };
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

  // Whether the maintenance port's limit rule is in the firewall, with the status
  // it was read from for the assertion message.
  async function maintenanceRule() {
    const { stdout } = await execInContainer(legacy.container, 'ufw status verbose; true');
    return { present: new RegExp(`^${SSH_PORT}/tcp\\s+LIMIT IN\\s+Anywhere\\s*$`, 'm').test(stdout), status: stdout };
  }

  // A dpkg hook that fires once, after the first dpkg call that leaves
  // openssh-server in the given state, and runs the given command. It runs
  // inside FluxOS's install, so killing FluxOS's unit kills the apt and dpkg
  // that install runs.
  async function armDpkgFault(client, state, command) {
    const hook = [
      '#!/bin/sh',
      '[ -e /var/tmp/e2e-dpkg-fault-fired ] && exit 0',
      `[ "$(dpkg-query -W -f='\${Status}' openssh-server 2>/dev/null)" = 'install ok ${state}' ] || exit 0`,
      'touch /var/tmp/e2e-dpkg-fault-fired',
      command,
      '',
    ].join('\n');
    const { exitCode, stderr } = await execInContainer(client.container, [
      'sh', '-c',
      'printf "%s" "$1" > /usr/local/sbin/e2e-dpkg-fault && chmod 755 /usr/local/sbin/e2e-dpkg-fault'
      + ' && echo post-invoke=/usr/local/sbin/e2e-dpkg-fault > /etc/dpkg/dpkg.cfg.d/zz-e2e-fault',
      'sh', hook,
    ]);
    expect(exitCode, `dpkg fault hook failed: ${stderr}`).to.equal(0);
  }

  // A broken dpkg state: a package whose configure always fails, left
  // half-configured. Every apt run from then on configures what it installs and
  // exits non-zero, so FluxOS's install of openssh-server fails after the
  // package is configured, and so does every retry of it.
  async function breakDpkg(client) {
    const { exitCode, stdout, stderr } = await execInContainer(client.container, [
      'sh', '-c',
      'd=$(mktemp -d) && mkdir -p "$d/DEBIAN"'
      + ' && printf "Package: e2e-broken\\nVersion: 1\\nArchitecture: all\\nMaintainer: e2e\\nDescription: fails to configure\\n" > "$d/DEBIAN/control"'
      + ' && printf "#!/bin/sh\\nexit 1\\n" > "$d/DEBIAN/postinst" && chmod 755 "$d/DEBIAN/postinst"'
      + ' && dpkg-deb -b "$d" /var/tmp/e2e-broken.deb >/dev/null && rm -rf "$d"'
      + ' && { dpkg -i /var/tmp/e2e-broken.deb >/dev/null 2>&1; true; }'
      + " && dpkg-query -W -f='${Status}' e2e-broken",
    ]);
    expect(exitCode, `breaking dpkg failed: ${stderr}`).to.equal(0);
    expect(stdout.trim()).to.equal('install ok half-configured');
  }

  async function repairDpkg(client) {
    // waits for the dpkg lock, which FluxOS's own apt runs take
    const { exitCode, stderr } = await execInContainer(client.container,
      'DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 purge -y e2e-broken');
    expect(exitCode, `repairing dpkg failed: ${stderr}`).to.equal(0);
  }

  async function dpkgFaultFired(client) {
    const { exitCode } = await execInContainer(client.container, 'test -e /var/tmp/e2e-dpkg-fault-fired');
    return exitCode === 0;
  }

  // The package's own sshd and FluxOS's install state, one line each.
  async function distroSshdState(client) {
    const { stdout } = await execInContainer(client.container,
      `test -x /usr/sbin/sshd && echo sshd; dpkg-query -W -f='\${Status}\n' openssh-server 2>/dev/null; `
      + 'systemctl is-enabled ssh.service ssh.socket; systemctl is-active ssh.service ssh.socket; '
      + `test -e ${SSHD_PRESET} && echo preset; test -e ${POLICY_RC} && echo hold; true`);
    return stdout.trim().split('\n').join(' | ');
  }

  const DISTRO_SSHD_OFF = 'sshd | install ok installed | disabled | disabled | inactive | inactive';

  // The node's first fluxadm pass after afterId that was not deferred, whatever
  // its outcome.
  async function anyPass(client, afterId) {
    const { data } = await client.waitForEvent('fluxadm:pass', (d) => d.outcome !== 'deferred', PASS_TIMEOUT_MS, { afterId });
    return data;
  }

  // A reboot: systemd starts whatever is enabled before FluxOS runs, so port 22
  // after it shows whether the package's sshd was left enabled.
  async function reboot(index) {
    await env.restartNode(index);
    return env.clients[index];
  }

  async function port22Listening(client) {
    const { stdout } = await execInContainer(client.container, "ss -Hltn 'sport = :22'");
    return stdout.trim() !== '';
  }

  // The node owner's sshd as the node owner sees it: its units, its running process,
  // its config and its port.
  async function ownerSshdState() {
    const { stdout } = await execInContainer(owner.container,
      'systemctl is-enabled ssh.service ssh.socket; systemctl is-active ssh.service ssh.socket; '
      + "systemctl show -p MainPID --value ssh.service; sha256sum /etc/ssh/sshd_config; ss -Hltn 'sport = :22'; true");
    return stdout.trim();
  }

  // The node owner's own sshd, installed with libpam-systemd as on a server and
  // running before FluxOS ever treats the node as legacy, with the stranger key
  // authorized for root: a login on port 22 that must keep working, and that
  // proves port 22 is reachable at all.
  async function startOwnerSshd() {
    const { exitCode, stderr } = await execInContainer(owner.container, [
      'sh', '-c',
      'DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y openssh-server libpam-systemd'
      + ' && install -d -m 700 /root/.ssh && printf \'%s\\n\' "$1" > /root/.ssh/authorized_keys',
      'sh', publicKey('stranger'),
    ]);
    expect(exitCode, `node owner's sshd install failed: ${stderr}`).to.equal(0);
    await waitFor(() => loginOrThrow('stranger', { ip: ownerIp, port: 22, user: 'root' }), {
      timeout: CONVERGE_TIMEOUT_MS, interval: 3000, label: "a root login on the node owner's sshd",
    });
  }

  // The node's first fluxadm pass after afterId that was not deferred. A pass
  // that did not reconcile fails the test at once, naming the step it stopped at.
  async function reconciledPass(client, afterId) {
    const { data } = await client.waitForEvent('fluxadm:pass', (d) => d.outcome !== 'deferred', PASS_TIMEOUT_MS, { afterId });
    expect(data.outcome, `fluxadm pass ${data.outcome}${data.step ? ` at ${data.step}` : ''}`).to.equal('reconciled');
  }

  // A release that ships a new key list: the config FluxOS reads at start is
  // rewritten, and FluxOS restarts. Returns once a pass has completed on it.
  async function releaseKeys(names, client = legacy) {
    const keys = JSON.stringify(names.map(publicKey));
    const afterId = client.getLastEventId();
    const write = await execInContainer(client.container, [
      'node', '-e',
      'const f = "/flux/ZelBack/config/local.js"; const c = require(f);'
      + ' c.fluxadm = { ...(c.fluxadm ?? {}), sshAuthorizedKeys: JSON.parse(process.argv[1]) };'
      + ' require("fs").writeFileSync(f, `module.exports = ${JSON.stringify(c, null, 2)};\\n`);',
      keys,
    ]);
    expect(write.exitCode, `config rewrite failed: ${write.stderr}`).to.equal(0);
    await restartFluxos(client.container);
    await reconciledPass(client, afterId);
  }

  async function managedState() {
    const { stdout } = await execInContainer(legacy.container,
      `stat -c '%n %Y %s' ${MANAGED_FILES.join(' ')}; systemctl show -p ActiveEnterTimestampMonotonic --value fluxadm-sshd.socket`);
    return stdout.trim();
  }

  before(async function hook() {
    generateKeys();
    env = await createTestEnv({
      hookCtx: this,
      nodes: 7,
      legacyNodes: [LEGACY, NODE_OWNER_SSHD, ...FAULTED],
      firewall: [LEGACY],
      systemdMode: true,
      tickerAutostart: false,
      configOverrides: { fluxadm: { sshAuthorizedKeys: [publicKey('current')] } },
    });
    legacy = env.clients[LEGACY];
    owner = env.clients[NODE_OWNER_SSHD];
    arcane = env.clients[ARCANE];
    legacyIp = subnet.nodeIp(LEGACY + 1);
    ownerIp = subnet.nodeIp(NODE_OWNER_SSHD + 1);

    const keyDirMade = await execInContainer(arcane.container, `install -d -m 700 ${CLIENT_KEY_DIR}`);
    expect(keyDirMade.exitCode, `client key dir failed: ${keyDirMade.stderr}`).to.equal(0);
    await arcane.container.copyContentToContainer(KEY_NAMES.map((name) => ({
      content: privateKeys[name],
      target: `${CLIENT_KEY_DIR}/${name}`,
      mode: 0o600,
    })));

    await startOwnerSshd();
    ownerSshdBefore = await ownerSshdState();

    // The node owner's sshd, enabled as the package enables it, then removed
    // without a purge: the package's enablement stays behind.
    const removed = env.clients[OWNER_REMOVED];
    const ownerInstall = await execInContainer(removed.container,
      'DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y openssh-server'
      + ' && DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 remove -y openssh-server'
      + " && dpkg-query -W -f='${Status}' openssh-server && ls /etc/systemd/system/sockets.target.wants/");
    expect(ownerInstall.exitCode, `node owner's install and removal failed: ${ownerInstall.stderr}`).to.equal(0);
    expect(ownerInstall.stdout, 'the removal must leave the package enabled, unpurged')
      .to.match(/deinstall ok config-files/).and.to.match(/ssh\.socket/);

    await breakDpkg(env.clients[APT_FAILS]);
    await armDpkgFault(env.clients[KILLED_INSTALLED], 'installed', 'systemctl kill -s KILL fluxos.service');
    await armDpkgFault(env.clients[KILLED_UNPACKED], 'unpacked', 'systemctl kill -s KILL fluxos.service');
    await breakDpkg(removed);

    // Every node boots attested, so the boot's own pass skipped. Marked legacy and
    // restarted, each node's next start is its first pass as a legacy node.
    const legacyClients = [[legacy, legacyIp], [owner, ownerIp]]
      .concat(FAULTED.map((i) => [env.clients[i], subnet.nodeIp(i + 1)]));
    for (const [client, ip] of legacyClients) {
      await setSystemSecure(ip, false);
      legacyStartedAfter.set(client, client.getLastEventId());
      await restartFluxos(client.container);
    }
  });

  after(async () => {
    await env?.teardown();
  });

  it('boots every node with systemd as init and FluxOS as a unit', async () => {
    for (const client of [legacy, owner, arcane]) {
      const { stdout } = await execInContainer(client.container, 'cat /proc/1/comm');
      expect(stdout.trim()).to.equal('systemd');
      expect(await unitState(client.container, 'fluxos')).to.equal('active');
    }
  });

  it('lets a configured key in, with passwordless sudo', async () => {
    await reconciledPass(legacy, legacyStartedAfter.get(legacy));
    await loginOrThrow('current');
  });

  it('installs openssh-server without starting the sshd it ships', async () => {
    const { stdout } = await execInContainer(legacy.container,
      'test -x /usr/sbin/sshd && echo installed; '
      + 'systemctl is-enabled ssh.service ssh.socket; systemctl is-active ssh.service ssh.socket; true');
    expect(stdout.trim().split('\n')).to.deep.equal(['installed', 'disabled', 'disabled', 'inactive', 'inactive']);
    expect(await port22Listening(legacy), 'nothing may listen on port 22').to.equal(false);
  });

  // A reinstall runs the package's maintainer scripts exactly as an upgrade does.
  it('keeps the sshd it ships off through a package upgrade', async () => {
    const upgrade = await execInContainer(legacy.container,
      'DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install --reinstall -y openssh-server');
    expect(upgrade.exitCode, `openssh-server reinstall failed: ${upgrade.stderr}`).to.equal(0);
    const { stdout } = await execInContainer(legacy.container,
      'systemctl is-enabled ssh.service ssh.socket; systemctl is-active ssh.service ssh.socket; true');
    expect(stdout.trim().split('\n')).to.deep.equal(['disabled', 'disabled', 'inactive', 'inactive']);
    expect(await port22Listening(legacy), 'nothing may listen on port 22').to.equal(false);
  });

  it('leaves the sshd it ships disabled through a reboot when apt fails after installing it', async () => {
    const client = env.clients[APT_FAILS];
    const pass = await anyPass(client, legacyStartedAfter.get(client));
    expect(pass, 'the install reports the failure').to.deep.equal({ outcome: 'failed', step: 'sshd' });
    expect(await distroSshdState(client)).to.equal(DISTRO_SSHD_OFF);
    await repairDpkg(client);
    const rebooted = await reboot(APT_FAILS);
    expect(await distroSshdState(rebooted)).to.equal(DISTRO_SSHD_OFF);
    expect(await port22Listening(rebooted), 'nothing may listen on port 22 after a reboot').to.equal(false);
  });

  it("lets the node owner turn the sshd it ships on, once FluxOS has installed it", async () => {
    const client = env.clients[APT_FAILS];
    const { exitCode, stderr } = await execInContainer(client.container, 'systemctl enable --now ssh.service');
    expect(exitCode, `enable failed: ${stderr}`).to.equal(0);
    await waitFor(() => port22Listening(client), { timeout: 30000, interval: 1000, label: "the node owner's sshd on port 22" });
  });

  it('leaves the sshd it ships disabled through a reboot when FluxOS is killed right after installing it', async () => {
    const client = env.clients[KILLED_INSTALLED];
    await reconciledPass(client, legacyStartedAfter.get(client));
    expect(await dpkgFaultFired(client), 'the dpkg fault must have fired').to.equal(true);
    expect(await distroSshdState(client), 'the next pass releases the preset and the hold').to.equal(DISTRO_SSHD_OFF);
    const rebooted = await reboot(KILLED_INSTALLED);
    expect(await distroSshdState(rebooted)).to.equal(DISTRO_SSHD_OFF);
    expect(await port22Listening(rebooted), 'nothing may listen on port 22 after a reboot').to.equal(false);
  });

  it('leaves the sshd it ships disabled when FluxOS is killed between unpacking and configuring it', async () => {
    const client = env.clients[KILLED_UNPACKED];
    await anyPass(client, legacyStartedAfter.get(client));
    expect(await dpkgFaultFired(client), 'the dpkg fault must have fired').to.equal(true);
    const unpacked = await reboot(KILLED_UNPACKED);
    expect(await port22Listening(unpacked), 'nothing may listen on port 22 while the package is unpacked').to.equal(false);
    // what the node owner, unattended-upgrades or FluxOS's own apt runs next
    const configure = await execInContainer(unpacked.container, 'DEBIAN_FRONTEND=noninteractive dpkg --configure -a');
    expect(configure.exitCode, `dpkg --configure -a failed: ${configure.stderr}`).to.equal(0);
    expect(await port22Listening(unpacked), 'configuring the package must not start its sshd').to.equal(false);
    const rebooted = await reboot(KILLED_UNPACKED);
    expect(await port22Listening(rebooted), 'nothing may listen on port 22 after a reboot').to.equal(false);
    await waitFor(async () => (await distroSshdState(rebooted)) === DISTRO_SSHD_OFF,
      { timeout: PASS_TIMEOUT_MS, interval: 3000, label: 'the sshd it ships disabled and the preset released' });
    await waitFor(() => loginOrThrow('current', { ip: subnet.nodeIp(KILLED_UNPACKED + 1) }), {
      timeout: PASS_TIMEOUT_MS, interval: 3000, label: 'a maintenance login once the package is configured',
    });
  });

  it("leaves the sshd it ships disabled through a reboot over a removed package the node owner had enabled", async () => {
    const client = env.clients[OWNER_REMOVED];
    const pass = await anyPass(client, legacyStartedAfter.get(client));
    expect(pass, 'the install reports the failure').to.deep.equal({ outcome: 'failed', step: 'sshd' });
    expect(await distroSshdState(client)).to.equal(DISTRO_SSHD_OFF);
    expect(await port22Listening(client), 'nothing may listen on port 22').to.equal(false);
    await repairDpkg(client);
    const rebooted = await reboot(OWNER_REMOVED);
    expect(await distroSshdState(rebooted)).to.equal(DISTRO_SSHD_OFF);
    expect(await port22Listening(rebooted), 'nothing may listen on port 22 after a reboot').to.equal(false);
  });

  it('lets the configured key in on a node whose node owner runs sshd', async () => {
    await reconciledPass(owner, legacyStartedAfter.get(owner));
    await loginOrThrow('current', { ip: ownerIp });
  });

  it("leaves the node owner's sshd as it was, and the maintenance key off it", async () => {
    expect(await ownerSshdState()).to.equal(ownerSshdBefore);
    expect(await port22Listening(owner), "the node owner's sshd must still listen on port 22").to.equal(true);
    expect(await login('stranger', { ip: ownerIp, port: 22, user: 'root' }),
      "the node owner's own login on port 22 must still work").to.equal(true);
    expect(await login('current', { ip: ownerIp, port: 22 })).to.equal(false);
  });

  it("ends a maintenance session in its logind scope when a key is dropped, and not the node owner's", async () => {
    const maintenance = await openSession(owner, ownerIp, 'current', 7003);
    expect(maintenance, 'with pam_systemd a session gets its own logind scope').to.match(/\/session-[^/]+\.scope$/);
    const ownersOwn = await openSession(owner, ownerIp, 'stranger', 7004, { port: 22, user: 'root' });
    await releaseKeys(['next'], owner);
    expect(await sessionCgroup(owner, 7003), 'dropping a key must end the session and its sudo child').to.equal(null);
    expect(await sessionCgroup(owner, 7004), "the node owner's own session must survive").to.equal(ownersOwn);
  });

  it('refuses a key that is not configured', async () => {
    expect(await login('current'), 'the configured key must still log in').to.equal(true);
    expect(await login('stranger')).to.equal(false);
  });

  it('rate-limits the maintenance port in the firewall', async () => {
    const { present, status } = await maintenanceRule();
    expect(present, status).to.equal(true);
  });

  it('listens for the maintenance sshd with its own socket, on apiport - 5', async () => {
    expect(await unitState(legacy.container, 'fluxadm-sshd.socket')).to.equal('active');
    const { stdout } = await execInContainer(legacy.container, `ss -Hltn 'sport = :${SSH_PORT}'`);
    expect(stdout.trim(), `nothing listening on ${SSH_PORT}`).to.not.equal('');
  });

  // systemd's per-trigger rate limit fails an Accept=yes socket on a connection
  // burst; off, with the connection count capped instead, a burst cannot take
  // maintenance access offline.
  it('serves the maintenance socket with its rate limit off and its connections capped', async () => {
    // one property per call: `systemctl show --value` returns multiple -p in
    // systemd's own order, not the order asked for
    const trigger = await execInContainer(legacy.container, 'systemctl show fluxadm-sshd.socket -p TriggerLimitIntervalUSec --value');
    const maxConn = await execInContainer(legacy.container, 'systemctl show fluxadm-sshd.socket -p MaxConnections --value');
    expect(trigger.stdout.trim(), 'the trigger rate limit must be off').to.equal('0');
    expect(maxConn.stdout.trim(), 'concurrent connections must be capped').to.equal('10');
  });

  // Ten connections from one address that never log in, held for less than
  // LoginGraceTime. Opened from the node itself over loopback, which ufw does not
  // filter, so the firewall's rate limit is not what stops them.
  it('keeps one source to two connections, so idle connections from it cannot lock a login out', async function heldSlots() {
    this.timeout(120000);
    const holders = 10;
    // bash, for /dev/tcp: the node's sh is dash.
    const started = await execInContainer(legacy.container, ['bash', '-c', [
      'rm -f /tmp/fluxadm-hold-*',
      `for i in $(seq 1 ${holders}); do setsid bash -c "exec 3<>/dev/tcp/127.0.0.1/${SSH_PORT} && timeout 8 cat <&3 > /tmp/fluxadm-hold-$i" >/dev/null 2>&1 & done`,
      'sleep 2',
    ].join('\n')]);
    expect(started.exitCode, `holders did not start: ${started.stderr}`).to.equal(0);

    const loggedIn = await loginResult('current');
    // The sshd sends its banner at once: a connection that holds a slot has it.
    const { stdout: answered } = await execInContainer(legacy.container, 'sleep 7; grep -l "^SSH-2.0" /tmp/fluxadm-hold-* | wc -l');
    expect(loggedIn.ok, `a login from another address while one source held its connections: ${loggedIn.stderr}`).to.equal(true);
    expect(Number(answered.trim()), 'connections from the one source that sshd answered').to.equal(2);
  });

  it('keeps the maintenance socket serving after a burst of connections, and a login still works', async function burst() {
    this.timeout(120000);
    // Every connection the socket took, served or refused over a cap, one property per call.
    const reached = async () => {
      const count = async (property) => Number((await execInContainer(legacy.container, `systemctl show fluxadm-sshd.socket -p ${property} --value`)).stdout.trim());
      return (await count('NAccepted')) + (await count('NRefused'));
    };
    const reachedBefore = await reached();
    // 400 connect-and-close from one source, well over systemd's 200-per-2s
    // default. bash, for /dev/tcp: the node's sh is dash.
    const flood = await execInContainer(legacy.container, ['bash', '-c',
      `for i in $(seq 1 400); do (exec 3<>/dev/tcp/127.0.0.1/${SSH_PORT}) 2>/dev/null; done; echo done`]);
    expect(flood.stdout.trim()).to.equal('done');
    // The canary: the burst reached the socket. systemd 255 and later pause a
    // socket that is triggered faster than its poll limit, so the last of the
    // burst is taken from the backlog once the pause ends.
    await waitFor(async () => (await reached()) - reachedBefore >= 400, {
      timeout: 30000, interval: 1000, label: 'the socket to take every connection of the burst',
    });
    expect(await unitState(legacy.container, 'fluxadm-sshd.socket'), 'the socket must survive the burst').to.equal('active');
    await loginOrThrow('current');
  });

  it('installs nothing on an Arcane node with the same key list', async () => {
    const probe = 'id fluxadm >/dev/null 2>&1 && echo user; '
      + 'test -e /etc/systemd/system/fluxadm-sshd.socket && echo unit; '
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
    expect(cgroup, "without pam_systemd a session stays in its connection's session unit")
      .to.match(/\/fluxadm-sshd@[^/]+\.service$/);
    await releaseKeys(['current', 'next']);
    expect(await sessionCgroup(legacy, 7001), 'adding a key must not end an open session').to.equal(cgroup);
    await loginOrThrow('next');
    expect(await login('current'), 'the outgoing key must still log in during the overlap').to.equal(true);
  });

  it('refuses the old key once the rotation completes, and ends open sessions', async () => {
    expect(await sessionCgroup(legacy, 7001), 'the session must be open before the key is dropped').to.not.equal(null);
    await releaseKeys(['next']);
    expect(await sessionCgroup(legacy, 7001), 'dropping a key must end the session and its sudo child').to.equal(null);
    const outgoing = await refusedForKey('current');
    expect(outgoing.refused, `the outgoing key must be refused by the sshd: ${outgoing.stderr}`).to.equal(true);
    expect(await login('next'), 'the incoming key must still log in').to.equal(true);
  });

  it('refuses every key once the list is empty, and removes everything it installed', async () => {
    expect(await login('next'), 'the key must log in before the list is emptied').to.equal(true);
    await openSession(legacy, legacyIp, 'next', 7002);
    await releaseKeys([]);
    expect(await sessionCgroup(legacy, 7002), 'emptying the list must end the session').to.equal(null);
    const rule = await maintenanceRule();
    expect(rule.present, `emptying the list must remove the firewall rule:\n${rule.status}`).to.equal(false);
    expect(await login('next'), 'login must be refused once the list is empty').to.equal(false);
    const { stdout } = await execInContainer(legacy.container,
      'test -e /etc/systemd/system/fluxadm-sshd.socket && echo socket; test -e /etc/systemd/system/fluxadm-sshd@.service && echo session; '
      + 'test -e /etc/ssh/fluxadm_sshd_config && echo config; test -e /etc/ssh/fluxadm_authorized_keys && echo keys; '
      + 'id fluxadm >/dev/null 2>&1 && echo user; test -e /home/fluxadm && echo home; test -e /etc/sudoers.d/fluxadm && echo sudoers; '
      + `ss -Hltn 'sport = :${SSH_PORT}' | grep -q . && echo listener; true`);
    expect(stdout.trim()).to.equal('');
  });
});
