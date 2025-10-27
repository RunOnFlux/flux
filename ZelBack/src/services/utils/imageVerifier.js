const serviceHelper = require('../serviceHelper');

const { AsyncLock } = require('./asyncLock');

/**
 * Docker Architecture
 * @typedef {"amd64" | "arm64"} Architecture
 */

class ImageVerifier {
  static defaultDockerRegistry = 'registry-1.docker.io';

  static imagePattern = /^(?:(?<provider>(?:(?:[\w-]+(?:\.[\w-]+)+)(?::\d+)?)|[\w]+:\d+)\/)?\/?(?<namespace>(?:(?:[a-z0-9]+(?:(?:[._]|__|[-]*)[a-z0-9]+)*)\/){0,2})(?<repository>[a-z0-9-_.]+\/{0,1}[a-z0-9-_.]+)[:]?(?<tag>[\w][\w.-]{0,127})?/;

  static wwwAuthHeaderPattern = /(?<scheme>Bearer|Basic)\s+realm="(?<realm>[^"]+)"(?:,\s*service="(?<service>[^"]+)")?(?:,\s*scope="(?<scope>[^"]+)")?/;

  static supportedMediaTypes = [
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json',
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
  ];

  static whitelistedImages = [];

  static lastWhitelistFetchTime = 0;

  static resetWhitelist() {
    ImageVerifier.whitelistedImages = [];
    ImageVerifier.lastWhitelistFetchTime = 0;
  }

  /**
   * Parse www-authenticate header
   * @param {string} authHeader # www-auth header
   * @returns {object} Object of parsed header - {realm, service, scope}
   */
  static parseAuthHeader(header) {
    const match = ImageVerifier.wwwAuthHeaderPattern.exec(header);

    if (!match) return null;

    return { ...match.groups };
  }

  static fetchLock = new AsyncLock();

  #abortController = new AbortController();

  #axiosInstance = null;

  #evaluationErrorDetail = '';

  #lookupErrorDetail = '';

  #parseErrorDetail = '';

  #lookupErrorMeta = null; // Stores { httpStatus, errorCode, errorType }

  #architectureSupported = false;

  authConfigured = false;

  authVerified = false;

  evaluated = false;

  ambiguous = false;

  credentials = null;

  provider = null;

  namespace = null;

  repository = null;

  tag = null;

  /**
   * @param {string} imageTag
   * @param {{credentials?: string, architecture?: Architecture, architectureSet?: Array<Architecture>}} options
   */
  constructor(imageTag, options = {}) {
    if (typeof imageTag !== 'string') {
      this.#parseErrorDetail = 'Invalid Docker Image Tag';
      return;
    }

    this.rawImageTag = imageTag;

    this.architecture = options.architecture || 'amd64';
    this.architectureSet = options.architectureSet || ['amd64', 'arm64'];
    this.maxImageSize = options.maxImageSize || 2_000_000_000; // 2Gb

    if (options.credentials) this.addCredentials(options.credentials);

    this.#parseDockerTag();

    if (!this.parseError) this.#createAxiosInstance();
  }

  get parseError() {
    return Boolean(this.#parseErrorDetail);
  }

  get lookupError() {
    return Boolean(this.#lookupErrorDetail);
  }

  get evaluationError() {
    return Boolean(this.#evaluationErrorDetail);
  }

  get error() {
    return this.parseError || this.lookupError || this.evaluationError;
  }

  get errorDetail() {
    return this.#lookupErrorDetail || this.#parseErrorDetail || this.#evaluationErrorDetail || '';
  }

  get errorMeta() {
    return this.#lookupErrorMeta;
  }

  get parts() {
    const parts = [this.provider, this.namespace, this.repository, this.tag];
    return parts.filter((x) => x);
  }

  get useable() {
    return this.parts.length === 4;
  }

  /**
   * If this image can run on the Flux network.
   */
  get verified() {
    return this.evaluated && !this.error && this.useable;
  }

  /**
   * If this image can run on this Fluxnode.
   */
  get supported() {
    return this.verified && this.#architectureSupported;
  }

  #createAxiosInstance() {
    this.#axiosInstance = serviceHelper.axiosInstance({
      baseURL: `https://${this.provider}/v2/`,
      timeout: 20_000,
      signal: this.#abortController.signal,
      headers: { Accept: ImageVerifier.supportedMediaTypes.join(', ') },
    });
  }

  async #fetchWhitelist() {
    // ToDo: use etag
    if (
      this.error
      && !this.#lookupErrorDetail.match('Unable to fetch whitelisted repositories')
    ) {
      return;
    }

    const now = Number(process.hrtime.bigint() / BigInt(1_000_000_000));

    await ImageVerifier.fetchLock.enable();

    try {
      if (
        ImageVerifier.whitelistedImages.length
        && ImageVerifier.lastWhitelistFetchTime + 600 > now
      ) return;

      const { data } = await serviceHelper
        .axiosGet(
          'https://raw.githubusercontent.com/RunOnFlux/flux/master/helpers/repositories.json',
          { timeout: 20_000 },
        )
        .catch((err) => {
          this.#lookupErrorDetail = 'Unable to fetch whitelisted repositories. Try again later.';
          this.#lookupErrorMeta = {
            httpStatus: err?.response?.status || null,
            errorCode: err?.code || null,
            errorType: 'whitelist_fetch_error',
          };
          return { data: [] };
        });

      ImageVerifier.lastWhitelistFetchTime = now;

      // this could throw if data not array
      if (data.length) ImageVerifier.whitelistedImages = data;
    } finally {
      ImageVerifier.fetchLock.disable();
    }
  }

  #parseDockerTag() {
    if (this.error) return;

    if (/\s/.test(this.rawImageTag)) {
      this.#parseErrorDetail = `Image tag: "${this.rawImageTag}" should not contain space characters.`;
      return;
    }

    if (this.rawImageTag.startsWith('/') || this.rawImageTag.endsWith('/')) {
      this.#parseErrorDetail = `Image tag: "${this.rawImageTag}" cannot start or end with a backslash.`;
      return;
    }

    const match = ImageVerifier.imagePattern.exec(this.rawImageTag);

    if (match === null) {
      this.#parseErrorDetail = `Image tag: ${this.rawImageTag} is not in valid format [HOST[:PORT_NUMBER]/][NAMESPACE/]REPOSITORY[:TAG]`;
      return;
    }

    const {
      groups: {
        provider, namespace, repository, tag,
      },
    } = match;

    this.provider = provider || ImageVerifier.defaultDockerRegistry;

    // Without doing a lookup against the dockerhub library, no way to know if a single string is
    // an image or a namespace
    if (tag === undefined) {
      if (this.provider === ImageVerifier.defaultDockerRegistry) {
        // we can't tell, so we set namespace to repository if no namespace
        this.namespace = namespace || repository;
        this.repository = namespace ? repository : '';
        this.tag = tag;
        this.ambiguous = this.repository === '';
      } else {
        // registry
        this.namespace = namespace;
        this.repository = repository;
        this.tag = '';
        // a registry is ambiguous as you can have multiple / in both namespace and repository,
        // and we don't know how it is split, until we get a tag
        this.ambiguous = true;
      }
    } else {
      // we have certainty that the image parts that we have are correct
      // Docker Hub uses 'library' namespace for official images, but other registries don't use default namespaces
      // this would be better to lookup against dockerhub library (only 150 odd images to pull via api)
      const isDockerHub = this.provider === ImageVerifier.defaultDockerRegistry
      const defaultNamespace = isDockerHub ? 'library' : '';

      this.namespace = namespace || defaultNamespace;
      this.repository = repository;
      this.tag = tag;
      this.ambiguous = false;
    }

    // ToDo: update regex so we don't have to strip last namespace /
    if (this.namespace.slice(-1) === '/') {
      this.namespace = this.namespace.slice(0, -1);
    }
  }

  /**
   * To fetch an auth token from registry auth provider.
   * @param {object} authDetails Parsed www-authenticate header.
   */
  async #handleAuth(authDetails) {
    const { scheme, realm, service, scope } = authDetails;

    // For Basic auth (AWS ECR), use credentials directly without token exchange
    if (scheme === 'Basic') {
      if (!this.credentials) {
        this.#lookupErrorDetail = `Basic authentication required but no credentials provided`;
        return;
      }

      // Set up Basic auth interceptor for all subsequent requests
      this.#axiosInstance.interceptors.request.use((config) => {
        const authString = `${this.credentials.username}:${this.credentials.password}`;
        const base64Auth = Buffer.from(authString).toString('base64');
        // eslint-disable-next-line no-param-reassign
        config.headers.Authorization = `Basic ${base64Auth}`;
        return config;
      });

      this.authConfigured = true;
      this.authVerified = false; // Not verified yet - will be tested on retry
      return;
    }

    // For Bearer auth (Docker Hub, etc.), do token exchange
    const {
      data: { token },
    } = await serviceHelper
      .axiosGet(`${realm}?service=${service}&scope=${scope}`, { auth: this.credentials })
      .catch((err) => {
        const status = err?.response?.status;

        if (status === 401) {
          this.#lookupErrorDetail = `Authentication rejected for: ${this.rawImageTag}`;
          this.#lookupErrorMeta = {
            httpStatus: 401,
            errorCode: null,
            errorType: 'auth_rejected',
          };
        } else {
          this.#lookupErrorDetail = `Authentication token from ${realm} for ${scope} not available`;
          this.#lookupErrorMeta = {
            httpStatus: status || null,
            errorCode: null,
            errorType: 'auth_unavailable',
          };
        }
        return { data: { token: null } };
      });

    if (!token) return;

    this.authConfigured = true;
    this.authVerified = true; // Verified at realm endpoint
    this.#axiosInstance.interceptors.request.use((config) => {
      // eslint-disable-next-line no-param-reassign
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
  }

  async #handleAxiosError(endpointUrl, error) {
    const connectionErrors = [
      'ECONNREFUSED',
      'ECONNABORTED',
      'ERR_CANCELED',
      'ENETUNREACH',
    ];

    if (connectionErrors.includes(error.code)) {
      this.#lookupErrorDetail = `Connection Error ${error.code}: ${this.rawImageTag} not available`;
      this.#lookupErrorMeta = {
        httpStatus: null,
        errorCode: error.code,
        errorType: 'network',
      };
      return { data: null };
    }

    const httpStatus = error.response?.status;

    if (httpStatus !== 401) {
      this.#lookupErrorDetail = `Bad HTTP Status ${httpStatus}: ${this.rawImageTag} not available`;
      this.#lookupErrorMeta = {
        httpStatus,
        errorCode: null,
        errorType: httpStatus === 429 ? 'rate_limit' : (httpStatus >= 500 ? 'server_error' : 'http_error'),
      };
      return { data: null };
    }

    if (this.authConfigured) {
      // This is the second 401 - we already set up auth and retried
      if (this.authVerified) {
        // Bearer: Credentials were verified at realm endpoint, so image doesn't exist
        this.#lookupErrorDetail = `Authentication failed: ${this.rawImageTag} not available or doesn't exist`;
        this.#lookupErrorMeta = {
          httpStatus: 401,
          errorCode: null,
          errorType: 'auth_failed',
        };
      } else {
        // Basic: Credentials weren't verified yet, so they must be invalid
        this.#lookupErrorDetail = `Authentication rejected for: ${this.rawImageTag}`;
        this.#lookupErrorMeta = {
          httpStatus: 401,
          errorCode: null,
          errorType: 'auth_rejected',
        };
      }
      return { data: null };
    }

    const authDetails = ImageVerifier.parseAuthHeader(
      error.response.headers['www-authenticate'],
    );

    if (!authDetails) {
      this.#lookupErrorDetail = `Malformed Auth Header: ${this.rawImageTag} not available`;
      this.#lookupErrorMeta = {
        httpStatus: 401,
        errorCode: null,
        errorType: 'auth_error',
      };
      return { data: null };
    }

    await this.#handleAuth(authDetails);

    if (!this.authConfigured) return { data: null };

    return this.#axiosInstance
      .get(endpointUrl)
      .catch((err) => this.#handleAxiosError(endpointUrl, err));
  }

  async #evaluateImageManifest(manifestIndex) {
    this.evaluated = true;

    const evaluateSingleImage = async (manifest, architecture) => {
      let size = 0;
      let arch = architecture;

      // this can happen if we ask for a manifest list, but only get a manifest. If
      // so, we need to look up the image config to get the arch.
      if (!arch) {
        const imageConfig = await this.#fetchConfig(manifest.config.digest);
        if (this.error) return;

        arch = imageConfig.architecture;
      }

      manifest.layers.forEach((layer) => {
        size += layer.size;
      });

      if (size > this.maxImageSize) {
        this.#evaluationErrorDetail = `Docker image: ${this.rawImageTag} size is over Flux limit`;
        this.#lookupErrorMeta = {
          httpStatus: null,
          errorCode: null,
          errorType: 'size_limit',
        };
      }

      if (this.architecture === arch) this.#architectureSupported = true;
    };

    const evaluateMultipleImages = async (manifest) => {
      const images = manifest.manifests.filter((m) => this.architectureSet.includes(m.platform.architecture));

      if (!images.length) {
        this.#evaluationErrorDetail = `Docker image: ${this.rawImageTag} does not have a valid architecture`;
        this.#lookupErrorMeta = {
          httpStatus: null,
          errorCode: null,
          errorType: 'unsupported_architecture',
        };
        return;
      }

      // Can't remember 100% but think it's AWS that rate limits to 1/s if not authed.
      // eslint-disable-next-line no-restricted-syntax
      for (const image of images) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => {
          setTimeout(r, 1_000);
        });
        // eslint-disable-next-line no-await-in-loop
        const singleManifest = await this.#fetchManifest(image.digest);

        if (this.error) return;
        // eslint-disable-next-line no-await-in-loop
        await evaluateSingleImage(singleManifest, image.platform.architecture);
      }
    };

    const { mediaType } = manifestIndex;

    switch (mediaType) {
      case 'application/vnd.oci.image.index.v1+json':
        await evaluateMultipleImages(manifestIndex);
        break;
      case 'application/vnd.oci.image.manifest.v1+json':
        await evaluateSingleImage(manifestIndex);
        break;
      case 'application/vnd.docker.distribution.manifest.list.v2+json':
        await evaluateMultipleImages(manifestIndex);
        break;
      case 'application/vnd.docker.distribution.manifest.v2+json':
        await evaluateSingleImage(manifestIndex);
        break;
      default:
        this.#evaluationErrorDetail = `Unsupported Media type: ${mediaType} for: ${this.rawImage}`;
        this.#lookupErrorMeta = {
          httpStatus: null,
          errorCode: null,
          errorType: 'unsupported_media_type',
        };
    }
  }

  async #fetchManifest(digest) {
    const manifestEndpoint = this.namespace
      ? `${this.namespace}/${this.repository}/manifests/${digest}`
      : `${this.repository}/manifests/${digest}`;

    const { data: imageManifest } = await this.#axiosInstance
      .get(manifestEndpoint)
      .catch((error) => this.#handleAxiosError(manifestEndpoint, error));

    return imageManifest;
  }

  async #fetchConfig(digest) {
    const blobsEndpoint = this.namespace
      ? `${this.namespace}/${this.repository}/blobs/${digest}`
      : `${this.repository}/blobs/${digest}`;

    const { data: imageConfig } = await this.#axiosInstance
      .get(blobsEndpoint)
      .catch((error) => this.#handleAxiosError(blobsEndpoint, error));

    return imageConfig;
  }

  /**
   * Adds credentials to the verifier.
   * @param {string|object} credentials - Either "username:password" string or {username, password} object
   */
  addCredentials(credentials) {
    // Accept object format (preferred - avoids parsing issues with passwords containing colons)
    if (credentials && typeof credentials === 'object' && credentials.username && credentials.password) {
      this.credentials = {
        username: credentials.username,
        password: credentials.password
      };
      return;
    }

    // Accept string format (backward compatible)
    // Use indexOf + substring to handle passwords containing colons correctly
    if (credentials && typeof credentials === 'string') {
      const colonIndex = credentials.indexOf(':');
      if (colonIndex === -1) {
        this.credentials = null;
        return;
      }

      const username = credentials.substring(0, colonIndex);
      const password = credentials.substring(colonIndex + 1);
      this.credentials = username && password ? { username, password } : null;
      return;
    }

    this.credentials = null;
  }

  resetErrors() {
    this.#parseErrorDetail = null;
    this.#lookupErrorDetail = null;
    this.#evaluationErrorDetail = null;
    this.#lookupErrorMeta = null;
  }

  /**
   * Allows for descriptive errors to be throw if there are any errors present.
   * @returns {void}
   */
  throwIfError() {
    if (!this.error) return;

    try {
      throw new Error(
        this.#parseErrorDetail
        || this.#lookupErrorDetail
        || this.#evaluationErrorDetail,
      );
    } finally {
      this.resetErrors();
    }
  }

  /**
   * Allows for any long running axios requests to be aborted
   */
  abort() {
    this.#abortController.abort();
  }

  async isWhitelisted() {
    await this.#fetchWhitelist();

    if (this.error) return false;

    if (!this.useable) {
      this.#evaluationErrorDetail = `Image Tag: ${this.rawImageTag} is not in valid format [HOST[:PORT_NUMBER]/][NAMESPACE/]REPOSITORY:TAG`;
      this.#lookupErrorMeta = {
        httpStatus: null,
        errorCode: null,
        errorType: 'invalid_format',
      };
      return false;
    }

    const separators = ['/', ':'];

    const whitelisted = ImageVerifier.whitelistedImages.find(
      // doesn't matter if rawImageTag is shorter than img
      (otherTag) => {
        const len = otherTag.length;
        const thisTag = this.rawImageTag;

        return (
          thisTag === otherTag
          || (thisTag.slice(0, len) === otherTag
            && separators.includes(thisTag.slice(len, len + 1)))
        );
      },
    );

    if (!whitelisted) {
      this.#evaluationErrorDetail = 'Repository is not whitelisted. Please contact Flux Team.';
      this.#lookupErrorMeta = {
        httpStatus: null,
        errorCode: null,
        errorType: 'not_whitelisted',
      };
    }

    return Boolean(whitelisted);
  }

  /**
   * Checks that the image is available for the provided architecture set, and that the image's size
   * is less that the configured maximum image size, for the provided architecture set.
   * @returns {Promise<boolean>}
   */
  async verifyImage() {
    if (this.error) return false;

    const imageManifest = await this.#fetchManifest(this.tag);

    if (!imageManifest) return false;

    if (imageManifest.schemaVersion !== 2) {
      this.#lookupErrorDetail = `Unsupported schemaVersion: ${imageManifest.schemaVersion} for: ${this.rawImageTag}`;
      this.#lookupErrorMeta = {
        httpStatus: null,
        errorCode: null,
        errorType: 'unsupported_schema',
      };
      return false;
    }

    await this.#evaluateImageManifest(imageManifest);

    return this.verified;
  }
}

module.exports = { ImageVerifier };
