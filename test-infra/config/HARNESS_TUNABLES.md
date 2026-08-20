# Harness config tunables, as ratios of production

Generated from `ZelBack/config/default.js` and `test-infra/config/shared.js`.
Regenerate rather than hand-edit; every suite header quotes these numbers and a
checker verifies them.

A **factor** is production divided by harness: 10x means the harness reaches the
same behaviour ten times sooner. Two knobs the code relates by an inequality must
carry the SAME factor, or the property between them is deleted or inverted - see
`fluxModels/workstreams/test-harness/HARNESS_CONFIG_COMPRESSION.md`.

## Layer 2 - `shared.js`, applied to every suite

| key | production | harness | factor |
|---|---:|---:|---:|
| `confirmation.daemonExpiredMs` | 19200000 | 600000 | 32.0x |
| `confirmation.daemonStaleMs` | 7500000 | 300000 | 25.0x |
| `confirmation.pollIntervalMs` | 30000 | 5000 | 6.0x |
| `fluxapps.appSyncDegradedThreshold` | 4 | 1 | 4.0x |
| `fluxapps.appSyncMinCompletions` | 3 | 1 | 3.0x |
| `fluxapps.appSyncMinPeerUptime` | 7500 | 0 | n/a |
| `fluxapps.appSyncPeerThreshold` | 12 | 2 | 6.0x |
| `fluxapps.bootDelayMultiplier` | 1 | 0.01 | 100.0x |
| `fluxapps.cpuCheckIntervalMs` | 900000 | 30000 | 30.0x |
| `fluxapps.daemonInfoIntervalMs` | 30000 | 5000 | 6.0x |
| `fluxapps.defaultSwap` | 2 | 0 | n/a |
| `fluxapps.discoveryConnectionDelayMs` | 500 | 100 | 5.0x |
| `fluxapps.discoveryFailRetryMs` | 120000 | 5000 | 24.0x |
| `fluxapps.discoveryRetryMs` | 60000 | 5000 | 12.0x |
| `fluxapps.explorerDeepRestoreBlocks` | 100 | 0 | n/a |
| `fluxapps.explorerPollIntervalMs` | 5000 | 250 | 20.0x |
| `fluxapps.explorerSyncRetryMs` | 120000 | 5000 | 24.0x |
| `fluxapps.forceRemovalIntervalMs` | 7200000 | 120000 | 60.0x |
| `fluxapps.globalCmdDelayMs` | 500 | 100 | 5.0x |
| `fluxapps.hashSyncEphemeralPeers` | 5 | 3 | 1.7x |
| `fluxapps.hashSyncFallbackRecheckBlocks` | 100 | 10 | 10.0x |
| `fluxapps.hashSyncMaxRetries` | 3 | 2 | 1.5x |
| `fluxapps.hashSyncRetryMs` | 300000 | 10000 | 30.0x |
| `fluxapps.hashSyncSettleMs` | 4000 | 2000 | 2.0x |
| `fluxapps.hddFileSystemMinimum` | 10 | 2 | 5.0x |
| `fluxapps.imageComplianceIntervalMs` | 3600000 | 60000 | 60.0x |
| `fluxapps.imageUpdateCheckIntervalMs` | 21600000 | 5000 | 4320.0x |
| `fluxapps.imageUpdateDelayAfterRedeployMs` | 120000 | 1000 | 120.0x |
| `fluxapps.imageUpdateDelayBetweenAppsMs` | 5000 | 100 | 50.0x |
| `fluxapps.imageUpdateDelayBetweenComponentsMs` | 1000 | 100 | 10.0x |
| `fluxapps.imageUpdateInitialDelayMaxMs` | 1800000 | 2000 | 900.0x |
| `fluxapps.imageUpdateInitialDelayMinMs` | 600000 | 1000 | 600.0x |
| `fluxapps.installation.delay` | 120 | 5 | 24.0x |
| `fluxapps.installCollisionWaitMs` | 90000 | 5000 | 18.0x |
| `fluxapps.locationTtlS` | 7500 | 63 | 119.0x |
| `fluxapps.masterSlaveIntervalMs` | 30000 | 3000 | 10.0x |
| `fluxapps.minHashSyncPeers` | 12 | 1 | 12.0x |
| `fluxapps.minIncoming` | 4 | 2 | 2.0x |
| `fluxapps.minOutgoing` | 8 | 4 | 2.0x |
| `fluxapps.minUniqueIpsIncoming` | 3 | 2 | 1.5x |
| `fluxapps.minUniqueIpsOutgoing` | 7 | 3 | 2.3x |
| `fluxapps.minUpTime` | 1800 | 10 | 180.0x |
| `fluxapps.nodeMonitorCheckTimeoutMs` | 10000 | 5000 | 2.0x |
| `fluxapps.nodeMonitorConfirmationLossDelayMs` | 1200000 | 10000 | 120.0x |
| `fluxapps.nodeMonitorDosRecoveryDelayMs` | 600000 | 10000 | 60.0x |
| `fluxapps.nodeMonitorErrorRecoveryDelayMs` | 120000 | 5000 | 24.0x |
| `fluxapps.nodeMonitorIntervalMs` | 1200000 | 10000 | 120.0x |
| `fluxapps.nodeMonitorRemovalDelayMs` | 60000 | 1000 | 60.0x |
| `fluxapps.nonEnterpriseSpawnDelayMs` | 120000 | 500 | 240.0x |
| `fluxapps.peerNotifyIntervalMs` | 3600000 | 30000 | 120.0x |
| `fluxapps.portRestoreIntervalMs` | 600000 | 30000 | 20.0x |
| `fluxapps.portTestBindDelayMs` | 5000 | 100 | 50.0x |
| `fluxapps.portTestMaxAttempts` | 5 | 2 | 2.5x |
| `fluxapps.portTestPeerTimeoutMs` | 30000 | 3000 | 10.0x |
| `fluxapps.portTestPropagationDelayMs` | 10000 | 100 | 100.0x |
| `fluxapps.redeploy.composedDelay` | 5 | 1 | 5.0x |
| `fluxapps.redeploy.delay` | 30 | 1 | 30.0x |
| `fluxapps.removal.delay` | 300 | 5 | 60.0x |
| `fluxapps.spawnDeferrals.capacityGap.largeMs.enterprise` | 1800000 | 350 | 5142.9x |
| `fluxapps.spawnDeferrals.capacityGap.largeMs.standard` | 7020000 | 700 | 10028.6x |
| `fluxapps.spawnDeferrals.capacityGap.mediumMs.enterprise` | 1260000 | 400 | 3150.0x |
| `fluxapps.spawnDeferrals.capacityGap.mediumMs.standard` | 5220000 | 800 | 6525.0x |
| `fluxapps.spawnDeferrals.capacityGap.smallMs.enterprise` | 720000 | 450 | 1600.0x |
| `fluxapps.spawnDeferrals.capacityGap.smallMs.standard` | 3420000 | 900 | 3800.0x |
| `fluxapps.spawnDeferrals.datacenterMs.enterprise` | 1620000 | 250 | 6480.0x |
| `fluxapps.spawnDeferrals.datacenterMs.standard` | 3420000 | 500 | 6840.0x |
| `fluxapps.spawnDeferrals.staticIpMs.enterprise` | 1620000 | 200 | 8100.0x |
| `fluxapps.spawnDeferrals.staticIpMs.standard` | 3420000 | 400 | 8550.0x |
| `fluxapps.spawnDeferrals.targetedNodesMs.enterprise` | 1800000 | 150 | 12000.0x |
| `fluxapps.spawnDeferrals.targetedNodesMs.standard` | 3420000 | 300 | 11400.0x |
| `fluxapps.spawnDelayMultiplier` | 1 | 0.002 | 500.0x |
| `fluxapps.spawnReconfirmDelayMs` | 7500000 | 30000 | 250.0x |
| `fluxapps.syncResponseThrottleMs` | 300000 | 10000 | 30.0x |
| `fluxapps.syncTimeoutMs` | 120000 | 30000 | 4.0x |
| `fluxapps.tempMsgTtlS` | 3600 | 300 | 12.0x |
| `fluxapps.wsHandshakeTimeoutMs` | 10000 | 5000 | 2.0x |
| `peers.wsMaxMissedPongs` | 3 | 2 | 1.5x |
| `peers.wsPingIntervalMs` | 15000 | 2000 | 7.5x |
| `syncthing.monitorIntervalMs` | 30000 | 3000 | 10.0x |
| `syncthing.stallNudgeAfterMs` | 180000 | 6000 | 30.0x |
| `syncthing.stallNudgeMaxIntervalMs` | 900000 | 12000 | 75.0x |
| `syncthing.stallRemoveMinNudges` | 3 | 2 | 1.5x |
| `syncthing.stallRemoveMinWindowMs` | 1200000 | 30000 | 40.0x |
| `system.bootDaemonTimeoutMs` | 300000 | 30000 | 10.0x |
| `system.bootSyncTimeoutMs` | 300000 | 30000 | 10.0x |
| `system.heartbeatIntervalMs` | 30000 | 10000 | 3.0x |

## Knobs with no reader - the harness value changes nothing

These are set in `shared.js` and look like compression. The code never reads them;
it uses a hardcoded constant instead, at the production value, in every suite.

| key | production | harness | apparent factor | what the code actually uses |
|---|---:|---:|---:|---|
| `fluxapps.hashSyncIntervalMs` | 1800000 | 30000 | 60.0x | literal `30 * 60 * 1000` (serviceManager.js:679) |
| `fluxapps.removalSpacingMs` | 60000 | 1000 | 60.0x | nothing - no equivalent |
| `fluxapps.spawnDelayMs` | 0 | 10000 | n/a | nothing - no equivalent |

## Values production and the harness share

Deliberately uncompressed - a suite depending on one of these is depending on the
production number.

`syncthing.port` = 8384 · `fluxapps.maxAppsPerNode` = 200 · `fluxapps.blocksLasting` = 22000 · `fluxapps.newMinBlocksAllowance` = 100 · `fluxapps.daemonPONFork` = 2020000 · `fluxapps.hashSyncResponseTimePerHashMs` = 150 · `fluxapps.hashSyncBufferMs` = 5000 · `fluxapps.hashSyncMaxRounds` = 4 · `fluxapps.hashSyncPeersPerRound` = 3 · `fluxapps.installingTtlS` = 900 · `fluxapps.installErrorTtlS` = 86400 · `fluxapps.installation.probability` = 100 · `fluxapps.removal.probability` = 25 · `fluxapps.redeploy.probability` = 2
