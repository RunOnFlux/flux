const crypto = require('crypto');
const config = require('config');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const dockerService = require('../dockerService');
const imageManager = require('../appSecurity/imageManager');
const imageCacheStore = require('./imageCacheStore');
const imageCacheQuota = require('./imageCacheQuota');
const imageCacheDownloader = require('./imageCacheDownloader');
const enterpriseHelper = require('../utils/enterpriseHelper');
const { ImageProgress } = require('./imageCacheProgress');

// Synthetic per-owner RSA keypair label (blockHeight is not part of fluxbench's
// derivation, so 0 is fine): the client fetches the pubkey for (owner, this label)
// via /apps/getpublickey, encrypts, and this node decrypts with the same tuple.
const CACHE_KEY_LABEL = 'fluxos-image-cache';

// Typed errors so the controller can map them to HTTP status without HTTP leaking here.
function badRequestError(message) { const e = new Error(message); e.kind = 'bad-request'; return e; }
function overCapacityError(message) { const e = new Error(message); e.kind = 'over-capacity'; return e; }

// Business logic for the enterprise image cache (NO req/res — the controller owns
// those). A submission becomes one in-memory job tracking every image in it; the
// images flow through inspect -> admit -> pull concurrently (capped), with boundary
// images queued (not rejected) and re-evaluated against real usage as pulls drain.
//
// Pipeline shape:
//   - admission is SERIAL (one pumpOnce at a time) so reservations are consistent;
//   - pulls run concurrently up to imageCacheMaxConcurrentPulls;
//   - a finished pull re-pumps, which frees reservations and lets queued images in;
//   - queue only ever happens while reservations are held (i.e. pulls are active),
//     so a pull completion always re-drives progress — no deadlock.

const TERMINAL_STATES = ['pinned', 'failed', 'rejected'];

const jobs = new Map(); // jobId -> job
let globalActivePulls = 0;
let pumping = false;
let pumpAgain = false;

function nowNs() { return process.hrtime.bigint(); }
function jobTtlNs() { return BigInt(config.fluxapps.imageCacheJobTtlMs) * 1_000_000n; }
function maxConcurrentPulls() { return Math.max(1, config.fluxapps.imageCacheMaxConcurrentPulls); }

function isTerminal(image) { return TERMINAL_STATES.includes(image.state); }
function jobSettled(job) { return job.images.every(isTerminal); }

function pruneExpiredJobs() {
  const now = nowNs();
  [...jobs.entries()].forEach(([id, job]) => {
    if (jobSettled(job) && job.expiresAtNs !== null && now > job.expiresAtNs) jobs.delete(id);
  });
}

function resolveSettledJobs() {
  [...jobs.values()].forEach((job) => {
    if (!job.settledResolved && jobSettled(job)) {
      job.settledResolved = true;
      job.expiresAtNs = nowNs() + jobTtlNs(); // retain the terminal result for the TTL
      job.resolveSettled();
    }
  });
}

// Reuse the network's blacklist/compliance gate so the cache can never pull a blocked
// image. Synthetic single-image spec (no on-chain app); the owner is the fluxId, so an
// owner-level block is honoured too. Throws when the image/owner is blocked.
async function assertCompliant(fluxId, repotag) {
  await imageManager.checkApplicationImagesCompliance({
    version: 8, name: 'imagecache', owner: fluxId, hash: '', compose: [{ repotag }],
  });
}

async function ensureInspected(job, image) {
  if (image.inspected) return;
  image.inspected = true;
  try {
    await assertCompliant(job.fluxId, image.repotag);
  } catch (err) {
    image.state = 'rejected';
    image.reason = 'non-compliant';
    image.error = err.message;
    return;
  }
  const info = await imageCacheDownloader.inspectImage(image.repotag, image.repoauth, { fluxId: job.fluxId });
  if (!info.ok) {
    image.state = 'rejected';
    image.reason = 'invalid-image';
    image.error = info.error;
    return;
  }
  if (!info.supported) {
    image.state = 'rejected';
    image.reason = 'unsupported-arch';
    return;
  }
  image.compressedBytes = info.compressedBytes;
  image.digest = info.digest;
}

// Real on-disk size of the just-pulled image (df-style, via listImages). On a read
// miss store a conservative estimate rather than 0 so the quota never under-counts a
// real image; a later GC re-syncs from docker.
async function reconcileSize(repotag, compressedBytes) {
  try {
    const images = await dockerService.dockerListImages();
    const match = (images || []).find((img) => Array.isArray(img.RepoTags) && img.RepoTags.includes(repotag));
    if (match) {
      const repoDigest = (match.RepoDigests || [])[0];
      const digest = repoDigest && repoDigest.includes('@') ? repoDigest.split('@')[1] : null;
      return { sizeOnDiskBytes: match.Size || 0, imageId: match.Id || null, digest };
    }
  } catch (err) {
    log.warn(`imageCache - reconcileSize ${repotag} failed: ${err.message}`);
  }
  return { sizeOnDiskBytes: Math.round((compressedBytes || 0) * 2), imageId: null, digest: null };
}

// Authoritative present/absent check for a just-pulled image via a direct inspect
// (reliable, unlike reconcileSize's list scan whose miss also covers a transient list
// error). Fail-closed: a non-404 docker error rethrows so the caller never pins an image
// it could not confirm.
async function imageIsPresent(repotag) {
  try {
    await dockerService.dockerImageInspect(repotag);
    return true;
  } catch (err) {
    if (err.statusCode === 404) return false;
    throw err;
  }
}

// Re-reconcile pinned cache records for a repotag whose local image just changed —
// e.g. imageUpdateService soft-redeployed an app onto a newer digest. Docker moves the
// tag to the new image (the old one goes dangling and is later pruned), so without this
// the pin would keep the superseded digest/imageId/size: the quota (summed by real
// imageId) would miss the new image and `inspect` would report the wrong snapshot.
// Tracks the live image instead. No-op when the repotag carries no live pin; best-effort
// (the caller wraps it so an update never fails on a cache reconcile error).
async function reconcilePinnedImage(repotag) {
  if (!config.fluxapps.imageCacheEnabled || !repotag) return;
  const pins = await imageCacheStore.findPinsForRepotag(repotag);
  const active = (pins || []).filter((pin) => pin.state === 'pinned');
  if (!active.length) return;
  const { sizeOnDiskBytes, imageId, digest } = await reconcileSize(repotag, 0);
  // eslint-disable-next-line no-restricted-syntax
  for (const pin of active) {
    const patch = { sizeOnDiskBytes, imageId, lastReferencedAt: Date.now() };
    if (digest) patch.digest = digest;
    // eslint-disable-next-line no-await-in-loop
    await imageCacheStore.patchImage(pin.fluxId, repotag, patch);
  }
  log.info(`imageCache - reconciled ${active.length} pin(s) for updated image ${repotag}`);
}

async function pullWithRetry(job, image, onProgress) {
  const maxRetries = config.fluxapps.imageCacheMaxPullRetries;
  let attempt = 0;
  let lastErr;
  while (attempt <= maxRetries) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await imageCacheDownloader.pullImage({
        repotag: image.repotag, repoauth: image.repoauth, fluxId: job.fluxId, onProgress,
      });
      return;
    } catch (err) {
      lastErr = err;
      attempt += 1;
      if (attempt > maxRetries) break;
      log.warn(`imageCache - pull ${image.repotag} failed (attempt ${attempt}/${maxRetries}): ${err.message}, retrying`);
      // eslint-disable-next-line no-await-in-loop
      await serviceHelper.delay(Math.min(60000, 2 ** attempt * 1000));
    }
  }
  throw lastErr;
}

async function startPull(job, image) {
  // Durable in-flight pin record: boot reconcile flips a stale 'pulling' to 'failed',
  // and the retention gate keeps an image that is mid-pull.
  await imageCacheStore.upsertImage({
    fluxId: job.fluxId,
    repotag: image.repotag,
    digest: image.digest,
    imageId: null,
    compressedBytes: image.compressedBytes,
    sizeOnDiskBytes: 0,
    state: 'pulling',
    jobId: job.id,
    pinnedAt: null,
    lastReferencedAt: Date.now(),
    error: null,
  });

  const progress = new ImageProgress();
  const onProgress = (event) => {
    progress.onEvent(event);
    const snap = progress.snapshot();
    image.pulledBytes = snap.pulledBytes;
    image.totalBytes = snap.totalBytes;
    image.pct = snap.pct;
    // Downloads done but the pull hasn't returned yet -> docker is extracting/committing.
    // A display phase only (the durable record stays 'pulling'); flips to 'pinned' on success.
    if (image.state === 'pulling' && progress.downloadComplete) image.state = 'extracting';
  };

  try {
    await pullWithRetry(job, image, onProgress);
    // A pull can resolve without a usable image (a truncated stream that ends without a
    // socket error, or an in-band docker error). Never pin an image we cannot confirm is
    // actually present - fail it so the owner re-submits (docker's layer cache is cheap).
    if (!(await imageIsPresent(image.repotag))) {
      throw new Error('pull completed but image is not present');
    }
    const { sizeOnDiskBytes, imageId } = await reconcileSize(image.repotag, image.compressedBytes);
    await imageCacheStore.patchImage(job.fluxId, image.repotag, {
      state: 'pinned', sizeOnDiskBytes, imageId, digest: image.digest, pinnedAt: Date.now(), lastReferencedAt: Date.now(), error: null,
    });
    image.state = 'pinned';
    image.sizeOnDiskBytes = sizeOnDiskBytes;
  } catch (err) {
    await imageCacheStore.patchImage(job.fluxId, image.repotag, { state: 'failed', error: err.message });
    image.state = 'failed';
    image.error = err.message;
  } finally {
    imageCacheQuota.release(job.reservations.get(image.repotag));
    job.reservations.delete(image.repotag);
  }
}

async function pumpOnce() {
  pruneExpiredJobs();
  // eslint-disable-next-line no-restricted-syntax
  for (const job of jobs.values()) {
    // eslint-disable-next-line no-restricted-syntax
    for (const image of job.images) {
      if (image.state !== 'queued') {
        // eslint-disable-next-line no-continue
        continue;
      }
      if (globalActivePulls >= maxConcurrentPulls()) {
        resolveSettledJobs();
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      await ensureInspected(job, image);
      if (image.state !== 'queued') {
        // eslint-disable-next-line no-continue
        continue; // inspect rejected it
      }
      // eslint-disable-next-line no-await-in-loop
      const decision = await imageCacheQuota.tryAdmit(job.fluxId, image.repotag, image.compressedBytes);
      if (decision.decision === 'admit') {
        image.state = 'pulling';
        job.reservations.set(image.repotag, decision.token);
        globalActivePulls += 1;
        startPull(job, image).finally(() => {
          globalActivePulls -= 1;
          pumpAll();
        });
      } else if (decision.decision === 'reject') {
        image.state = 'rejected';
        image.reason = decision.reason;
      } else {
        image.reason = decision.reason; // queue: stays 'queued', re-admitted on a later pump
      }
    }
  }
  resolveSettledJobs();
}

// Serialize pumps (consistent reservations) with a coalesced re-run: a pump requested
// while one is running just sets pumpAgain, so the in-flight pump loops once more.
async function pumpAll() {
  if (pumping) {
    pumpAgain = true;
    return;
  }
  pumping = true;
  try {
    do {
      pumpAgain = false;
      // eslint-disable-next-line no-await-in-loop
      await pumpOnce();
    } while (pumpAgain);
  } catch (err) {
    log.error(`imageCache - pump error: ${err.message}`);
  } finally {
    pumping = false;
  }
}

function imageView(image) {
  return {
    repotag: image.repotag,
    state: image.state,
    reason: image.reason,
    compressedBytes: image.compressedBytes ?? null,
    sizeOnDiskBytes: image.sizeOnDiskBytes,
    pulledBytes: image.pulledBytes,
    totalBytes: image.totalBytes,
    pct: image.pct,
    digest: image.digest,
    error: image.error,
  };
}

function jobView(job) {
  return {
    jobId: job.id,
    createdAt: job.createdAt,
    settled: jobSettled(job),
    images: job.images.map(imageView),
  };
}

/**
 * Create a download job for one owner's image set and start processing it.
 * Synchronous: returns immediately so the controller can answer 202. Per-image
 * outcomes (queued/pulling/pinned/failed/rejected) are observed via getJob.
 * @param {string} fluxId
 * @param {Array<{repotag:string, repoauth?:string}>} images
 * @returns {{jobId:string, settled:Promise<void>}} settled resolves when every image is terminal
 */
function submit(fluxId, images) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('No images provided');
  }
  const normalized = images.map((img) => {
    if (!img || typeof img.repotag !== 'string' || !img.repotag) {
      throw new Error('Each image requires a repotag');
    }
    return {
      repotag: img.repotag,
      repoauth: img.repoauth || null,
      state: 'queued',
      reason: null,
      inspected: false,
      compressedBytes: undefined,
      digest: null,
      sizeOnDiskBytes: 0,
      pulledBytes: 0,
      totalBytes: 0,
      pct: 0,
      error: null,
    };
  });

  const id = crypto.randomUUID();
  let resolveSettled;
  const settled = new Promise((resolve) => { resolveSettled = resolve; });
  jobs.set(id, {
    id,
    fluxId,
    createdAt: Date.now(),
    expiresAtNs: null, // set once settled (retain terminal result for the TTL)
    images: normalized,
    reservations: new Map(),
    resolveSettled,
    settledResolved: false,
    settled,
  });
  pumpAll();
  return { jobId: id, settled };
}

/**
 * Owner-scoped job view (per-image progress for the whole submission), or null if the
 * job is unknown or belongs to another owner.
 */
function getJob(jobId, fluxId) {
  pruneExpiredJobs();
  const job = jobs.get(jobId);
  if (!job || job.fluxId !== fluxId) return null;
  return jobView(job);
}

function recordView(record) {
  return {
    repotag: record.repotag,
    digest: record.digest ?? null,
    imageId: record.imageId ?? null,
    compressedBytes: record.compressedBytes ?? null,
    sizeOnDiskBytes: record.sizeOnDiskBytes ?? 0,
    state: record.state,
    pinnedAt: record.pinnedAt ?? null,
    lastReferencedAt: record.lastReferencedAt ?? null,
    error: record.error ?? null,
  };
}

// Decrypt the v8-envelope payload to its { images: [...] } plaintext, keyed to the
// owner's synthetic cache keypair. Throws a bad-request on a malformed/undecryptable
// payload.
async function decryptSubmission(fluxId, encryptedData) {
  let payload;
  try {
    payload = await enterpriseHelper.decryptEnterpriseFromSession(encryptedData, CACHE_KEY_LABEL, 0, fluxId);
  } catch (err) {
    throw badRequestError(`Unable to decrypt image cache payload: ${err.message}`);
  }
  if (!payload || !Array.isArray(payload.images) || payload.images.length === 0) {
    throw badRequestError('Decrypted payload must contain a non-empty images array');
  }
  return payload.images;
}

// Synchronous over-capacity guard before a job is created: if the owner already fills
// their quota (or the node fills its cap) nothing in the batch can ever be admitted,
// so reject the whole request rather than spin up a job of all-rejects. Headroom
// cases still go async (per-image admission decides). Fail-closed on a store error.
async function assertHasCapacity(fluxId) {
  const [fluxRecords, allRecords] = await Promise.all([
    imageCacheStore.listImagesForFluxId(fluxId),
    imageCacheStore.listAllImages(),
  ]);
  if (fluxRecords === null || allRecords === null) {
    throw overCapacityError('Image cache accounting is temporarily unavailable');
  }
  if (imageCacheQuota.quotaInfoForFluxId(fluxRecords).remainingBytes <= 0) {
    throw overCapacityError('Per-fluxId image cache quota is full');
  }
  if (imageCacheQuota.nodeQuotaInfo(allRecords).remainingBytes <= 0) {
    throw overCapacityError('Node image cache capacity is full');
  }
}

/**
 * Decrypt an owner's encrypted submission and start a download job for it.
 * @returns {Promise<{jobId:string}>}
 * @throws {Error} with .kind 'bad-request' (malformed) or 'over-capacity' (no room)
 */
async function submitEncrypted(fluxId, encryptedData) {
  const images = await decryptSubmission(fluxId, encryptedData);
  images.forEach((img) => {
    if (!img || typeof img.repotag !== 'string' || !img.repotag) {
      throw badRequestError('Each image requires a repotag');
    }
  });
  await assertHasCapacity(fluxId);
  const { jobId } = submit(fluxId, images);
  return { jobId };
}

/** One owner's cached images + their allocation summary. */
async function listImages(fluxId) {
  const records = await imageCacheStore.listImagesForFluxId(fluxId);
  if (records === null) throw new Error('Image cache listing is temporarily unavailable');
  const info = imageCacheQuota.quotaInfoForFluxId(records);
  return {
    images: records.map(recordView),
    allocation: { usedBytes: info.usedBytes, quotaBytes: info.quotaBytes, remainingBytes: info.remainingBytes },
  };
}

/** One cached image by repotag or digest, or null if this owner has none. */
async function getImageDetail(fluxId, identifier) {
  const records = await imageCacheStore.listImagesForFluxId(fluxId);
  if (records === null) throw new Error('Image cache lookup is temporarily unavailable');
  const match = records.find((r) => r.repotag === identifier || r.digest === identifier);
  return match ? recordView(match) : null;
}

// Whether any container (running OR stopped) is built from this cached image, so the
// image must NOT be removed. Matches by imageId (robust across tags) with a repotag
// fallback. Fail-safe: if containers can't be listed, assume in use (keep the image).
async function imageInUseByContainer(repotag, imageId) {
  let containers;
  try {
    containers = await dockerService.dockerListContainers(true);
  } catch (err) {
    log.warn(`imageCache - cannot verify container usage of ${repotag}, keeping image: ${err.message}`);
    return true;
  }
  return (containers || []).some((c) => (imageId && c.ImageID === imageId) || c.Image === repotag);
}

/**
 * Unpin one cached image (remove this owner's record), then reclaim the docker image
 * ONLY if no other owner still pins it AND no app container references it. The usage is
 * pre-checked so an in-use image is never even offered to docker for removal; the
 * non-forced remove's 409 is kept only as a TOCTOU backstop for the redeploy race.
 * Returns { found, removed, imageRemoved, message }.
 */
async function deleteImage(fluxId, identifier) {
  const records = await imageCacheStore.listImagesForFluxId(fluxId);
  if (records === null) throw new Error('Image cache delete is temporarily unavailable');
  const match = records.find((r) => r.repotag === identifier || r.digest === identifier);
  if (!match) return { found: false, removed: false, imageRemoved: false, message: 'No such cached image for this owner' };

  await imageCacheStore.removeImage(fluxId, match.repotag);

  // Another owner may pin the same repotag (one shared docker image, many records).
  const otherPins = await imageCacheStore.findPinsForRepotag(match.repotag);
  const stillPinned = otherPins === null || otherPins.some((p) => p.state !== 'failed');
  if (stillPinned) {
    return { found: true, removed: true, imageRemoved: false, message: 'Unpinned; image kept (still pinned by another owner)' };
  }

  // Pre-check: don't even attempt removal of an image an app is using.
  if (await imageInUseByContainer(match.repotag, match.imageId)) {
    return { found: true, removed: true, imageRemoved: false, message: 'Unpinned; image kept (in use by an app container)' };
  }

  try {
    await dockerService.appDockerImageRemove(match.repotag);
    return { found: true, removed: true, imageRemoved: true, message: 'Unpinned and image removed' };
  } catch (err) {
    // Backstop only: a container could have appeared between the check and the remove.
    return { found: true, removed: true, imageRemoved: false, message: `Unpinned; image kept (appeared in use): ${err.message}` };
  }
}

module.exports = {
  submit,
  submitEncrypted,
  getJob,
  listImages,
  getImageDetail,
  deleteImage,
  reconcilePinnedImage,
  pruneExpiredJobs,
};
