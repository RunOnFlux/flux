// Interim fetch-and-restore for the iplocation artifact.
//
// This branch ships before the policy store (feat/userconfig-rearchitecture),
// which already registers this same artifact and takes over when it rebases
// onto this branch. To make that handover seamless, this module mirrors the
// store's artifact contract exactly: same registry key, same GridFS bucket and
// record shape (policyArtifactRepository, shared verbatim), the same signed
// statement deciding which bytes are the table, and the same rejection rule -
// bytes the reader throws on are never cached and never displace a good stored
// copy. The policy store will restore the cache this module populated; no node
// refetches across the transition.
//
// AT REBASE: delete this module and its serviceManager start call, and wire
//   policyStore.onArtifact('ipLocationTable', (bytes) => ipLocationStore.setArtifact(bytes));
// beside policyStore.startSync() instead. The rows live in mongo and the ingest
// marker names the baseline they came from, so their boot restore only
// re-ingests when the artifact's generated timestamp differs from the marker's.

const config = require('config');
const crypto = require('crypto');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const fluxCommunicationUtils = require('../fluxCommunicationUtils');
const policyArtifactRepository = require('../appDatabase/policyArtifactRepository');
const policyStore = require('../policyStore');
const ipLocationStore = require('./ipLocationStore');

const ARTIFACT_NAME = 'ipLocationTable'; // registry key, shared with policyStore
const ARTIFACT_FILE = 'iplocation.bin.gz';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 10 * 60 * 1000; // only while the node holds no table at all
const MAX_RETRY_ATTEMPTS = 5; // 10m, 20m, 40m, 80m, 160m - then the daily refresh
const FETCH_TIMEOUT_MS = 120 * 1000; // 4.8 MB over slow uplinks; never gates boot

// The sha256 of the bytes this node currently holds, and the ONLY thing consulted to decide
// whether a refresh has anything to do. The signed bundle names the digest the current table
// must have, so "do I already hold it" is a string comparison against a signed value rather
// than a question put to the server that would be serving the answer.
let heldSha = null;
let refreshInterval = null;
let retryTimer = null;
let retryAttempt = 0;
let started = false;
let restored = false;
let nodeLocationPass = null;

/**
 * Bring the per-node location view in line with the current node list. Several
 * paths want this after they change something, and a single pass at a time is
 * enough for all of them - a second concurrent pass would look up exactly the
 * addresses the first is already writing.
 * @returns {Promise<void>}
 */
function refreshNodeLocations() {
  if (nodeLocationPass) return nodeLocationPass;
  nodeLocationPass = fluxCommunicationUtils.deterministicFluxList()
    .then((nodeList) => ipLocationStore.refreshNodeLocations(nodeList))
    .then(({ refreshed, dropped }) => {
      if (refreshed || dropped) log.info(`ipLocationSync - node locations refreshed: ${refreshed} written, ${dropped} dropped`);
    })
    .catch((error) => log.warn(`ipLocationSync - node location refresh failed: ${error.message}`))
    .finally(() => { nodeLocationPass = null; });
  return nodeLocationPass;
}

/** Lower-case hex sha256, the form the signed bundle names artifacts by. */
function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Fetch the artifact the signed bundle names, verify it, install it, and cache it.
 *
 * THE BUNDLE IS WHAT SAYS WHICH BYTES ARE THE TABLE. It carries a content-addressed file
 * name and the sha256 that file must hash to, under the fleet's pinned keys - so this fetch
 * is checked against a signed statement rather than trusted because of where it came from.
 * Without that the largest artifact on the network, four point eight megabytes that decide
 * every node's geolocation and therefore where apps may be placed, would be the one piece of
 * policy taken on the publisher's word.
 *
 * A node holding no bundle does not fetch. There is nothing to verify against, and installing
 * an unverified table is the thing this exists to stop; the retry below brings it back once
 * policy arrives.
 *
 * The digest also replaces the conditional request. A content-addressed name changes when the
 * content does, so holding the named digest IS "unchanged" - decided locally, against a signed
 * value, instead of by an ETag the server could answer anything to.
 * @returns {Promise<boolean>} true when a new table was installed.
 */
async function refresh() {
  const want = policyStore.getArtifact(ARTIFACT_FILE);
  if (!want || !want.file || !want.sha256) {
    log.info('ipLocationSync - no signed statement for the iplocation table yet, not fetching');
    return false;
  }
  if (heldSha === want.sha256) return false;

  const url = `${config.policy.signedBaseUrl}/${want.file}`;
  try {
    const res = await serviceHelper.axiosGet(url, {
      timeout: FETCH_TIMEOUT_MS,
      responseType: 'arraybuffer',
      // The declared size is a ceiling as well as an expectation: it stops a source that
      // answers with something enormous costing this node the memory before the digest can
      // reject it.
      maxContentLength: want.bytes || undefined,
    });
    const bytes = Buffer.from(res.data);

    if (want.bytes && bytes.length !== want.bytes) {
      throw new Error(`artifact is ${bytes.length} bytes, bundle says ${want.bytes}`);
    }
    const got = sha256Hex(bytes);
    if (got !== want.sha256) {
      throw new Error(`artifact hashes to ${got}, bundle says ${want.sha256}`);
    }

    try {
      // before the cache write, so a malformed artifact never displaces a good stored copy
      await ipLocationStore.setArtifact(bytes);
    } catch (error) {
      // Remember the digest of bytes this build cannot read, so the next attempt does not
      // download the same rejected artifact again. A corrected publication is a different
      // digest and is fetched.
      heldSha = want.sha256;
      throw error;
    }
    heldSha = want.sha256;
    await policyArtifactRepository.writeArtifactBytes(ARTIFACT_NAME, bytes)
      .catch((error) => log.warn(`ipLocationSync - failed to cache artifact: ${error.message}`));
    log.info(`ipLocationSync - iplocation table refreshed, verified against the signed bundle (${want.sha256.slice(0, 12)})`);
    // a new baseline invalidates every node location document
    refreshNodeLocations();
    return true;
  } catch (error) {
    log.warn(`ipLocationSync - failed to refresh from ${url}, keeping current table: ${error.message}`);
    return false;
  }
}

/**
 * Run a refresh, and while the node holds NO table at all, retry on a short
 * interval instead of waiting out the daily one. A node whose first fetch
 * lands in a boot-time network gap would otherwise spend a full day computing
 * /16 fault domains while the rest of the fleet uses organisations.
 */
function scheduleRefresh() {
  refresh()
    .then((installed) => {
      // The node list drifts while the table does not, so a 304 still leaves
      // nodes that joined since the last pass without a location document.
      // An install has already asked for the pass this would repeat.
      if (!installed) refreshNodeLocations();
      if (installed || ipLocationStore.status().ready) {
        retryAttempt = 0;
        return;
      }
      if (retryTimer || retryAttempt >= MAX_RETRY_ATTEMPTS) return;
      // Exponential backoff with a cap on attempts: a boot-time network gap
      // clears in minutes, while a published artifact this build cannot read
      // never clears, and retrying it forever would have every node in the
      // fleet re-downloading the same broken file on a fixed interval. After
      // the attempts are spent the daily refresh is the only retry.
      const delay = RETRY_INTERVAL_MS * 2 ** retryAttempt;
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        scheduleRefresh();
      }, delay);
      if (retryTimer.unref) retryTimer.unref();
    })
    .catch((error) => log.error(`ipLocationSync - refresh error: ${error.message}`));
}

/**
 * Bring back the table this node already holds: adopt the stored baseline, or
 * restore the last-good artifact from GridFS.
 *
 * Separate from startSync, and started separately, because the two halves need
 * different things and cost different amounts. This half needs MONGO ONLY - on a
 * node that has run before it is a single marker read, and the two million rows
 * are already in the collection - so it belongs as early as the database is up.
 * Every consumer of the table then has it within milliseconds of boot instead of
 * waiting on work it does not depend on. Idempotent.
 * @returns {Promise<void>}
 */
async function restoreCachedTable() {
  if (restored) return;
  restored = true;
  // Best-effort: a database briefly unavailable at this moment must not cost
  // this process its table for the rest of its life, so a failure here still
  // leaves the fetch and the refresh loop armed.
  try {
    const adopted = await ipLocationStore.adoptPersistedStatus();
    await policyArtifactRepository.sweepOrphanedArtifacts(ARTIFACT_NAME);
    const record = await policyArtifactRepository.getArtifactRecord(ARTIFACT_NAME);
    if (adopted) {
      // The rows are already in mongo under the marker's baseline; re-ingesting
      // the same two million of them to learn what the marker already says buys
      // nothing. The digest still comes from the record, so a refresh that finds
      // the bundle naming what we hold does not download it again.
      heldSha = record?.sha256 ?? null;
      refreshNodeLocations();
    } else {
      const bytes = record ? await policyArtifactRepository.readArtifactBytes(record.fileId) : null;
      if (bytes) {
        try {
          await ipLocationStore.setArtifact(bytes);
          ({ sha256: heldSha } = record);
          log.info('ipLocationSync - iplocation table restored from cache');
          refreshNodeLocations();
        } catch (error) {
          // A stored copy this build cannot read must not leave the next refresh
          // believing it holds the named table - drop the digest so the refetch
          // happens. This is also the upgrade path: a node that cached the
          // previous JSON artifact holds bytes whose magic this reader rejects,
          // and the refetch below is what brings it the verified binary one.
          heldSha = null;
          log.error(`ipLocationSync - stored iplocation table rejected, will refetch: ${error.message}`);
        }
      }
    }
  } catch (error) {
    log.warn(`ipLocationSync - could not restore the cached table, fetching instead: ${error.message}`);
  }
}

/**
 * Fetch the artifact if it has changed, and keep it fresh daily.
 *
 * The expensive half: a 4.2 MB download and, when the published baseline has
 * moved, an ingest of two million rows. It is deliberately NOT started with the
 * restore above - a node with no cache would otherwise run that ingest
 * concurrently with the app-database rebuild, which is the busiest the database
 * ever is. Placement needs no table to run - it degrades to status-quo /16
 * arithmetic - so nothing here gates boot either way. Restores first if that has
 * not happened. Idempotent.
 * @returns {Promise<void>}
 */
async function startSync() {
  if (started) return;
  started = true;
  await restoreCachedTable();
  scheduleRefresh();
  refreshInterval = setInterval(scheduleRefresh, REFRESH_INTERVAL_MS);
  if (refreshInterval.unref) refreshInterval.unref();
}

/**
 * Stop the refresh loop. Test support and shutdown.
 */
function stopSync() {
  if (refreshInterval) clearInterval(refreshInterval);
  if (retryTimer) clearTimeout(retryTimer);
  refreshInterval = null;
  retryTimer = null;
  retryAttempt = 0;
  started = false;
  restored = false;
  heldSha = null;
}

module.exports = {
  restoreCachedTable,
  startSync,
  stopSync,
  refresh,
};
