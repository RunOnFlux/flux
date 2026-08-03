const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const jobRegistry = require('../utils/jobRegistry');
const log = require('../../lib/log');

// The one status resource for every long-running operation this node accepts.
// Endpoints that start work answer 202 with a job handle and point here; this
// owns the polling contract so no endpoint has to invent one.

/**
 * The FluxID a caller is authenticated as, or null. Jobs registered with an
 * owner are only readable by that identity; jobs registered without one treat
 * the jobId itself as the capability.
 */
async function callerFluxId(req) {
  const authorized = await verificationHelper.verifyPrivilege('user', req);
  if (!authorized) return null;
  const auth = serviceHelper.ensureObject(req.headers.zelidauth);
  return auth ? auth.zelid : null;
}

/**
 * Shape a 202 for an endpoint that has just started work. Location and
 * Operation-Id are the RFC 9110 / Azure long-running-operation spelling; the
 * body repeats them so a client that cannot read headers is not stuck.
 *
 * @param {import('express').Response} res
 * @param {{jobId: string, statusUrl: string}} handle
 * @param {object} [extra] additional body fields the endpoint wants echoed
 */
function accepted(res, handle, extra = {}) {
  res.setHeader('Location', handle.statusUrl);
  res.setHeader('Operation-Id', handle.jobId);
  res.setHeader('Retry-After', String(jobRegistry.retryAfterSeconds()));
  return res.status(202).json(messageHelper.createDataMessage({
    jobId: handle.jobId,
    statusUrl: handle.statusUrl,
    status: jobRegistry.JobStatus.RUNNING,
    ...extra,
  }));
}

/**
 * How far through an operation's line-numbered output the caller has already
 * read. Anything that is not a non-negative whole number is treated as no
 * cursor at all - a client sending nonsense gets the whole retained view rather
 * than a silently truncated one.
 *
 * @param {import('express').Request} req
 * @returns {number} 0 when absent or unusable
 */
function readCursor(req) {
  const raw = req.query && req.query.sinceSeq;
  if (raw === undefined || raw === null || raw === '') return 0;
  const seq = Number(raw);
  if (!Number.isSafeInteger(seq) || seq < 0) return 0;
  return seq;
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getOperation(req, res) {
  try {
    const jobId = req.params.jobId || (req.query && req.query.jobId);
    if (!jobId) {
      return res.status(400).json(messageHelper.createErrorMessage('Missing jobId'));
    }

    const view = jobRegistry.get(jobId, await callerFluxId(req), { sinceSeq: readCursor(req) });
    // Unknown, expired and not-yours are one answer: a jobId must not tell a
    // caller whether someone else has an operation running.
    if (!view) {
      return res.status(404).json(messageHelper.createErrorMessage('Operation not found'));
    }

    // A running operation is a 200 with a non-terminal body. Completion is read
    // from the status field, never inferred from the HTTP code - a failed
    // operation is still a successful poll.
    if (jobRegistry.isTerminal(view.status)) {
      res.setHeader('Expires', new Date(view.lastUpdatedAt + 60 * 60 * 1000).toUTCString());
    } else {
      res.setHeader('Retry-After', String(jobRegistry.retryAfterSeconds()));
    }

    return res.json(messageHelper.createDataMessage(view));
  } catch (error) {
    log.error(`operationsController getOperation: ${error.message}`);
    return res.status(500).json(messageHelper.createErrorMessage(error.message));
  }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function cancelOperation(req, res) {
  try {
    const { jobId } = req.params;
    if (!jobId) {
      return res.status(400).json(messageHelper.createErrorMessage('Missing jobId'));
    }

    const owner = await callerFluxId(req);
    const view = jobRegistry.get(jobId, owner);
    if (!view) {
      return res.status(404).json(messageHelper.createErrorMessage('Operation not found'));
    }

    // Best effort, and said so plainly: the flag is raised here and the worker
    // stops at its next checkpoint, so the status stays Running until it does.
    const requested = jobRegistry.requestCancel(jobId);
    return res.json(messageHelper.createDataMessage({
      jobId,
      cancelRequested: requested,
      status: jobRegistry.get(jobId, owner).status,
    }));
  } catch (error) {
    log.error(`operationsController cancelOperation: ${error.message}`);
    return res.status(500).json(messageHelper.createErrorMessage(error.message));
  }
}

module.exports = {
  accepted,
  getOperation,
  cancelOperation,
};
