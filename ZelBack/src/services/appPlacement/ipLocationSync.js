// Interim fetch-and-restore for the iplocation artifact.
//
// This branch ships before the policy store (feat/userconfig-rearchitecture),
// which already registers this same artifact and takes over when it rebases
// onto this branch. To make that handover seamless, this module mirrors the
// store's artifact contract exactly: same registry key, same GridFS bucket and
// record shape (policyArtifactRepository, shared verbatim), same conditional
// requests, and the same rejection rule - bytes the reader throws on are never
// cached and never displace a good stored copy. The policy store will restore
// the cache this module populated; no node refetches across the transition.
//
// AT REBASE: delete this module and its serviceManager start call, and wire
//   policyStore.onArtifact('ipLocationTable', (bytes) => ipLocationStore.setArtifact(bytes));
// beside policyStore.startSync() instead. The rows live in mongo and the ingest
// marker names the baseline they came from, so their boot restore only
// re-ingests when the artifact's generated timestamp differs from the marker's.

const config = require('config');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const fluxCommunicationUtils = require('../fluxCommunicationUtils');
const policyArtifactRepository = require('../appDatabase/policyArtifactRepository');
const ipLocationStore = require('./ipLocationStore');

const ARTIFACT_NAME = 'ipLocationTable'; // registry key, shared with policyStore
const ARTIFACT_FILE = 'iplocation.bin.gz';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 10 * 60 * 1000; // only while the node holds no table at all
const MAX_RETRY_ATTEMPTS = 5; // 10m, 20m, 40m, 80m, 160m - then the daily refresh
const FETCH_TIMEOUT_MS = 120 * 1000; // 4.2 MB over slow uplinks; never gates boot

let etag = null;
let refreshInterval = null;
let retryTimer = null;
let retryAttempt = 0;
let started = false;
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

/**
 * Fetch the artifact if it changed, install it, and cache it. A malformed
 * response is rejected by the reader's parse and never written to the cache;
 * an unchanged artifact costs a 304 and no body.
 * @returns {Promise<boolean>} true when a new table was installed.
 */
async function refresh() {
  const url = `${config.policy.baseUrl}/${ARTIFACT_FILE}`;
  try {
    const options = {
      timeout: FETCH_TIMEOUT_MS,
      responseType: 'arraybuffer',
      // axios rejects everything outside 2xx; 304 is the expected answer for
      // an unchanged artifact and must come back as a response
      validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
    };
    if (etag) options.headers = { 'If-None-Match': etag };
    const res = await serviceHelper.axiosGet(url, options);
    if (res.status === 304) return false;
    const bytes = Buffer.from(res.data);
    const served = (res.headers && (res.headers.etag ?? res.headers.ETag)) ?? null;
    try {
      // before the cache write, so a malformed artifact never displaces a good stored copy
      await ipLocationStore.setArtifact(bytes);
    } catch (error) {
      // Remember the etag of bytes this build cannot read, so the next attempt
      // is a 304 rather than another full download of the same broken
      // artifact. A corrected publication carries a new etag and is fetched.
      etag = served;
      throw error;
    }
    etag = served;
    await policyArtifactRepository.writeArtifactBytes(ARTIFACT_NAME, bytes, etag)
      .catch((error) => log.warn(`ipLocationSync - failed to cache artifact: ${error.message}`));
    log.info('ipLocationSync - iplocation table refreshed');
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
 * Adopt the stored baseline - or restore the last-good artifact from GridFS -
 * then refresh in the background and daily thereafter. Placement needs no table
 * to run - it degrades to status-quo /16 arithmetic - so nothing here ever
 * gates boot. Idempotent. Call after mongo is up.
 */
async function startSync() {
  if (started) return;
  started = true;
  // The restore is best-effort: a database that is briefly unavailable at this
  // moment must not cost this process its table for the rest of its life, so a
  // failure here still leaves the fetch and the refresh loop armed.
  try {
    const adopted = await ipLocationStore.adoptPersistedStatus();
    await policyArtifactRepository.sweepOrphanedArtifacts(ARTIFACT_NAME);
    const record = await policyArtifactRepository.getArtifactRecord(ARTIFACT_NAME);
    if (adopted) {
      // The rows are already in mongo under the marker's baseline; re-ingesting
      // the same two million of them to learn what the marker already says buys
      // nothing. The etag still comes from the record so the daily refresh is a
      // conditional request rather than a full download.
      etag = record?.etag ?? null;
      refreshNodeLocations();
    } else {
      const bytes = record ? await policyArtifactRepository.readArtifactBytes(record.fileId) : null;
      if (bytes) {
        try {
          await ipLocationStore.setArtifact(bytes);
          ({ etag } = record);
          log.info('ipLocationSync - iplocation table restored from cache');
          refreshNodeLocations();
        } catch (error) {
          // A stored copy this build cannot read must not leave the next
          // refresh answering 304 for bytes we are not actually holding - drop
          // the etag so the refetch is unconditional. This is also the upgrade
          // path: a node that cached the previous JSON artifact holds bytes
          // whose magic this reader rejects, and the unconditional refetch
          // below is what brings it the binary one.
          etag = null;
          log.error(`ipLocationSync - stored iplocation table rejected, will refetch: ${error.message}`);
        }
      }
    }
  } catch (error) {
    log.warn(`ipLocationSync - could not restore the cached table, fetching instead: ${error.message}`);
  }
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
  etag = null;
}

module.exports = {
  startSync,
  stopSync,
  refresh,
};
