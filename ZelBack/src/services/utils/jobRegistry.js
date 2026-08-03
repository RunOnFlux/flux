const crypto = require('crypto');
const config = require('config');
const log = require('../../lib/log');

// One registry for every long-running operation a node accepts, so a client
// polls one URL family, reads one status field and gets one error shape no
// matter which endpoint started the work. Before this, each feature invented
// its own: one said `settled: true`, another `state: 'done'`, neither sent a
// Retry-After, and a client had to know which endpoint it had called to know
// how to read the answer.
//
// Deliberately in-memory and node-local. The work these track is node-local
// too, so a job lost to a restart costs a re-ask and nothing else - the same
// call the client makes when a poll 404s.

const NS_PER_MS = 1_000_000n;

const JobStatus = Object.freeze({
  RUNNING: 'Running',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  CANCELED: 'Canceled',
  // The node took the work away. Distinct from both neighbours on purpose: a
  // cancel says the caller asked for this, and a failure says their input was at
  // fault. Neither is true here, and reporting it as either misattributes the
  // node's decision to the person it was made against.
  EVICTED: 'Evicted',
});

const TERMINAL = Object.freeze([
  JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELED, JobStatus.EVICTED,
]);

const jobs = new Map();

/**
 * An operation id, mintable before the operation is registered.
 *
 * The format lives here rather than at each caller so `op_` stays one fact.
 * @returns {string}
 */
function mintJobId() {
  return `op_${crypto.randomUUID()}`;
}

function retentionMs() {
  return config.fluxapps.operationRetentionMs ?? 60 * 60 * 1000;
}

/** How long a client should wait before polling again, while a job is running. */
function retryAfterSeconds() {
  return config.fluxapps.operationRetryAfterSeconds ?? 2;
}

function isTerminal(status) {
  return TERMINAL.includes(status);
}

function pruneExpired() {
  const now = process.hrtime.bigint();
  for (const [id, job] of jobs) {
    if (job.expiresAtNs !== null && now >= job.expiresAtNs) jobs.delete(id);
  }
}

function scheduleExpiry(job) {
  job.expiresAtNs = process.hrtime.bigint() + BigInt(retentionMs()) * NS_PER_MS;
}

/**
 * Normalize a failure to RFC 9457 problem+json. Accepts an Error or an already
 * shaped problem, so a caller can hand over whatever it has.
 *
 * Credentials are scrubbed rather than trusted not to appear: a registry auth
 * failure can carry a repoauth string in its message, and this ends up in a
 * response body.
 */
function toProblem(failure, jobId) {
  const problem = failure instanceof Error
    ? { title: failure.name || 'Error', detail: failure.message, status: 500 }
    : { title: 'Error', status: 500, ...failure };

  return {
    type: problem.type ?? 'about:blank',
    title: problem.title,
    status: problem.status,
    detail: scrubCredentials(problem.detail ?? ''),
    instance: `/apps/operations/${jobId}`,
    ...(problem.code ? { code: problem.code } : {}),
    ...(problem.retryAfterMs ? { retryAfterMs: problem.retryAfterMs } : {}),
  };
}

// Registry credentials reach error messages as "user:password" or as a
// provider:// config string. Neither belongs in a status response.
function scrubCredentials(detail) {
  if (typeof detail !== 'string' || !detail) return '';
  return detail
    .replace(/\b[\w.-]+:[^\s@/]{4,}@/g, '<credentials>@')
    .replace(/\b(?:aws|azure|gcp|gar|acr|ecr):\/\/\S+/gi, '<credentials>');
}

/**
 * Register a new operation.
 *
 * @param {object} params
 * @param {string} params.kind what the operation is, e.g. 'imagepreflight'
 * @param {string|null} [params.owner] the FluxID allowed to read it; null means
 *   the jobId alone is the capability
 * @param {() => object} [params.detail] called at read time for the operation's
 *   own payload, so a service keeps its domain state where it already lives
 *   instead of copying it in here on every transition
 * @param {() => void} [params.onCancel] called when a cancel is REQUESTED, so
 *   work that is waiting on something can be woken and see the flag. Without it
 *   a cancel is only observed the next time the work happens to look.
 * @param {string} [params.jobId] a caller-minted id, from mintJobId(). For work
 *   whose identity is needed BEFORE it is certain to run: the playground names
 *   its containers and network after its session, and has to do so while
 *   deciding whether to accept it - long before there is a job to poll. The
 *   registration still happens last, so a refusal is still an answer on the
 *   request rather than a job someone has to poll to discover.
 * @returns {{jobId: string, statusUrl: string}}
 */
function start(params) {
  pruneExpired();

  const {
    kind, owner = null, detail = null, onCancel = null,
  } = params;
  const jobId = params.jobId ?? mintJobId();
  const now = Date.now();

  jobs.set(jobId, {
    jobId,
    kind,
    owner,
    detail,
    onCancel,
    status: JobStatus.RUNNING,
    createdAt: now,
    lastUpdatedAt: now,
    progress: [],
    error: null,
    canceled: false,
    expiresAtNs: null,
  });

  return { jobId, statusUrl: statusUrlFor(jobId) };
}

function statusUrlFor(jobId) {
  return `/apps/operations/${jobId}`;
}

function touch(jobId) {
  const job = jobs.get(jobId);
  if (job) job.lastUpdatedAt = Date.now();
}

/**
 * Append one human-readable step. Progress is append-only and polls return the
 * whole array, so a client that missed a poll loses nothing and can diff by
 * index rather than parsing a stream.
 */
function progress(jobId, message) {
  const job = jobs.get(jobId);
  if (!job || isTerminal(job.status)) return;
  job.progress.push({ at: Date.now(), message });
  job.lastUpdatedAt = Date.now();
}

function succeed(jobId) {
  const job = jobs.get(jobId);
  if (!job || isTerminal(job.status)) return;
  job.status = JobStatus.SUCCEEDED;
  job.lastUpdatedAt = Date.now();
  scheduleExpiry(job);
}

function fail(jobId, failure) {
  const job = jobs.get(jobId);
  if (!job || isTerminal(job.status)) return;
  job.status = JobStatus.FAILED;
  job.error = toProblem(failure, jobId);
  job.lastUpdatedAt = Date.now();
  scheduleExpiry(job);
  log.warn(`Operation ${jobId} (${job.kind}) failed: ${job.error.detail}`);
}

/**
 * Best-effort cancel: the flag is raised here and the worker is expected to
 * notice at its next checkpoint, so a job is only Canceled once it has actually
 * stopped.
 */
function requestCancel(jobId) {
  const job = jobs.get(jobId);
  if (!job || isTerminal(job.status)) return false;
  job.canceled = true;
  job.lastUpdatedAt = Date.now();
  // A cancel is a thing that HAPPENED, so the work is told rather than left to
  // notice. An operation that waits on events would otherwise not see the flag
  // until whatever it is waiting for arrives - which for a quiet playground
  // session is its full fifteen-minute deadline.
  if (job.onCancel) {
    try {
      job.onCancel();
    } catch (err) {
      log.error(`Operation ${jobId} cancel handler failed: ${err.message}`);
    }
  }
  return true;
}

function isCanceled(jobId) {
  const job = jobs.get(jobId);
  return Boolean(job && job.canceled);
}

function cancelled(jobId) {
  const job = jobs.get(jobId);
  if (!job || isTerminal(job.status)) return;
  job.status = JobStatus.CANCELED;
  job.lastUpdatedAt = Date.now();
  scheduleExpiry(job);
}

/**
 * The node reclaimed what this operation was using.
 *
 * Carries a reason, because this is the one terminal state the caller had no
 * part in and cannot infer: a status alone would leave them looking for what
 * they did wrong.
 *
 * @param {string} jobId
 * @param {string} reason - shown to the caller as-is
 */
function evicted(jobId, reason) {
  const job = jobs.get(jobId);
  if (!job || isTerminal(job.status)) return;
  job.status = JobStatus.EVICTED;
  job.error = { title: 'Ended by the node', detail: reason, instance: statusUrlFor(jobId) };
  job.lastUpdatedAt = Date.now();
  scheduleExpiry(job);
  log.info(`Operation ${jobId} (${job.kind}) evicted: ${reason}`);
}

/**
 * The public view of an operation, or null when it is unknown, has aged out, or
 * belongs to someone else. Unknown and not-yours are the same answer on
 * purpose: a jobId must not be a probe for whether other people have jobs.
 *
 * @param {string} jobId
 * @param {string|null} [owner] the authenticated caller, when the job has one
 * @returns {object|null}
 */
function get(jobId, owner = null, readOptions = {}) {
  pruneExpired();

  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.owner !== null && job.owner !== owner) return null;

  return {
    jobId: job.jobId,
    kind: job.kind,
    status: job.status,
    createdAt: job.createdAt,
    lastUpdatedAt: job.lastUpdatedAt,
    progress: job.progress,
    error: job.error,
    // Built at read time, and given the reader's options: an operation whose
    // detail is a growing log needs to know where the caller got to.
    detail: job.detail ? job.detail(readOptions) : null,
  };
}

/** Test seam: drop every operation. */
function reset() {
  jobs.clear();
}

module.exports = {
  JobStatus,
  isTerminal,
  retryAfterSeconds,
  statusUrlFor,
  mintJobId,
  start,
  touch,
  progress,
  succeed,
  fail,
  requestCancel,
  isCanceled,
  cancelled,
  evicted,
  get,
  reset,
};
