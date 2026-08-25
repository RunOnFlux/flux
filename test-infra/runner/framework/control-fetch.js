// Talking to a stub's control API, with the failure legible.
//
// `fetch` reports every transport failure as the same three words - "TypeError:
// fetch failed" - and puts the part that identifies it (ECONNREFUSED, socket
// hang up, EAI_AGAIN) in `cause`, which nothing prints. A suite that loses a
// control call therefore fails with no endpoint, no errno and no stack into the
// harness, and the only way to find out which of a dozen control APIs went
// quiet is to run it again with a guess bolted on.
//
// That cost this suite three ten-minute runs. So every control call goes through
// here, and a failure names the method, the URL and the cause.

/**
 * fetch, with the failure identifying itself.
 * @param {string} url Absolute control-API URL.
 * @param {object} [init] fetch init.
 * @returns {Promise<Response>}
 */
export async function controlFetch(url, init) {
  try {
    return await fetch(url, init);
  } catch (error) {
    const method = init?.method ?? 'GET';
    const cause = error?.cause;
    const detail = cause
      ? `${cause.code ?? cause.name ?? 'unknown'}${cause.message ? `: ${cause.message}` : ''}`
      : 'no cause reported';
    const wrapped = new Error(`${method} ${url} failed - ${detail}`);
    wrapped.cause = error;
    throw wrapped;
  }
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
