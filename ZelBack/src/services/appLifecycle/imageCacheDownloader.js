const util = require('util');
const config = require('config');
const dockerService = require('../dockerService');
const { ImageVerifier } = require('../utils/imageVerifier');
const registryCredentialHelper = require('../utils/registryCredentialHelper');
const { systemArchitecture } = require('../appSystem/systemIntegration');
const { supportedArchitectures } = require('../utils/appConstants');

// Per-image pull mechanics for the enterprise image cache: read the remote manifest
// (compressed size + digest, no layers pulled) for the admission decision, and pull
// the image into the local docker store while forwarding raw progress events to a
// caller-supplied tap. Reuses the same ImageVerifier + registryCredentialHelper the
// app-install path uses, so private registries (Basic/ECR/GAR/ACR) work identically.
// Credentials are resolved transiently per call and never persisted.

const dockerPullStreamPromise = util.promisify(dockerService.dockerPullStream);

// The image-cache payload is decrypted with the v8 enterprise envelope, so each
// image's repoauth arrives as plaintext — resolve credentials as a v8 spec (no PGP).
// This selects the credential-decoding mode; it is not a real on-chain app version.
const CACHE_SPEC_VERSION = 8;

// Per-owner key for the registry-auth provider token cache (cloud providers cache
// short-lived tokens against it), so one owner's creds never reuse another's.
function credentialCacheKey(fluxId) {
  return `imagecache:${fluxId}`;
}

async function resolveCredentials(repotag, repoauth, fluxId) {
  if (!repoauth) return null;
  const credentials = await registryCredentialHelper.getCredentials(
    repotag,
    repoauth,
    CACHE_SPEC_VERSION,
    credentialCacheKey(fluxId),
  );
  if (!credentials) throw new Error('Unable to resolve registry credentials');
  return credentials;
}

/**
 * Read the remote manifest (no layers pulled) to learn the COMPRESSED download size
 * and digest for this node's architecture, and whether the image is usable here.
 * Resilient: returns a structured result instead of throwing, so the job manager can
 * record a per-image disposition without failing the whole submission.
 * @param {string} repotag
 * @param {string} repoauth - plaintext registry auth (already decrypted), or falsy
 * @param {object} [opts] - { fluxId }
 * @returns {Promise<{ok:boolean, compressedBytes:number, digest:(string|null), supported:boolean, supportedArchitectures:string[], error:(string|null)}>}
 */
async function inspectImage(repotag, repoauth, opts = {}) {
  try {
    const architecture = await systemArchitecture();
    const credentials = await resolveCredentials(repotag, repoauth, opts.fluxId);
    const verifier = new ImageVerifier(repotag, {
      maxImageSize: config.fluxapps.maxImageSize,
      architecture,
      architectureSet: supportedArchitectures,
      ...(credentials ? { credentials } : {}),
    });
    await verifier.verifyImage();
    if (verifier.error) {
      return {
        ok: false,
        compressedBytes: 0,
        digest: null,
        supported: false,
        supportedArchitectures: verifier.supportedArchitectures,
        error: verifier.errorDetail || 'image verification failed',
      };
    }
    const digest = await verifier.fetchManifestDigestOnly();
    return {
      ok: true,
      compressedBytes: verifier.compressedSize,
      digest,
      supported: verifier.supported,
      supportedArchitectures: verifier.supportedArchitectures,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      compressedBytes: 0,
      digest: null,
      supported: false,
      supportedArchitectures: [],
      error: err.message || String(err),
    };
  }
}

/**
 * Pull (download + extract) an image into the local docker store, forwarding each
 * raw dockerode progress event to onProgress. Resolves on completion; rejects on a
 * pull or abort error. Credentials are used transiently and never stored.
 * @param {object} params - { repotag, repoauth, fluxId, onProgress, abortSignal }
 */
async function pullImage(params) {
  const {
    repotag, repoauth, fluxId, onProgress, abortSignal,
  } = params;
  const credentials = await resolveCredentials(repotag, repoauth, fluxId);
  const pullConfig = { repoTag: repotag };
  if (credentials) {
    pullConfig.authConfig = credentials;
    // serveraddress for the authconfig (Docker Hub resolves to registry-1.docker.io)
    pullConfig.provider = new ImageVerifier(repotag, {}).provider;
  }
  if (typeof onProgress === 'function') pullConfig.progressTap = onProgress;
  if (abortSignal) pullConfig.abortSignal = abortSignal;
  await dockerPullStreamPromise(pullConfig, null);
}

module.exports = {
  inspectImage,
  pullImage,
};
