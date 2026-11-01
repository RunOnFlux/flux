// The routers FluxOS nodes sit behind, as named gateway profiles. Each is a behaviour a
// survey of 953 routers in front of 4,466 nodes measured (2026-10-26), built from the
// external-http stub's gateway switches, and the outcome FluxOS reaches on it:
//
//   renews          UPnP verified; the renewal test shows the router restarts a lease when a
//                   mapping is added again, and long-lived mappings are leased
//   does-not-renew  UPnP verified; the renewal test runs and shows no renewal, and long-lived
//                   mappings are permanent
//   keeps-no-lease  UPnP verified; the router keeps no test mapping's lease, so no renewal test
//                   runs and long-lived mappings are permanent
//   unverified      UPnP not verified: the node maps nothing of its own
//
// A profile names router software and models only: nothing that identifies a router, a
// network or a node behind one.
//
// A Freebox that refused the survey's first leased mapping with 718 is not a profile: 718
// says another machine holds the port, and the survey cannot tell that apart from a router
// that misreports it.
import {
  enableUpnpGateway, setUpnpCapacity, setUpnpDeleteFault, setUpnpEmptyLookups, setUpnpLeases,
  setUpnpSlowAdds,
} from './external-http-control.js';

// a machine other than the node, holding the mappings of a full table
const OTHER_MACHINE = '192.168.1.200';

/** Mappings another machine holds, from external port 40000 up. */
function heldByAnother(count) {
  return Array.from({ length: count }, (_, i) => ({
    externalPort: 40000 + i,
    protocol: 'TCP',
    internalPort: 40000 + i,
    internalClient: OTHER_MACHINE,
    description: 'another machine',
    leaseDuration: 0,
  }));
}

export const ROUTERS = {
  'miniupnpd-2': {
    surveyed: '770 routers renew a lease when a mapping is added again: every miniupnpd 2.x that took a leased mapping, and most libupnp and vendor stacks',
    expect: 'renews',
  },
  'fritzos-8': {
    surveyed: 'every FRITZ!Box on FRITZ!OS 8.x answers an add of a held mapping and leaves it as it is, so its lease is not restarted; it stores a description\'s underscores and spaces as dots',
    gateway: { fritzDescriptions: true },
    leases: { keepsHeld: true },
    expect: 'does-not-renew',
  },
  'miniupnpd-1.8': {
    surveyed: 'every miniupnpd 1.8 (TP-Link Archer, Mercusys) and some 1.6 and 1.9 leave a held mapping as it is when it is added again',
    leases: { keepsHeld: true },
    expect: 'does-not-renew',
  },
  'omada-static': {
    surveyed: '44 routers show every lease as asked, never counting down, and renew it (TP-Link ER605/ER707/Omada, libupnp 1.6.18 and 1.6.19)',
    leases: { staticLeases: true },
    expect: 'renews',
  },
  'verizon-g1100': {
    surveyed: 'the Verizon FiOS G1100 shows every lease as asked and leaves a held mapping as it is when it is added again',
    leases: { staticLeases: true, keepsHeld: true },
    expect: 'does-not-renew',
  },
  mikrotik: {
    surveyed: 'every MikroTik RouterOS (6.49 and 7.x) refuses a leased mapping with 725',
    leases: { fault: 725 },
    expect: 'keeps-no-lease',
  },
  'drops-lease': {
    surveyed: 'a router that takes a leased mapping and holds it as permanent',
    leases: { drops: true },
    expect: 'keeps-no-lease',
  },
  'one-week-permanent': {
    surveyed: '232 routers hold a mapping asked for with no lease for IGDv2\'s one week (miniupnpd 2.3.8 and 2.3.9 on IGDv2, Freebox, Huawei ATP, some libupnp)',
    leases: { permanentAs: 7 * 24 * 60 * 60 },
    expect: 'renews',
  },
  'long-minimum': {
    surveyed: 'routers that hold a short lease for a minimum of their own and count it down (Sagemcom F3896LG: 900 s)',
    leases: { minimumLease: 900 },
    expect: 'does-not-renew',
  },
  'long-minimum-static': {
    surveyed: 'routers that show every lease as one day (libupnp 1.6.22 on Cisco and Technicolor gateways)',
    leases: { minimumLease: 86400, staticLeases: true },
    expect: 'does-not-renew',
  },
  'refuses-refresh': {
    surveyed: 'the TP-Link Archer VR2100v refuses an add of a held mapping with 501',
    leases: { refreshFault: 501 },
    expect: 'does-not-renew',
  },
  'first-add-402': {
    surveyed: 'routers that refuse a leased mapping with 402 (D-Link DIR-X3260, Cisco XSR150DX, miniupnpd 2.1)',
    leases: { fault: 402 },
    expect: 'keeps-no-lease',
  },
  'first-add-606': {
    surveyed: 'routers that refuse a leased mapping with 606 (OPNsense and FreeBSD miniupnpd 2.x)',
    leases: { fault: 606 },
    expect: 'keeps-no-lease',
  },
  'full-501': {
    surveyed: 'a full table that refuses a new mapping with 501 (Sagemcom F@st5688b, TP-Link AX10)',
    gateway: { capacity: 4, mappings: heldByAnother(4) },
    fullFault: 501,
    expect: 'unverified',
  },
  'eero-empty-lookup': {
    surveyed: 'eero (Pro 6, Pro 7) answers a lookup of any port with an empty entry',
    emptyLookups: true,
    expect: 'keeps-no-lease',
  },
  'kaon-dg2200tn': {
    surveyed: 'the Kaon DG2200TN keeps a lease and holds 128 mappings, answers a port test\'s mapping after the node has stopped waiting, and answers a removal it carries out with a fault',
    gateway: { capacity: 128 },
    slowAdds: { ms: 15000, description: 'Flux_Test_App' },
    deleteFault: 501,
    expect: 'renews',
  },
};

/**
 * Put a node behind the router `name` names, with a table holding only what the profile
 * gives it.
 * @param {string} ip
 * @param {string} name - a key of ROUTERS
 * @returns {Promise<object>} the profile
 */
export async function putBehindRouter(ip, name) {
  const router = ROUTERS[name];
  if (!router) throw new Error(`putBehindRouter: no router profile ${name}`);
  await enableUpnpGateway(ip, router.gateway ?? {});
  if (router.leases) await setUpnpLeases(ip, router.leases);
  if (router.fullFault) await setUpnpCapacity(ip, router.gateway.capacity, { fault: router.fullFault });
  if (router.emptyLookups) await setUpnpEmptyLookups(ip, true);
  if (router.slowAdds) await setUpnpSlowAdds(ip, router.slowAdds);
  if (router.deleteFault) await setUpnpDeleteFault(ip, router.deleteFault);
  return router;
}
