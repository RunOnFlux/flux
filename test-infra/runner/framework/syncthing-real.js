// Reads a node's OWN syncthing daemon, for suites booted with
// `createTestEnv({ syncthing: 'binary' })`.
//
// Deliberately observers, not setters. The stub's control surface
// (syncthing-control.js) scripts what a node believes about sync state, because
// with a stub there is no truth to read. With a real daemon there is, and
// scripting it would only hide what the test exists to establish - so these
// wait on what actually happened.
//
// Everything goes through the node's container, because the daemon binds
// 127.0.0.1 inside it and its API key is whatever it generated for itself.
import { execInContainer } from './container.js';

// The daemon's home as FluxOS resolves it: SYNCTHING_PATH where the node sets it
// (Arcane), otherwise ~/.config/syncthing of the account FluxOS runs as (legacy).
const CONFIG_XML = '"${SYNCTHING_PATH:-$(getent passwd "${FLUX_FLUXOS_USER:-root}" | cut -d: -f6)/.config/syncthing}/config.xml"';

async function apiKey(client) {
  const r = await execInContainer(client.container,
    `sed -n 's|.*<apikey>\\(.*\\)</apikey>.*|\\1|p' ${CONFIG_XML} | head -1`);
  const key = r.stdout.trim();
  if (!key) throw new Error('syncthing-real: no api key in the node\'s config.xml - is this env booted with syncthing: "binary"?');
  return key;
}

async function api(client, path) {
  const key = await apiKey(client);
  const r = await execInContainer(client.container,
    `curl -sS -H "X-API-Key: ${key}" "http://127.0.0.1:8384${path}"`);
  if (r.exitCode !== 0) throw new Error(`syncthing-real: GET ${path} failed: ${r.stderr || r.output}`);
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(`syncthing-real: GET ${path} returned unparseable body: ${r.stdout.slice(0, 200)}`);
  }
}

export async function isDaemonUp(client) {
  try {
    const pong = await api(client, '/rest/system/ping');
    return pong?.ping === 'pong';
  } catch {
    return false;
  }
}

export async function getVersion(client) {
  return (await api(client, '/rest/system/version')).version;
}

export async function getDeviceId(client) {
  return (await api(client, '/rest/system/status')).myID;
}

export async function getFolders(client) {
  return api(client, '/rest/config/folders');
}

export async function getFolderStatus(client, folderId) {
  return api(client, `/rest/db/status?folder=${encodeURIComponent(folderId)}`);
}

// A folder is complete when the index describes something and the disk holds all
// of it. globalBytes === 0 means the index is empty, which is not the same as
// synced and must never read as done.
export async function isFolderSynced(client, folderId) {
  try {
    const s = await getFolderStatus(client, folderId);
    return s.globalBytes > 0 && s.inSyncBytes === s.globalBytes && s.needBytes === 0;
  } catch {
    return false;
  }
}

// Which peers this node is actually connected to, by device id.
export async function getConnectedDevices(client) {
  const conns = await api(client, '/rest/system/connections');
  return Object.entries(conns.connections || {})
    .filter(([, c]) => c.connected)
    .map(([id]) => id);
}

// Ask the daemon to look at the folder NOW. Without this a test that writes into a
// volume waits on syncthing's own rescan interval, which is an hour by default - so
// "the daemon has not noticed yet" reads identically to "the write never landed".
export async function scanFolder(client, folderId) {
  const key = await apiKey(client);
  const r = await execInContainer(client.container,
    `curl -sS -X POST -H "X-API-Key: ${key}" "http://127.0.0.1:8384/rest/db/scan?folder=${encodeURIComponent(folderId)}"`);
  if (r.exitCode !== 0) throw new Error(`syncthing-real: scan of ${folderId} failed: ${r.stderr || r.output}`);
}

// What is actually on disk inside the folder, which is the only thing that
// settles whether data moved. The index can describe files a node does not have.
export async function listFolderFiles(client, path) {
  const r = await execInContainer(client.container, `ls -A "${path}" 2>/dev/null | sort | tr '\\n' ' '`);
  return r.stdout.trim();
}

// One folder's config as the daemon holds it: type, syncOwnership,
// maxConflicts, devices and the rest. Null when the folder does not exist.
export async function getFolderConfig(client, folderId) {
  const folders = await getFolders(client);
  return folders.find((f) => f.id === folderId) ?? null;
}

// Owner and mode of a path on the node's disk, as numbers: { uid, gid, mode }
// with mode the octal permission string stat prints (e.g. '755'). Null when
// the path does not exist.
export async function statPath(client, path) {
  const r = await execInContainer(client.container, `stat -c '%u %g %a' "${path}" 2>/dev/null`);
  const [uid, gid, mode] = r.stdout.trim().split(' ');
  if (r.exitCode !== 0 || mode === undefined) return null;
  return { uid: Number(uid), gid: Number(gid), mode };
}

// One file's record in the daemon's index: `global` is the version the cluster
// agrees on, with `global.platform.Unix` the owner it carries ({ UID, GID,
// OwnerName, GroupName }), `local` this node's own. `file` is relative to the
// folder root.
export async function getFileInfo(client, folderId, file) {
  return api(client, `/rest/db/file?folder=${encodeURIComponent(folderId)}&file=${encodeURIComponent(file)}`);
}

// What each running syncthing process resolves owners against: the sha256 of
// its /etc/passwd followed by its /etc/group, as that process sees them - the
// value numericIdTables.js calls TABLES_SHA256 when they are the numeric id
// tables. Empty when no syncthing runs.
export async function syncthingIdTables(client) {
  const r = await execInContainer(client.container,
    'for p in $(pgrep -x syncthing); do echo "$p $(cat /proc/$p/root/etc/passwd /proc/$p/root/etc/group | sha256sum | cut -c1-64)"; done');
  return r.stdout.trim().split('\n').filter(Boolean).map((line) => {
    const [pid, tables] = line.split(' ');
    return { pid: Number(pid), tables };
  });
}

// A file's content on the node's disk, or null when it does not exist.
export async function readPath(client, path) {
  const r = await execInContainer(client.container, `cat "${path}" 2>/dev/null`);
  return r.exitCode === 0 ? r.stdout : null;
}

// Start the node's own daemon again after something stopped it, the way the OS
// starts it, and wait until it answers.
export async function startDaemon(client, { timeout = 60000, interval = 1000 } = {}) {
  const r = await execInContainer(client.container, '/flux/test-infra/start-syncthing.sh');
  if (r.exitCode !== 0) throw new Error(`syncthing-real: could not start the daemon: ${r.output}`);
  const start = Date.now();
  while (Date.now() - start < timeout) {
    // eslint-disable-next-line no-await-in-loop
    if (await isDaemonUp(client)) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, interval); });
  }
  throw new Error(`syncthing-real: the daemon did not answer within ${timeout}ms of starting`);
}

// Stop the node's own daemon outright, as a machine going down stops it.
export async function stopDaemon(client) {
  await execInContainer(client.container, 'pkill -KILL -x syncthing; true');
}

// The daemon's own event log since `since`, optionally of named types - e.g.
// StateChanged (a folder starting a scan) and ConfigSaved (a folder's type
// changed). Event ids are ordered, so two events can be put in order, and
// they restart from 1 when the daemon does.
//
// Filtered here, not with the API's `events=`: syncthing creates the
// subscription for a filter the first time it is asked for, so a filtered read
// holds nothing from before that. The default subscription runs from start-up.
export async function getDaemonEvents(client, { since = 0, events = [] } = {}) {
  const all = await api(client, `/rest/events?since=${since}&timeout=1`);
  return events.length ? all.filter((e) => events.includes(e.type)) : all;
}

// The id of the newest event the daemon holds, to measure later events from.
export async function lastDaemonEventId(client) {
  const all = await getDaemonEvents(client);
  return all.length ? all[all.length - 1].id : 0;
}

// What the daemon records about each device: { <deviceID>: { lastSeen, ... } }.
// lastSeen is 1970-01-01 for a device it has never been connected to.
export async function getDeviceStats(client) {
  return api(client, '/rest/stats/device');
}

// The devices the daemon has configured, as syncthing holds them.
export async function getConfigDevices(client) {
  return api(client, '/rest/config/devices');
}
