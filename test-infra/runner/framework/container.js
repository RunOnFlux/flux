export async function execInContainer(container, command) {
  const args = Array.isArray(command) ? command : ['sh', '-c', command];
  const result = await container.exec(args);
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, output: result.output };
}

export async function listAppContainers(container, { all = false } = {}) {
  const flag = all ? ' -a' : '';
  const { stdout } = await execInContainer(container,
    `docker ps${flag} --format "{{.Names}}\t{{.Status}}\t{{.Image}}" 2>/dev/null || echo ""`,
  );
  return stdout.trim().split('\n')
    .filter((line) => line && !line.includes('NAMES'))
    .map((line) => {
      const [name, status, image] = line.split('\t');
      return { name, status, image };
    })
    .filter((c) => c.name);
}

export async function isAppContainerRunning(container, appName) {
  const containers = await listAppContainers(container);
  return containers.some((c) => c.name.includes(appName) && c.status?.startsWith('Up'));
}

export async function killAppContainer(container, appName, componentName) {
  const name = `flux${componentName ?? appName}_${appName}`;
  return execInContainer(container, `docker rm -f ${name}`);
}

export async function getAppContainerStatus(container, appName, { all = false } = {}) {
  const containers = await listAppContainers(container, { all });
  return containers.find((c) => c.name.includes(appName)) ?? null;
}

function appContainerName(appName, componentName) {
  return `flux${componentName ?? appName}_${appName}`;
}

// graceful stop -> the container exits 0 and stays present (not removed). Use to
// exercise restart-on-clean-exit, as opposed to killAppContainer (docker rm -f,
// which removes it -> the missing-container/recreate path).
export async function stopAppContainer(container, appName, componentName) {
  return execInContainer(container, `docker stop ${appContainerName(appName, componentName)}`);
}

// SIGKILL -> the container exits non-zero (137) and stays present. Use to
// exercise crash recovery / restart-on-failure.
export async function crashAppContainer(container, appName, componentName) {
  return execInContainer(container, `docker kill ${appContainerName(appName, componentName)}`);
}

// --- appdata data-safety helpers -----------------------------------------
// The syncthing folder FluxOS configures for a g:/r: app is the WHOLE app
// folder (/mnt/appdata/flux-apps/flux<comp>_<app>) — all subdirs synced
// together (syncthingMonitor.js). These let a suite plant real bytes and later
// assert they survived (or were destroyed): the data-safety contracts under
// test (e.g. db/revert against an empty global must NOT delete the only copy).

// Resolve the app's on-disk folder inside a node, robust to the exact id form.
async function appFolderPath(container, appName) {
  const { stdout } = await execInContainer(container,
    `sh -c "ls -d /mnt/appdata/flux-apps/flux${appName}* 2>/dev/null | head -1"`);
  return stdout.trim();
}

// Plant files under <appFolder>/appdata. files: [{ name, sizeMB?, content? }].
// Returns the appdata dir. Throws if the app folder isn't present yet.
export async function plantAppdata(container, appName, files) {
  const base = await appFolderPath(container, appName);
  if (!base) throw new Error(`plantAppdata: no app folder for ${appName} under /mnt/appdata/flux-apps`);
  const dir = `${base}/appdata`;
  await execInContainer(container, `sh -c "mkdir -p '${dir}'"`);
  for (const f of files) {
    if (f.sizeMB) {
      await execInContainer(container, `sh -c "dd if=/dev/urandom of='${dir}/${f.name}' bs=1M count=${f.sizeMB} 2>/dev/null"`);
    } else {
      await execInContainer(container, `sh -c "printf %s '${(f.content ?? 'x').replace(/'/g, '')}' > '${dir}/${f.name}'"`);
    }
  }
  return dir;
}

// Count regular files under <appFolder>/appdata (0 if the folder is gone).
export async function countAppdataFiles(container, appName) {
  const base = await appFolderPath(container, appName);
  if (!base) return 0;
  const { stdout } = await execInContainer(container,
    `sh -c "find '${base}/appdata' -type f 2>/dev/null | wc -l"`);
  return Number(stdout.trim()) || 0;
}

// Whether a specific planted file still exists under <appFolder>/appdata.
export async function appdataFileExists(container, appName, name) {
  const base = await appFolderPath(container, appName);
  if (!base) return false;
  const { stdout } = await execInContainer(container,
    `sh -c "[ -f '${base}/appdata/${name}' ] && echo yes || echo no"`);
  return stdout.trim() === 'yes';
}

// the actual exit code the reconciler reads from Docker (null if container absent)
export async function getAppContainerExitCode(container, appName, componentName) {
  const { stdout } = await execInContainer(container,
    `docker inspect --format '{{.State.ExitCode}}' ${appContainerName(appName, componentName)} 2>/dev/null || echo ""`,
  );
  const v = stdout.trim();
  return v === '' ? null : Number(v);
}

/**
 * Bounce the inner dockerd under a running FluxOS (the dockerd-restart orphan
 * case). Kills dockerd; the in-image watchdog respawns it. Without --live-restore
 * this stops dockerd's containers, leaving them 'exited' for the reconnect sweep
 * to recover. Confirms dockerd actually went DOWN and came back UP, so the caller
 * can't observe a false "already ready".
 */
export async function restartDockerd(container, { readyTimeoutMs = 40000, interval = 500 } = {}) {
  await execInContainer(container, 'kill $(pidof dockerd) 2>/dev/null || true');
  const start = Date.now();
  let sawDown = false;
  while (Date.now() - start < readyTimeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const r = await execInContainer(container, 'docker info > /dev/null 2>&1');
    const up = r.exitCode === 0;
    if (!up) sawDown = true;
    if (sawDown && up) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((res) => setTimeout(res, interval));
  }
  throw new Error(`restartDockerd: dockerd did not cycle down and back up within ${readyTimeoutMs}ms`);
}

/**
 * Restart the FluxOS process only - the `systemctl restart fluxos` case. Kills just
 * the node app.js child (its PID is in /tmp/fluxos.pid, written by the entrypoint
 * watchdog, so PID 1 is never touched); the watchdog respawns it. The inner dockerd
 * and the running app containers are NOT affected - they keep running while FluxOS's
 * in-memory state (e.g. controllerDesired) is wiped. This is distinct from
 * restartNode (whole container -> dockerd + containers restart) and restartDockerd
 * (dockerd only). Confirms FluxOS went DOWN and came back UP so the caller can't
 * observe a false "already ready".
 */
export async function restartFluxos(container, { apiPort = 16127, readyTimeoutMs = 120000, interval = 500 } = {}) {
  // hard-kill only the node child (state wiped instantly); never PID 1
  await execInContainer(container, 'kill -9 "$(cat /tmp/fluxos.pid 2>/dev/null)" 2>/dev/null || true');
  const probe = `curl -sf -o /dev/null http://127.0.0.1:${apiPort}/flux/version`;
  const start = Date.now();
  let sawDown = false;
  while (Date.now() - start < readyTimeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const r = await execInContainer(container, probe);
    const up = r.exitCode === 0;
    if (!up) sawDown = true;
    if (sawDown && up) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((res) => setTimeout(res, interval));
  }
  throw new Error(`restartFluxos: FluxOS did not cycle down and back up within ${readyTimeoutMs}ms`);
}

export async function getContainerImageDigest(container, appName, componentName) {
  const containerName = `flux${componentName}_${appName}`;
  const { stdout } = await execInContainer(container,
    `docker image inspect $(docker inspect --format '{{.Image}}' ${containerName}) --format '{{index .RepoDigests 0}}'`,
  );
  const match = stdout.trim().match(/@(sha256:[a-f0-9]+)$/);
  return match ? match[1] : null;
}
