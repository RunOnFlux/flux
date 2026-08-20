module.exports = {
  testEventStream: true,
  logConsole: true,
  fluxTeamFluxID: '19J4Ef396goaQhrqgNLTFvtCXYqjFAx2Js',
  daemon: { host: '198.18.0.3' },
  benchmark: { host: '198.18.0.3' },
  // upnpService builds its client at module load, and with no gateway URL the client
  // discovers one by SSDP - every node multicasting to 239.255.255.250:1900 for the life of
  // the run. Naming a gateway replaces discovery with a fixed device, which is the point of
  // the hook. The stub serves a device description with no WAN connection service, so
  // support verification fails exactly as it does today and no node believes it has UPnP -
  // the behaviour is unchanged, only the searching stops.
  // nodeIp stays empty as in production: it is the node's own address for a port mapping,
  // it cannot be a shared constant, and no mapping is ever made because verification fails.
  upnp: { gatewayUrl: 'http://198.18.0.6:3000/upnp/device.xml', nodeIp: '' },
  // Empty disables analytics. The app default is the live cloudaudit endpoint and
  // the fleet network has egress, so without this a run reports suite activity -
  // generated app names, fixture identities, 198.18.x addresses - as real traffic.
  analytics: { url: '' },
  // compressed decider cadence: the syncthing readiness/stall loop runs every 3s
  // and a stall is declared after 4 no-progress cycles (~12s) instead of ~5min.
  syncthing: {
    ip: '198.18.0.4',
    port: 8384,
    monitorIntervalMs: 3000,
    // stall ladder compressed for suite time: first nudge ~6s after flat-idle,
    // removal after 2 failed nudges over >=30s with a CONNECTED synced peer
    stallNudgeAfterMs: 6000,
    stallNudgeMaxIntervalMs: 12000,
    stallRemoveMinWindowMs: 30000,
    stallRemoveMinNudges: 2,
    // The repository a legacy node installs syncthing from, served by the external
    // stub out of the node image rather than by apt.syncthing.net.
    aptSourceUrl: 'http://198.18.0.6:3000/apt/',
    releaseKeyUrl: 'http://198.18.0.6:3000/apt/keyring.gpg',
  },
  system: {
    bootIdPath: '/tmp/flux-boot-config/boot-id',
    heartbeatIntervalMs: 10000,
    bootSyncTimeoutMs: 30000,
    bootDaemonTimeoutMs: 30000,
  },
  peers: {
    wsPingIntervalMs: 2000,
    wsMaxMissedPongs: 2,
  },
  confirmation: {
    pollIntervalMs: 5000,
    // The stale/expired verdicts remove every local app, so the fleet default
    // must ride out multi-second process stalls under parallel-gate load
    // (production is minutes-scale). Suites that exercise the stale/expiry
    // removal flows override these per-env to fast values.
    daemonStaleMs: 300000,
    daemonExpiredMs: 600000,
  },
  github: {
    rawBaseUrl: 'http://198.18.0.6:3000',
    apiBaseUrl: 'http://198.18.0.6:3000',
  },
  geolocation: {
    ipApiBaseUrl: 'http://198.18.0.6:3000',
  },
  stats: { baseUrl: 'http://198.18.0.6:3000' },
  pricing: {
    fluxRatesBaseUrl: 'http://198.18.0.6:3000',
    coingeckoBaseUrl: 'http://198.18.0.6:3000',
  },
  mongodb: { signingKeyBaseUrl: 'http://198.18.0.6:3000' },
  // the stub serves iplocation.bin.gz, so harness nodes exercise the real
  // table reader rather than skipping it. Its default artifact puts the whole
  // harness range in ONE organisation, which is the single-fault-domain
  // posture the tableless fallback produced - suites written against that keep
  // their meaning. POST /iplocation {domains:n} to the stub's control port
  // splits the fleet n ways. Nothing here ever calls out to github.
  policy: {
    baseUrl: 'http://198.18.0.6:3000',
  },
  fluxapps: {
    minOutgoing: 4,
    minIncoming: 2,
    minUniqueIpsOutgoing: 3,
    minUniqueIpsIncoming: 2,
    minHashSyncPeers: 1,
    minUpTime: 10,
    maxAppsPerNode: 200,
    blocksLasting: 22000,
    newMinBlocksAllowance: 100,
    daemonPONFork: 2020000,
    hddFileSystemMinimum: 2,
    defaultSwap: 0,
    appSyncPeerThreshold: 2,
    appSyncDegradedThreshold: 1,
    appSyncMinPeerUptime: 0,
    appSyncMinCompletions: 1,
    syncTimeoutMs: 30000,
    hashSyncMaxRetries: 2,
    hashSyncRetryMs: 10000,
    hashSyncSettleMs: 2000,
    hashSyncResponseTimePerHashMs: 150,
    hashSyncBufferMs: 5000,
    hashSyncMaxRounds: 4,
    hashSyncPeersPerRound: 3,
    hashSyncEphemeralPeers: 3,
    hashSyncFallbackRecheckBlocks: 10,
    syncResponseThrottleMs: 10000,
    wsHandshakeTimeoutMs: 5000,
    discoveryConnectionDelayMs: 100,
    nodeMonitorRemovalDelayMs: 1000,
    nodeMonitorDosRecoveryDelayMs: 10000,
    nodeMonitorConfirmationLossDelayMs: 10000,
    nodeMonitorErrorRecoveryDelayMs: 5000,
    nodeMonitorCheckTimeoutMs: 5000,
    bootDelayMultiplier: 0.01,
    spawnDelayMs: 10000,
    removalSpacingMs: 1000,
    // Per-document expiry for the ephemeral app collections, in seconds. These
    // three also serve as GOSSIP ACCEPTANCE WINDOWS - messageStore drops an
    // incoming broadcast whose broadcastedAt is older than the window - so a
    // value below what the fleet takes to produce and deliver a message does
    // not make a suite faster, it makes peers refuse each other.
    //
    // They read as 300/60/300 from the day the harness was first stood up until
    // 2026-08-20 and none of them ever took effect: the config keys were wired
    // to collection-level TTL indexes that were dropped when expiry moved
    // per-document, so every suite ran on the production durations while this
    // file claimed otherwise. The numbers below are derived; the old ones were
    // round guesses that nothing could contradict.
    //
    // A running-app location record is refreshed by the peerNotifyIntervalMs
    // re-announce, so the ratio between them IS the property: how many
    // announcements a node may miss before its apps look gone. Production is
    // 7500s/3600s = 2.08, so this tracks the announce interval's 120x.
    locationTtlS: 63, // 2.10 announces, against production's 2.08
    // NOT compressed, and not compressible by a ratio. What this must outlive is
    // an install, and the harness does not compress installs - they are real
    // image pulls and real container starts. The suites' own budgets say so:
    // waitForAppInstalled is given 120s routinely and 300s at the top end. At
    // the old 60s the marker expired mid-install and peers rejected any
    // installing claim older than a minute; suite 78 reads exactly that claim.
    installingTtlS: 900,
    // NOT compressed, for the same reason: the errors it accumulates come from
    // real failed installs, and suite 27 waits for five of them to reach the
    // network-wide threshold. No knob paces that, so there is no ratio to hold.
    installErrorTtlS: 86400,
    tempMsgTtlS: 300,
    hashSyncIntervalMs: 30000,
    peerNotifyIntervalMs: 30000,
    cpuCheckIntervalMs: 30000,
    statsSampleIntervalMs: 2000,
    portRestoreIntervalMs: 30000,
    imageComplianceIntervalMs: 60000,
    forceRemovalIntervalMs: 120000,
    installCollisionWaitMs: 5000,
    portTestBindDelayMs: 100,
    portTestPropagationDelayMs: 100,
    portTestPeerTimeoutMs: 3000,
    portTestMaxAttempts: 2,
    spawnReconfirmDelayMs: 30000,
    nonEnterpriseSpawnDelayMs: 500,
    globalCmdDelayMs: 100,
    discoveryAutostart: false,
    discoveryRetryMs: 5000,
    discoveryFailRetryMs: 5000,
    connectionBackoffMs: [2000, 5000, 10000, 15000],
    nodeMonitorIntervalMs: 10000,
    spawnDeferrals: {
      targetedNodesMs: { enterprise: 150, standard: 300 },
      staticIpMs: { enterprise: 200, standard: 400 },
      datacenterMs: { enterprise: 250, standard: 500 },
      capacityGap: {
        largeMs: { enterprise: 350, standard: 700 },
        mediumMs: { enterprise: 400, standard: 800 },
        smallMs: { enterprise: 450, standard: 900 },
      },
    },
    spawnDelayMultiplier: 0.002,
    daemonInfoIntervalMs: 5000,
    // The floor on how fast a driven chain can be processed: a block is not
    // looked at until the next poll, so at production's 5000 a suite driving its
    // own blocks still waits five seconds for each one, and everything hung off
    // block processing - the give-up pass among them - inherits that. Measured
    // at 4.8s a block before this was tunable.
    explorerPollIntervalMs: 250,
    explorerSyncRetryMs: 5000,
    explorerDeepRestoreBlocks: 0,
    imageUpdateCheckIntervalMs: 5000,
    imageUpdateInitialDelayMinMs: 1000,
    imageUpdateInitialDelayMaxMs: 2000,
    imageUpdateDelayBetweenAppsMs: 100,
    imageUpdateDelayAfterRedeployMs: 1000,
    imageUpdateDelayBetweenComponentsMs: 100,
    masterSlaveIntervalMs: 3000, // compressed g: FDM election cycle (prod 30s)
    installation: { probability: 100, delay: 5 },
    removal: { probability: 25, delay: 5 },
    redeploy: { probability: 2, delay: 1, composedDelay: 1 },
  },
};
