// Talking to a stub's control API or a node's own API. A transport failure names
// its request and cause through the harness's fetch (http-client.js).

/**
 * fetch, for a control-API or node-API call.
 * @param {string} url Absolute URL.
 * @param {object} [init] fetch init.
 * @returns {Promise<Response>}
 */
export async function controlFetch(url, init) {
  return fetch(url, init);
}

/**
 * The same, parsed as JSON. A control API that answers with a body the caller
 * cannot read is its own failure, and it reads identically to a transport one
 * unless it says so.
 * @param {string} url Absolute control-API URL.
 * @param {object} [init] fetch init.
 * @returns {Promise<any>}
 */
export async function controlJson(url, init) {
  const res = await controlFetch(url, init);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${init?.method ?? 'GET'} ${url} answered ${res.status} with a body that is not JSON: `
      + `${text.slice(0, 200)}`,
    );
  }
}
