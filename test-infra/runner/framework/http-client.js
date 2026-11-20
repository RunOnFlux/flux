// How the harness talks HTTP. Loaded before every suite (.mocharc.json).
//
// Every request opens its own connection. A node closes an idle connection after
// its keep-alive timeout (5 s); a harness process the box has starved past its own
// idle timer would write its next request into a connection the node has closed,
// and the node answers with a reset.
//
// A transport failure names the method, the URL and its cause. fetch reports every
// one as "fetch failed" and keeps what identifies it (ECONNRESET, ECONNREFUSED, a
// connect timeout) in `cause`, which mocha does not print.

import { Agent, setGlobalDispatcher } from 'undici';

setGlobalDispatcher(new Agent({ pipelining: 0 }));

const nativeFetch = globalThis.fetch;

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
    const cause = error?.cause;
    if (!cause || error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const method = init?.method ?? input?.method ?? 'GET';
    const detail = `${cause.code ?? cause.name ?? 'unknown'}${cause.message ? `: ${cause.message}` : ''}`;
    const named = new Error(`${method} ${url} failed - ${detail}`);
    named.cause = error;
    throw named;
  }
};
