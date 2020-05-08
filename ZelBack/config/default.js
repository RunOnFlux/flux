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
    epochstart: 600000, // zelapps epoch blockheight start
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

// assumption: Number of basics, supers and bamfs is the same
// Thus per node we have 10+30+70 = 110 / 3 = 37 aka 3.7 cores
// 34000 / 3 = 11333 aka 11,3gb
// 710 / 3 = 236.6 gb
// Specs.: An application shall run on 1% of the network. With at least 5 instances and maximum of 10 instances.
// basic block rewards 0.0375;
// super block rewards 0.0625;
// bamf block rewards 0.15; -> 25%
// Assumption as of initial we do not suppose zel halving, leaving it at 150 coins per block.
// per month 150/4*720*30 zel is distributed to nodes 810000 zel. That much zel shall be obtained from application subscribing for full network load.
// potential of network load supposing per node. 135000 /3  zel. Max supply 210000000 -> 4666.6 nodes. Yes lets just lock all for simplicity. Do not assume circulating and so on.
// zel received per node assuming potential = 810000 / 4666.6 = 173.6 zel per month
// assuming specs are unchanged for initial launch. Potential of flux network is:
// -> 4666.6 * 37 = 172,664.2 cpu units -> 17266 cpu cores
// -> 4666.6 * 11333 = 52,886,577.8‬ mb ram -> 52886 GB ram
// -> 4666.6 * 236.6 = 1,104,117‬ GB hdd.
// -> 1 cpu unit = 0.1 core = 300 mb ram, 6gb hdd.
// => 3.7 core, 11333 mb ram and 236.6 gb hdd costs 173.6 zel.
// => 1 cpu unit (0.1 core), 300 mb ram and 6 gb hdd cost all totally 4.7 zel
// => 1 cpu unit is 3 times the price of 1 ram unit and 6 times the price as 1 hdd unit.
// 6x + 2x + 1x = 4.7 // x is price for hdd unit. hdd unit costs 4.7/9 zel. ram unit costs 4.7*2/9 zel. cpu unit costs 4.7*6/9 zel.
// 4.7/9  ~ 0.52. -> 0.5 zel per hdd unit. 1 zel per ram unit and 3 zel per cpu unit.
// all above shall be adjusted and calculated dependent on current supply, halving, block rewards
// adjusting parameters of locked amount and node resources are considered a hard fork of zelflux network and as such shall be treated.
// each hard fork an epoch is created set on zelcash blockheight
// Potential of zelflux network is alwyas locked. to
// -> 4666.6 nodes coming from maximum zel supply and locked zel.
// -> that means 17266 cpu cores, 52886 GB ram, 1,104,117 GB hdd as available zelapps resources.
// An application with 1 cpu. 2 GB ram and 20GB hdd will cost 30 + 20 + 10 = 60 zel per month. An overhead of 2GB of hdd is accounted for docker image, container etc. -> 61 ZEL
// with each zel halving. Price of zel apps may half as well.
