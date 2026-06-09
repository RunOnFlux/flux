// Single source of truth for the test network's IP layout.
//
// The /16 BASE (two octets, e.g. '198.18') is chosen per run via TEST_SUBNET_BASE
// (default '198.18'), so concurrent runs use distinct subnets instead of all
// colliding on 198.18.0.0/16. Every address in the harness — framework helpers,
// test-env, stub control clients, test assertions — derives from here.
//
// FluxOS is IP-centric: a node's network identity IS its IP (peers dial IPs, the
// deterministic node list is IP-keyed, a node confirms itself by matching its own
// IP against that list). So the harness must still ASSIGN each node a known IP up
// front — we only parameterise the base, we don't go to Docker-dynamic IPs.
//
// The image registry is the one service NOT addressed by IP: it is given a stable
// network ALIAS (REGISTRY_ALIAS) and a DNS-SAN cert, so it is reachable under any
// base. Nodes pull `fluxregistry:5000/...` (Docker embedded DNS resolves the alias);
// the host pushes to the registry IP but verifies TLS against the alias name. This
// is why the base can be fully arbitrary without regenerating the registry cert.

export const REGISTRY_ALIAS = 'fluxregistry';
export const REGISTRY_PORT = 5000;

export function resolveBase() {
  const base = process.env.TEST_SUBNET_BASE || '198.18';
  if (!/^\d{1,3}\.\d{1,3}$/.test(base)) {
    throw new Error(`TEST_SUBNET_BASE must be a two-octet base like '198.18', got '${base}'`);
  }
  return base;
}

export function getSubnetConfig(base = resolveBase()) {
  return {
    base,
    subnet: `${base}.0.0/16`,
    gateway: `${base}.0.1`,
    mongo: `${base}.0.2`,
    daemon: `${base}.0.3`,
    syncthing: `${base}.0.4`,
    registry: `${base}.0.5`,
    externalStub: `${base}.0.6`,
    fdm: `${base}.0.7`,
    // node number is 1-based (node 1 -> base.1.0), matching the deterministic list order
    nodeIp: (num) => `${base}.${num}.0`,
  };
}

// The repotag prefix used in seeded app specs and pulled by node dockerd via the
// registry's network alias — base-independent.
export const REGISTRY_REPO_HOST = `${REGISTRY_ALIAS}:${REGISTRY_PORT}`;
