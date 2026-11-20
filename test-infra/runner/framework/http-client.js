// How the harness talks HTTP. Loaded before every suite (.mocharc.json).
//
// Every request opens its own connection. A node closes an idle connection after
// its keep-alive timeout (5 s); a harness process the box has starved past its own
// idle timer would write its next request into a connection the node has closed,
// and the node answers with a reset.
//
// A transport failure names the URL and its cause, whether it ends the request or the
// reading of its body. fetch reports the first as "fetch failed" and the second as
// "terminated", and keeps what identifies it (ECONNRESET, ECONNREFUSED, a connect
// timeout) in `cause`, which mocha does not print.

import { Agent, setGlobalDispatcher } from 'undici';

setGlobalDispatcher(new Agent({ pipelining: 0 }));

const nativeFetch = globalThis.fetch;

/**
 * @param {Error} error A transport failure.
 * @returns {string} What identifies it.
 */
function causeOf(error) {
  const cause = error?.cause;
  if (!cause) return error?.message ?? String(error);
  return `${cause.code ?? cause.name ?? 'unknown'}${cause.message ? `: ${cause.message}` : ''}`;
}

['text', 'json', 'arrayBuffer', 'blob', 'formData'].forEach((reader) => {
  const read = Response.prototype[reader];
  Response.prototype[reader] = async function readNamingItsFailure(...args) {
    try {
      return await read.apply(this, args);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      const named = new Error(`reading the body of ${this.url || 'a response'} failed - ${causeOf(error)}`);
      named.cause = error;
      throw named;
    }
  };
});

/**
 * fetch, with a transport failure naming its request and cause. An abort is the
 * caller's own and is passed on as it is.
 * @param {string|URL|Request} input
 * @param {object} [init]
 * @returns {Promise<Response>}
 */
globalThis.fetch = async function fetchNamingItsFailure(input, init) {
  try {
    return await nativeFetch(input, init);
  } catch (error) {
    if (!error?.cause || error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const method = init?.method ?? input?.method ?? 'GET';
    const named = new Error(`${method} ${url} failed - ${causeOf(error)}`);
    named.cause = error;
    throw named;
  }
};
