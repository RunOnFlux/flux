/**
 * Flux storage links.
 *
 * A specification may carry a URL in place of a value it does not want written
 * to a public chain, and the node dereferences it before it starts the
 * container. It does so carrying its own signed identity, so the address it
 * fetches is not the specification author's to choose: an arbitrary one turns
 * every node hosting the app into a signed request to wherever that node can
 * reach, and hands the response back as the container's own environment.
 *
 * Only the two markers the node actually fetches belong here. F_S_CONTACTS
 * carries the same shape but nothing in FluxOS dereferences it, so a URL there
 * is not a request this node will ever make.
 */

const config = require('config');
const { URL } = require('url');

const STORAGE_MARKERS = ['F_S_ENV=', 'F_S_CMD='];

/**
 * The URL a storage marker carries, or null when the parameter is not one.
 * @param {string} parameter One environment parameter or command.
 * @returns {string|null} The link, unvalidated.
 */
function storageLinkOf(parameter) {
  if (typeof parameter !== 'string') {
    return null;
  }
  const marker = STORAGE_MARKERS.find((candidate) => parameter.startsWith(candidate));
  return marker ? parameter.slice(marker.length) : null;
}

/**
 * Whether a link addresses Flux storage.
 *
 * The host is compared whole. A suffix test would admit
 * `storage.runonflux.io.example.com` and a substring test any host carrying the
 * name in a query string, and both read as though they check the same thing.
 * @param {string} link The URL a storage marker carries.
 * @returns {boolean} True when the node may fetch it.
 */
function isFluxStorageUrl(link) {
  const { storageHost } = config.fluxapps;
  if (!storageHost) {
    throw new Error('No Flux storage host is configured: fluxapps.storageHost');
  }
  if (typeof link !== 'string') {
    return false;
  }
  let url = null;
  try {
    url = new URL(link);
  } catch (error) {
    return false;
  }
  return url.protocol === 'https:' && url.hostname === storageHost;
}

module.exports = {
  STORAGE_MARKERS,
  isFluxStorageUrl,
  storageLinkOf,
};
