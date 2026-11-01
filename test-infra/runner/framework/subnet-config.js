// Single source of truth for the test network's IP layout.
//
// Each run gets its own /14 slot (TEST_SUBNET_BASE, the three-octet prefix of the
// slot's first /24, like '25.192.0'; default '25.192.0'), carved from 25.192.0.0/10.
// The slot is four /16s. Every address in the harness — framework helpers, test-env,
// stub control clients, test assertions — derives from here, so concurrent runs use
// distinct slots instead of all colliding on one subnet.
//
// Why 25.192.0.0/10: a node treats the fleet's addresses as it treats a real fleet's,
// so they are ordinary public addresses - none in a range FluxOS refuses as a peer, a
// registry or a download. 25.0.0.0/8 is a legacy allocation no one announces in BGP.
// The fleet network is internal (no route off the host), so these addresses stand in
// for their real owners only inside the fleet. The /10 holds 16 slots (25.192 …
// 25.252) - i.e. up to 16 concurrent runs on one host - and stays clear of every
// range labnet routes (25.47.0.0/16, 25.48.0.0/24, 25.96.0.0/11): a slot overlapping
// one would shadow a route the harness boxes need.
//
// A slot spans four /16s because FluxOS groups peers by /16: a node never dials a
// second peer in a /16 it already has one in, nor one in its own. Infra and every
// node sit in the slot's first /16 unless a suite places a node in another
// (setIpGroups), which is how a fleet gets peers it is allowed to dial.
//
// FluxOS is IP-centric: a node's network identity IS its IP (peers dial IPs, the
// deterministic node list is IP-keyed, a node confirms itself by matching its own IP
// against that list). So the harness still ASSIGNS each node a known IP up front.
//
// The image registry is the one service NOT addressed by IP: it has a stable network
// ALIAS (REGISTRY_ALIAS) with a DNS-SAN cert, so it's reachable under any slot without
// regenerating the cert. Nodes pull `fluxregistry:5000/...` (Docker embedded DNS
// resolves the alias); the host pushes to the registry IP but verifies TLS against
// the alias name.
//
// Within a slot's first /24: .1 gateway, .2-.7 infra services, nodes start at .10
// (so node N -> .N+9); a node placed in /16 group g has the same last two octets in
// the slot's g-th /16.

export const REGISTRY_ALIAS = 'fluxregistry';
export const REGISTRY_PORT = 5000;

// The one host a storage link may address. It matches fluxapps.storageHost in
// the node config, the SAN on fixtures/registry-tls/storage-cert.pem and the
// network alias the external HTTP stub is given; all three must name the same
// host or a node resolves, refuses or distrusts it.
export const STORAGE_HOST = 'storage.runonflux.io';

// The slots: 16 /14s from 25.192.0.0/10.
export const SLOT_POOL_SECOND_OCTET = 192;
export const SLOT_COUNT = 16;
export const SLOT_WIDTH = 4; // /16s per slot
export const DEFAULT_BASE = '25.192.0';

// Which /16 group (0..SLOT_WIDTH-1) a node number is placed in; absent is group 0.
let ipGroups = new Map();

/**
 * Place nodes in the slot's other /16s for the fleet about to boot. Keyed by
 * node number (1-based); a node not named stays in group 0.
 * @param {Object<number, number>} groups node number -> group
 */
export function setIpGroups(groups = {}) {
  const placed = new Map();
  for (const [num, group] of Object.entries(groups)) {
    if (!Number.isInteger(group) || group < 0 || group >= SLOT_WIDTH) {
      throw new Error(`setIpGroups: node ${num} names group ${group}; a slot has /16 groups 0..${SLOT_WIDTH - 1}`);
    }
    placed.set(Number(num), group);
  }
  ipGroups = placed;
}

export function resolveBase() {
  const base = process.env.TEST_SUBNET_BASE || DEFAULT_BASE;
  const match = /^25\.(\d{1,3})\.0$/.exec(base);
  const second = match ? Number(match[1]) : NaN;
  const slot = (second - SLOT_POOL_SECOND_OCTET) / SLOT_WIDTH;
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) {
    throw new Error(`TEST_SUBNET_BASE must be a slot base 25.<192..252, a multiple of 4>.0, like '${DEFAULT_BASE}', got '${base}'`);
  }
  return base;
}

export function getSubnetConfig(base = resolveBase()) {
  const [first, second] = base.split('.').map(Number);
  return {
    base,
    subnet: `${base}.0/14`,
    gateway: `${base}.1`,
    mongo: `${base}.2`,
    daemon: `${base}.3`,
    syncthing: `${base}.4`,
    registry: `${base}.5`,
    externalStub: `${base}.6`,
    fdm: `${base}.7`,
    // nodes occupy .10+ (gateway .1, services .2-.7); node number is 1-based
    nodeIp: (num) => `${first}.${second + (ipGroups.get(num) ?? 0)}.0.${num + 9}`,
  };
}

// The repotag prefix used in seeded app specs and pulled by node dockerd via the
// registry's network alias — base-independent.
export const REGISTRY_REPO_HOST = `${REGISTRY_ALIAS}:${REGISTRY_PORT}`;
