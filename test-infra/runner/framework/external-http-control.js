// Drives the external HTTP stub's artifact store: arbitrary bytes a node can
// fetch over real HTTP from inside the subnet. The restore suites need this
// because the remote path - the download, the content-length comparison, the
// file landing in backup/remote - cannot be reached with a local archive.
import { getSubnetConfig, STORAGE_HOST } from './subnet-config.js';

const HOST = getSubnetConfig().externalStub;
const CONTROL = process.env.EXTERNAL_HTTP_CONTROL || `http://${HOST}:3001`;
const SERVE_PORT = 3000;

async function post(path, body) {
  const res = await fetch(`${CONTROL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

/**
 * Stage bytes to be served at artifactUrl(name).
 *
 * `declaredLength` overrides the content-length header without changing what is
 * sent, which is how a download that stops short of what was promised is
 * reproduced - a dropped connection, or an error page served as 200.
 *
 * @param {string} name - artifact name, used in the URL
 * @param {string} base64 - the bytes, base64 encoded
 * @param {{declaredLength?: number}} [opts]
 */
export async function stageArtifact(name, base64, { declaredLength = null } = {}) {
  return post('/artifact', { name, base64, declaredLength });
}

/**
 * The URL a node should be given to fetch a staged artifact. Built from the
 * subnet config rather than a literal, so it follows a re-based fleet.
 * @param {string} name - artifact name
 * @returns {string} URL reachable from inside the fleet
 */
export function artifactUrl(name) {
  return `http://${HOST}:${SERVE_PORT}/artifact/${name}`;
}

/**
 * Every name a node asked for that nothing on the fleet could answer.
 *
 * The fleet network has no route off it, so a hardcoded address cannot reach
 * anywhere - but blocking alone only turns it into a timeout, and a timeout reads
 * as a slow test rather than as a node reaching somewhere it should not. The
 * resolver records instead, so this list names the host and the node that wanted
 * it.
 *
 * @returns {Promise<Array<{name: string, node: string, at: string}>>}
 */
export async function dnsAttempts() {
  const res = await fetch(`${CONTROL}/dns-attempts`);
  const { attempts } = await res.json();
  return attempts;
}

/**
 * Forget every recorded attempt. Called before the window a suite intends to
 * assert over, so it measures its own fleet rather than whatever ran before it.
 */
export async function resetDnsAttempts() {
  return post('/dns-attempts/reset');
}

/**
 * The names the resolver answers itself (createTestEnv's `dnsRecords`), each with the
 * records it was given and how many answers of each type it has served.
 *
 * @returns {Promise<Object<string, {records: object, served: Object<string, number>}>>}
 */
export async function dnsRecordsServed() {
  const res = await fetch(`${CONTROL}/dns-records`);
  return res.json();
}

/**
 * Queries the broken resolver route (the aaaa-servfail-dns network shape's own DNS server) has
 * received, by record type: `{ A: n, AAAA: n }`.
 * @returns {Promise<Object<string, number>>}
 */
export async function dnsBrokenServed() {
  const res = await fetch(`${CONTROL}/dns-broken-served`);
  return res.json();
}

/**
 * Publish the typed blocklist every node fetches, each entry naming the kind of
 * thing it refuses: `{ kind, value, reason, added }` with kind one of hash, name,
 * owner, image or org.
 *
 * A node caches what it fetched for six hours, so a fleet that has already read
 * an empty document will not see this until that expires. Set it before the nodes
 * that must see it are asked anything.
 *
 * @param {Array<{kind: string, value: string, reason?: string, added?: string}>} entries
 */
export async function setBlocklist(entries) {
  return post('/blocklist', entries);
}

/**
 * Publish the flat blocklist, which a node reads only when the typed document is
 * empty or unreadable. Its entries are bare strings matched against the hash, the
 * owner, the repository and the namespace alike.
 *
 * @param {string[]} entries
 */
export async function setBlockedRepositories(entries) {
  return post('/blocked-repos', entries);
}

/**
 * Fail naming the host and the node, rather than leaving a caller to compare
 * lists. `allowed` is for a suite that means to reach something - it should be
 * rare enough that writing the name down is the easy part.
 *
 * @param {{allowed?: string[]}} [opts]
 */
export async function expectNoUnexpectedDns({ allowed = [] } = {}) {
  const unexpected = (await dnsAttempts()).filter((a) => !allowed.includes(a.name));
  if (!unexpected.length) return;

  const detail = unexpected
    .map((a) => `${a.name} (node ${a.node})`)
    .join(', ');
  throw new Error(`nodes reached for names the fleet does not serve: ${detail}`);
}

/**
 * Stage what Flux storage answers for a link.
 *
 * The body is what the node receives as the container's environment or command
 * parameters, so it is a JSON array of strings.
 *
 * @param {string} name - the last path segment of the link
 * @param {string[]} body - the parameters the payload carries
 */
export async function stageStoragePayload(name, body) {
  return post('/storage', { name, body });
}

/**
 * Stage a link that answers 302 to somewhere else.
 *
 * The host is the whole of the rule, so a followed redirect would put the node
 * back to fetching an address the response chose.
 *
 * @param {string} name - the last path segment of the link
 * @param {string} redirectTo - the location header to answer with
 */
export async function stageStorageRedirect(name, redirectTo) {
  return post('/storage', { name, redirectTo });
}

/**
 * The link a specification should carry to reach a staged payload.
 * @param {string} name - the staged payload's name
 * @returns {string} an https link addressing Flux storage
 */
export function storageUrl(name) {
  return `https://${STORAGE_HOST}/${name}`;
}

/**
 * Every storage request the fleet made, in order.
 *
 * Only requests that arrived over TLS at the storage host are here, so an entry
 * is a fetch that satisfied both halves of the rule - and an empty list after a
 * container start is a node that refused before asking.
 *
 * @returns {Promise<Array<{name: string, at: string, fluxApp: string|null,
 *   fluxMessage: string|null, fluxSignature: string|null}>>}
 */
export async function storageRequests() {
  const res = await fetch(`${CONTROL}/storage-requests`);
  const { requests } = await res.json();
  return requests;
}

/** Forget every storage request, so what follows is this test's doing. */
export async function resetStorageRequests() {
  return post('/storage-requests/reset');
}

/**
 * Put a node behind a UPnP gateway the stub serves it. Every other node is served
 * a gateway with no WAN service, and runs without UPnP.
 * @param {string} ip - the node's fleet address, as subnet-config names it
 * @param {object} [opts]
 * @param {string} [opts.externalIp] - the address the gateway reports; the node's own when absent
 * @param {number} [opts.capacity] - how many mappings its table holds; no limit when absent
 * @param {object[]} [opts.mappings] - what its table holds already, as upnpGatewayState lists it
 * @param {number} [opts.refuseDeletes] - how many DeletePortMapping requests it refuses with
 *   501 before it removes anything; a refused request carries `refused: 501` in its state
 * @param {boolean} [opts.fritzDescriptions] - store each new mapping's description as a
 *   FRITZ!Box does, its underscores and spaces as dots
 */
export async function enableUpnpGateway(ip, {
  externalIp = null, capacity = null, mappings = [], refuseDeletes = 0, fritzDescriptions = false,
} = {}) {
  const res = await post('/upnp-gateway', {
    ip, externalIp, capacity, mappings, refuseDeletes, fritzDescriptions,
  });
  if (!res.ok) throw new Error(`enableUpnpGateway: ${JSON.stringify(res)}`);
}

/**
 * Set how many DeletePortMapping requests a node's gateway refuses from now on, keeping its
 * table and the requests it has seen.
 * @param {string} ip
 * @param {number} count - Infinity refuses every one
 */
export async function setUpnpRefuseDeletes(ip, count) {
  const res = await post(`/upnp-gateway/${ip}/refuse-deletes`, { count: Number.isFinite(count) ? count : Number.MAX_SAFE_INTEGER });
  if (!res.ok) throw new Error(`setUpnpRefuseDeletes: ${JSON.stringify(res)}`);
}

/**
 * Set the fault a node's gateway answers every mapping of one protocol with from now on - a
 * router that forwards TCP and refuses UDP. Keeps its table and the requests it has seen; each
 * such answer carries `refused: <code>`.
 * @param {string} ip
 * @param {'TCP'|'UDP'} protocol
 * @param {number|null} code - null maps the protocol as the spec says
 */
export async function setUpnpProtocolFault(ip, protocol, code) {
  const res = await post(`/upnp-gateway/${ip}/protocol-fault`, { protocol, code });
  if (!res.ok) throw new Error(`setUpnpProtocolFault: ${JSON.stringify(res)}`);
}

/**
 * Set the fault a node's gateway answers every GetSpecificPortMappingEntry with from now on,
 * whether or not it holds the entry. Keeps its table and the requests it has seen; each such
 * answer carries `refused: <code>`.
 * @param {string} ip
 * @param {number|null} code - null answers as the spec says
 */
export async function setUpnpLookupFault(ip, code) {
  const res = await post(`/upnp-gateway/${ip}/lookup-fault`, { code });
  if (!res.ok) throw new Error(`setUpnpLookupFault: ${JSON.stringify(res)}`);
}

/**
 * Set the fault a node's gateway answers every GetGenericPortMappingEntry with from now on: a
 * router that will not list its table (401, 602 and 606 are the faults that say so). Keeps its
 * table and the requests it has seen; each such answer carries `refused: <code>`.
 * @param {string} ip
 * @param {number|null} code - null answers as the spec says
 */
export async function setUpnpListFault(ip, code) {
  const res = await post(`/upnp-gateway/${ip}/list-fault`, { code });
  if (!res.ok) throw new Error(`setUpnpListFault: ${JSON.stringify(res)}`);
}

/**
 * Set the fault a node's gateway answers every removal with from now on, while still carrying
 * it out, and the same fault for a removal of an entry it does not hold, where the spec says
 * 714. Keeps its table and the requests it has seen; each such answer carries `refused: <code>`.
 * @param {string} ip
 * @param {number|null} code - null answers as the spec says
 */
export async function setUpnpDeleteFault(ip, code) {
  const res = await post(`/upnp-gateway/${ip}/delete-fault`, { code });
  if (!res.ok) throw new Error(`setUpnpDeleteFault: ${JSON.stringify(res)}`);
}

/**
 * Set how many mappings a node's gateway holds from now on, keeping its table and the requests
 * it has seen. A new mapping past it is refused with `fault`, carried as `refused: <fault>` in
 * its state.
 * @param {string} ip
 * @param {number|null} capacity - null for no limit
 * @param {object} [opts]
 * @param {number} [opts.fault] - 728 NoPortMapsAvailable when absent
 */
export async function setUpnpCapacity(ip, capacity, { fault = null } = {}) {
  const res = await post(`/upnp-gateway/${ip}/capacity`, { capacity, fault });
  if (!res.ok) throw new Error(`setUpnpCapacity: ${JSON.stringify(res)}`);
}

/**
 * Set how a node's gateway treats a mapping asked for with a lease from now on, keeping its
 * table and the requests it has seen. A refused one carries `refused: <fault>` in its state.
 * @param {string} ip
 * @param {object} [opts]
 * @param {number|null} [opts.fault] - the fault it refuses a leased mapping with; 725 is a
 *   router that keeps permanent mappings only. Null takes it.
 * @param {boolean} [opts.drops] - take a leased mapping and hold it as permanent
 * @param {boolean} [opts.keepsHeld] - answer an add of a held entry and leave the entry as it
 *   is: its lease is not restarted or changed
 * @param {boolean} [opts.staticLeases] - show every entry's lease as it was asked for, never
 *   counting down
 * @param {number|null} [opts.minimumLease] - hold a shorter lease for this many seconds
 * @param {number|null} [opts.permanentAs] - hold a mapping asked for with no lease for this
 *   many seconds
 * @param {number|null} [opts.refreshFault] - the fault it refuses an add of a held entry with
 */
export async function setUpnpLeases(ip, {
  fault = null, drops = false, keepsHeld = false, staticLeases = false,
  minimumLease = null, permanentAs = null, refreshFault = null,
} = {}) {
  const res = await post(`/upnp-gateway/${ip}/leases`, {
    fault, drops, keepsHeld, staticLeases, minimumLease, permanentAs, refreshFault,
  });
  if (!res.ok) throw new Error(`setUpnpLeases: ${JSON.stringify(res)}`);
}

/**
 * Set whether a node's gateway answers a lookup of any port with an empty entry from now on,
 * whatever it holds, keeping its table and the requests it has seen.
 * @param {string} ip
 * @param {boolean} on
 */
export async function setUpnpEmptyLookups(ip, on) {
  const res = await post(`/upnp-gateway/${ip}/empty-lookups`, { on });
  if (!res.ok) throw new Error(`setUpnpEmptyLookups: ${JSON.stringify(res)}`);
}

/**
 * Set how long a node's gateway takes to answer a mapping it has taken from now on: the
 * mapping is in its table at once, and the answer comes `ms` later. Keeps its table and the
 * requests it has seen; each such request carries `answeredAfterMs` in its state.
 * @param {string} ip
 * @param {object} opts
 * @param {number|null} opts.ms - null answers at once
 * @param {string} [opts.description] - only mappings with this description; every one when absent
 */
export async function setUpnpSlowAdds(ip, { ms, description = null }) {
  const res = await post(`/upnp-gateway/${ip}/slow-adds`, { ms, description });
  if (!res.ok) throw new Error(`setUpnpSlowAdds: ${JSON.stringify(res)}`);
}

/**
 * The gateway a node is behind: its port mappings and the actions the node sent it, each with
 * the external port, protocol and description it named (null for one it names none of), and
 * the lease an AddPortMapping asked for. A mapping with a lease carries `expiresAt` (epoch
 * ms), and goes from the table once it has passed.
 * @param {string} ip
 * @returns {Promise<{externalIp: string|null, mappings: object[], requests: object[]}|null>}
 */
export async function upnpGatewayState(ip) {
  const res = await fetch(`${CONTROL}/upnp-gateway/${ip}`);
  return res.json();
}
