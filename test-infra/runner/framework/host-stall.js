// A stalled host, on a real kernel: the filesystem a node's docker keeps its data on,
// held. Frozen (freezeDocker), every write docker makes there is held in the kernel -
// its threads sit in uninterruptible sleep and never run - until the filesystem is
// thawed, which is what a host that stops returning the disk does to docker. Stalled
// (stallDisk), every read is held as well, which is what a disk that stops answering
// does to everything on it.
//
// The node is booted with createTestEnv({ freezableDockerRoot: [index] }), which
// mounts its docker data root on a filesystem of its own, through a device-mapper
// device of its own. The env's teardown thaws and resumes it, so a node
// a failing test left held can still be stopped.
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

/** Let the node's docker write again. A data root that is not frozen is left as it is. */
export async function thawDocker(container) {
  // fsfreeze refuses to thaw a filesystem that is not frozen, with EINVAL
  await run(container, `out=$(fsfreeze -u ${DOCKER_ROOT} 2>&1) || echo "$out" | grep -q 'Invalid argument' || { echo "$out"; exit 1; }`, 'thawDocker');
}

// The device-mapper device a stallable mount sits on, in the node's shell.
const deviceOf = (mountpoint) => `$(findmnt -no SOURCE ${mountpoint} | sed -n 's|^/dev/mapper/||p')`;

/**
 * Hold every read and write to the filesystem at `mountpoint`, until resumeDisk:
 * the filesystem is frozen, so a write is held before it reaches the cache, and
 * its device suspended. What of it the kernel has cached is dropped in between,
 * for that filesystem only, so a read of a file or a directory listing on it
 * reaches the device and is held.
 * @param {object} container The node.
 * @param {string} mountpoint DOCKER_ROOT, mounted stallable.
 */
export async function stallDisk(container, mountpoint) {
  await run(container, `d=${deviceOf(mountpoint)}; [ -n "$d" ]`, `${mountpoint} is not on a device of its own: boot the node with freezableDockerRoot`);
  await run(container, `fsfreeze -f ${mountpoint} && find ${mountpoint} -xdev -type f -print0 | xargs -0 -r -n 64 -P 8 sh -c 'for f; do dd if="$f" iflag=nocache count=0 status=none; done' sh`
    + ` && blockdev --flushbufs $(findmnt -no SOURCE ${mountpoint}) && dmsetup suspend --nolockfs --noflush ${deviceOf(mountpoint)}`, `stallDisk ${mountpoint}`);
}

/** Let reads and writes reach the filesystem at `mountpoint` again. One not stalled is left as it is. */
export async function resumeDisk(container, mountpoint) {
  // the thaw writes to the device, so the device is resumed first
  await run(container, `dmsetup resume ${deviceOf(mountpoint)} && { out=$(fsfreeze -u ${mountpoint} 2>&1) || echo "$out" | grep -q 'Invalid argument' || { echo "$out"; exit 1; }; }`, `resumeDisk ${mountpoint}`);
}

/**
 * Whether a listing of `dir` and a read of every file named `file` below it are
 * still held after `overMs`: run in the background and left to finish once the
 * disk is resumed, since a read held by the kernel cannot be killed.
 * @returns {Promise<boolean>}
 */
export async function readsHeld(container, dir, { file, overMs = 3000 } = {}) {
  const marker = `/tmp/reads-returned-${Date.now()}`;
  const read = `ls ${dir} >/dev/null${file ? ` && find ${dir} -name ${file} -exec cat {} + >/dev/null` : ''}`;
  const result = await execInContainer(container,
    `setsid sh -c '${read} && touch ${marker}' </dev/null >/dev/null 2>&1 & sleep ${overMs / 1000}; test ! -e ${marker}`);
  return result.exitCode === 0;
}

/**
 * Thaw and resume every node's docker data root that is held, and every cgroup frozen in it
 * (systemd-control.freezeUnit), and pass over the rest: the last step before
 * anything reads a node through its docker or stops it, since a node whose docker
 * is held can be neither read nor stopped. Never rejects.
 * @param {Array<{container?: object}>} clients
 */
export async function thawEveryNode(clients) {
  const thaw = `d=${deviceOf(DOCKER_ROOT)}; [ -n "$d" ] && dmsetup resume "$d" 2>/dev/null; `
    + `fsfreeze -u ${DOCKER_ROOT} 2>/dev/null; `
    + 'for f in $(find /sys/fs/cgroup -name cgroup.freeze 2>/dev/null); do [ "$(cat $f)" = 1 ] && echo 0 > $f; done; true';
  await Promise.all(clients.map(async (client) => {
    if (!client?.container) return;
    await execInContainer(client.container, thaw).catch(() => {});
  }));
}

/**
 * The cgroup directory a container's main process lives in, read while docker
 * still answers.
 * @param {object} container The node.
 * @param {string} name The container's name inside the node.
 * @returns {Promise<string>} Under /sys/fs/cgroup.
 */
export async function containerCgroup(container, name) {
  const pid = (await run(container, `docker inspect -f '{{.State.Pid}}' ${name}`, `finding ${name}'s process`)).trim();
  const line = (await run(container, `cat /proc/${pid}/cgroup`, `reading ${name}'s cgroup`)).trim();
  return line.replace(/^0::/, '/sys/fs/cgroup');
}

/**
 * The processes in a cgroup and every cgroup below it that could still run:
 * neither gone nor with SIGKILL pending. Read inside the node, independently of
 * FluxOS. Throws when the cgroup does not exist, which is never an answer of
 * "nothing can run".
 * @param {object} container
 * @param {string} cgroupDir Under /sys/fs/cgroup: systemd-control.unitCgroup, or containerCgroup.
 * @returns {Promise<string[]>} Their pids; empty when nothing in it can run again.
 */
export async function processesThatCanRun(container, cgroupDir) {
  await run(container, `test -d '${cgroupDir}'`, `${cgroupDir} does not exist`);
  const script = `for p in $(find '${cgroupDir}' -name cgroup.procs -exec cat {} +); do `
    + 's=/proc/$p/status; [ -r $s ] || continue; '
    + 'k=$(awk \'/^(SigPnd|ShdPnd):/{print $2}\' $s | while read m; do [ $(( 0x$m & 0x100 )) -ne 0 ] && echo y; done); '
    + '[ -z "$k" ] && echo $p; done; true';
  const out = await run(container, script, `reading the processes under ${cgroupDir}`);
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
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
