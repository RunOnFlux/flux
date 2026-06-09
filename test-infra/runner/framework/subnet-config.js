// Single source of truth for the test network's IP layout.
//
// Each run gets its own /24 (TEST_SUBNET_BASE, a three-octet prefix like '198.18.0',
// default '198.18.0'), carved from 198.18.0.0/15. Every address in the harness —
// framework helpers, test-env, stub control clients, test assertions — derives from
// here, so concurrent runs use distinct /24s instead of all colliding on one subnet.
//
// Why 198.18.0.0/15: FluxOS only treats RFC1918 (10/8, 172.16/12, 192.168/16) +
// loopback/link-local/CGN as non-routable and drops peers on those (serviceHelper
// isPrivateAddress/isNonRoutableAddress). 198.18.0.0/15 is the RFC 2544 network-
// benchmarking reservation — not RFC1918, so FluxOS accepts it as a normal public
// node IP, yet it never routes on the real internet, so it's safe in tests. It holds
// 512 /24s (198.18.0 … 198.19.255) — i.e. up to 512 concurrent runs.
//
// FluxOS is IP-centric: a node's network identity IS its IP (peers dial IPs, the
// deterministic node list is IP-keyed, a node confirms itself by matching its own IP
// against that list). So the harness still ASSIGNS each node a known IP up front —
// we only parameterise which /24, we don't go to Docker-dynamic IPs.
//
// The image registry is the one service NOT addressed by IP: it has a stable network
// ALIAS (REGISTRY_ALIAS) with a DNS-SAN cert, so it's reachable under any /24 without
// regenerating the cert. Nodes pull `fluxregistry:5000/...` (Docker embedded DNS
// resolves the alias); the host pushes to the registry IP but verifies TLS against
// the alias name.
//
// Within a /24: .1 gateway, .2-.7 infra services, nodes start at .10 (so node N -> .N+9).

export const REGISTRY_ALIAS = 'fluxregistry';
export const REGISTRY_PORT = 5000;

export function resolveBase() {
  const base = process.env.TEST_SUBNET_BASE || '198.18.0';
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(base)) {
    throw new Error(`TEST_SUBNET_BASE must be a three-octet /24 prefix like '198.18.0', got '${base}'`);
  }
  return base;
}

export function getSubnetConfig(base = resolveBase()) {
  return {
    base,
    subnet: `${base}.0/24`,
    gateway: `${base}.1`,
    mongo: `${base}.2`,
    daemon: `${base}.3`,
    syncthing: `${base}.4`,
    registry: `${base}.5`,
    externalStub: `${base}.6`,
    fdm: `${base}.7`,
    // nodes occupy .10+ (gateway .1, services .2-.7); node number is 1-based
    nodeIp: (num) => `${base}.${num + 9}`,
  };
}

// The repotag prefix used in seeded app specs and pulled by node dockerd via the
// registry's network alias — base-independent.
export const REGISTRY_REPO_HOST = `${REGISTRY_ALIAS}:${REGISTRY_PORT}`;
