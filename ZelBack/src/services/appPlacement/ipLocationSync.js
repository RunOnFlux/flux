// Interim fetch-and-restore for the iplocation artifact.
//
// This branch ships before the policy store (feat/userconfig-rearchitecture),
// which already registers this same artifact and takes over when it rebases
// onto this branch. To make that handover seamless, this module mirrors the
// store's artifact contract exactly: same registry key, same GridFS bucket and
// record shape (policyArtifactRepository, shared verbatim), same conditional
// requests, and the same rejection rule - bytes the reader throws on are never
// cached and never displace a good stored copy. The store will restore the
// cache this module populated; no node refetches across the transition.
//
// AT REBASE: delete this module and its serviceManager start call, and wire
//   policyStore.onArtifact('ipLocationTable', (bytes) => ipLocationTable.setArtifact(bytes));
// beside policyStore.startSync() instead.

const config = require('config');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const policyArtifactRepository = require('../appDatabase/policyArtifactRepository');
const ipLocationTable = require('./ipLocationTable');

const ARTIFACT_NAME = 'ipLocationTable'; // registry key, shared with policyStore
const ARTIFACT_FILE = 'iplocation.json';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 120 * 1000; // 8.5 MB over slow uplinks; never gates boot

let etag = null;
let refreshInterval = null;
let started = false;

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
    // before the cache write, so a malformed artifact never displaces a good stored copy
    ipLocationTable.setArtifact(bytes);
    etag = (res.headers && (res.headers.etag ?? res.headers.ETag)) ?? null;
    await policyArtifactRepository.writeArtifactBytes(ARTIFACT_NAME, bytes, etag)
      .catch((error) => log.warn(`ipLocationSync - failed to cache artifact: ${error.message}`));
    log.info('ipLocationSync - iplocation table refreshed');
    return true;
  } catch (error) {
    log.warn(`ipLocationSync - failed to refresh from ${url}, keeping current table: ${error.message}`);
    return false;
  }
}

/**
 * Restore the last-good artifact from GridFS, then refresh in the background
 * and daily thereafter. Placement needs no table to run - it degrades to
 * status-quo /16 arithmetic - so nothing here ever gates boot. Idempotent.
 * Call after mongo is up.
 */
async function startSync() {
  if (started) return;
  started = true;
  await policyArtifactRepository.sweepOrphanedArtifacts(ARTIFACT_NAME);
  const record = await policyArtifactRepository.getArtifactRecord(ARTIFACT_NAME);
  if (record) {
    const bytes = await policyArtifactRepository.readArtifactBytes(record.fileId);
    if (bytes) {
      try {
        ipLocationTable.setArtifact(bytes);
        ({ etag } = record);
        log.info('ipLocationSync - iplocation table restored from cache');
      } catch (error) {
        // A stored copy this build cannot read (a downgrade, a corrupt write)
        // must not leave the next refresh answering 304 for bytes we are not
        // actually holding - drop the etag so the refetch is unconditional.
        etag = null;
        log.error(`ipLocationSync - stored iplocation table rejected, will refetch: ${error.message}`);
      }
    }
  }
  refresh().catch((error) => log.error(`ipLocationSync - refresh error: ${error.message}`));
  refreshInterval = setInterval(() => {
    refresh().catch((error) => log.error(`ipLocationSync - refresh error: ${error.message}`));
  }, REFRESH_INTERVAL_MS);
  if (refreshInterval.unref) refreshInterval.unref();
}

/**
 * Stop the refresh loop. Test support and shutdown.
 */
function stopSync() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = null;
  started = false;
  etag = null;
}

module.exports = {
  startSync,
  stopSync,
  refresh,
};
