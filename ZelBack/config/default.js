module.exports = {
  server: {
    zelfrontport: 26126,
    apiport: 26127,
    apiporthttps: 26128,
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
      },
    },
    zelapps: {
      database: 'localzelapps',
      collections: {
        resourcesLocked: 'zelappslocalresources',
      },
    },
    global: {
      database: 'zelfluxglobal',
      collections: {
        registeredZelApps: 'registeredzelapps',
        zelAppsInfo: 'zelappsinfo',
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
};
