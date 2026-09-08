// Fixtures on an app's volume, for the file-operation suites.
//
// Everything here writes through the NODE container (execInContainer), because
// the volume is a loop-mounted file inside it and the runner cannot see it from
// the host.
//
// Every seeding function asserts what it produced. Two of this feature's
// security tests have already passed for the wrong reason - one built its
// archive inside a read-only container so the archive never existed, another
// used tar -h so the "symlink" in it was a regular file - and both read as
// clean passes. A fixture that silently did not happen turns an assertion into
// decoration, so the check belongs next to the write, not in the test.

import { execInContainer } from './container.js';

// A plausible application uid: an app runs as something like www-data, not as
// root, and its files belong to that user. Copies MUST keep belonging to it -
// cp -a cannot restore ownership without CAP_CHOWN and does NOT fail when it
// can't, it exits 0 having written root-owned files, and the app then silently
// loses access to its own data. Seeding as root would make that regression
// untestable: root-owned files are trivially "preserved" as root whether the
// capability is granted or not.
export const APP_UID = 33;
export const APP_GID = 33;

export const appId = (name) => `flux${name}_${name}`;
export const volumeRoot = (name) => `/mnt/appdata/flux-apps/${appId(name)}`;

// Single-quote for the shell. Fixture content is chosen by the suites, but a
// literal $ or backtick in one must stay a literal rather than becoming
// whatever the node's shell makes of it - that is the class of thing that makes
// a fixture quietly different from what the test says it is.
const sq = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

// execInContainer already runs a string through `sh -c`.
async function run(container, command, what) {
  const r = await execInContainer(container, command);
  if (r.exitCode !== 0) {
    throw new Error(`${what} failed (exit ${r.exitCode}): ${r.output}`);
  }
  return r.stdout;
}

/**
 * uid:gid of a path, as seen on the node. Follows nothing.
 */
export async function ownerOf(container, path) {
  return (await run(container, `stat -c '%u:%g' ${sq(path)}`, `stat ${path}`)).trim();
}

/**
 * Every path under `root`, relative to it, sorted. The shape a round-trip
 * assertion compares.
 */
export async function treeOf(container, root) {
  const out = await run(container, `cd ${sq(root)} && find . | sort`, `list ${root}`);
  return out.trim().split('\n').filter((line) => line && line !== '.');
}

/**
 * Contents of a file, for asserting a copy really carried the bytes.
 */
export async function contentOf(container, path) {
  return run(container, `cat ${sq(path)}`, `read ${path}`);
}

export async function exists(container, path) {
  const r = await execInContainer(container, `test -e ${sq(path)}`);
  return r.exitCode === 0;
}

/**
 * Whether a path is a symlink, which `exists` cannot tell you about a dangling
 * one - and a dangling link is exactly what a containment test plants.
 */
export async function isSymlink(container, path) {
  const r = await execInContainer(container, `test -L ${sq(path)}`);
  return r.exitCode === 0;
}

/**
 * Seed a tree on an app's volume, owned by an ordinary application user.
 *
 * @param {object} container node container
 * @param {string} name app name
 * @param {Object<string, string>} files relative path -> contents
 * @returns {Promise<string>} the volume root the files were written under
 */
export async function seedVolumeTree(container, name, files) {
  const root = volumeRoot(name);
  const paths = Object.keys(files);

  for (const relative of paths) {
    const target = sq(`${root}/${relative}`);
    // eslint-disable-next-line no-await-in-loop
    await run(container, `mkdir -p "$(dirname ${target})" && printf '%s' ${sq(files[relative])} > ${target}`, `seed ${relative}`);
  }

  // The top-level entries the caller named, chowned recursively. Doing this
  // after the writes rather than per-file keeps the directories created along
  // the way from being missed.
  const tops = [...new Set(paths.map((p) => p.split('/')[0]))];
  await run(container, `chown -R ${APP_UID}:${APP_GID} ${tops.map((t) => sq(`${root}/${t}`)).join(' ')}`, 'chown the seeded tree');

  // Assert the fixture IS what the tests are about to rely on. If the harness
  // ever runs as something that cannot chown, every ownership assertion below
  // would otherwise pass by comparing root to root.
  for (const relative of paths) {
    // eslint-disable-next-line no-await-in-loop
    const owner = await ownerOf(container, `${root}/${relative}`);
    if (owner !== `${APP_UID}:${APP_GID}`) {
      throw new Error(`seedVolumeTree: ${relative} is owned by ${owner}, not ${APP_UID}:${APP_GID} - the ownership assertions would be meaningless`);
    }
  }

  return root;
}

/**
 * Clear everything a test put on the volume, keeping the app's own data
 * directory so the running container is undisturbed.
 *
 * Names nothing: listing what to delete means a test that leaves something
 * unexpected - a staging directory, a marker, an archive named after a case
 * that was renamed - silently carries it into the next one.
 */
export async function resetVolume(container, name, { keep = ['appdata'] } = {}) {
  const root = volumeRoot(name);
  const exclusions = keep.map((k) => `! -name ${sq(k)}`).join(' ');
  await run(container, `find ${sq(root)} -mindepth 1 -maxdepth 1 ${exclusions} -exec rm -rf {} +`, `reset ${root}`);
}

/**
 * Seed one large file, owned by the application user.
 *
 * For the byte-progress assertions: the figure is read by a ticker while the
 * operation runs, and there is deliberately no final measurement - a walk still
 * in flight when the operation ends is discarded rather than landed on a job
 * already marked Succeeded. So an operation that finishes inside a single tick
 * reports no figure at all, and only a source big enough to span several ticks
 * can show one advancing.
 *
 * @param {number} megabytes
 */
export async function seedLargeFile(container, name, relative, megabytes) {
  const root = volumeRoot(name);
  const path = `${root}/${relative}`;
  await run(
    container,
    `mkdir -p "$(dirname ${sq(path)})" && dd if=/dev/urandom of=${sq(path)} bs=1M count=${megabytes} 2>/dev/null && chown ${APP_UID}:${APP_GID} ${sq(path)}`,
    `seed ${megabytes}MB at ${relative}`,
  );

  const size = parseInt(await run(container, `stat -c '%s' ${sq(path)}`, `size ${relative}`), 10);
  const expected = megabytes * 1024 * 1024;
  if (size !== expected) {
    throw new Error(`seedLargeFile: ${relative} is ${size} bytes, not ${expected}`);
  }
  return size;
}

/**
 * Plant a symlink on the volume and assert it really is one.
 *
 * `tar -czhf` and `zip` without -y both dereference, so a fixture built with
 * either contains a regular file and a containment test built on it proves
 * nothing.
 */
export async function seedSymlink(container, name, relative, target) {
  const root = volumeRoot(name);
  const path = `${root}/${relative}`;
  await run(container, `mkdir -p "$(dirname ${sq(path)})" && ln -sfn ${sq(target)} ${sq(path)}`, `link ${relative}`);

  if (!await isSymlink(container, path)) {
    throw new Error(`seedSymlink: ${relative} is not a symlink`);
  }
  const readBack = (await run(container, `readlink ${sq(path)}`, `readlink ${relative}`)).trim();
  if (readBack !== target) {
    throw new Error(`seedSymlink: ${relative} points at ${readBack}, not ${target}`);
  }
  return path;
}
