'use strict';

// A second network for the tests: its own ports, heights and identities, the same keys as
// mainnet's profile.

const LAB_VM = 'http://network.invalid';
const LAB_TEAM_FLUXID = '1KocphA8j8vcaLEZmeKzw3g45Q4tuKWkQH';
// The one app-payment receiver, in force from genesis.
const LAB_PAYMENT_ADDRESS = 'tmRj9rspfGbyuhVZvupXNttvP4j9YmzWbkv';

// Every spec version is in force from genesis.
const appSpecsEnforcementHeights = {
  1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0,
};

const portBlockheightChange = 0;

module.exports = {
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
    // Every app rule applies from the first block.
    minimumInstancesV8Block: 0,
    newMinBlocksAllowanceBlock: 0,
    cancel1BlockMinBlocksAllowanceBlock: 0,
    removeBlocksAllowanceIntervalBlock: 0,
    applyMinimumPriceOn3Instances: 0,
    applyMinimumForExtraInstances: 0,
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
    storageHost: 'network.invalid',
    // Every receiver is the one lab address, so the receiver a deployment is
    // told to pay is that address at every height, and a node
    // accepts no other. As the multisig receivers, it also signs soft-fork
    // messages.
    address: LAB_PAYMENT_ADDRESS,
    addressMultisig: LAB_PAYMENT_ADDRESS,
    addressMultisigB: LAB_PAYMENT_ADDRESS,
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
    incomingCapFloor: 32,
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
};
