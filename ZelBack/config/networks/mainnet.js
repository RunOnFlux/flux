'use strict';

// The Flux main network. Every value here differs between networks; default.js
// places each one, and every profile carries exactly these keys.

const appSpecsEnforcementHeights = {
  1: 0, // blockheight v1 is deprecated. Not possible to use api to update to its specs
  2: 0, // blockheight
  3: 983000, // blockheight. Since this blockheight specification of type 3 is active. User can still submit v1 or v2. UI allows only v2, v3
  4: 1004000, // v4 available, composition
  5: 1142000, // v5 available adding contacts, geolocation
  6: 1300000, // v6, expiration, app price, t3
  7: 1420000, // v7, nodes selection, secrets, private images (nodes selection allows secrets, private image - scope), staticip
  8: 1932380, // v8, brings enterprise apps using arcaneOS features to run these apps. // Around June 23th
};

const portBlockheightChange = 1420000;

module.exports = {
  // Whether userconfig.initial.development selects the values under `development`.
  developmentApplies: true,
  daemon: {
    chainValidHeight: 1062000,
    port: 16125,
    rpcport: 16124,
    // The daemon header height assumed until the daemon reports one.
    initialHeaderFloor: 1136836,
    // Where fluxd keeps this network's chain and debug.log, under its datadir.
    chainSubdir: '',
  },
  benchmark: {
    port: 16225,
    rpcport: 16224,
  },
  fluxTeamFluxID: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
  // A list, so support can be granted to (or revoked from) an identity without
  // touching every privilege check. A bare string is still read as a one entry
  // list, so a node carrying an older local override keeps working.
  fluxSupportTeamFluxID: [
    '16dNCFf7nR3nx5iwn2RQMBw6KcJXkE3JC1',
    '15c3aH6y9Koq1Dg1rGXE9Ypn5nL2AbSJCu',
    '1NGqYirE4T9wzd1ZcGrw3HjETiuCkt6Sgy',
    '13BBPcpHxwCaC61vjQgK6qeDcprFJEGVkP',
  ],
  fluxapps: {
    // in flux main chain per month (blocksLasting)
    price: [
      { // any price fork can be done by adjusting object similarily.
        height: -1, // height from which price spec is valid
        cpu: 3, // per 0.1 cpu core,
        ram: 1, // per 100mb,
        hdd: 0.5, // per 1gb,
        minPrice: 1, // minimum price that has to be paid for registration or update. Flux listens only to message above or equal this price
        port: 2, // additional price per enterprise port
        scope: 6, // additional price for application targetting specific nodes, private images
        staticip: 3, // additional price per application for targetting nodes that have static ip address
      },
      {
        height: 983000, // height from which price spec is valid. Counts from when app was registerd on blockchain!
        cpu: 0.3, // per 0.1 cpu core,
        ram: 0.1, // per 100mb,
        hdd: 0.05, // per 1gb,
        minPrice: 0.1, // minimum price that has to be paid for registration or update. Flux listens only to message above or equal this price
        port: 2, // additional price per enterprise port
        scope: 6, // additional price for application targetting specific nodes, private images
        staticip: 3, // additional price per application for targetting nodes that have static ip address
      },
      {
        height: 1004000, // height from which price spec is valid. Counts from when app was registerd on blockchain! 1004000
        cpu: 0.06, // per 0.1 cpu core,
        ram: 0.02, // per 100mb,
        hdd: 0.01, // per 1gb,
        minPrice: 0.01, // minimum price that has to be paid for registration or update. Flux listens only to message above or equal this price
        port: 2, // additional price per enterprise port
        scope: 6, // additional price for application targetting specific nodes, private images
        staticip: 3, // additional price per application for targetting nodes that have static ip address
      },
      {
        height: 1288000, // height from which price spec is valid. Counts from when app was registerd on blockchain! 1004000
        cpu: 0.15, // per 0.1 cpu core,
        ram: 0.05, // per 100mb,
        hdd: 0.02, // per 1gb,
        minPrice: 0.01, // minimum price that has to be paid for registration or update. Flux listens only to message above or equal this price
        port: 2, // additional price per enterprise port
        scope: 6, // additional price for application targetting specific nodes, private images
        staticip: 3, // additional price per application for targetting nodes that have static ip address
      },
      // soft fork 1
      {
        height: 1594832, // height from which price spec is valid. Counts from when app was registerd on blockchain! 1004000
        cpu: 0.15, // per 0.1 cpu core,
        ram: 0.05, // per 100mb,
        hdd: 0.02, // per 1gb,
        minPrice: 0.01, // minimum price that has to be paid for registration or update. Flux listens only to message above or equal this price
        port: 1.5, // additional price per enterprise port
        scope: 6, // additional price for application targetting specific nodes, private images
        staticip: 3, // additional price per application for targetting nodes that have static ip address
      },
      // soft fork 2
      {
        height: 1597156, // height from which price spec is valid. Counts from when app was registerd on blockchain! 1004000
        cpu: 0.03, // per 0.1 cpu core,
        ram: 0.01, // per 100mb,
        hdd: 0.004, // per 1gb,
        minPrice: 0.01, // minimum price that has to be paid for registration or update. Flux listens only to message above or equal this price
        port: 0.4, // additional price per enterprise port
        scope: 0.8, // additional price for application targetting specific nodes, private images
        staticip: 0.4, // additional price per application for targetting nodes that have static ip address
      },
    ],
    // Who the support team is, from which height. Only the latest fork at or below
    // a message's own block is consulted, so entries are only ever appended: an
    // edit to one below the tip changes which signatures the past accepts.
    teamSupportAddress: [{
      height: 1851659, // height from which address is valid
      address: '16iJqiVbHptCx87q6XQwNpKdgEZnFtKcyP',
    }, {
      // From here a fork names a list rather than one address. The address above
      // is carried forward - a fork replaces its predecessor rather than adding
      // to it, so leaving it out would stop it signing.
      //
      // Dated about a week ahead of the tip it was written at (2931010, 7th
      // September 2026, ~30s blocks) rather than at it: a node on an older FluxOS
      // reads only the fork at 1851659 and rejects a message signed by any of the
      // new addresses, so the fork has to fall after the network has had time to
      // update.
      height: 2951000, // ~14th September 2026
      addresses: [
        '16iJqiVbHptCx87q6XQwNpKdgEZnFtKcyP',
        '16dNCFf7nR3nx5iwn2RQMBw6KcJXkE3JC1',
        '15c3aH6y9Koq1Dg1rGXE9Ypn5nL2AbSJCu',
        '1NGqYirE4T9wzd1ZcGrw3HjETiuCkt6Sgy',
        '13BBPcpHxwCaC61vjQgK6qeDcprFJEGVkP',
      ],
    }],
    usersToExtend: ['1MCBJn6qsy3YRY2YasdYMYdJcdhy1ev8Rd'], // addresses that can extend applications on behalf of app owners (expire-only updates) addresses cannot be deleted over time, just adding new ones
    appSpecsEnforcementHeights,
    // Flux storage is the only host a storage link may address. The node
    // dereferences F_S_ENV and F_S_CMD with its own signed identity before it
    // starts a container, so the target is not the specification author's to
    // choose. The harness reaches a stand-in under this same name - the stub
    // carries it as a docker network alias and its certificate as a SAN - so
    // the value is not overridden anywhere and a config that changed it would
    // fail TLS against that certificate.
    storageHost: 'storage.runonflux.io',
    // App-payment receivers. `address` from genesis, `addressMultisig` from
    // appSpecsEnforcementHeights[6], `addressMultisigB` from
    // multisigAddressChange; new deployments pay to the latest in force. The two
    // multisigs also sign the soft-fork messages. `addressDevelopment` is a
    // receiver only on a development node.
    address: 't1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6',
    addressMultisig: 't3aGJvdtd8NR6GrnqnRuVEzH6MbrXuJFLUX',
    addressMultisigB: 't3NryfAQLGeFs9jEoeqsxmBN2QLRaRKFLUX',
    addressDevelopment: 't1Mzja9iJcEYeW5B4m4s1tJG8M42odFZ16A',
    multisigAddressChange: 1670000,
    epochstart: 694000,
    publicepochstart: 705000,
    portBlockheightChange,
    // Heights an insight explorer skips because no app message lies strictly
    // between `from` and `to`; the scan resumes at `to`.
    explorerInsightSkipRanges: [{ from: 699420, to: 862002 }],
    minimumInstances: 3,
    minOutgoing: 8,
    minUniqueIpsOutgoing: 7,
    minIncoming: 4,
    minUniqueIpsIncoming: 3,
    minHashSyncPeers: 12,
    minUpTime: 1800, // 30 mins
    appSyncPeerThreshold: 12, // peers needed before starting app sync / spawning
    appSyncDegradedThreshold: 4, // below this, pause spawner — gossip unreliable
    appSyncMinCompletions: 3, // sync responses needed per type before spawner can start
    // Applies ONLY to peers whose build cannot refuse a sync request - one that
    // can is asked whatever its uptime, because it answers for itself. Retires
    // with the last such build.
    appSyncMinPeerUptime: 7500,
    // How long a node waits for a state sync before deciding that what it has
    // is what it gets. Both roads to readiness, and to answering another node's
    // sync request, so a node with a 0 here is authoritative from the moment it
    // starts - which is how a fleet gets a peer that can answer at all.
    //
    // 125 minutes is locationTtlS, in minutes: one full lifetime of a
    // running-app location record, so every holder has had to announce itself
    // at least once. That is what makes waiting it out equivalent to a view,
    // and it is why there is no shorter variant of it for anyone.
    appSyncFallbackMinutes: 125,
    daemonPONFork: 2020000, // block height where PON (Proof of Node) fork activates - chain works 4x faster after this block
  },
  enterprisePublicKeys: [ // list of whitelisted nodes indentity public keys. Most trusted node operators that are publicly known, kyc. Eg Flux team members, Titan.
    '045bd4f81d7bda582141793463edb58e0f3228a873bd6b6680b78586db2969f51dfeda672eae65e64ca814316f77557012d02c73db7876764f5eddb6b6d9d02b5b',
    '042ebcb3a94fe66b9ded6e456871346d6984502bbadf14ed07644e0eb91f8cc0b1f07632c428e1e6793f372d9c303d680de80ae0499d51095676cabf68599e9591',
    '040a0f94fdbd670a4514a7366e8b5f7fbfb264c6ca6ea7d3f37147410b62a50525d1ed1ac83dac029de9203b9cabcf18a01b82e499ba36ea51594fd799999b2a26',
    '04092edca3ed2d2b744a1d93e504568e9d861f38232023835202c155afa9f74e3779c926745a4157a7897ca6dca30aa78aa26e4ee11101ce20db9fc79b686de5f0',
    '045964031bb8818521b99f16d2614f1bc8a9968184c9c38dc09cf95b744dae0f603ff3bbecc7845d952901ebabeb343cdcde3c4325274901768dfb102b9a34f5d6',
    '0459f5c058481d557fb63580bfbf21f3791a2f3a62a62c99b435fd8db1d59e21353bdae35cfe00adaf7c4f2f0d400afc698e9c58ee6a3894c20706b3db7da83750',
    '040ecac42ff4468fa8ae094e125fb8ae67c1a588e7b218ac0a9d270bba882c19db656b7b5d99b1af0fe96c34475545088a5bd87efb9a771174bcdd7fb499dd7ca3',
    '04a52af6e9688fcb9d47096f8a15db67131f9b0bbfb50c28fd22028d9fba18f4e9bd3293b43ed64634dbba11688b4e37f1f8e65629b6a204df352d3ecfb174b9f5',
    '04ce029f9d17da47809cbde46e0ea2eace185f79f98e5718cb4ddc3d84bfd742cd3e3951388fcd2771238ab323fe22d53c3dced2a30326ead0447b10f7db0a829b',
    '04dbbf2ba07d28b0010f4faa0537d963b3481b5d8e7ec0de29f311264a4ab074d4d579aca1c2aa3eb31e96f439a6d6bbf72393584049923f342ed4762f13fe7be4',
    '043c4fe1606c543ca28f107245166321fae026300747a608db94deecbcd2d945f86b29c52a33416464e7823a6c2e3e45c26733f6378be973959cbf9ee4bff79e66',
    '04a898a0bc768ad0b8456b4da7c1e653a715477926fefb47ef20d8bd841854ddf4e1f59c1c3d55f0088eaca53b850e6ab03d0bd00d0b5a70d17ffbc0554b6188d5',
    '0455a20efde6a0685fa15b020e694674170376bc7c23d203e96fb927717db38011b87c36b2f81c5cf68123c5567abf2b29788231966ea4c43c4f5cb759e4c5cdbb',
    '04c765d054bcded999c404145c7396725df81973fe803b3da5e9455173410743f43e20294e17bb41adff8b4ff1ab5540b8bcd98521b438840b6a38e904eb0b247f',
    '03cf1d8b708ca7f5979accb4d0dba35a90391e3dfc4422cf12670c929bb58d16ac',
    '03e29783936a36b396c28706494dbfd35f3d087f2addeb3df32e451f71bf9a53f3',
  ],
  // The load balancers whose X-Forwarded-For this node will believe. A request
  // arriving from any other address has its forwarding headers ignored entirely:
  // every node is reachable directly on its public port, so a header from an
  // unknown peer is chosen by the caller and says nothing.
  //
  // These are the addresses a node OBSERVES as its socket peer - each balancer's
  // public egress - which is not the same as the address its hostname resolves to
  // and not the management address ansible targets it on. Confirmed two ways
  // (inventory plus DNS) before being listed, because a wrong entry here hands
  // that address the power to name any client it likes, while a missing one only
  // costs attribution on that path.
  //
  // Empty is safe and means "trust nothing", which is how this behaves for any
  // balancer not yet listed.
  fdmAddresses: [
    // apps, production
    '5.39.57.42', '5.39.57.43', '5.39.57.44', '5.39.57.45',
    '146.190.83.190', '146.190.103.145', '134.209.107.70', '146.190.105.10',
    '5.161.211.14', '5.161.178.20', '5.161.42.73', '5.161.81.155',
    // apps, staging
    '5.161.215.75', '5.161.109.34', '5.39.57.46', '5.39.57.47',
    // main - one geo-steered name over three regional balancers, so resolving
    // it from a single location returns that region's alone. The eu box is in
    // the ansible inventory by its private address only.
    '5.39.57.40', '128.199.246.121', '5.161.44.226',
    // nodes - the per-node API hostnames the frontend pins to after login, and so
    // the path a playground submission takes. These two are the whole fleet; they
    // are absent from the ansible inventory and deployed by hand, so a change to
    // the balancers will not show up here on its own.
    '5.39.57.41', '5.161.198.150',
  ],
  policy: {
    signedBaseUrl: 'https://raw.githubusercontent.com/RunOnFlux/fluxos-network-policy/signed',
    // Raw ed25519 public keys. A bundle signed by ANY of them is accepted, so the cold key
    // can take over signing without every node needing a release first -- which is the only
    // thing a second key buys. Removing a compromised key from this list IS a release.
    // Kept in step with SIGNING.md in fluxos-network-policy.
    publicKeys: [
      'c31930ec386a49f31321851766d93bcb90bf269cd15bec7a329155a4d79ea380',
      '739ca41408f66c75d6cb4bc1d5c044ca5a118de190081da68e5a7d6839fb69f8',
    ],
    // How many capable peers must answer "not ahead of you" before their agreement stands as
    // confirmation. A sequence is a claim the asker cannot check, so one peer is not
    // evidence: a single stale or lying neighbour would otherwise open the acquisition gate
    // on policy the network has moved past. A peer that is genuinely ahead sends the signed
    // bundle instead, which stands on its own, and a node whose capable peers cannot reach
    // this many asks the publisher, whose answer is signed.
    minConfirmingPeers: 4,
  },
  geolocation: {
    ipApiBaseUrl: 'http://ip-api.com',
  },
  stats: {
    baseUrl: 'https://stats.runonflux.io',
  },
  pricing: {
    fluxRatesBaseUrl: 'https://viprates.runonflux.io',
    // Consulted only when the rates service above is unreachable.
    coingeckoBaseUrl: 'https://api.coingecko.com',
  },
  analytics: {
    url: 'https://cloudaudit.runonflux.io',
  },
  // What a development node (userconfig.initial.development) reads in place of
  // the same keys above. Read only where developmentApplies.
  development: {
    fluxapps: {
      appSpecsEnforcementHeights: {
        ...appSpecsEnforcementHeights,
        7: 1390000,
        8: 1921500,
      },
      portBlockheightChange: 1390000,
    },
  },
};
