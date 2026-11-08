// A request one node makes of another's API, signed the way FluxOS signs a node-to-node
// call (signedPeerRequest): the body carries the asked node's address, a timestamp, the
// signing node's public key and a challenge, and the signature covers JSON of all of it.
//
// postFromNode sends it from inside a node container, so the request comes from that
// node's IP: a route that checks the source IP sees the node it would see in
// production, which a request from the runner host cannot show.
import crypto from 'node:crypto';
import { expect } from 'chai';
import { nodeKey } from './keys.js';
import { signBtcMessage } from '../auth.js';
import { execInContainer } from './container.js';

/**
 * @param {number} signedBy 1-based node number whose key signs.
 * @param {string} target The asked node's socket address.
 * @param {object} fields What the request carries, covered by the signature.
 * @returns {Promise<object>} The body, signature included.
 */
export async function signedNodeBody(signedBy, target, fields = {}) {
  const body = {
    target,
    timestamp: Date.now(),
    pubKey: nodeKey(signedBy).pubkey,
    challenge: crypto.randomBytes(16).toString('hex'),
    ...fields,
  };
  const signature = await signBtcMessage(JSON.stringify(body), nodeKey(signedBy).privkey);
  return { ...body, signature };
}

/**
 * POSTs a JSON body from inside a node container.
 * @param {object} container The sending node's container.
 * @param {string} url
 * @param {object} body
 * @returns {Promise<object>} The parsed response.
 */
export async function postFromNode(container, url, body) {
  const json = JSON.stringify(body).replace(/'/g, "'\\''");
  const r = await execInContainer(container, `curl -s -m 60 -X POST -H 'Content-Type: application/json' --data '${json}' '${url}'`);
  expect(r.exitCode, `POST ${url} from a node: ${r.output}`).to.equal(0);
  return JSON.parse(r.stdout);
}
