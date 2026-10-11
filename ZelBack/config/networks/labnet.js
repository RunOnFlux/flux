'use strict';

// labnet: a private Flux network for the lab (fluxd -labnet). Its chain starts
// at height 0 and runs Proof of Node with 30 s blocks from height 2, and its
// transparent addresses use the testnet version bytes (tm…, t2…).
//
// The keys named here are the lab's own: the team FluxID and the policy signing
// key are held by the lab, and the payment address is in the labnet seed
// wallet. Services that answer the same on every network - prices, stats, the marketplace -
// are the real ones. Those that belong to a network are the lab's own, on the labnet VM: the
// policy bundle, published by fluxos-network-policy's own signing scripts with the lab key to
// the lab Forgejo, and geolocation, answered from the lab address registry, which sets each
// lab address's kind of line.

const LAB_VM = 'http://172.16.32.211';
const LAB_TEAM_FLUXID = '1KocphA8j8vcaLEZmeKzw3g45Q4tuKWkQH';
// The one app-payment receiver, in force from genesis.
const LAB_PAYMENT_ADDRESS = 'tmRj9rspfGbyuhVZvupXNttvP4j9YmzWbkv';

// Every spec version is in force from genesis.
const appSpecsEnforcementHeights = {
  1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0,
};

const portBlockheightChange = 0;

module.exports = {
  // userconfig.initial.development changes nothing on labnet.
  developmentApplies: false,
  daemon: {
    chainValidHeight: 0,
    port: 36125,
    rpcport: 36124,
    initialHeaderFloor: 0,
    chainSubdir: 'labnet',
  },
  benchmark: {
    port: 36225,
    rpcport: 36224,
  },
  fluxTeamFluxID: LAB_TEAM_FLUXID,
  fluxSupportTeamFluxID: [LAB_TEAM_FLUXID],
  fluxapps: {
    price: [
      {
        height: -1,
        cpu: 3,
        ram: 1,
        hdd: 0.5,
        minPrice: 1,
        port: 2,
        scope: 6,
        staticip: 3,
      },
    ],
    teamSupportAddress: [{ height: 0, address: LAB_TEAM_FLUXID }],
    usersToExtend: [LAB_TEAM_FLUXID],
    appSpecsEnforcementHeights,
    // Storage links must be https at this host. labnet runs no storage service.
    storageHost: '172.16.32.211',
    // Every receiver is the one lab address, so the receiver a deployment is
    // told to pay is that address at every height, and a development node
    // accepts no other. As the multisig receivers, it also signs soft-fork
    // messages.
    address: LAB_PAYMENT_ADDRESS,
    addressMultisig: LAB_PAYMENT_ADDRESS,
    addressMultisigB: LAB_PAYMENT_ADDRESS,
    addressDevelopment: LAB_PAYMENT_ADDRESS,
    multisigAddressChange: 0,
    // 1, not 0: the scan cursor is set to epochstart - 1 when the explorer
    // bootstrap fails, and the cursor holds heights from 0. Genesis carries no
    // app message.
    epochstart: 1,
    publicepochstart: 1,
    portBlockheightChange,
    explorerInsightSkipRanges: [],
    minimumInstances: 3,
    // A lab is a handful of nodes; these are the harness's fleet values.
    minOutgoing: 4,
    minUniqueIpsOutgoing: 3,
    minIncoming: 2,
    minUniqueIpsIncoming: 2,
    minHashSyncPeers: 1,
    minUpTime: 10,
    appSyncPeerThreshold: 2,
    appSyncDegradedThreshold: 1,
    appSyncMinCompletions: 1,
    appSyncMinPeerUptime: 0,
    appSyncFallbackMinutes: 5,
    daemonPONFork: 2,
  },
  enterprisePublicKeys: [],
  fdmAddresses: [],
  policy: {
    signedBaseUrl: `${LAB_VM}:3000/lab/fluxos-network-policy/raw/branch/signed`,
    // The lab policy signing key (ed25519, raw public key).
    publicKeys: ['39835c5ea604ecbcfbd3ba46cf2f9101f1c1f54675a00cc8fae01dce1e4868e6'],
    minConfirmingPeers: 1,
  },
  geolocation: {
    ipApiBaseUrl: `${LAB_VM}:8082`,
  },
  stats: {
    baseUrl: 'https://stats.runonflux.io',
  },
  pricing: {
    fluxRatesBaseUrl: 'https://viprates.runonflux.io',
    coingeckoBaseUrl: 'https://api.coingecko.com',
  },
  analytics: {
    url: '',
  },
  // Never read (developmentApplies is false); the production values above, so
  // the key set matches every other profile's.
  development: {
    fluxapps: {
      appSpecsEnforcementHeights,
      portBlockheightChange,
    },
  },
};
