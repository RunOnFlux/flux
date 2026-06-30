const config = require('config');
const messageHelper = require('../messageHelper');
const serviceHelper = require('../serviceHelper');
const verificationHelper = require('../verificationHelper');
const enterpriseNetwork = require('../utils/enterpriseNetwork');
const log = require('../../lib/log');
const imageCacheService = require('../appLifecycle/imageCacheService');

// API handlers for the enterprise image cache. This layer owns req/res ONLY: gate +
// authenticate, parse the request, delegate to imageCacheService, and shape the
// response. No business logic lives here.

const isArcane = Boolean(process.env.FLUXOS_PATH);

function sendError(res, status, message) {
  return res.status(status).json(messageHelper.createErrorMessage(message));
}

function kindToStatus(kind) {
  if (kind === 'bad-request') return 400;
  if (kind === 'over-capacity') return 507;
  return 500;
}

/**
 * Gate + authenticate. The feature must be enabled, the node enterprise (Arcane), the
 * caller validly signed, and the signing FluxID an owner allowed on THIS node.
 * @returns {Promise<{fluxId:string}|{error:{status:number,message:string}}>}
 */
async function authorizeOwner(req) {
  if (!config.fluxapps.imageCacheEnabled || !isArcane || enterpriseNetwork.getCachedEnterpriseIdentity() !== true) {
    return { error: { status: 403, message: 'Image cache is not available on this node' } };
  }
  const authorized = await verificationHelper.verifyPrivilege('user', req);
  if (!authorized) {
    return { error: { status: 401, message: 'Unauthorized' } };
  }
  const auth = serviceHelper.ensureObject(req.headers.zelidauth);
  const fluxId = auth ? auth.zelid : null;
  const allowed = enterpriseNetwork.getCachedAllowedOwnersForNode() || [];
  if (!fluxId || !allowed.includes(fluxId)) {
    return { error: { status: 403, message: 'This FluxID is not an allowed image-cache owner on this node' } };
  }
  return { fluxId };
}

async function postImageCache(req, res) {
  try {
    const authz = await authorizeOwner(req);
    if (authz.error) return sendError(res, authz.error.status, authz.error.message);

    const body = serviceHelper.ensureObject(req.body);
    const encrypted = body ? body.data : null;
    if (!encrypted || typeof encrypted !== 'string') {
      return sendError(res, 400, 'Missing encrypted "data" payload');
    }

    const { jobId } = await imageCacheService.submitEncrypted(authz.fluxId, encrypted);
    return res.status(202).json(messageHelper.createDataMessage({ jobId, statusUrl: `/apps/imagecache/status/${jobId}` }));
  } catch (err) {
    if (err.kind) return sendError(res, kindToStatus(err.kind), err.message);
    log.error(`imageCacheController postImageCache: ${err.message}`);
    return sendError(res, 500, err.message);
  }
}

async function getImageCacheStatus(req, res) {
  try {
    const authz = await authorizeOwner(req);
    if (authz.error) return sendError(res, authz.error.status, authz.error.message);

    const jobId = req.params.jobId || (req.query && req.query.jobId);
    if (!jobId) return sendError(res, 400, 'Missing jobId');

    const job = imageCacheService.getJob(jobId, authz.fluxId);
    if (!job) return sendError(res, 404, 'Job not found');
    return res.json(messageHelper.createDataMessage(job));
  } catch (err) {
    log.error(`imageCacheController getImageCacheStatus: ${err.message}`);
    return sendError(res, 500, err.message);
  }
}

async function getImageCacheList(req, res) {
  try {
    const authz = await authorizeOwner(req);
    if (authz.error) return sendError(res, authz.error.status, authz.error.message);

    const result = await imageCacheService.listImages(authz.fluxId);
    return res.json(messageHelper.createDataMessage(result));
  } catch (err) {
    log.error(`imageCacheController getImageCacheList: ${err.message}`);
    return sendError(res, 500, err.message);
  }
}

async function getImageCacheItem(req, res) {
  try {
    const authz = await authorizeOwner(req);
    if (authz.error) return sendError(res, authz.error.status, authz.error.message);

    const identifier = req.query ? req.query.identifier : null;
    if (!identifier) return sendError(res, 400, 'Missing identifier (repotag or digest)');

    const item = await imageCacheService.getImageDetail(authz.fluxId, identifier);
    if (!item) return sendError(res, 404, 'No such cached image');
    return res.json(messageHelper.createDataMessage(item));
  } catch (err) {
    log.error(`imageCacheController getImageCacheItem: ${err.message}`);
    return sendError(res, 500, err.message);
  }
}

async function removeImageCache(req, res) {
  try {
    const authz = await authorizeOwner(req);
    if (authz.error) return sendError(res, authz.error.status, authz.error.message);

    const body = serviceHelper.ensureObject(req.body);
    const identifier = (body && body.identifier) || (req.query && req.query.identifier);
    if (!identifier) return sendError(res, 400, 'Missing identifier (repotag or digest)');

    const result = await imageCacheService.deleteImage(authz.fluxId, identifier);
    if (!result.found) return sendError(res, 404, result.message);
    return res.json(messageHelper.createDataMessage(result));
  } catch (err) {
    log.error(`imageCacheController removeImageCache: ${err.message}`);
    return sendError(res, 500, err.message);
  }
}

module.exports = {
  postImageCache,
  getImageCacheStatus,
  getImageCacheList,
  getImageCacheItem,
  removeImageCache,
};
