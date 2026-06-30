const crypto = require('crypto');
const config = require('config');
const log = require('../../lib/log');
const serviceHelper = require('../serviceHelper');
const dockerService = require('../dockerService');
const imageManager = require('../appSecurity/imageManager');
const imageCacheStore = require('./imageCacheStore');
const imageCacheQuota = require('./imageCacheQuota');
const imageCacheDownloader = require('./imageCacheDownloader');
const { ImageProgress } = require('./imageCacheProgress');

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
    if (match) return { sizeOnDiskBytes: match.Size || 0, imageId: match.Id || null };
  } catch (err) {
    log.warn(`imageCache - reconcileSize ${repotag} failed: ${err.message}`);
  }
  return { sizeOnDiskBytes: Math.round((compressedBytes || 0) * 2), imageId: null };
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
  };

  try {
    await pullWithRetry(job, image, onProgress);
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

module.exports = {
  submit,
  getJob,
  pruneExpiredJobs,
};
