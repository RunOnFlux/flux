const config = require('config');
const { GridFSBucket } = require('mongodb');
const dbHelper = require('../dbHelper');
const log = require('../../lib/log');

// Last-known-good storage for policy artifacts: documents too large to sit inline in a
// mongo document, which the 16 MiB BSON cap forbids. GridFS chunks them, so size is not
// a constraint, and they stay in the same local database — no untracked files in the repo
// tree, and identical on Arcane and legacy.
//
// Bytes go to the bucket; the etag and the id of the stored file go to the ordinary
// policyDocuments row, so there is one place to look for "what do we have and how fresh".
const BUCKET_NAME = 'policyartifacts';
const policyDocumentsCollection = config.database.local.collections.policyDocuments;

function db() {
  const connection = dbHelper.databaseConnection();
  return connection ? connection.db(config.database.local.database) : null;
}

function bucket(database) {
  return new GridFSBucket(database, { bucketName: BUCKET_NAME });
}

/**
 * What we hold for an artifact: the id of its stored bytes and the etag they were served
 * with, or null when there is nothing.
 * @param {string} name Registry key.
 * @returns {Promise<{fileId: object, etag: string|null, fetchedAt: number|null}|null>}
 */
async function getArtifactRecord(name) {
  const database = db();
  if (!database) return null;
  const doc = await dbHelper.findOneInDatabase(
    database,
    policyDocumentsCollection,
    { _id: name },
  );
  if (!doc || !doc.fileId) return null;
  return { fileId: doc.fileId, etag: doc.etag ?? null, fetchedAt: doc.fetchedAt ?? null };
}

/**
 * The stored bytes for an artifact, or null when the file is missing.
 *
 * A record whose file has gone (an interrupted write, a dropped bucket) reads as absent
 * rather than throwing: the caller's next fetch replaces it.
 * @param {object} fileId GridFS file id from the artifact record.
 * @returns {Promise<Buffer|null>}
 */
async function readArtifactBytes(fileId) {
  const database = db();
  if (!database) return null;
  try {
    const chunks = [];
    const stream = bucket(database).openDownloadStream(fileId);
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch (error) {
    log.warn(`policyArtifact - could not read stored bytes for ${fileId}: ${error.message}`);
    return null;
  }
}

/**
 * Store bytes for an artifact and point its record at them.
 *
 * GridFS does not overwrite — every upload is a new file with its own chunks — so the
 * previous file is deleted once the new one is committed and the record moved. Skipping
 * that would grow the local database by the artifact's size on every refresh.
 * @param {string} name Registry key.
 * @param {Buffer} bytes The artifact.
 * @param {string|null} [etag] Response ETag, for the next conditional request.
 * @returns {Promise<boolean>} true when stored and recorded.
 */
async function writeArtifactBytes(name, bytes, etag = null) {
  const database = db();
  if (!database) return false;

  const previous = await getArtifactRecord(name);

  const fileId = await new Promise((resolve, reject) => {
    const upload = bucket(database).openUploadStream(name);
    upload.on('error', reject);
    upload.on('finish', () => resolve(upload.id));
    upload.end(bytes);
  });

  await dbHelper.findOneAndUpdateInDatabase(
    database,
    policyDocumentsCollection,
    { _id: name },
    { $set: { fileId, etag, fetchedAt: Date.now() } },
    { upsert: true },
  );

  // Only now is the old file unreferenced. Failing to delete it is untidy, not incorrect,
  // so it must not fail the write that already succeeded.
  if (previous) {
    await bucket(database).delete(previous.fileId)
      .catch((error) => log.warn(`policyArtifact - could not delete superseded ${name} file: ${error.message}`));
  }

  return true;
}

/**
 * Delete stored files for an artifact that its record does not point at.
 *
 * A process killed between the upload finishing and the record moving leaves a file
 * nothing references, and nothing else would ever reclaim it. Run at startup.
 * @param {string} name Registry key.
 * @returns {Promise<number>} How many files were removed.
 */
async function sweepOrphanedArtifacts(name) {
  const database = db();
  if (!database) return 0;
  try {
    const current = await getArtifactRecord(name);
    const currentId = current ? String(current.fileId) : null;
    const files = await bucket(database).find({ filename: name }).toArray();
    const orphans = files.filter((file) => String(file._id) !== currentId);

    // eslint-disable-next-line no-restricted-syntax
    for (const orphan of orphans) {
      // eslint-disable-next-line no-await-in-loop
      await bucket(database).delete(orphan._id)
        .catch((error) => log.warn(`policyArtifact - could not sweep ${orphan._id}: ${error.message}`));
    }
    if (orphans.length) log.info(`policyArtifact - swept ${orphans.length} orphaned ${name} file(s)`);
    return orphans.length;
  } catch (error) {
    log.warn(`policyArtifact - sweep of ${name} failed: ${error.message}`);
    return 0;
  }
}

module.exports = {
  getArtifactRecord,
  readArtifactBytes,
  writeArtifactBytes,
  sweepOrphanedArtifacts,
  BUCKET_NAME,
};
