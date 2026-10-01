const config = require('config');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');

const serviceHelper = require('./serviceHelper');
const benchmarkService = require('./benchmarkService');
const systemService = require('./systemService');
const fluxNetworkHelper = require('./fluxNetworkHelper');
const log = require('../lib/log');

const isArcane = Boolean(process.env.FLUXOS_PATH);

const fluxadmUser = 'fluxadm';
const fluxadmHome = `/home/${fluxadmUser}`;
const authorizedKeysPath = `${fluxadmHome}/.ssh/authorized_keys`;
const sudoersPath = `/etc/sudoers.d/${fluxadmUser}`;
// Deliberately NOT under /etc/ssh/sshd_config.d - that directory is pulled
// into the operator's sshd via the distro Include glob. This file must only
// ever be read by our dedicated instance.
const sshdConfigPath = '/etc/ssh/fluxadm_sshd_config';
const sshdBinaryPath = '/usr/sbin/sshd';
const serviceName = 'fluxadm-sshd.service';
const serviceUnitPath = `/etc/systemd/system/${serviceName}`;
// present only when systemd booted the machine as PID 1 (see sd_booted(3))
const systemdRuntimeDir = '/run/systemd/system';

const reconcileIntervalMs = 60 * 60 * 1000;
// used when the ArcaneOS confirmation is indeterminate (fluxbenchd not up yet)
const reconcileRetryIntervalMs = 5 * 60 * 1000;

let reconcileTimer = null;

/**
 * The ed25519 public keys granted maintenance access. An empty list disables
 * the feature entirely and revokes any previously installed access.
 * @returns {string[]}
 */
function getConfiguredKeys() {
  const keys = config.fluxadm.sshAuthorizedKeys;
  if (!Array.isArray(keys)) return [];
  return keys.filter((key) => typeof key === 'string' && key.trim()).map((key) => key.trim());
}

/**
 * Whether systemd is this machine's init. The maintenance sshd runs as a
 * systemd unit, so without it the feature cannot work and must not start.
 * @returns {boolean}
 */
function bootedWithSystemd() {
  return fsSync.existsSync(systemdRuntimeDir);
}

/**
 * The port the maintenance sshd instance listens on. Same convention as
 * ArcaneOS: apiport - 5 (16122 on a default node). Returns null when the
 * feature is inactive (ArcaneOS, no systemd, or no keys configured) so callers
 * like the UPnP restore loop can skip it.
 * @returns {number | null}
 */
function getFluxadmSshPort() {
  if (isArcane) return null;
  if (!bootedWithSystemd()) return null;
  if (!getConfiguredKeys().length) return null;

  const { userconfig } = globalThis;
  const apiPort = userconfig.initial.apiport || config.server.apiport;

  return +apiPort - 5;
}

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
 * Reads a file only root can read (sudoers, authorized_keys).
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
 * over an operator's account would replace their authorized_keys.
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
 * Reconciles authorized_keys to exactly the configured key set. This is the
 * key roll mechanism: shipping a FluxOS release with a changed key list
 * rotates the whole legacy fleet.
 * @param {string[]} keys
 * @returns {Promise<boolean>}
 */
async function ensureAuthorizedKeys(keys) {
  const desired = keys.length ? `${keys.join('\n')}\n` : '';

  const current = await readFileAsRoot(authorizedKeysPath);
  if (current !== null && current.trim() === desired.trim()) return true;

  const { error: dirError } = await serviceHelper.runCommand('install', {
    runAsRoot: true,
    params: ['-d', '-o', fluxadmUser, '-g', fluxadmUser, '-m', '0700', path.dirname(authorizedKeysPath)],
  });
  if (dirError) return false;

  const installed = await installFileAsRoot(desired, authorizedKeysPath, {
    mode: '0600',
    owner: fluxadmUser,
    group: fluxadmUser,
  });
  if (installed) log.info(`fluxadm access - authorized_keys updated (${keys.length} key(s))`);
  return installed;
}

/**
 * Config for the dedicated maintenance sshd instance. Key-only auth for the
 * fluxadm user exclusively - the operator's accounts (and their password
 * policy, root login setting etc) do not exist on this port. Algorithms are
 * pinned to a strong set that openssh 7.6 (Ubuntu 18.04) still supports.
 * @param {number} port
 * @returns {string}
 */
function buildSshdConfig(port) {
  return `# Managed by FluxOS. Dedicated maintenance SSH instance for the ${fluxadmUser} user.
# The operator's own sshd and its configuration are never touched.
Port ${port}
PidFile /run/fluxadm-sshd.pid
HostKey /etc/ssh/ssh_host_ed25519_key
AllowUsers ${fluxadmUser}
AuthenticationMethods publickey
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
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
 * Unit for the maintenance sshd. /run/sshd (privilege separation dir) is
 * created with an ExecStartPre instead of RuntimeDirectory=sshd on purpose:
 * RuntimeDirectory is removed on unit stop, which would break new connections
 * on the operator's own sshd sharing that directory. KillMode=process keeps
 * established sessions alive across restarts of the instance.
 * @returns {string}
 */
function buildServiceUnit() {
  return `[Unit]
Description=FluxOS maintenance SSH instance (${fluxadmUser})
After=network.target

[Service]
ExecStartPre=/bin/mkdir -p /run/sshd
ExecStartPre=${sshdBinaryPath} -t -f ${sshdConfigPath}
ExecStart=${sshdBinaryPath} -D -f ${sshdConfigPath}
ExecReload=/bin/kill -HUP $MAINPID
KillMode=process
Restart=on-failure
RestartPreventExitStatus=255

[Install]
WantedBy=multi-user.target
`;
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
 * Ensures the sshd instance config, unit file and running state.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
async function ensureSshdInstance(port) {
  const sshdPresent = await fs.access(sshdBinaryPath).then(() => true).catch(() => false);
  if (!sshdPresent) {
    const installError = await systemService.upgradePackage('openssh-server');
    if (installError) {
      log.error('fluxadm access - openssh-server is not installable, cannot start maintenance sshd');
      return false;
    }
  }

  const desiredConfig = buildSshdConfig(port);
  const currentConfig = await readFileIfExists(sshdConfigPath);
  const configChanged = currentConfig !== desiredConfig;

  if (configChanged) {
    const validator = async (stagedPath) => {
      const { error } = await serviceHelper.runCommand(sshdBinaryPath, {
        runAsRoot: true,
        params: ['-t', '-f', stagedPath],
      });
      return !error;
    };

    const installed = await installFileAsRoot(desiredConfig, sshdConfigPath, { mode: '0644', validator });
    if (!installed) return false;
    log.info(`fluxadm access - maintenance sshd config installed for port ${port}`);
  }

  const desiredUnit = buildServiceUnit();
  const currentUnit = await readFileIfExists(serviceUnitPath);
  const unitChanged = currentUnit !== desiredUnit;

  if (unitChanged) {
    const installed = await installFileAsRoot(desiredUnit, serviceUnitPath, { mode: '0644' });
    if (!installed) return false;

    const { error: reloadError } = await serviceHelper.runCommand('systemctl', {
      runAsRoot: true,
      params: ['daemon-reload'],
    });
    if (reloadError) return false;
    log.info(`fluxadm access - ${serviceName} unit installed`);
  }

  const { stdout: enabledState } = await serviceHelper.runCommand('systemctl', {
    logError: false,
    params: ['is-enabled', serviceName],
  });
  if (serviceHelper.ensureString(enabledState).trim() !== 'enabled') {
    const { error } = await serviceHelper.runCommand('systemctl', {
      runAsRoot: true,
      params: ['enable', serviceName],
    });
    if (error) return false;
  }

  const { stdout: activeState } = await serviceHelper.runCommand('systemctl', {
    logError: false,
    params: ['is-active', serviceName],
  });
  const isActive = serviceHelper.ensureString(activeState).trim() === 'active';

  if (configChanged || unitChanged || !isActive) {
    const { error } = await serviceHelper.runCommand('systemctl', {
      runAsRoot: true,
      params: ['restart', serviceName],
    });
    if (error) return false;
    log.info(`fluxadm access - maintenance sshd listening on port ${port}`);
  }

  return true;
}

/**
 * Rate-limited firewall opening for the maintenance sshd port.
 * @param {number} port
 * @returns {Promise<void>}
 */
async function ensureFirewall(port) {
  const firewallActive = await fluxNetworkHelper.isFirewallActive();
  if (!firewallActive) return;

  const { error } = await serviceHelper.runCommand('ufw', {
    runAsRoot: true,
    params: ['limit', `${port}/tcp`],
  });
  if (error) {
    log.warn(`fluxadm access - failed to add ufw limit rule for port ${port}`);
  }
}

/**
 * Revocation path for an empty configured key list: removes the maintenance
 * sshd instance installed by a previous release and empties authorized_keys.
 * The key file must be emptied too, as the operator's own sshd would still
 * accept the key for the fluxadm user on their port. Only ever touches a
 * fluxadm user carrying our sudoers drop-in, never an operator's own user.
 * Converges to a no-op: once removed (or never installed) nothing runs.
 * @returns {Promise<void>}
 */
async function removeAccess() {
  const unitPresent = await fs.access(serviceUnitPath).then(() => true).catch(() => false);
  const configPresent = await fs.access(sshdConfigPath).then(() => true).catch(() => false);

  if (unitPresent) {
    await serviceHelper.runCommand('systemctl', {
      runAsRoot: true,
      logError: false,
      params: ['disable', '--now', serviceName],
    });
  }

  if (unitPresent || configPresent) {
    await serviceHelper.runCommand('rm', {
      runAsRoot: true,
      params: ['-f', serviceUnitPath, sshdConfigPath],
    });
    if (unitPresent) {
      await serviceHelper.runCommand('systemctl', { runAsRoot: true, params: ['daemon-reload'] });
    }
    log.info('fluxadm access - no keys configured, maintenance sshd removed');
  }

  const oursMarker = await readFileAsRoot(sudoersPath);
  if (oursMarker === null) return;

  const currentKeys = await readFileAsRoot(authorizedKeysPath);
  if (currentKeys !== null && currentKeys.trim()) {
    await installFileAsRoot('', authorizedKeysPath, {
      mode: '0600',
      owner: fluxadmUser,
      group: fluxadmUser,
    });
    log.info('fluxadm access - no keys configured, authorized_keys emptied');
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
  if (isArcane) return 'skipped';

  try {
    // every path below mutates the system, so nothing - including removal -
    // runs without an explicit legacy confirmation
    const legacyConfirmed = await confirmedLegacyNode();
    if (legacyConfirmed === null) return 'deferred';
    if (legacyConfirmed === false) return 'skipped';

    if (!bootedWithSystemd()) {
      log.warn('fluxadm access - systemd is not this node\'s init, maintenance access unavailable');
      return 'skipped';
    }

    const keys = getConfiguredKeys();
    if (!keys.length) {
      await removeAccess();
      return 'reconciled';
    }

    if (!(await ensureUser())) return 'failed';
    if (!(await ensureSudoers())) return 'failed';
    if (!(await ensureAuthorizedKeys(keys))) return 'failed';

    const port = getFluxadmSshPort();
    if (!(await ensureSshdInstance(port))) return 'failed';
    await ensureFirewall(port);

    return 'reconciled';
  } catch (error) {
    log.error(`fluxadm access - reconcile failed: ${error.message}`);
    return 'failed';
  }
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
    const outcome = await ensureFluxadmAccess();
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
  getFluxadmSshPort,
  start,
  stop,
  // testing exports
  buildServiceUnit,
  bootedWithSystemd,
  buildSshdConfig,
  confirmedLegacyNode,
  ensureAuthorizedKeys,
  ensureFirewall,
  ensureSshdInstance,
  ensureSudoers,
  ensureUser,
  getConfiguredKeys,
  installFileAsRoot,
  removeAccess,
};
