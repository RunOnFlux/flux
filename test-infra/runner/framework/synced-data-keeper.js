import { getDiskClaims } from './syncthing-control.js';
import { execInContainer } from './container.js';

// A real syncthing leaves a folder's data on every node that syncs it, and FluxOS
// reads that disk: the stale-index check refuses a folder whose index claims bytes
// the disk does not hold. The syncthing stub moves no data, so this puts the bytes
// there: a mounted volume that holds none of the owner's data while the stub reports
// bytes in sync gets them, in one file. It is written again after FluxOS clears the
// volume - as a sync would refill it - and removed once the stub reports nothing in
// sync, or a declaration says the disk does not hold it (setSyncState's onDisk:
// false). A volume a suite has put data on itself is left as it is, and so is a
// folder its node has paused: a paused folder moves no data.
//
// A pass acts on what one read of the stub said, so a folder paused after that read
// must not be written. Each write and removal is made only while the node's clock is
// within READ_VALID_MS of the read. FluxOS clears a folder's appdata at least 5 s
// after pausing it - appendRestoreTask pauses, stops the app, waits 5 s and only then
// clears - so a write made within READ_VALID_MS of a read that found the folder
// running lands before that clear, and never between the clear and the unpack.

const SYNCED_FILE = 'appdata/.harness-synced';
const INTERVAL_MS = 1000;
const READ_VALID_MS = 1000;
const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;

// The bytes each node should hold per folder: the node's own declaration where it
// has one, the wildcard's otherwise - the stub's own lookup order.
function bytesByFolder(claims, ip) {
  const wanted = new Map();
  claims.filter((c) => c.ip === '*').forEach((c) => wanted.set(c.folder, c.bytes));
  claims.filter((c) => c.ip === ip).forEach((c) => wanted.set(c.folder, c.bytes));
  return wanted;
}

// The folders a node's config has paused.
function pausedFolders(paused, ip) {
  return new Set(paused.filter((p) => p.ip === ip).map((p) => p.folder));
}

/**
 * @param {Array<[string, number]>} entries folder -> bytes it should hold (0: none)
 * @param {number} deadline epoch ms after which nothing is written or removed
 * @returns {string}
 */
function script(entries, deadline) {
  const inTime = `[ "$(( $(date +%s%N) / 1000000 ))" -lt ${deadline} ]`;
  return entries.map(([folder, bytes]) => {
    const dir = `/mnt/appdata/flux-apps/${folder}`;
    const file = `${dir}/${SYNCED_FILE}`;
    const ownData = `find ${dir}/appdata -type f -size +0 ! -path ${file} -print -quit`;
    const write = bytes > 0
      ? `[ -n "$(${ownData})" ] || [ "$(stat -c %s ${file} 2>/dev/null)" = "${bytes}" ] || head -c ${bytes} /dev/zero > ${file}`
      : `rm -f ${file}`;
    return `if ${inTime} && grep -qs " ${dir} " /proc/mounts && [ -d ${dir}/appdata ]; then ${write}; fi`;
  }).join('\n');
}

/**
 * Keeps every node's volumes holding what the syncthing stub reports they hold in
 * sync, until stopped.
 * @param {object} env The test environment; its clients are read on every pass, so a
 *   node started later is covered from then on.
 * @returns {{stop: () => Promise<void>}}
 */
export function startSyncedDataKeeper(env) {
  let stopped = false;
  const kept = new Map(); // node ip -> folders it was given bytes for
  const pass = async () => {
    const readAt = Date.now();
    const read = await getDiskClaims().catch(() => null);
    if (!Array.isArray(read?.claims) || !Array.isArray(read?.paused)) return;
    const deadline = readAt + READ_VALID_MS;
    await Promise.all((env.clients || []).filter((client) => client?.container).map(async (client) => {
      const wanted = bytesByFolder(read.claims, client.ip);
      const previouslyKept = kept.get(client.ip) || new Set();
      // A folder this node was given bytes for and no longer claims loses them.
      previouslyKept.forEach((folder) => { if (!wanted.has(folder)) wanted.set(folder, 0); });
      const paused = pausedFolders(read.paused, client.ip);
      const entries = [...wanted].filter(([folder]) => SAFE_NAME.test(folder) && !paused.has(folder));
      // A paused folder keeps whatever it was given until it runs again.
      const stillKept = [...previouslyKept].filter((folder) => paused.has(folder));
      kept.set(client.ip, new Set([...stillKept, ...entries.filter(([, bytes]) => bytes > 0).map(([folder]) => folder)]));
      if (!entries.length) return;
      await execInContainer(client.container, script(entries, deadline)).catch(() => {});
    }));
  };
  const loop = (async () => {
    while (!stopped) {
      // eslint-disable-next-line no-await-in-loop
      await pass();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, INTERVAL_MS); });
    }
  })();
  return {
    async stop() {
      stopped = true;
      await loop;
    },
  };
}
