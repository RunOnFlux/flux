// use default for typing
const axios = require('axios').default;
const { AsyncLock } = require('./asyncLock');

/**
 * Docker Architecture
 * @typedef {"amd64" | "arm64"} Architecture
 */

class ImageVerifier {
  static defaultDockerRegistry = 'registry-1.docker.io';

  static imagePattern = /^(?:(?<provider>(?:(?:[\w-]+(?:\.[\w-]+)+)(?::\d+)?)|[\w]+:\d+)\/)?\/?(?<namespace>(?:(?:[a-z0-9]+(?:(?:[._]|__|[-]*)[a-z0-9]+)*)\/){0,2})(?<repository>[a-z0-9-_.]+\/{0,1}[a-z0-9-_.]+)[:]?(?<tag>[\w][\w.-]{0,127})?/;

  static wwwAuthHeaderPattern = /Bearer realm="(?<realm>(?:[0-9a-z:\-./]*?))"(?:,service="(?<service>(?:[0-9a-z:\-./]*?))")?(?:,scope="(?<scope>[0-9a-z:\-./]*?)")?/;

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

  #architectureSupported = false;

  authed = false;

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
    this.#axiosInstance = axios.create({
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

      const { data } = await axios
        .get(
          'https://raw.githubusercontent.com/RunOnFlux/flux/master/helpers/repositories.json',
          { timeout: 20_000 },
        )
        .catch(() => {
          this.#lookupErrorDetail = 'Unable to fetch whitelisted repositories. Try again later.';
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

    const match = ImageVerifier.imagePattern.exec(this.rawImageTag);

    if (match === null) {
      this.#parseErrorDetail = `Image tag: ${this.rawImageTag} is not in valid format [HOST[:PORT_NUMBER]/][NAMESPACE/]REPOSITORY[:TAG]`;
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
      // this would be better to lookup against dockerhub library (only 150 odd images to pull via api)
      this.namespace = namespace || 'library';
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
    const { realm, service, scope } = authDetails;

    const {
      data: { token },
    } = await axios
      .get(`${realm}?service=${service}&scope=${scope}`, { auth: this.credentials })
      .catch((err) => {
        const status = err?.response.status;

        if (status === 401) {
          this.#lookupErrorDetail = `Authentication rejected for: ${this.rawImageTag}`;
        } else {
          this.#lookupErrorDetail = `Authentication token from ${realm} for ${scope} not available`;
        }
        return { data: { token: null } };
      });

    if (!token) return;

    this.authed = true;
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
      return { data: null };
    }

    const httpStatus = error.response?.status;

    if (httpStatus !== 401) {
      this.#lookupErrorDetail = `Bad HTTP Status ${httpStatus}: ${this.rawImageTag} not available`;
      return { data: null };
    }

    if (this.authed) {
      this.#lookupErrorDetail = `Authentication failed: ${this.rawImageTag} not available or doesn't exist`;
      return { data: null };
    }

    const authDetails = ImageVerifier.parseAuthHeader(
      error.response.headers['www-authenticate'],
    );

    if (!authDetails) {
      this.#lookupErrorDetail = `Malformed Auth Header: ${this.rawImageTag} not available`;
      return { data: null };
    }

    await this.#handleAuth(authDetails);

    if (!this.authed) return { data: null };

    return this.#axiosInstance
      .get(endpointUrl)
      .catch((err) => this.#handleAxiosError(endpointUrl, err));
  }

  async #evaluateImageManifest(manifestIndex) {
    this.evaluated = true;

    const evaluateSingleImage = (manifest, architecture = 'amd64') => {
      let size = 0;

      manifest.layers.forEach((layer) => {
        size += layer.size;
      });

      if (size > this.maxImageSize) {
        this.#evaluationErrorDetail = `Docker image: ${this.rawImageTag} size is over Flux limit`;
      }

      if (this.architecture === architecture) this.#architectureSupported = true;
    };

    const evaluateMultipleImages = async (manifest) => {
      const images = manifest.manifests.filter((m) => this.architectureSet.includes(m.platform.architecture));

      if (!images.length) {
        this.#evaluationErrorDetail = `Docker image: ${this.rawImageTag} does not have a valid architecture`;
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
        if (!this.error) evaluateSingleImage(singleManifest, image.platform.architecture);
      }
    };

    const { mediaType } = manifestIndex;

    switch (mediaType) {
      case 'application/vnd.oci.image.index.v1+json':
        await evaluateMultipleImages(manifestIndex);
        break;
      case 'application/vnd.oci.image.manifest.v1+json':
        evaluateSingleImage(manifestIndex);
        break;
      case 'application/vnd.docker.distribution.manifest.list.v2+json':
        await evaluateMultipleImages(manifestIndex);
        break;
      case 'application/vnd.docker.distribution.manifest.v2+json':
        evaluateSingleImage(manifestIndex);
        break;
      default:
        this.#evaluationErrorDetail = `Unsupported Media type: ${mediaType} for: ${this.rawImage}`;
    }
  }

  async #fetchManifest(id) {
    const manifestEndpoint = `${this.namespace}/${this.repository}/manifests/${id}`;

    const { data: imageManifest } = await this.#axiosInstance
      .get(manifestEndpoint)
      .catch((error) => this.#handleAxiosError(manifestEndpoint, error));

    return imageManifest;
  }

  /**
   * Adds credentials to the verifier. The user is responsible for ensuring the
   * credentials are formatted correclty.
   * @param {string} credentials
   */
  addCredentials(credentials) {
    const [username, password] = credentials
      ? credentials.split(':')
      : [null, null];
    this.credentials = username && password ? { username, password } : null;
  }

  resetErrors() {
    this.#parseErrorDetail = null;
    this.#lookupErrorDetail = null;
    this.#evaluationErrorDetail = null;
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
      return false;
    }

    await this.#evaluateImageManifest(imageManifest);

    return this.verified;
  }
}

module.exports = { ImageVerifier };
