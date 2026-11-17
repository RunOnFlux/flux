// A component's data as a restore meets it, and the damage a restore that stops part
// way through leaves.
//
// The restore clears appdata with `find <appdata> -mindepth 1 -exec rm -rf {} +` and
// fails when anything in it cannot be removed. A directory made immutable keeps
// itself and what it holds while every other entry is deleted, so the failed clear
// leaves appdata part deleted and part kept: neither the old copy nor the archive.

import { expect } from 'chai';
import { execInContainer } from './container.js';
import { dbClient } from './db-client.js';

// A component's volume root, which is the root of its syncthing folder too.
export const componentDir = (appName, component = appName) => `/mnt/appdata/flux-apps/flux${component}_${appName}`;
export const appdataOf = (appName, component = appName) => `${componentDir(appName, component)}/appdata`;
export const localArchiveOf = (appName, component = appName) => `${componentDir(appName, component)}/backup/local/backup_${component.toLowerCase()}.tar.gz`;

// The entries a component's data holds before the restore: three files the clear
// deletes, and one inside the directory it cannot.
export const ORIGINAL = Object.freeze({ 'a.txt': 'original-a', 'b.txt': 'original-b', 'locked/kept.txt': 'original-kept' });
export const DELETED_BY_CLEAR = Object.freeze(['a.txt', 'b.txt']);

async function run(client, command, what) {
  const r = await execInContainer(client.container, command);
  expect(r.exitCode, `${what}: ${r.output}`).to.equal(0);
  return r.stdout;
}

const quoted = (text) => `'${String(text).replace(/'/g, "'\\''")}'`;

/**
 * Writes `files` (relative path -> content) into the component's appdata, and reads
 * each back.
 */
export async function writeAppdata(client, appName, component, files = ORIGINAL) {
  const root = appdataOf(appName, component);
  const writes = Object.entries(files).map(([path, content]) => `mkdir -p "$(dirname ${root}/${path})" && printf %s ${quoted(content)} > ${root}/${path}`);
  await run(client, writes.join(' && '), `writing ${component}'s appdata`);
  expect(await readAppdata(client, appName, component, Object.keys(files)), `${component}'s appdata as written`).to.deep.equal(files);
}

const ABSENT = '__absent__';

/**
 * @returns {Promise<object>} relative path -> content, null for a file that is absent
 */
export async function readAppdata(client, appName, component, paths) {
  const root = appdataOf(appName, component);
  const out = {};
  // eslint-disable-next-line no-restricted-syntax
  for (const path of paths) {
    // eslint-disable-next-line no-await-in-loop
    const r = await execInContainer(client.container, `test -f ${root}/${path} && cat ${root}/${path} || printf %s ${ABSENT}`);
    out[path] = r.stdout === ABSENT ? null : r.stdout;
  }
  return out;
}

/**
 * Makes appdata/locked immutable, so a clear removes everything else and fails.
 */
export async function lockPart(client, appName, component = appName) {
  const dir = `${appdataOf(appName, component)}/locked`;
  await run(client, `test -d ${dir} && chattr +i ${dir}`, `locking ${dir}`);
  const attrs = await run(client, `lsattr -d ${dir}`, `reading ${dir}'s attributes`);
  expect(attrs.split(/\s+/)[0], `${dir} is immutable`).to.contain('i');
}

export async function unlockPart(client, appName, component = appName) {
  await execInContainer(client.container, `chattr -i ${appdataOf(appName, component)}/locked 2>/dev/null; true`);
}

/**
 * Puts a local backup archive holding `files` where a local restore reads it.
 */
export async function stageLocalArchive(client, appName, component, files) {
  const stage = `/tmp/stage-${component}_${appName}`;
  const writes = Object.entries(files).map(([path, content]) => `mkdir -p "$(dirname ${stage}/${path})" && printf %s ${quoted(content)} > ${stage}/${path}`);
  const archive = localArchiveOf(appName, component);
  await run(client, `rm -rf ${stage} && mkdir -p ${stage} && ${writes.join(' && ')} `
    + `&& mkdir -p "$(dirname ${archive})" && tar -czf ${archive} -C ${stage} .`, `staging ${component}'s archive`);
  const listed = await run(client, `tar -tzf ${archive}`, `listing ${archive}`);
  Object.keys(files).forEach((path) => expect(listed, `${archive} holds ${path}`).to.contain(path));
}

export async function archiveDigest(client, appName, component = appName) {
  const r = await execInContainer(client.container, `md5sum ${localArchiveOf(appName, component)} 2>/dev/null | cut -d' ' -f1`);
  return r.stdout.trim() || null;
}

/**
 * Whether an unfinished restore holds the component on node `index` (0-based):
 * true, false, or null where the node keeps no runtime record of it.
 */
export function restoreRecord(index, identifier) {
  return dbClient(index + 1).restoreUnfinished(identifier);
}

/**
 * The node's /apps/componentstates answer for an app, as the holder of `zelidauth`.
 */
export function componentStates(client, appName, zelidauth) {
  return client.getAuthed(`/apps/componentstates/${appName}?_=${Date.now()}`, zelidauth);
}

/**
 * Restores `component` from its local archive.
 * @returns {Promise<string>} the restore's response
 */
export function restoreLocal(client, appName, components, zelidauth) {
  return client.appendRestoreTask(appName, components.map((component) => ({ component, restore: true })), 'local', zelidauth);
}

/**
 * The record writes a node published for a component since `afterId`, in order.
 */
export function recordWrites(client, identifier, afterId) {
  return client.getEventBuffer()
    .filter((e) => e.id > afterId && e.event === 'restore:record' && e.data?.identifier === identifier)
    .map((e) => e.data.unfinished);
}
