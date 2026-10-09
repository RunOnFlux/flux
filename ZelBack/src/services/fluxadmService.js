const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');

const serviceHelper = require('./serviceHelper');
const benchmarkService = require('./benchmarkService');
const systemService = require('./systemService');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const fluxadmPort = require('./fluxadmPort');
const fluxEventBus = require('./utils/fluxEventBus');
const ufw = require('./utils/ufw');
const log = require('../lib/log');

const isArcane = Boolean(process.env.FLUXOS_PATH);

const fluxadmUser = 'fluxadm';
// Outside every user's home, so only the dedicated instance, which names it,
// reads it: the node owner's sshd looks up keys under the user's home.
const authorizedKeysPath = '/etc/ssh/fluxadm_authorized_keys';
const sudoersPath = `/etc/sudoers.d/${fluxadmUser}`;
// Deliberately NOT under /etc/ssh/sshd_config.d - that directory is pulled
// into the node owner's sshd via the distro Include glob. This file must only
// ever be read by our dedicated instance.
const sshdConfigPath = '/etc/ssh/fluxadm_sshd_config';
const sshdBinaryPath = '/usr/sbin/sshd';
// systemd holds the maintenance port and starts one sshd per connection, each
// in its own instance of the session unit, so every session is a unit.
const socketName = fluxadmPort.sshdSocket;
const socketUnitPath = `/etc/systemd/system/${socketName}`;
const sessionUnitPath = '/etc/systemd/system/fluxadm-sshd@.service';
const sessionUnits = 'fluxadm-sshd@*.service';
const ufwBinaryPath = '/usr/sbin/ufw';
// The openssh-server package's own units: a general-purpose sshd on port 22.
const distroSshdUnits = ['ssh.service', 'ssh.socket'];
// Debian enables a package's units on its first install through `systemctl
// preset`, so with this preset in place openssh-server's own units are never
// enabled, and a crash at any point of FluxOS's install leaves nothing to start
// sshd on the next boot. Held until dpkg has the package fully installed: from
// then on its units' recorded state decides, and keeps them disabled through an
// upgrade. A preset only sets a first install's default; it never stops the
// node owner enabling the units.
const sshdPresetDir = '/etc/systemd/system-preset';
const sshdPresetPath = `${sshdPresetDir}/00-fluxadm.preset`;
const sshdPreset = `# FluxOS: openssh-server's own sshd stays disabled while FluxOS installs it.\n${distroSshdUnits.map((unit) => `disable ${unit}`).join('\n')}\n`;
// Where Debian records, per unit, the links it created to enable it. A removed
// (not purged) package keeps both the record and the links.
const unitStateDir = '/var/lib/systemd/deb-systemd-helper-enabled';
const systemUnitDir = '/etc/systemd/system/';
// dpkg states of a package that is unpacked but not configured: configuring it
// is what enables its units, so the preset stays while it is in one of these.
const unconfiguredPackageStates = ['unpacked', 'half-configured', 'half-installed'];
// Debian's hook for package installs: a policy-rc.d that exits 101 stops every
// maintainer script starting a service. Held only across FluxOS's own install
// of openssh-server, and marked so a copy left by an interrupted one is known.
const policyRcPath = '/usr/sbin/policy-rc.d';
const policyRc = '#!/bin/sh\n# FluxOS: no service starts while it installs openssh-server.\nexit 101\n';

const reconcileIntervalMs = 60 * 60 * 1000;
// used when the ArcaneOS confirmation is indeterminate (fluxbenchd not up yet)
const reconcileRetryIntervalMs = 5 * 60 * 1000;

let reconcileTimer = null;


/**
 * Three-state ArcaneOS check via fluxbenchd, mirroring the tampering
 * blocklist gate. Creating users or writing sudoers on ArcaneOS is treated as
 * tampering by its system integrity verification, so the spoofable env check
 * alone is not enough - only proceed on an explicit "not ArcaneOS" from a
 * separate daemon.
 *   true  - confirmed legacy node, safe to proceed
 *   false - confirmed ArcaneOS
 *   null  - fluxbenchd unreachable or response malformed, skip this cycle
 * @returns {Promise<boolean | null>}
 */
async function confirmedLegacyNode() {
  try {
    const benchmarkResponse = await benchmarkService.getBenchmarks();
    if (!benchmarkResponse || benchmarkResponse.status !== 'success' || !benchmarkResponse.data) {
      return null;
    }
    const { systemsecure } = benchmarkResponse.data;
    if (typeof systemsecure !== 'boolean') return null;
    return !systemsecure;
  } catch (error) {
    log.warn(`fluxadm access - benchmark check failed: ${error.message}`);
    return null;
  }
}

/**
 * Reads a file only root can read (the sudoers drop-in).
 * @param {string} filePath
 * @returns {Promise<string | null>} Content, or null if unreadable / missing.
 */
async function readFileAsRoot(filePath) {
  const { stdout, error } = await serviceHelper.runCommand('cat', {
    runAsRoot: true,
    logError: false,
    params: [filePath],
  });

  if (error) return null;
  return stdout;
}

/**
 * Reads a world-readable file natively.
 * @param {string} filePath
 * @returns {Promise<string | null>} Content, or null if missing.
 */
async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Installs content to a root-owned location atomically via install(1). The
 * content is staged in a private temp dir as the fluxos user first.
 * @param {string} content
 * @param {string} targetPath
 * @param {{mode: string, owner?: string, group?: string, validator?: (stagedPath: string) => Promise<boolean>}} options
 *   validator runs against the staged file before install; returning false aborts.
 * @returns {Promise<boolean>} True on success.
 */
async function installFileAsRoot(content, targetPath, options) {
  const {
    mode, owner = 'root', group = 'root', validator = null,
  } = options;

  let tempDir = null;
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxadm-'));
    const stagedPath = path.join(tempDir, path.basename(targetPath));
    await fs.writeFile(stagedPath, content, { mode: 0o600 });

    if (validator && !(await validator(stagedPath))) {
      log.error(`fluxadm access - staged content for ${targetPath} failed validation, not installing`);
      return false;
    }

    const { error } = await serviceHelper.runCommand('install', {
      runAsRoot: true,
      params: ['-o', owner, '-g', group, '-m', mode, stagedPath, targetPath],
    });

    return !error;
  } catch (error) {
    log.error(`fluxadm access - failed to install ${targetPath}: ${error.message}`);
    return false;
  } finally {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Ensures the passwordless sudo drop-in, validated with visudo before install
 * so a bad write can never break sudo for the fluxos user itself. The file is
 * also the marker that the fluxadm user belongs to FluxOS.
 * @returns {Promise<boolean>}
 */
async function ensureSudoers() {
  const desired = `${fluxadmUser} ALL=(ALL) NOPASSWD:ALL\n`;

  const current = await readFileAsRoot(sudoersPath);
  if (current !== null && current.trim() === desired.trim()) return true;

  const validator = async (stagedPath) => {
    const { error } = await serviceHelper.runCommand('visudo', {
      runAsRoot: true,
      params: ['-cf', stagedPath],
    });
    return !error;
  };

  const installed = await installFileAsRoot(desired, sudoersPath, { mode: '0440', validator });
  if (installed) log.info(`fluxadm access - installed sudoers drop-in ${sudoersPath}`);
  return installed;
}

/**
 * Ensures the fluxadm user exists. A pre-existing fluxadm user that we did
 * not create (no sudoers drop-in) is refused rather than adopted - taking
 * over a node owner's account would replace their authorized_keys.
 * @returns {Promise<boolean>} True if the user exists and is ours to manage.
 */
async function ensureUser() {
  const { error: idError } = await serviceHelper.runCommand('id', {
    logError: false,
    params: ['-u', fluxadmUser],
  });

  if (!idError) {
    const sudoersContent = await readFileAsRoot(sudoersPath);
    if (sudoersContent === null) {
      log.error(`fluxadm access - user ${fluxadmUser} already exists but was not created by FluxOS `
        + `(no ${sudoersPath}). Refusing to manage it. Remove the user or create the sudoers `
        + 'drop-in manually to proceed.');
      return false;
    }
    return true;
  }

  // the sudoers drop-in doubles as the ownership marker and must exist before
  // the user does: a failure between the two steps then resumes cleanly on the
  // next cycle instead of tripping the foreign-user refusal above
  if (!(await ensureSudoers())) return false;

  const { error } = await serviceHelper.runCommand('useradd', {
    runAsRoot: true,
    params: ['-r', '-m', '-s', '/bin/bash', fluxadmUser],
  });

  if (error) return false;

  log.info(`fluxadm access - created system user ${fluxadmUser}`);
  return true;
}

/**
 * Ends every fluxadm session, together with whatever it runs through sudo, and
 * returns once they are gone. A session's processes live in its connection's
 * session unit, or in the user's slice where pam_systemd registers the session;
 * both are killed, then stopped - a stop returns only when the unit is empty.
 * @returns {Promise<void>}
 */
async function endSessions() {
  const { stdout: uid } = await serviceHelper.runCommand('id', {
    logError: false,
    params: ['-u', fluxadmUser],
  });
  const units = [sessionUnits];
  const userId = serviceHelper.ensureString(uid).trim();
  if (/^\d+$/.test(userId)) units.push(`user-${userId}.slice`);

  await serviceHelper.runCommand('systemctl', {
    runAsRoot: true,
    logError: false,
    params: ['kill', '--signal=SIGKILL', ...units],
  });
  await serviceHelper.runCommand('systemctl', {
    runAsRoot: true,
    logError: false,
    params: ['stop', ...units],
  });
  log.info('fluxadm access - fluxadm sessions ended');
}

/**
 * Reconciles authorized_keys to exactly the configured key set. This is the
 * key roll mechanism: shipping a FluxOS release with a changed key list
 * rotates the whole legacy fleet. A list that drops a key also ends every open
 * session, so a removed key keeps no access it already had.
 * @param {string[]} keys
 * @returns {Promise<boolean>}
 */
async function ensureAuthorizedKeys(keys) {
  const desired = keys.length ? `${keys.join('\n')}\n` : '';

  const current = await readFileIfExists(authorizedKeysPath);
  if (current !== null && current.trim() === desired.trim()) return true;

  const installed = await installFileAsRoot(desired, authorizedKeysPath, { mode: '0644' });
  if (!installed) return false;
  log.info(`fluxadm access - authorized_keys updated (${keys.length} key(s))`);

  const currentKeys = (current ?? '').split('\n').map((key) => key.trim()).filter(Boolean);
  if (currentKeys.some((key) => !keys.includes(key))) await endSessions();
  return true;
}

/**
 * Config for the maintenance sshd, run once per connection (sshd -i), so it
 * names no port: the socket holds that. Key-only auth for the fluxadm user
 * exclusively - the node owner's accounts (and their password policy, root
 * login setting etc) do not exist on this port. Algorithms are pinned to a
 * strong set that openssh 8.2 (Ubuntu 20.04) still supports.
 * @returns {string}
 */
function buildSshdConfig() {
  return `# Managed by FluxOS. Dedicated maintenance SSH instance for the ${fluxadmUser} user.
# The node owner's own sshd and its configuration are never touched.
HostKey /etc/ssh/ssh_host_ed25519_key
AllowUsers ${fluxadmUser}
AuthenticationMethods publickey
PubkeyAuthentication yes
AuthorizedKeysFile ${authorizedKeysPath}
PasswordAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin no
UsePAM yes
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com
LoginGraceTime 30
MaxAuthTries 3
X11Forwarding no
PrintMotd no
Subsystem sftp internal-sftp
`;
}

/**
 * The maintenance port's socket. systemd listens and, for each connection,
 * starts an instance of the session unit with the connection as its stdin.
 *
 * Accept=yes (one sshd instance per connection) because the oldest supported
 * legacy distro, Ubuntu 22.04, ships an sshd that is socket-activated only this
 * way; it also makes each session its own unit, so revoking a key can end it.
 *
 * TriggerLimitIntervalSec=0 turns off systemd's per-trigger rate limit, which
 * on 22.04 and Debian 12 puts an Accept=yes socket into a failed state on a
 * connection burst and keeps it there until restarted - a single source could
 * take maintenance access away until the next reconcile. MaxConnections caps
 * concurrent sessions instead: it bounds the sshd processes a flood can spawn
 * on any node size, and a handful is all maintenance ever needs. Over the cap,
 * connections are refused and the socket stays up.
 * @param {number} port
 * @returns {string}
 */
function buildSocketUnit(port) {
  return `[Unit]
Description=FluxOS maintenance SSH socket (${fluxadmUser})

[Socket]
ListenStream=${port}
Accept=yes
TriggerLimitIntervalSec=0
MaxConnections=10

[Install]
WantedBy=sockets.target
`;
}

/**
 * One maintenance SSH connection: an sshd in inetd mode serving the socket's
 * connection, which reads the current config and keys as it starts. Stopping
 * the instance ends the session and everything it started. /run/sshd
 * (privilege separation dir) is created with an ExecStartPre instead of
 * RuntimeDirectory=sshd on purpose: RuntimeDirectory is removed when a unit
 * stops, which would break new connections on the node owner's own sshd
 * sharing that directory.
 * @returns {string}
 */
function buildSessionUnit() {
  return `[Unit]
Description=FluxOS maintenance SSH session (${fluxadmUser})

[Service]
ExecStartPre=/bin/mkdir -p /run/sshd
ExecStart=-${sshdBinaryPath} -i -f ${sshdConfigPath}
StandardInput=socket
`;
}

/**
 * Removes the sshd preset unless openssh-server is unpacked and not yet
 * configured, which is the one state in which a configure still to come would
 * enable its units. Runs on every pass, so a preset left by an install that was
 * interrupted goes once dpkg has finished the package.
 * @returns {Promise<void>}
 */
async function releaseSshdPreset() {
  if (!(await fs.access(sshdPresetPath).then(() => true).catch(() => false))) return;
  const status = await systemService.getPackageStatus('openssh-server');
  if (unconfiguredPackageStates.includes(status.split(' ')[2])) return;
  const { error } = await serviceHelper.runCommand('rm', { runAsRoot: true, params: ['-f', sshdPresetPath] });
  if (error) log.error(`fluxadm access - could not remove ${sshdPresetPath}, retrying on the next pass`);
}

/**
 * Removes the enablement a removed (not purged) openssh-server leaves behind:
 * the links Debian recorded creating for its units, which point at nothing
 * until the package's unit files return and then enable them before any preset
 * is read. Only a recorded link that is under /etc/systemd/system and points at
 * nothing is removed, so a unit file that exists is never disabled. The units
 * are stopped too, so nothing from before the removal is left running.
 * @returns {Promise<boolean>}
 */
async function clearRemovedSshdEnablement() {
  const recorded = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const unit of distroSshdUnits) {
    // eslint-disable-next-line no-await-in-loop
    const state = (await readFileIfExists(`${unitStateDir}/${unit}.dsh-also`)) || '';
    recorded.push(...state.split('\n').map((line) => line.trim()).filter((line) => line.startsWith(systemUnitDir)));
  }

  const dangling = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const link of recorded) {
    // eslint-disable-next-line no-await-in-loop
    const isLink = await fs.lstat(link).then((stat) => stat.isSymbolicLink()).catch(() => false);
    // eslint-disable-next-line no-await-in-loop
    if (isLink && !(await fs.stat(link).then(() => true).catch(() => false))) dangling.push(link);
  }

  if (dangling.length) {
    const { error } = await serviceHelper.runCommand('rm', { runAsRoot: true, params: ['-f', ...dangling] });
    if (error) {
      log.error(`fluxadm access - could not remove the links a removed openssh-server left: ${dangling.join(', ')}`);
      return false;
    }
    log.info(`fluxadm access - removed the links a removed openssh-server left: ${dangling.join(', ')}`);
  }

  await serviceHelper.runCommand('systemctl', { runAsRoot: true, logError: false, params: ['stop', ...distroSshdUnits] });
  return true;
}

/**
 * Installs openssh-server for the sshd binary and host keys the maintenance
 * sshd needs, leaving the package's own sshd installed and disabled. A preset
 * keeps its units from ever being enabled, and service starts are held off
 * across the install, so the package's sshd never starts and port 22 never
 * opens, whether the install completes, fails or is interrupted. A
 * policy-rc.d that is not FluxOS's is never replaced: the install waits for a
 * node without one.
 * @returns {Promise<boolean>}
 */
async function installOpensshServer() {
  const existing = await readFileIfExists(policyRcPath);
  if (existing !== null && existing !== policyRc) {
    log.error(`fluxadm access - ${policyRcPath} is the node owner's, not installing openssh-server`);
    return false;
  }
  if (!(await clearRemovedSshdEnablement())) return false;
  const { error: presetDirError } = await serviceHelper.runCommand('install', {
    runAsRoot: true,
    params: ['-d', '-m', '0755', sshdPresetDir],
  });
  if (presetDirError || !(await installFileAsRoot(sshdPreset, sshdPresetPath, { mode: '0644' }))) {
    log.error(`fluxadm access - cannot write ${sshdPresetPath}, not installing openssh-server`);
    return false;
  }
  if (existing === null && !(await installFileAsRoot(policyRc, policyRcPath, { mode: '0755' }))) {
    log.error(`fluxadm access - cannot hold service starts with ${policyRcPath}, not installing openssh-server`);
    return false;
  }

  let installError;
  try {
    installError = await systemService.upgradePackage('openssh-server');
  } finally {
    const { error: rmError } = await serviceHelper.runCommand('rm', { runAsRoot: true, params: ['-f', policyRcPath] });
    if (rmError) log.error(`fluxadm access - could not remove ${policyRcPath}; no package can start a service until it is removed`);
    await releaseSshdPreset();
  }
  if (installError) {
    log.error('fluxadm access - openssh-server is not installable, cannot start maintenance sshd');
    return false;
  }
  log.info('fluxadm access - openssh-server installed, its own sshd disabled');
  return true;
}

/**
 * Ensures the maintenance sshd's config, its socket and session units, and the
 * socket listening. An sshd the node owner already has is left exactly as it
 * is; openssh-server is installed only where there is none. A changed config
 * or session unit applies to the next connection; a changed socket is
 * restarted, which leaves open sessions running.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
async function ensureSshdInstance(port) {
  const sshdPresent = await fs.access(sshdBinaryPath).then(() => true).catch(() => false);
  if (!sshdPresent && !(await installOpensshServer())) return false;
  // a hold left by an install that was interrupted after the package went in
  if (sshdPresent && (await readFileIfExists(policyRcPath)) === policyRc) {
    await serviceHelper.runCommand('rm', { runAsRoot: true, params: ['-f', policyRcPath] });
  }

  const desiredConfig = buildSshdConfig();
  if ((await readFileIfExists(sshdConfigPath)) !== desiredConfig) {
    const validator = async (stagedPath) => {
      const { error } = await serviceHelper.runCommand(sshdBinaryPath, {
        runAsRoot: true,
        params: ['-t', '-f', stagedPath],
      });
      return !error;
    };

    const installed = await installFileAsRoot(desiredConfig, sshdConfigPath, { mode: '0644', validator });
    if (!installed) return false;
    log.info('fluxadm access - maintenance sshd config installed');
  }

  let unitsChanged = false;
  let socketChanged = false;
  // eslint-disable-next-line no-restricted-syntax
  for (const [unitPath, content] of [[sessionUnitPath, buildSessionUnit()], [socketUnitPath, buildSocketUnit(port)]]) {
    // eslint-disable-next-line no-await-in-loop
    if ((await readFileIfExists(unitPath)) !== content) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await installFileAsRoot(content, unitPath, { mode: '0644' }))) return false;
      unitsChanged = true;
      if (unitPath === socketUnitPath) socketChanged = true;
    }
  }
  if (unitsChanged) {
    const { error: reloadError } = await serviceHelper.runCommand('systemctl', {
      runAsRoot: true,
      params: ['daemon-reload'],
    });
    if (reloadError) return false;
    log.info('fluxadm access - maintenance sshd units installed');
  }

  const { stdout: enabledState } = await serviceHelper.runCommand('systemctl', {
    logError: false,
    params: ['is-enabled', socketName],
  });
  if (serviceHelper.ensureString(enabledState).trim() !== 'enabled') {
    const { error } = await serviceHelper.runCommand('systemctl', {
      runAsRoot: true,
      params: ['enable', socketName],
    });
    if (error) return false;
  }

  const { stdout: activeState } = await serviceHelper.runCommand('systemctl', {
    logError: false,
    params: ['is-active', socketName],
  });
  const isActive = serviceHelper.ensureString(activeState).trim() === 'active';

  if (socketChanged || !isActive) {
    const { error } = await serviceHelper.runCommand('systemctl', {
      runAsRoot: true,
      params: ['restart', socketName],
    });
    if (error) return false;
    log.info(`fluxadm access - maintenance sshd listening on port ${port}`);
  }

  return true;
}

/**
 * Rate-limited firewall opening for the maintenance sshd port.
 * @param {number} port
 * @returns {Promise<boolean>} False when the rule could not be added.
 */
async function ensureFirewall(port) {
  const firewallActive = await fluxNetworkHelper.isFirewallActive();
  if (!firewallActive) return true;

  const { error, stderr } = await ufw.runUfw(['limit', `${port}/tcp`]);
  if (error) {
    log.error(`fluxadm access - could not add the ufw limit rule for port ${port}: ${stderr.trim() || error.message}`);
    return false;
  }
  return true;
}

/**
 * Revocation path for an empty configured key list: ends every fluxadm
 * session, removes the maintenance sshd and its key file, then the firewall
 * rule, the fluxadm user and its sudoers drop-in. The drop-in marks the user as
 * ours, so it goes last: a pass that fails part way resumes on the next one
 * instead of finding a user it would refuse as the node owner's. Converges to a
 * no-op: once removed (or never installed) nothing runs.
 * @returns {Promise<void>}
 */
async function removeAccess() {
  const present = async (filePath) => fs.access(filePath).then(() => true).catch(() => false);
  const unitPresent = await present(socketUnitPath) || await present(sessionUnitPath);
  const configPresent = await present(sshdConfigPath);
  const keysPresent = await present(authorizedKeysPath);
  const ours = (await readFileAsRoot(sudoersPath)) !== null;

  // the socket first, so no new session starts while the open ones are ended
  if (unitPresent) {
    await serviceHelper.runCommand('systemctl', {
      runAsRoot: true,
      logError: false,
      params: ['disable', '--now', socketName],
    });
  }

  if (ours) await endSessions();

  if (unitPresent || configPresent || keysPresent) {
    await serviceHelper.runCommand('rm', {
      runAsRoot: true,
      params: ['-f', socketUnitPath, sessionUnitPath, sshdConfigPath, authorizedKeysPath],
    });
    if (unitPresent) {
      await serviceHelper.runCommand('systemctl', { runAsRoot: true, params: ['daemon-reload'] });
    }
    log.info('fluxadm access - no keys configured, maintenance sshd and its keys removed');
  }

  if (!ours) return;

  // ufw exits 0 for a rule that is already gone, so only a real failure keeps
  // the drop-in, and with it the retry on the next pass
  const ufwPresent = await fs.access(ufwBinaryPath).then(() => true).catch(() => false);
  if (ufwPresent) {
    const port = fluxadmPort.currentSshPort();
    const { error: ufwError, stderr } = await ufw.runUfw(['delete', 'limit', `${port}/tcp`]);
    if (ufwError) {
      log.error(`fluxadm access - could not delete the ufw limit rule for port ${port}, retrying on the next pass: ${stderr.trim() || ufwError.message}`);
      return;
    }
  }

  const { error: idError } = await serviceHelper.runCommand('id', {
    logError: false,
    params: ['-u', fluxadmUser],
  });
  if (!idError) {
    const { error: userdelError } = await serviceHelper.runCommand('userdel', {
      runAsRoot: true,
      params: ['-r', fluxadmUser],
    });
    if (userdelError) {
      log.error(`fluxadm access - could not remove user ${fluxadmUser}, retrying on the next pass`);
      return;
    }
  }

  const { error: rmError } = await serviceHelper.runCommand('rm', {
    runAsRoot: true,
    params: ['-f', sudoersPath],
  });
  if (!rmError) log.info(`fluxadm access - user ${fluxadmUser} and its sudoers drop-in removed`);
}

/**
 * One reconcile pass: its outcome, and for a failed pass the step that failed.
 * @returns {Promise<{outcome: 'reconciled' | 'skipped' | 'deferred' | 'failed', step?: string}>}
 */
async function reconcileAccess() {
  if (isArcane) return { outcome: 'skipped' };

  try {
    // every path below mutates the system, so nothing - including removal -
    // runs without an explicit legacy confirmation
    const legacyConfirmed = await confirmedLegacyNode();
    if (legacyConfirmed === null) return { outcome: 'deferred' };
    if (legacyConfirmed === false) return { outcome: 'skipped' };

    if (!fluxadmPort.bootedWithSystemd()) {
      log.warn('fluxadm access - systemd is not this node\'s init, maintenance access unavailable');
      return { outcome: 'skipped' };
    }

    await releaseSshdPreset();

    const keys = fluxadmPort.getConfiguredKeys();
    if (!keys.length) {
      await removeAccess();
      return { outcome: 'reconciled' };
    }

    const port = fluxadmPort.getFluxadmSshPort();
    const steps = [
      ['user', () => ensureUser()],
      ['sudoers', () => ensureSudoers()],
      ['authorized keys', () => ensureAuthorizedKeys(keys)],
      ['sshd', () => ensureSshdInstance(port)],
      ['firewall', () => ensureFirewall(port)],
    ];
    // eslint-disable-next-line no-restricted-syntax
    for (const [step, ensure] of steps) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await ensure())) return { outcome: 'failed', step };
    }
    return { outcome: 'reconciled' };
  } catch (error) {
    log.error(`fluxadm access - reconcile failed: ${error.message}`);
    return { outcome: 'failed', step: error.message };
  }
}

/**
 * Reconciles fluxadm maintenance access on legacy nodes: system user with
 * passwordless sudo, the configured ed25519 keys, and a dedicated hardened
 * sshd instance on apiport - 5. Never runs on ArcaneOS, which provisions the
 * equivalent at ISO build time, nor on a machine whose init is not systemd.
 * @returns {Promise<'reconciled' | 'skipped' | 'deferred' | 'failed'>}
 */
async function ensureFluxadmAccess() {
  return (await reconcileAccess()).outcome;
}

/**
 * Starts the periodic reconcile. Retries sooner while the ArcaneOS
 * confirmation is indeterminate (fluxbenchd still starting).
 * @returns {void}
 */
function start() {
  if (isArcane) return;
  if (reconcileTimer) return;

  const runCycle = async () => {
    const { outcome, step } = await reconcileAccess();
    log.info(`fluxadm access - reconcile pass ${outcome}${step ? ` at ${step}` : ''}`);
    fluxEventBus.publish('fluxadm:pass', step ? { outcome, step } : { outcome });
    const delay = outcome === 'deferred' ? reconcileRetryIntervalMs : reconcileIntervalMs;
    reconcileTimer = setTimeout(runCycle, delay);
  };

  reconcileTimer = setTimeout(runCycle, 0);
}

/**
 * Stops the periodic reconcile.
 * @returns {void}
 */
function stop() {
  if (reconcileTimer) {
    clearTimeout(reconcileTimer);
    reconcileTimer = null;
  }
}

module.exports = {
  ensureFluxadmAccess,
  start,
  stop,
  // testing exports
  buildSessionUnit,
  buildSocketUnit,
  buildSshdConfig,
  confirmedLegacyNode,
  endSessions,
  ensureAuthorizedKeys,
  ensureFirewall,
  ensureSshdInstance,
  ensureSudoers,
  ensureUser,
  installFileAsRoot,
  removeAccess,
};
