// use default for typing
const axios = require('axios').default;

/**
 * Docker Architecture
 * @typedef {"amd64" | "arm64"} Architecture
 */

class ImageVerifier {
  static defaultDockerRegistry = 'registry-1.docker.io';

  static imagePattern =
    /^(?:(?<provider>(?:(?:[\w-]+(?:\.[\w-]+)+)(?::\d+)?)|[\w]+:\d+)\/)?\/?(?<namespace>(?:(?:[a-z0-9]+(?:(?:[._]|__|[-]*)[a-z0-9]+)*)\/){0,2})(?<repository>[a-z0-9-_.]+\/{0,1}[a-z0-9-_.]+)[:]?(?<tag>[\w][\w.-]{0,127})?/;

  static wwwAuthHeaderPattern =
    /Bearer realm="(?<realm>(?:[0-9a-z:\-./]*?))"(?:,service="(?<service>(?:[0-9a-z:\-./]*?))")?(?:,scope="(?<scope>[0-9a-z:\-./]*?)")?/;

  static supportedMediaTypes = [
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json',
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
    ,
  ];

  #abortController = new AbortController();

  #axiosInstance = null;

  #evaluationErrorDetail = '';

  #lookupErrorDetail = '';

  #parseErrorDetail = '';

  #architectureSupported = false;

  authed = false;

  evaluated = false;

  /**
   * @param {string} imageTag
   * @param {{credentials?: string, architecture?: Architecture, architectureSet?: Array<Architecture>}} options
   */
  constructor(imageTag, options = {}) {
    this.rawImageTag = imageTag;

    this.architecture = options.architecture || 'amd64';
    this.architectureSet = options.architectureSet || ['amd64', 'arm64'];
    this.maxImageSize = options.maxImageSize || 2_000_000_000; // 2Gb

    const [username, password] = options.credentials ? options.credentials.split(':') : [null, null];
    this.credentials = username && password ? { username, password } : null;

    this.#parseDockerTag();

    if (!this.parseError) this.#createAxiosInstance();
  }

  /**
 * Parse www-authenticate header
 * @param {string} authHeader # www-auth header
 * @returns {object} Object of parsed header - {realm, service, scope}
 */
  static parseAuthHeader(header) {
    const match = ImageVerifier.wwwAuthHeaderPattern.exec(header);

    return { ...match.groups };
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
    return this.parseError || this.lookupError || this.evaluationError
  }

  /**
   * If this image can run on the Flux network.
   */
  get verified() {
    return this.evaluated && !this.error;
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

  #parseDockerTag() {
    if (/\s/.test(this.rawImageTag)) {
      this.#parseErrorDetail = `Image tag: "${this.rawImageTag}" should not contain space characters.`
      return;
    }

    const match = ImageVerifier.imagePattern.exec(this.rawImageTag);

    if (match === null || !(match.groups.repository && match.groups.tag)) {
      this.#parseErrorDetail = `Image tag: ${this.rawImageTag} is not in valid format [HOST[:PORT_NUMBER]/][NAMESPACE/]REPOSITORY:TAG`
      return;
    }

    const {
      groups: { provider, namespace, repository, tag },
    } = match;

    this.provider = provider || ImageVerifier.defaultDockerRegistry;

    // Without doing a lookup against the dockerhub library, no way to know if a single string is
    // an image or a namespace
    if (tag === undefined) {
      if (this.provider === ImageVerifier.defaultDockerRegistry) {
        // we can't tell, so we set namespace/repository to repository
        this.namespace = namespace || repository;
        this.repository = repository;
        this.tag = tag;
        this.ambiguous = this.namespace === this.repository;
      } else {
        // registry
        this.namespace = namespace;
        this.repository = repository;
        this.tag = tag;
        // a registry is ambiguous as you can have multiple / in both namespace and repository,
        // and we don't know how it is split
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

    const { data: { token } } = await axios.get(
      `${realm}?service=${service}&scope=${scope}`,
    ).catch(() => {
      this.#lookupErrorDetail = `Authentication token from ${realm} for ${scope} not available`
      return { data: { token: null } };
    });

    if (token) {
      this.authed = true;
      this.#axiosInstance.interceptors.request.use(function (config) {
        config.headers.Authorization = `Bearer ${token}`;
        return config;
      });
    }
  }

  async #handleAxiosError(
    endpointUrl,
    error,
  ) {

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
      this.#lookupErrorDetail = `Authentication failed: ${this.rawImageTag} not available`;
      return { data: null };
    }

    const authDetails = ImageVerifier.parseAuthHeader(
      error.response.headers['www-authenticate']
    );

    if (!authDetails) {
      this.#lookupErrorDetail = `Malformed Auth Header: ${this.rawImageTag} not available`;
    }

    await this.#handleAuth(authDetails);

    if (!this.authed) return { data: null };

    return this.#axiosInstance.get(
      endpointUrl
    ).catch((error) =>
      this.#handleAxiosError(endpointUrl, error)
    );
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
      }

      // Can't remember 100% but think it's AWS that rate limits to 1/s if not authed.
      for (const image of images) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => { setTimeout(r, 1_000) });
        // eslint-disable-next-line no-await-in-loop
        const singleManifest = await this.#fetchManifest(image.digest);
        if (!this.error) evaluateSingleImage(singleManifest, image.platform.architecture);
      }
    }

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

    const { data: imageManifest } = await this.#axiosInstance.get(
      manifestEndpoint,
    ).catch((error) =>
      this.#handleAxiosError(manifestEndpoint, error)
    );

    return imageManifest;
  }

  /**
 * Allows for descriptive errors to be throw if there are any errors present.
 * @returns {void}
 */
  throwIfError() {
    if (!this.error) return;

    throw new Error(this.#parseErrorDetail || this.#lookupErrorDetail || this.#evaluationErrorDetail)
  }

  /**
   * Allows for any long running axios requests to be aborted
   */
  abort() {
    this.#abortController.abort();
  }

  /**
   * Checks that the image is available for this system's architecture, and that the image's size
   * is less that the configured maximum image size.
   * @returns {Promise<boolean>}
   */
  async verifyImage() {
    if (this.parseError) return;

    const imageManifest = await this.#fetchManifest(this.tag);

    if (!imageManifest) return;

    if (imageManifest.schemaVersion !== 2) {
      this.#lookupErrorDetail = `Unsupported schemaVersion: ${imageManifest.schemaVersion} for: ${this.rawImageTag}`
      return;
    }

    await this.#evaluateImageManifest(imageManifest);

    return this.verified;
  }
}

module.exports = { ImageVerifier }
