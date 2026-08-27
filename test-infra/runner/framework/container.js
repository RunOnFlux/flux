import { throwIfInfraDead, sleepUnlessInfraDead } from './infra-death.js';

export async function execInContainer(container, command) {
  const args = Array.isArray(command) ? command : ['sh', '-c', command];
  const result = await container.exec(args);
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, output: result.output };
}

// Give a node a second address on the fleet network, so it answers there as well
// as where it started.
//
// The other half of an address change. Telling the network a node moved is not
// enough on its own: the availability check that gates the whole path has a PEER
// dial the address the node now claims, so a node that claims an address nothing
// answers on reads as unreachable rather than as moved. The nodes run privileged,
// so the address is simply added to the interface - no renumbering, no restart,
// and every existing connection survives because the original address stays.
//
// @param {object} container The node's container.
// @param {string} ip Bare address to add, inside the fleet's own /24.
export async function addNodeAddress(container, ip, { prefix = 24, iface = 'eth0' } = {}) {
  const r = await execInContainer(container, `ip addr add ${ip}/${prefix} dev ${iface}`);
  // Already present is the state we wanted, not a failure.
  if (r.exitCode !== 0 && !/File exists/i.test(r.output || '')) {
    throw new Error(`addNodeAddress: could not add ${ip}/${prefix} to ${iface}: ${r.output}`);
  }
  return ip;
}

// Make a node unreachable to the named peers, without taking it off the network.
//
// The node keeps its address, its list entry and its outbound connections; what
// stops is inbound traffic to its API port FROM those peers. That is what a node
// whose address has moved looks like from the outside - still listed where it was,
// no longer answering there - and it is the state that makes a peer's availability
// probe fail, which is what a node needs before it will ask benchmark whether its
// address changed.
//
// REJECT rather than DROP, and the difference decides whether this works at all.
// A peer asked whether it can reach this node probes it and answers within the
// asker's own timeout budget. Dropped packets blackhole, so that probe burns its
// full timeout and the peer answers too late - the asker times out on the PEER and
// reads "I could not ask" instead of "I am unreachable", which retries without ever
// consulting benchmark. Refusing fails the probe instantly, so the answer arrives
// in time and says what it is meant to say.
//
// Named peers rather than the subnet: the runner reaches the node from the docker
// gateway on that same /24, so a blanket rule would cut off the very client doing
// the asserting.
//
// @param {object} container The node's container.
// @param {string[]} peerIps Bare addresses whose traffic to drop.
// @param {number} apiPort The node's API port.
export async function blockPeerAccess(container, peerIps, apiPort) {
  for (const peerIp of peerIps) {
    // eslint-disable-next-line no-await-in-loop
    const r = await execInContainer(container, `iptables -I INPUT -p tcp --dport ${apiPort} -s ${peerIp} -j REJECT --reject-with tcp-reset`);
    if (r.exitCode !== 0) {
      throw new Error(`blockPeerAccess: could not drop ${peerIp} -> :${apiPort}: ${r.output}`);
    }
  }
  return peerIps;
}

// Undo blockPeerAccess. Tolerates a rule that is already gone so teardown after a
// failed test cannot fail in its own right.
export async function unblockPeerAccess(container, peerIps, apiPort) {
  for (const peerIp of peerIps) {
    // eslint-disable-next-line no-await-in-loop
    await execInContainer(container, `iptables -D INPUT -p tcp --dport ${apiPort} -s ${peerIp} -j REJECT --reject-with tcp-reset`);
  }
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
    // an infra death voids the run - don't spend the budget proving it
    throwIfInfraDead();
    // eslint-disable-next-line no-await-in-loop
    const r = await execInContainer(container, 'docker info > /dev/null 2>&1');
    const up = r.exitCode === 0;
    if (!up) sawDown = true;
    if (sawDown && up) return;
    // eslint-disable-next-line no-await-in-loop
    await sleepUnlessInfraDead(interval);
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
    // an infra death voids the run - don't spend the budget proving it
    throwIfInfraDead();
    // eslint-disable-next-line no-await-in-loop
    const r = await execInContainer(container, probe);
    const up = r.exitCode === 0;
    if (!up) sawDown = true;
    if (sawDown && up) return;
    // eslint-disable-next-line no-await-in-loop
    await sleepUnlessInfraDead(interval);
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
