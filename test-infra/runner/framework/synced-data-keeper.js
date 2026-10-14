import { getDiskClaims, onSyncDeclaration } from './syncthing-control.js';
import { execInContainer } from './container.js';

// A real syncthing leaves a folder's data on every node that syncs it, and FluxOS
// reads that disk: the stale-index check refuses a folder whose index claims bytes
// the disk does not hold. The syncthing stub moves no data, so this puts the bytes
// there: a mounted volume that holds none of the owner's data while the stub reports
// bytes in sync gets them, in one file, and loses it once the stub reports nothing
// in sync or a declaration says the disk does not hold it (setSyncState's onDisk:
// false). A volume a suite has put data on itself is left as it is.
//
// A volume is written only at the moments a sync would write it: when a declaration
// changes, when FluxOS builds the volume (app:installed, a hard component redeploy),
// and when FluxOS empties it for a sync to refill (reconciler:actuated dataCleared).
// A restore empties a volume for the owner's archive, not for a sync, so nothing
// here writes into it. A node whose event stream opens or reports a gap may have
// missed one of those moments, and is brought to every declaration at once.

const SYNCED_FILE = 'appdata/.harness-synced';
const APPS_DIR = '/mnt/appdata/flux-apps';
const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;

// The bytes each node should hold per folder: the node's own declaration where it
// has one, the wildcard's otherwise - the stub's own lookup order.
function bytesByFolder(claims, ip) {
  const wanted = new Map();
  claims.filter((c) => c.ip === '*').forEach((c) => wanted.set(c.folder, c.bytes));
  claims.filter((c) => c.ip === ip).forEach((c) => wanted.set(c.folder, c.bytes));
  return wanted;
}

// The syncthing folder id of a component identifier, as dockerService.getAppIdentifier
// derives it.
function folderOf(identifier) {
  return /^(flux|zel)/.test(identifier) ? identifier : `flux${identifier}`;
}

// Whether a folder belongs to an app: its single component's, or one of its composed
// components' (flux<component>_<app>).
function belongsTo(folder, app) {
  return folder === folderOf(app) || folder.endsWith(`_${app}`);
}

/**
 * @param {Array<[string, number]>} entries folder -> bytes it should hold (0: none)
 * @param {boolean} sweep Also remove the file from every folder not in entries.
 * @returns {string}
 */
function script(entries, sweep) {
  const lines = entries.map(([folder, bytes]) => {
    const dir = `${APPS_DIR}/${folder}`;
    const file = `${dir}/${SYNCED_FILE}`;
    const ownData = `find ${dir}/appdata -type f -size +0 ! -path ${file} -print -quit`;
    const write = bytes > 0
      ? `[ -n "$(${ownData})" ] || [ "$(stat -c %s ${file} 2>/dev/null)" = "${bytes}" ] || head -c ${bytes} /dev/zero > ${file}`
      : `rm -f ${file}`;
    return `if grep -qs " ${dir} " /proc/mounts && [ -d ${dir}/appdata ]; then ${write}; fi`;
  });
  if (sweep) {
    const keep = entries.map(([folder]) => `${APPS_DIR}/${folder}/${SYNCED_FILE}`).join(' ');
    lines.push(`for f in ${APPS_DIR}/*/${SYNCED_FILE}; do case " ${keep} " in *" $f "*) ;; *) rm -f "$f" ;; esac; done`);
  }
  return lines.join('\n');
}

/**
 * Keeps every node's volumes holding what the syncthing stub reports they hold in
 * sync, until stopped.
 * @param {object} env The test environment; each of its clients is watched from the
 *   start, and a node started later from watch().
 * @returns {{watch: (client: object) => void, stop: () => Promise<void>}}
 */
export function startSyncedDataKeeper(env) {
  const queues = new Map(); // node ip -> its applies, run one at a time
  const watched = new Set();
  const unsubscribes = [];

  // Brings one node's volumes to the declared bytes: the folders `pick` accepts, or
  // every declared folder - and no file in any other - when pick is null.
  const apply = (client, pick) => {
    const run = async () => {
      const claims = await getDiskClaims().catch(() => null);
      if (!Array.isArray(claims)) return;
      const entries = [...bytesByFolder(claims, client.ip)]
        .filter(([folder]) => SAFE_NAME.test(folder) && (!pick || pick(folder)));
      if (pick && !entries.length) return;
      await execInContainer(client.container, script(entries, !pick)).catch(() => {});
    };
    const next = (queues.get(client.ip) || Promise.resolve()).then(run);
    queues.set(client.ip, next);
    return next;
  };

  const watch = (client) => {
    if (!client?.container || watched.has(client)) return;
    watched.add(client);
    const everything = () => { apply(client, null); };
    unsubscribes.push(
      client.subscribe('stream:open', everything),
      client.subscribe('stream:gap', everything),
      client.subscribe('app:installed', ({ data }) => { apply(client, (folder) => belongsTo(folder, data.name)); }),
      client.subscribe('app:componentRedeployed', ({ data }) => {
        if (data.hard) apply(client, (folder) => folder === folderOf(data.identifier));
      }),
      client.subscribe('reconciler:actuated', ({ data }) => {
        if (data.action === 'dataCleared') apply(client, (folder) => folder === folderOf(data.identifier));
      }),
    );
    everything();
  };

  (env.clients || []).forEach(watch);
  unsubscribes.push(onSyncDeclaration((change) => Promise.all([...watched]
    .filter((client) => change.all || change.ip === '*' || change.ip === client.ip)
    .map((client) => apply(client, change.all ? null : (folder) => folder === change.folder)))));

  return {
    watch,
    async stop() {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      await Promise.all(queues.values());
    },
  };
}
