module.exports = {
  server: {
    zelfrontport: 16126,
    apiport: 16127,
    apiporthttps: 16128,
  },
  database: {
    url: '127.0.0.1',
    port: 27017,
    local: {
      database: 'zelfluxlocal',
      collections: {
        loggedUsers: 'loggedusers',
        activeLoginPhrases: 'activeloginphrases',
      },
    },
    zelcash: {
      database: 'zelcashdata',
      collections: {
        // addreesIndex contains a) balance, b) list of all transacitons, c) list of utxos
        scannedHeight: 'scannedheight',
        utxoIndex: 'utxoindex',
        addressTransactionIndex: 'addresstransactionindex',
        zelnodeTransactions: 'zelnodetransactions',
        zelappsHashes: 'zelappshashes',
      },
    },
    zelappslocal: {
      database: 'localzelapps',
      collections: {
        resourcesLocked: 'zelappslocalresources', // TODO DELETE
        zelappsInformation: 'zelappsinformation',
      },
    },
    zelappsglobal: {
      database: 'globalzelapps',
      collections: {
        zelAppsMessages: 'zelappsmessages', // storage for all zelapps messages done on zelcash network
        zelAppsInfo: 'zelappsinfo', // stores actual state of zelapp configuration info - initial state and its overwrites with update messages
      },
    },
  },
  zelbench: {
    port: 16225,
    rpcport: 16224,
    porttestnet: 26225,
    rpcporttestnet: 26224,
  },
  zelTeamZelId: '132hG26CFTNhLM3MRsLEJhp9DpBrK6vg5N',
  zelapps: {
    // in zel per month
    price: {
      cpu: 3, // per 0.1 cpu core,
      ram: 1, // per 100mb,
      hdd: 0.5, // per 1gb,
    },
    address: 't1...', // apps registration address
    epochstart: 1000000, // zelapps epoch blockheight start
  },
  lockedSystemResources: {
    cpu: 10, // 1 cpu core
    ram: 20, // 2000mb
    hdd: 30, // 30gb // this value is likely to rise
  },
  fluxSpecifics: {
    cpu: {
      basic: 20, // 10 available for apps
      super: 40, // 30 available for apps
      bamf: 80, // 70 available for apps
    },
    ram: {
      basic: 3000, // 1000 available for apps
      super: 7000, // 5000 available for apps
      bamf: 30000, // available 28000 for apps
    },
    hdd: {
      basic: 50, // 20 for apps
      super: 150, // 120 for apps
      bamf: 600, // 570 for apps
    },
    collateral: {
      basic: 10000,
      super: 25000,
      bamf: 100000,
    },
  },
};
