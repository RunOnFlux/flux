const serviceHelper = require('../serviceHelper');
const fluxCommunicationMessagesSender = require('../fluxCommunicationMessagesSender');
const fluxCaching = require('./cacheManager');
const log = require('../../lib/log');

const storagePayloadCache = fluxCaching.default.storagePayloadCache;

// Application spec array field name -> Flux Storage marker prefix.
const STORAGE_MARKERS = {
  environmentParameters: 'F_S_ENV=',
  commands: 'F_S_CMD=',
  contacts: 'F_S_CONTACTS=',
};

// Post-fetch payload validation limits (mirrors dockerService container-start checks).
const MAX_PAYLOAD_ENTRIES = 200;
const MAX_ENTRY_LENGTH = 5000000;

/**
 * Fetches an application payload (env vars / commands / contacts) from Flux Storage.
 * The request is signed with the node key so that even unsecured storages can verify the
 * caller against the deterministic node list (timestamp guards replay). Basic auth only.
 * @param {string} url Flux Storage URL (the value after the F_S_* marker).
 * @param {string} appName Application name, sent as the flux-app header.
 * @returns {Promise<any>} The raw response body (expected: an array of strings).
 */
async function obtainPayloadFromStorage(url, appName) {
  try {
    // do a signed request in headers
    // we want to be able to fetch even from unsecure storages that may not have all the auths
    // and so this is only basic auth where timestamp is important
    // server should verify valid signature based on publicKey that server can get from
    // deterministic node list of ip address that did this request
    const version = 1;
    const timestamp = Date.now();
    const message = version + url + timestamp;
    const signature = await fluxCommunicationMessagesSender.getFluxMessageSignature(message);
    const axiosConfig = {
      headers: {
        'flux-message': message,
        'flux-signature': signature,
        'flux-app': appName,
      },
      timeout: 20000,
    };
    const response = await serviceHelper.axiosGet(url, axiosConfig);
    return response.data;
  } catch (error) {
    log.error(error);
    throw new Error(`Parameters from Flux Storage ${url} failed to be obtained`);
  }
}

/**
 * Finds the first Flux Storage marker entry in an array field.
 * @param {any} values The field value (expected an array of strings).
 * @param {string} marker The marker prefix, e.g. 'F_S_ENV='.
 * @returns {{entry: string, url: string}|null} The matching entry and its URL, or null.
 */
function findStorageMarker(values, marker) {
  if (!Array.isArray(values)) return null;
  const entry = values.find((value) => typeof value === 'string' && value.startsWith(marker));
  if (!entry) return null;
  return { entry, url: entry.slice(marker.length) };
}

/**
 * Resolves a single storage-backed field to a status object for client display.
 * Never throws - transient/permanent failures are captured as a status so one dead link
 * cannot abort resolution of the rest of the spec. Only successful results are cached
 * (storage content is immutable), so failures are retried on the next request.
 * @param {any} values The field value to inspect.
 * @param {string} marker The marker prefix for this field.
 * @param {string} appName Application name for the signed fetch.
 * @returns {Promise<object|null>} { source, url, status, values?/message? } or null when no marker.
 */
async function resolveField(values, marker, appName) {
  const found = findStorageMarker(values, marker);
  if (!found) return null;

  const { url } = found;

  const cached = storagePayloadCache.get(url);
  if (cached) return cached;

  try {
    const payload = await obtainPayloadFromStorage(url, appName);
    if (!Array.isArray(payload) || payload.length >= MAX_PAYLOAD_ENTRIES) {
      return {
        source: 'flux-storage', url, status: 'error', message: 'Invalid payload from Flux Storage',
      };
    }
    const oversize = payload.some(
      (item) => typeof item !== 'string' || item.length > MAX_ENTRY_LENGTH,
    );
    if (oversize) {
      return { source: 'flux-storage', url, status: 'too-large' };
    }
    const result = {
      source: 'flux-storage', url, status: 'ok', values: payload,
    };
    storagePayloadCache.set(url, result);
    return result;
  } catch (error) {
    return {
      source: 'flux-storage', url, status: 'error', message: 'Failed to obtain payload from Flux Storage',
    };
  }
}

/**
 * Resolves every Flux Storage marker in a spec and attaches `<field>Resolved` status
 * objects (environmentParametersResolved, commandsResolved, contactsResolved) next to the
 * raw fields, which are left untouched. Works on a deep clone so a possibly-shared/cached
 * source spec is never mutated. All fields resolve in parallel; failures are per-field.
 * @param {object} spec Application specification.
 * @param {string} appName Application name for signed fetches.
 * @returns {Promise<object>} A clone of the spec with resolved fields attached.
 */
async function attachResolvedStorage(spec, appName) {
  const clone = JSON.parse(JSON.stringify(spec));
  const tasks = [];

  const resolveInto = (target, fieldName, marker, resolvedKey) => {
    tasks.push((async () => {
      const result = await resolveField(target[fieldName], marker, appName);
      if (result) {
        // eslint-disable-next-line no-param-reassign
        target[resolvedKey] = result;
      }
    })());
  };

  if (Array.isArray(clone.compose)) {
    clone.compose.forEach((component) => {
      resolveInto(component, 'environmentParameters', STORAGE_MARKERS.environmentParameters, 'environmentParametersResolved');
      resolveInto(component, 'commands', STORAGE_MARKERS.commands, 'commandsResolved');
    });
  } else {
    resolveInto(clone, 'environmentParameters', STORAGE_MARKERS.environmentParameters, 'environmentParametersResolved');
    resolveInto(clone, 'commands', STORAGE_MARKERS.commands, 'commandsResolved');
  }

  resolveInto(clone, 'contacts', STORAGE_MARKERS.contacts, 'contactsResolved');

  await Promise.all(tasks);
  return clone;
}

module.exports = {
  obtainPayloadFromStorage,
  findStorageMarker,
  resolveField,
  attachResolvedStorage,
  STORAGE_MARKERS,
};
