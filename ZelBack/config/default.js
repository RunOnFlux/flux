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
        activeSignatures: 'activesignatures',
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
        zelappsInformation: 'zelappsinformation',
      },
    },
    zelappsglobal: {
      database: 'globalzelapps',
      collections: {
        zelappsMessages: 'zelappsmessages', // storage for all zelapps messages done on zelcash network
        zelappsInformation: 'zelappsinformation', // stores actual state of zelapp configuration info - initial state and its overwrites with update messages
        zelappsTemporaryMessages: 'zelappstemporarymessages', // storages for all zelapps messages that are not yet confirmed on the zelcash network
      },
    },
  },
  zelbench: {
    port: 16225,
    rpcport: 16224,
    porttestnet: 26225,
    rpcporttestnet: 26224,
  },
  zelcash: {
    chainValidHeight: 640000,
  },
  zelTeamZelId: '132hG26CFTNhLM3MRsLEJhp9DpBrK6vg5N',
  zelapps: {
    // in zel per month
    price: {
      cpu: 3 * 5, // per 0.1 cpu core,
      ram: 1 * 5, // per 100mb,
      hdd: 0.5 * 5, // per 1gb,
    },
    address: 't1...', // apps registration address
    epochstart: 690000, // zelapps epoch blockheight start
    portMin: 30001, // originally should have been from 30000 but we got temporary folding there
    portMax: 39999,
    maxImageSize: 300000000, // 300mb
  },
  lockedSystemResources: {
    cpu: 10, // 1 cpu core
    ram: 2000, // 2000mb
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
