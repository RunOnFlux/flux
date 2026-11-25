// The flux-upnpd stand-in on a node createTestEnv gives `upnpdNodes` (test-infra/upnpd-stub):
// what FluxOS asked of it, and the faults a suite gives it.
import { controlJson } from './control-fetch.js';

const CONTROL_PORT = 16259;
const base = (nodeIp) => `http://${nodeIp}:${CONTROL_PORT}/control`;
const post = (url, body) => controlJson(url, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
});

/**
 * Every set FluxOS sent (PUT /desired) and every map it asked (POST /map), in order, each with
 * `seq`, numbered from one sequence across both; restarts; open event streams.
 * @param {string} nodeIp
 * @returns {Promise<{desired: Array<{seq: number, ports: object[]}>, maps: Array<{seq: number}>, restarts: number, streams: number}>}
 */
export function upnpdState(nodeIp) {
  return controlJson(base(nodeIp));
}

/**
 * A mapping fails from now on, the map that asks for it included, as flux-upnpd reports it.
 * @param {string} nodeIp
 * @param {{port: number, protocol: string, failure: string, reason?: string, holder?: string}} failure
 */
export function failUpnpdMapping(nodeIp, failure) {
  return post(`${base(nodeIp)}/fail`, failure);
}

/** The mapping maps again. */
export function healUpnpdMapping(nodeIp, { port, protocol }) {
  return post(`${base(nodeIp)}/heal`, { port, protocol });
}

/** flux-upnpd restarts: every stream ends, its socket goes and comes back, its set is forgotten. */
export function restartUpnpd(nodeIp) {
  return post(`${base(nodeIp)}/restart`);
}
