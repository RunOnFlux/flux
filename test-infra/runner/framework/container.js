import { throwIfInfraDead, sleepUnlessInfraDead } from './infra-death.js';

export async function execInContainer(container, command) {
  const args = Array.isArray(command) ? command : ['sh', '-c', command];
  const result = await container.exec(args);
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, output: result.output };
}

// Move a node to a different address on the fleet network: the new one goes on,
// the old one comes off.
//
// This is what an address change IS, and doing it for real is what makes the rest
// of the fixture honest. Its peers then find it unreachable at the old address
// because it genuinely is not there - no packet filter simulating it, and nothing
// hidden from the node list, so they still recognise it as the sender of the
// fluxipchanged broadcast that follows.
//
// The timing matters and is measured. A probe to an address that is gone fails
// with EHOSTUNREACH at ~3.1s (ARP gives up), NOT a hang - so a peer's own probe
// budget of 5s sees a failure rather than a timeout, and it answers the asking
// node inside that node's 7s budget. Those margins are why this works where
// dropping packets did not: a dropped probe burns the full 5s, and the answer
// then arrives after the asker has already given up, which reads as "I could not
// ask" rather than "you are unreachable" - a different branch entirely, and one
// that never consults benchmark.
//
// @param {object} container The node's container.
// @param {string} to Bare address to move to, inside the fleet's own /24.
// @param {string} from Bare address to give up.
export async function moveNodeAddress(container, to, from, { prefix = 24, iface = 'eth0' } = {}) {
  const add = await execInContainer(container, `ip addr add ${to}/${prefix} dev ${iface}`);
  if (add.exitCode !== 0 && !/File exists/i.test(add.output || '')) {
    throw new Error(`moveNodeAddress: could not add ${to}/${prefix} to ${iface}: ${add.output}`);
  }
  const del = await execInContainer(container, `ip addr del ${from}/${prefix} dev ${iface}`);
  if (del.exitCode !== 0 && !/Cannot assign|not exist/i.test(del.output || '')) {
    throw new Error(`moveNodeAddress: could not remove ${from}/${prefix} from ${iface}: ${del.output}`);
  }
  return to;
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

// A router that forwards by port alone, as seen from the node behind it: every
// call this node makes to `ports` on one of `toIps` arrives at `landsOn` instead,
// port for port. A DNAT in the node's own nat OUTPUT chain, so it moves only
// connections this node originates - traffic arriving at the node, and every
// other node's traffic, are untouched, which is exactly the half of the fault
// that makes it invisible from outside. TCP and UDP both, because syncthing
// dials QUIC on the same port as TCP.
//
// Moves new connections only. One already open to a target keeps going to it
// until it closes, as it would through a real router whose forwarding changed -
// unless `resetOpen`, which resets every TCP connection still addressed to a
// target, so the node's next call opens one through the redirect. A redirected
// connection is addressed to `landsOn` and is not reset.
//
// Returns the rules it added, for clearOutboundRedirect.
//
// @param {object} container The node's container.
// @param {{toIps: string[], ports: string, landsOn: string, resetOpen?: boolean}} redirect
//   `ports` as iptables takes it, e.g. '16127:16129'.
export async function redirectOutbound(container, {
  toIps, ports, landsOn, resetOpen = false,
}) {
  const rules = [];
  for (const toIp of toIps) {
    for (const proto of ['tcp', 'udp']) {
      const rule = `-t nat OUTPUT -p ${proto} -d ${toIp} --dport ${ports} -j DNAT --to-destination ${landsOn}`;
      // eslint-disable-next-line no-await-in-loop
      const r = await execInContainer(container, `iptables ${rule.replace(' OUTPUT', ' -A OUTPUT')}`);
      if (r.exitCode !== 0) {
        throw new Error(`redirectOutbound: could not send ${toIp}:${ports}/${proto} to ${landsOn}: ${r.output}`);
      }
      rules.push(rule);
    }
    if (resetOpen) {
      const rule = `-t filter OUTPUT -p tcp -d ${toIp} --dport ${ports} -j REJECT --reject-with tcp-reset`;
      // eslint-disable-next-line no-await-in-loop
      const r = await execInContainer(container, `iptables ${rule.replace(' OUTPUT', ' -A OUTPUT')}`);
      if (r.exitCode !== 0) throw new Error(`redirectOutbound: could not reset open connections to ${toIp}:${ports}: ${r.output}`);
      rules.push(rule);
    }
  }
  return rules;
}

// Undo redirectOutbound. Tolerates a rule that is already gone so teardown after
// a failed test cannot fail in its own right.
export async function clearOutboundRedirect(container, rules) {
  for (const rule of rules) {
    // eslint-disable-next-line no-await-in-loop
    await execInContainer(container, `iptables ${rule.replace(' OUTPUT', ' -D OUTPUT')}`);
  }
}

// THE READ CAN FAIL, AND SAYS SO. `2>/dev/null || echo ""` gave a broken docker
// exec the same answer as a node with no containers on it - an empty list - so
// every caller read "the app is not running" and every wait built on one spent
// its whole budget and ended reporting only that the condition never held. A
// failed read is not an observation, and the callers that poll are built to
// retry a throw; the ones that assert have no business ruling on a look they
// never took.
export async function listAppContainers(container, { all = false } = {}) {
  const flag = all ? ' -a' : '';
  const { stdout, stderr, exitCode } = await execInContainer(container,
    `docker ps${flag} --format "{{.Names}}\t{{.Status}}\t{{.Image}}"`,
  );
  if (exitCode !== 0) {
    throw new Error(`docker ps in the node container failed (exit ${exitCode}): ${(stderr || stdout || '').trim()}`);
  }
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

// The container's docker id, which is what distinguishes a container that was
// REPLACED from one that was merely restarted: a redeploy removes and recreates,
// so the id changes, while a restart keeps it. Status and image name are equal
// either way, so neither can tell the two apart. null if the container is absent.
export async function getAppContainerId(container, appName, componentName) {
  const { stdout } = await execInContainer(container,
    `docker inspect --format '{{.Id}}' ${appContainerName(appName, componentName)} 2>/dev/null || echo ""`,
  );
  const id = stdout.trim();
  return id === '' ? null : id;
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

// A graceful system shutdown of one node's FluxOS, as systemd performs it: the
// shutdown marker FluxOS checks for is put in place, the process is sent
// SIGTERM, and this returns once it has exited. The marker is removed again
// after the exit, so the next FluxOS on this node boots as usual.
//
// `hold` keeps the node down after the exit, as a machine stays down between a
// shutdown and its next boot; releaseFluxos brings it back. `stopSyncthingAfter`
// stops the node's own syncthing the moment FluxOS exits, which is what the OS
// does next on an Arcane node - for a node booted with syncthing: 'binary'.
//
// @returns {Promise<{pid: number, exitedAt: number}>} the process that shut down,
//   and when this saw it gone (ms)
export async function shutdownFluxosGracefully(container, {
  hold = false, stopSyncthingAfter = false, exitTimeoutMs = 120000, interval = 250,
} = {}) {
  const pid = Number((await execInContainer(container, 'cat /tmp/fluxos.pid')).stdout.trim());
  if (!pid) throw new Error('shutdownFluxosGracefully: no FluxOS pid in /tmp/fluxos.pid');
  await execInContainer(container, `touch /run/nologin${hold ? ' /tmp/fluxos.hold' : ''}`);
  if (stopSyncthingAfter) {
    // Inside the node, so the daemon stops within a poll of the exit rather than
    // a docker exec round trip later.
    const watcher = await execInContainer(container,
      `setsid sh -c 'while kill -0 ${pid} 2>/dev/null; do sleep 0.05; done; pkill -x syncthing' >/dev/null 2>&1 </dev/null &`);
    if (watcher.exitCode !== 0) throw new Error(`shutdownFluxosGracefully: could not arm the syncthing stop: ${watcher.output}`);
  }
  const signalled = await execInContainer(container, `kill -TERM ${pid}`);
  if (signalled.exitCode !== 0) throw new Error(`shutdownFluxosGracefully: could not signal ${pid}: ${signalled.output}`);
  const start = Date.now();
  try {
    while (Date.now() - start < exitTimeoutMs) {
      throwIfInfraDead();
      // eslint-disable-next-line no-await-in-loop
      const alive = await execInContainer(container, `kill -0 ${pid} 2>/dev/null`);
      if (alive.exitCode !== 0) return { pid, exitedAt: Date.now() };
      // eslint-disable-next-line no-await-in-loop
      await sleepUnlessInfraDead(interval);
    }
    throw new Error(`shutdownFluxosGracefully: FluxOS ${pid} still running ${exitTimeoutMs}ms after SIGTERM`);
  } finally {
    await execInContainer(container, 'rm -f /run/nologin');
  }
}

// Bring back a node held down by shutdownFluxosGracefully({ hold: true }), and
// wait for its API to answer.
export async function releaseFluxos(container, { apiPort = 16127, readyTimeoutMs = 120000, interval = 500 } = {}) {
  await execInContainer(container, 'rm -f /tmp/fluxos.hold');
  const probe = `curl -sf -o /dev/null http://127.0.0.1:${apiPort}/flux/version`;
  const start = Date.now();
  while (Date.now() - start < readyTimeoutMs) {
    throwIfInfraDead();
    // eslint-disable-next-line no-await-in-loop
    if ((await execInContainer(container, probe)).exitCode === 0) return;
    // eslint-disable-next-line no-await-in-loop
    await sleepUnlessInfraDead(interval);
  }
  throw new Error(`releaseFluxos: FluxOS did not answer within ${readyTimeoutMs}ms`);
}

// Drop every packet between this node and each peer on one port, TCP and UDP,
// in both directions and whichever side dialled - a link that is up but carries
// nothing for that service. The syncthing port is apiport+2, and syncthing
// listens on it for both TCP and QUIC.
function trafficRules(peerIp, port) {
  return ['tcp', 'udp'].flatMap((proto) => [
    `INPUT -p ${proto} -s ${peerIp} --dport ${port} -j DROP`,
    `INPUT -p ${proto} -s ${peerIp} --sport ${port} -j DROP`,
    `OUTPUT -p ${proto} -d ${peerIp} --dport ${port} -j DROP`,
    `OUTPUT -p ${proto} -d ${peerIp} --sport ${port} -j DROP`,
  ]);
}

export async function blockTraffic(container, peerIps, port) {
  for (const peerIp of peerIps) {
    for (const rule of trafficRules(peerIp, port)) {
      // eslint-disable-next-line no-await-in-loop
      const r = await execInContainer(container, `iptables -I ${rule}`);
      if (r.exitCode !== 0) throw new Error(`blockTraffic: could not add '${rule}': ${r.output}`);
    }
  }
  return peerIps;
}

// Undo blockTraffic. Tolerates a rule that is already gone.
export async function unblockTraffic(container, peerIps, port) {
  for (const peerIp of peerIps) {
    for (const rule of trafficRules(peerIp, port)) {
      // eslint-disable-next-line no-await-in-loop
      await execInContainer(container, `iptables -D ${rule}`);
    }
  }
}

// A crash of one node's FluxOS: the process is killed outright, with no
// shutdown handling at all. `hold` keeps the node down afterwards, as a machine
// that lost power stays down; releaseFluxos brings it back.
export async function crashFluxos(container, { hold = false, exitTimeoutMs = 30000, interval = 250 } = {}) {
  const pid = Number((await execInContainer(container, 'cat /tmp/fluxos.pid')).stdout.trim());
  if (!pid) throw new Error('crashFluxos: no FluxOS pid in /tmp/fluxos.pid');
  if (hold) await execInContainer(container, 'touch /tmp/fluxos.hold');
  await execInContainer(container, `kill -9 ${pid}`);
  const start = Date.now();
  while (Date.now() - start < exitTimeoutMs) {
    throwIfInfraDead();
    // eslint-disable-next-line no-await-in-loop
    if ((await execInContainer(container, `kill -0 ${pid} 2>/dev/null`)).exitCode !== 0) return { pid };
    // eslint-disable-next-line no-await-in-loop
    await sleepUnlessInfraDead(interval);
  }
  throw new Error(`crashFluxos: FluxOS ${pid} still running ${exitTimeoutMs}ms after SIGKILL`);
}

// The kill timeout of FluxOS's pm2 registration on a legacy node whose FluxOS
// pm2 runs (createTestEnv pm2Nodes), as the daemon holds it and as `pm2 save`
// stored it for the next boot. null where pm2 has none, which is its default.
//
// @returns {Promise<{live: number|null, saved: number|null, restarts: number}>}
export async function pm2Registration(container) {
  const jlist = await execInContainer(container, 'pm2 jlist');
  if (jlist.exitCode !== 0) throw new Error(`pm2Registration: pm2 jlist failed: ${jlist.output}`);
  const live = JSON.parse(jlist.stdout.trim()).find((p) => p.name === 'flux');
  if (!live) throw new Error('pm2Registration: pm2 lists no process named flux');
  const dump = await execInContainer(container, 'cat "$HOME/.pm2/dump.pm2" 2>/dev/null || echo "[]"');
  const saved = JSON.parse(dump.stdout.trim()).find((p) => p.name === 'flux');
  return {
    live: live.pm2_env.kill_timeout ?? null,
    saved: saved?.kill_timeout ?? null,
    restarts: live.pm2_env.restart_time,
  };
}

// A system shutdown of a legacy node whose FluxOS pm2 runs (createTestEnv
// pm2Nodes): the shutdown marker FluxOS checks for is put in place and pm2
// stops FluxOS, as the OS stops pm2 on its way down. pm2 returns once FluxOS
// has exited or its kill timeout has run out, whichever is first.
// `stopSyncthingAfter` then stops the node's syncthing, as the rest of the
// shutdown does: FluxOS started it outside pm2's process tree, so pm2 leaves it.
//
// @returns {Promise<{stopMs: number}>} how long pm2 took to report FluxOS stopped
export async function shutdownFluxosUnderPm2(container, { stopSyncthingAfter = false } = {}) {
  await execInContainer(container, 'touch /run/nologin');
  try {
    const started = Date.now();
    const stopped = await execInContainer(container, 'pm2 stop flux');
    const stopMs = Date.now() - started;
    if (stopped.exitCode !== 0) throw new Error(`shutdownFluxosUnderPm2: pm2 stop failed: ${stopped.output}`);
    if (stopSyncthingAfter) await execInContainer(container, 'pkill -KILL -x syncthing; true');
    return { stopMs };
  } finally {
    await execInContainer(container, 'rm -f /run/nologin');
  }
}

// Start FluxOS again through pm2 on a node shut down by shutdownFluxosUnderPm2,
// and wait for its API to answer.
export async function startFluxosUnderPm2(container, { apiPort = 16127, readyTimeoutMs = 180000, interval = 1000 } = {}) {
  const started = await execInContainer(container, 'pm2 start flux');
  if (started.exitCode !== 0) throw new Error(`startFluxosUnderPm2: pm2 start failed: ${started.output}`);
  const probe = `curl -sf -o /dev/null http://127.0.0.1:${apiPort}/flux/version`;
  const start = Date.now();
  while (Date.now() - start < readyTimeoutMs) {
    throwIfInfraDead();
    // eslint-disable-next-line no-await-in-loop
    if ((await execInContainer(container, probe)).exitCode === 0) return;
    // eslint-disable-next-line no-await-in-loop
    await sleepUnlessInfraDead(interval);
  }
  throw new Error(`startFluxosUnderPm2: FluxOS did not answer within ${readyTimeoutMs}ms`);
}
