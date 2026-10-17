// A stalled host, on a real kernel: the filesystem a node's docker keeps its data on,
// frozen. Every write docker makes there is then held in the kernel - its threads sit
// in uninterruptible sleep and never run - until the filesystem is thawed, which is
// what a host that stops returning the disk does to docker.
//
// The node is booted with createTestEnv({ freezableDockerRoot: [index] }), which
// mounts its docker data root on a filesystem of its own. The env's teardown thaws
// it, so a node a failing test left frozen can still be stopped.
import { execInContainer } from './container.js';

export const DOCKER_ROOT = '/mnt/appdata/docker';

async function run(container, command, what) {
  const result = await execInContainer(container, command);
  if (result.exitCode !== 0) throw new Error(`${what}: ${(result.output || result.stderr || '').trim()}`);
  return result.stdout;
}

/** Hold every write the node's docker makes to its data root, until thawDocker. */
export async function freezeDocker(container) {
  await run(container, `mountpoint -q ${DOCKER_ROOT}`, `${DOCKER_ROOT} is not a mount of its own: boot the node with freezableDockerRoot`);
  await run(container, `fsfreeze -f ${DOCKER_ROOT}`, 'freezeDocker');
}

/** Let the node's docker write again. */
export async function thawDocker(container) {
  await run(container, `fsfreeze -u ${DOCKER_ROOT}`, 'thawDocker');
}

/**
 * Thaw every node's docker that is frozen, and pass over the rest: the last step
 * before anything reads a node through its docker or stops it, since a node whose
 * docker is held in the kernel can be neither read nor stopped. Never rejects.
 * @param {Array<{container?: object}>} clients
 */
export async function thawEveryNode(clients) {
  await Promise.all(clients.map(async (client) => {
    if (!client?.container) return;
    await execInContainer(client.container, `fsfreeze -u ${DOCKER_ROOT} 2>/dev/null; true`).catch(() => {});
  }));
}

/**
 * One reading of every thread of the processes named `comm` in the node: its
 * state, its voluntary plus nonvoluntary context switches, and where it waits.
 * @returns {Promise<Map<string, {state: string, switches: number, wchan: string}>>} By thread id.
 */
async function readThreads(container, comm) {
  const script = `for p in $(pidof ${comm}); do for t in /proc/$p/task/*; do `
    + 'echo "${t##*/} $(cut -d" " -f3 $t/stat) $(awk \'/ctxt_switches/{s+=$2} END{print s}\' $t/status) $(cat $t/wchan)"; '
    + 'done; done; true';
  const out = await run(container, script, `reading ${comm}'s threads`);
  return new Map(out.split('\n').filter(Boolean).map((line) => {
    const [tid, state, switches, wchan] = line.split(' ');
    return [tid, { state, switches: Number(switches), wchan }];
  }));
}

/**
 * The threads of `comm` that did not run at all across `overMs`: in D at both
 * readings, with the same switch count. What FluxOS's detector reads as stuck,
 * read independently of it.
 * @returns {Promise<Array<{tid: string, wchan: string}>>}
 */
export async function stuckThreads(container, comm, { overMs = 3000 } = {}) {
  const first = await readThreads(container, comm);
  await new Promise((resolve) => { setTimeout(resolve, overMs); });
  const second = await readThreads(container, comm);
  return [...second].filter(([tid, now]) => {
    const before = first.get(tid);
    return before && before.state === 'D' && now.state === 'D' && before.switches === now.switches;
  }).map(([tid, now]) => ({ tid, wchan: now.wchan }));
}
