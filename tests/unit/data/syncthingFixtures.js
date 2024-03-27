const configFile = `<configuration version="37">
    <device id="AEYDK6D-2U3U5AI-MEDDSIE-5WC7F0K-FDLAOJQ-24AFG44-Z2B749L-BOUX3QM" name="chud" compression="metadata" introducer="false" skipIntroductionRemovals="false" introducedBy="">
        <address>dynamic</address>
        <paused>false</paused>
        <autoAcceptFolders>false</autoAcceptFolders>
        <maxSendKbps>0</maxSendKbps>
        <maxRecvKbps>0</maxRecvKbps>
        <maxRequestKiB>0</maxRequestKiB>
        <untrusted>false</untrusted>
        <remoteGUIPort>0</remoteGUIPort>
        <numConnections>0</numConnections>
    </device>
    <gui enabled="true" tls="false" debugging="true" sendBasicAuthPrompt="false">
        <address>127.0.0.1:8384</address>
        <apikey>uCskiAVNUyAYxdRx9VjpFV4a4UbysKwL</apikey>
        <theme>default</theme>
    </gui>
    <ldap></ldap>
    <options>
        <listenAddress>tcp://:16189</listenAddress>
        <listenAddress>quic://:16189</listenAddress>
        <globalAnnounceServer>default</globalAnnounceServer>
        <globalAnnounceEnabled>false</globalAnnounceEnabled>
        <localAnnounceEnabled>false</localAnnounceEnabled>
        <localAnnouncePort>21027</localAnnouncePort>
        <localAnnounceMCAddr>[ff12::8384]:21027</localAnnounceMCAddr>
        <maxSendKbps>0</maxSendKbps>
        <maxRecvKbps>0</maxRecvKbps>
        <reconnectionIntervalS>60</reconnectionIntervalS>
        <relaysEnabled>true</relaysEnabled>
        <relayReconnectIntervalM>10</relayReconnectIntervalM>
        <startBrowser>true</startBrowser>
        <natEnabled>false</natEnabled>
        <natLeaseMinutes>60</natLeaseMinutes>
        <natRenewalMinutes>30</natRenewalMinutes>
        <natTimeoutSeconds>10</natTimeoutSeconds>
        <urAccepted>-1</urAccepted>
        <urSeen>3</urSeen>
        <urUniqueID></urUniqueID>
        <urURL>https://data.syncthing.net/newdata</urURL>
        <urPostInsecurely>false</urPostInsecurely>
        <urInitialDelayS>1800</urInitialDelayS>
        <autoUpgradeIntervalH>12</autoUpgradeIntervalH>
        <upgradeToPreReleases>false</upgradeToPreReleases>
        <keepTemporariesH>24</keepTemporariesH>
        <cacheIgnoredFiles>false</cacheIgnoredFiles>
        <progressUpdateIntervalS>5</progressUpdateIntervalS>
        <limitBandwidthInLan>false</limitBandwidthInLan>
        <minHomeDiskFree unit="%">1</minHomeDiskFree>
        <releasesURL>https://upgrades.syncthing.net/meta.json</releasesURL>
        <overwriteRemoteDeviceNamesOnConnect>false</overwriteRemoteDeviceNamesOnConnect>
        <tempIndexMinBlocks>10</tempIndexMinBlocks>
        <unackedNotificationID>authenticationUserAndPassword</unackedNotificationID>
        <trafficClass>0</trafficClass>
        <setLowPriority>true</setLowPriority>
        <maxFolderConcurrency>0</maxFolderConcurrency>
        <crashReportingURL>https://crash.syncthing.net/newcrash</crashReportingURL>
        <crashReportingEnabled>true</crashReportingEnabled>
        <stunKeepaliveStartS>180</stunKeepaliveStartS>
        <stunKeepaliveMinS>20</stunKeepaliveMinS>
        <stunServer>default</stunServer>
        <databaseTuning>auto</databaseTuning>
        <maxConcurrentIncomingRequestKiB>0</maxConcurrentIncomingRequestKiB>
        <announceLANAddresses>true</announceLANAddresses>
        <sendFullIndexOnUpgrade>false</sendFullIndexOnUpgrade>
        <connectionLimitEnough>0</connectionLimitEnough>
        <connectionLimitMax>0</connectionLimitMax>
        <insecureAllowOldTLSVersions>false</insecureAllowOldTLSVersions>
        <connectionPriorityTcpLan>10</connectionPriorityTcpLan>
        <connectionPriorityQuicLan>20</connectionPriorityQuicLan>
        <connectionPriorityTcpWan>30</connectionPriorityTcpWan>
        <connectionPriorityQuicWan>40</connectionPriorityQuicWan>
        <connectionPriorityRelay>50</connectionPriorityRelay>
        <connectionPriorityUpgradeThreshold>0</connectionPriorityUpgradeThreshold>
    </options>
    <defaults>
        <folder id="" label="" path="~" type="sendreceive" rescanIntervalS="3600" fsWatcherEnabled="true" fsWatcherDelayS="10" ignorePerms="false" autoNormalize="true">
            <filesystemType>basic</filesystemType>
            <device id="AEYDK6D-2U3U5AI-MEDDSIE-5WC7F0K-FDLAOJQ-24AFG44-Z2B749L-BOUX3QM" introducedBy="">
                <encryptionPassword></encryptionPassword>
            </device>
            <minDiskFree unit="%">1</minDiskFree>
            <versioning>
                <cleanupIntervalS>3600</cleanupIntervalS>
                <fsPath></fsPath>
                <fsType>basic</fsType>
            </versioning>
            <copiers>0</copiers>
            <pullerMaxPendingKiB>0</pullerMaxPendingKiB>
            <hashers>0</hashers>
            <order>random</order>
            <ignoreDelete>false</ignoreDelete>
            <scanProgressIntervalS>0</scanProgressIntervalS>
            <pullerPauseS>0</pullerPauseS>
            <maxConflicts>0</maxConflicts>
            <disableSparseFiles>false</disableSparseFiles>
            <disableTempIndexes>false</disableTempIndexes>
            <paused>false</paused>
            <weakHashThresholdPct>25</weakHashThresholdPct>
            <markerName>.stfolder</markerName>
            <copyOwnershipFromParent>false</copyOwnershipFromParent>
            <modTimeWindowS>0</modTimeWindowS>
            <maxConcurrentWrites>2</maxConcurrentWrites>
            <disableFsync>false</disableFsync>
            <blockPullOrder>standard</blockPullOrder>
            <copyRangeMethod>standard</copyRangeMethod>
            <caseSensitiveFS>false</caseSensitiveFS>
            <junctionsAsDirs>false</junctionsAsDirs>
            <syncOwnership>true</syncOwnership>
            <sendOwnership>true</sendOwnership>
            <syncXattrs>true</syncXattrs>
            <sendXattrs>true</sendXattrs>
            <xattrFilter>
                <maxSingleEntrySize>1024</maxSingleEntrySize>
                <maxTotalSize>4096</maxTotalSize>
            </xattrFilter>
        </folder>
        <device id="" compression="metadata" introducer="false" skipIntroductionRemovals="false" introducedBy="">
            <address>dynamic</address>
            <paused>false</paused>
            <autoAcceptFolders>false</autoAcceptFolders>
            <maxSendKbps>0</maxSendKbps>
            <maxRecvKbps>0</maxRecvKbps>
            <maxRequestKiB>0</maxRequestKiB>
            <untrusted>false</untrusted>
            <remoteGUIPort>0</remoteGUIPort>
            <numConnections>0</numConnections>
        </device>
        <ignores></ignores>
    </defaults>
</configuration>`;

const configOptions = {
  "listenAddresses": [
    "tcp://:16189",
    "quic://:16189"
  ],
  "globalAnnounceServers": [
    "default"
  ],
  "globalAnnounceEnabled": false,
  "localAnnounceEnabled": false,
  "localAnnouncePort": 21027,
  "localAnnounceMCAddr": "[ff12::8384]:21027",
  "maxSendKbps": 0,
  "maxRecvKbps": 0,
  "reconnectionIntervalS": 60,
  "relaysEnabled": true,
  "relayReconnectIntervalM": 10,
  "startBrowser": true,
  "natEnabled": false,
  "natLeaseMinutes": 60,
  "natRenewalMinutes": 30,
  "natTimeoutSeconds": 10,
  "urAccepted": -1,
  "urSeen": 3,
  "urUniqueId": "",
  "urURL": "https://data.syncthing.net/newdata",
  "urPostInsecurely": false,
  "urInitialDelayS": 1800,
  "autoUpgradeIntervalH": 12,
  "upgradeToPreReleases": false,
  "keepTemporariesH": 24,
  "cacheIgnoredFiles": false,
  "progressUpdateIntervalS": 5,
  "limitBandwidthInLan": false,
  "minHomeDiskFree": {
    "value": 1,
    "unit": "%"
  },
  "releasesURL": "https://upgrades.syncthing.net/meta.json",
  "alwaysLocalNets": [],
  "overwriteRemoteDeviceNamesOnConnect": false,
  "tempIndexMinBlocks": 10,
  "unackedNotificationIDs": [
    "authenticationUserAndPassword"
  ],
  "trafficClass": 0,
  "setLowPriority": true,
  "maxFolderConcurrency": 0,
  "crURL": "https://crash.syncthing.net/newcrash",
  "crashReportingEnabled": true,
  "stunKeepaliveStartS": 180,
  "stunKeepaliveMinS": 20,
  "stunServers": [
    "default"
  ],
  "databaseTuning": "auto",
  "maxConcurrentIncomingRequestKiB": 0,
  "announceLANAddresses": true,
  "sendFullIndexOnUpgrade": false,
  "featureFlags": [],
  "connectionLimitEnough": 0,
  "connectionLimitMax": 0,
  "insecureAllowOldTLSVersions": false,
  "connectionPriorityTcpLan": 10,
  "connectionPriorityQuicLan": 20,
  "connectionPriorityTcpWan": 30,
  "connectionPriorityQuicWan": 40,
  "connectionPriorityRelay": 50,
  "connectionPriorityUpgradeThreshold": 0
}

module.exports = { configFile, configOptions };
