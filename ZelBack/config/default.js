const userconfig = require('../../config/userconfig');

const isDevelopment = userconfig.initial.development || false;

module.exports = {
  development: isDevelopment,
  server: {
    allowedPorts: [16127, 16137, 16147, 16157, 16167, 16177, 16187, 16197],
    apiport: 16127, // homeport is -1, ssl port is +1
  },
  database: {
    url: '127.0.0.1',
    port: 27017,
    local: {
      database: 'zelfluxlocal',
      collections: {
        loggedUsers: 'loggedusers',
        activeLoginPhrases: 'activeloginphrases',
        activeSignatures: 'activesignatures',
      },
    },
    daemon: {
      database: 'zelcashdata',
      collections: {
        // addreesIndex contains a) balance, b) list of all transacitons, c) list of utxos
        scannedHeight: 'scannedheight',
        utxoIndex: 'utxoindex',
        addressTransactionIndex: 'addresstransactionindex',
        fluxTransactions: 'zelnodetransactions',
        appsHashes: 'zelappshashes',
        coinbaseFusionIndex: 'coinbasefusionindex',
      },
    },
    appslocal: {
      database: 'localzelapps',
      collections: {
        appsInformation: 'zelappsinformation',
      },
    },
    appsglobal: {
      database: 'globalzelapps',
      collections: {
        appsMessages: 'zelappsmessages', // storage for all flux apps messages done on flux network
        appsInformation: 'zelappsinformation', // stores actual state of flux app configuration info - initial state and its overwrites with update messages
        appsTemporaryMessages: 'zelappstemporarymessages', // storages for all flux apps messages that are not yet confirmed on the flux network
        appsLocations: 'zelappslocation', // stores location of flux apps as documents containing name, hash, ip, obtainedAt
      },
    },
    chainparams: {
      database: 'chainparams',
      collections: {
        chainMessages: 'chainmessages', // soft fork messages occuring on chain, Messages have immediate activation from its occurance blockheight (next blockheight mined are already new specs enforced)
        // height, txid, message, version (version X_ determines the value of adjustment p_ specifies new price structure as per fluxapps.price array values)
      },
    },
    fluxshare: {
      database: 'zelshare',
      collections: {
        shared: 'shared',
      },
    },
  },
  benchmark: {
    port: 16225,
    rpcport: 16224,
    porttestnet: 26225,
    rpcporttestnet: 26224,
  },
  daemon: {
    chainValidHeight: 1062000,
    port: 16125,
    rpcport: 16124,
    porttestnet: 26125,
    rpcporttestnet: 26124,
  },
  minimumFluxBenchAllowedVersion: '3.8.0',
  minimumFluxOSAllowedVersion: '3.40.1',
  fluxTeamZelId: '1hjy4bCYBJr4mny4zCE85J94RXa8W6q37',
  deterministicNodesStart: 558000,
  fluxapps: {
    // in flux main chain per month (blocksLasting)
    price: [{ // any price fork can be done by adjusting object similarily.
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
    }],
    appSpecsEnforcementHeights: {
      1: 0, // blockheight v1 is deprecated. Not possible to use api to update to its specs
      2: 0, // blockheight
      3: 983000, // blockheight. Since this blockheight specification of type 3 is active. User can still submit v1 or v2. UI allows only v2, v3
      4: 1004000, // v4 available, composition
      5: 1142000, // v5 available adding contacts, geolocation
      6: 1300000, // v6, expiration, app price, t3
      7: isDevelopment ? 1390000 : 1420000, // v7, nodes selection, secrets, private images (nodes selection allows secrets, private image - scope), staticip
    },
    address: 't1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6',
    addressMultisig: 't3aGJvdtd8NR6GrnqnRuVEzH6MbrXuJFLUX',
    addressDevelopment: 't1Mzja9iJcEYeW5B4m4s1tJG8M42odFZ16A',
    epochstart: 694000,
    publicepochstart: 705000,
    portMin: 31000, // ports 30000 - 30999 are reserved for local applications
    portMax: 39999,
    portBockheightChange: isDevelopment ? 1390000 : 1420000,
    portMinNew: 1,
    portMaxNew: 65535,
    bannedPorts: ['16100-16299', '26100-26299', '30000-30099', 8384, 27017, 22, 23, 25, 3389, 5900, 5800, 161, 512, 513, 5901, 3388, 4444, 123],
    enterprisePorts: ['0-1023', 8080, 8081, 8443, 25565, 6667],
    maxImageSize: 2000000000, // 2000mb
    minimumInstances: 3,
    maximumInstances: 100,
    maximumAdditionalInstances: 1, // max instances above subscribed amount. In case of min instances, this is minimumInstances + maximumAdditionalInstances
    minOutgoing: 8,
    minIncoming: 4,
    minUpTime: 1800, // 30 mins
    installation: {
      probability: 100, // 1%
      delay: 120, // in seconds
    },
    removal: {
      probability: 25, // 4%
      delay: 300,
    },
    redeploy: {
      probability: 2, // 50%
      delay: 30,
      composedDelay: 5,
    },
    blocksLasting: 22000, // by default registered app will live for 22000 of blocks 44000 minutes ~= 1 month
    minBlocksAllowance: 5000, // app can be registered for a minimum of this blocks ~ 1 week
    maxBlocksAllowance: 264000, // app can be registered up for a maximum of this blocks ~ 1 year
    blocksAllowanceInterval: 1000, // ap differences can be in 1000s - more than 1 day
    ownerAppAllowance: 1000, // in case of node owner installing some app, the app will run for this amount of blocks
    temporaryAppAllowance: 200, // in case of any user installing some temporary app message for testing purposes, the app will run for this many blocks
    expireFluxAppsPeriod: 100, // every 100 blocks we run a check that deletes apps specifications and stops/removes the application from existence if it has been lastly updated more than 22k blocks ago
    updateFluxAppsPeriod: 9, // every 9 blocks we check for reinstalling of old application versions
    removeFluxAppsPeriod: 11, // every 11 blocks we check for more than maximum number of instances of an application
    reconstructAppMessagesHashPeriod: 3600, // every 5 days we ask for old messages
    benchUpnpPeriod: 6480, // every 9 days execute upnp bench
  },
  lockedSystemResources: {
    cpu: 10, // 1 cpu core
    ram: 2000, // 2000mb
    hdd: 40, // 40gb // this value is likely to raise
  },
  fluxSpecifics: { // tbd during forks
    cpu: {
      cumulus: 40, // 30 available for apps
      nimbus: 80, // 70 available for apps
      stratus: 160, // 150 available for apps
    },
    ram: {
      cumulus: 7000, // 5000 available for apps
      nimbus: 30000, // 28000 available for apps
      stratus: 61000, // available 59000 for apps
    },
    hdd: {
      cumulus: 220, // 180 for apps
      nimbus: 440, // 400 for apps
      stratus: 880, // 840 for apps
    },
    collateral: { // tbd during forks
      cumulusold: 10000,
      nimbusold: 25000,
      stratusold: 100000,
      cumulus: 1000,
      nimbus: 12500,
      stratus: 40000,
    },
  },
  syncthing: { // operates on apiPort + 2
    ip: '127.0.0.1', // local
    port: 8384, // local
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
  ],
};
