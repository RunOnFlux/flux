module.exports = {
  server: {
    apiport: 16127, // homeport is -1, ssl port is +1
    allowedPorts: [11, 13],
  },
  database: {
    url: '127.0.0.1',
    port: 27017,
    local: {
      database: 'zelfluxlocaltest',
      collections: {
        loggedUsers: 'loggedusers',
        activeLoginPhrases: 'activeloginphrases',
        activeSignatures: 'activesignatures',
      },
    },
    daemon: {
      database: 'zelcashdatatest',
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
      database: 'localzelappstest',
      collections: {
        appsInformation: 'zelappsinformation',
      },
    },
    appsglobal: {
      database: 'globalzelappstest',
      collections: {
        appsMessages: 'zelappsmessages', // storage for all flux apps messages done on flux network
        appsInformation: 'zelappsinformation', // stores actual state of flux app configuration info - initial state and its overwrites with update messages
        appsTemporaryMessages: 'zelappstemporarymessages', // storages for all flux apps messages that are not yet confirmed on the flux network
        appsLocations: 'zelappslocation', // stores location of flux apps as documents containing name, hash, ip, obtainedAt
      },
    },
    chainparams: {
      database: 'chainparamstest',
      collections: {
        chainMessages: 'chainmessages', // soft fork messages occuring on chain, Messages have immediate activation from its occurance blockheight (next blockheight mined are already new specs enforced)
        // height, txid, message, version (version X_ determines the value of adjustment p_ specifies new price structure as per fluxapps.price array values)
      },
    },
    fluxshare: {
      database: 'zelsharetest',
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
  minimumFluxOSAllowedVersion: '3.30.0',
  fluxTeamZelId: '1NH9BP155Rp3HSf5ef6NpUbE8JcyLRruAM',
  deterministicNodesStart: 558000,
  fluxapps: {
    // in flux main chain per month (blocksLasting)
    price: [{ // any price fork can be done by adjusting object similarily.
      height: -1, // height from which price spec is valid
      cpu: 3, // per 0.1 cpu core,
      ram: 1, // per 100mb,
      hdd: 0.5, // per 1gb,
      minPrice: 1, // minimum price that has to be paid for registration or update. Flux listens only to message above or equal this price
    },
    {
      height: 983000, // height from which price spec is valid. Counts from when app was registerd on blockchain!
      cpu: 0.3, // per 0.1 cpu core,
      ram: 0.1, // per 100mb,
      hdd: 0.05, // per 1gb,
      minPrice: 0.1, // minimum price that has to be paid for registration or update. Flux listens only to message above or equal this price
    },
    {
      height: 1004000, // height from which price spec is valid. Counts from when app was registerd on blockchain! 1004000
      cpu: 0.06, // per 0.1 cpu core,
      ram: 0.02, // per 100mb,
      hdd: 0.01, // per 1gb,
      minPrice: 0.01, // minimum price that has to be paid for registration or update. Flux listens only to message above or equal this price
    },
    {
      height: 1288000, // height from which price spec is valid. Counts from when app was registerd on blockchain! 1004000
      cpu: 0.15, // per 0.1 cpu core,
      ram: 0.05, // per 100mb,
      hdd: 0.02, // per 1gb,
      minPrice: 0.01, // minimum price that has to be paid for registration or update. Flux listens only to message above or equal this price
    }],
    appSpecsEnforcementHeights: {
      1: 0, // blockheight v1 is deprecated. Not possible to use api to update to its specs
      2: 0, // blockheight
      3: 983000, // blockheight. Since this blockheight specification of type 3 is active. User can still submit v1 or v2. UI allows only v2, v3
      4: 1004000, // v4 available, composition
      5: 1142000, // v5 available adding contacts, geolocation
      6: 1300000, // v6, expiration, app price, t3
    },
    address: 't1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6',
    addressMultisig: 't3aGJvdtd8NR6GrnqnRuVEzH6MbrXuJFLUX',
    epochstart: 694000,
    publicepochstart: 705000,
    portMin: 31000, // ports 30000 - 30999 are reserved for local applications
    portMax: 39999,
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
};
