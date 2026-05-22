import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'node-manifest.json'), 'utf-8'));

function databaseConfig(prefix) {
  return {
    url: '198.18.0.2',
    port: 27017,
    local: {
      database: `${prefix}zelfluxlocal`,
      collections: {
        loggedUsers: 'loggedusers',
        activeLoginPhrases: 'activeloginphrases',
        activeSignatures: 'activesignatures',
        activePaymentRequests: 'activepaymentrequests',
        completedPayments: 'completedpayments',
        geolocation: 'geolocation',
        benchmark: 'benchmark',
        appTamperingEvents: 'apptamperingevents',
        nodeStartupTracker: 'nodestartuptracker',
      },
    },
    daemon: {
      database: `${prefix}zelcashdata`,
      collections: {
        scannedHeight: 'scannedheight',
        utxoIndex: 'utxoindex',
        addressTransactionIndex: 'addresstransactionindex',
        fluxTransactions: 'zelnodetransactions',
        appsHashes: 'zelappshashes',
        coinbaseFusionIndex: 'coinbasefusionindex',
      },
    },
    appslocal: {
      database: `${prefix}localzelapps`,
      collections: {
        appsInformation: 'zelappsinformation',
      },
    },
    appsglobal: {
      database: `${prefix}globalzelapps`,
      collections: {
        appsMessages: 'zelappsmessages',
        appsInformation: 'zelappsinformation',
        appsTemporaryMessages: 'zelappstemporarymessages',
        appsLocations: 'zelappslocation',
        appsInstallingLocations: 'appsinstallinglocations',
        appsInstallingErrorsLocations: 'appsInstallingErrorsLocations',
      },
    },
    chainparams: {
      database: `${prefix}chainparams`,
      collections: {
        chainMessages: 'chainmessages',
      },
    },
    fluxshare: {
      database: `${prefix}zelshare`,
      collections: {
        shared: 'shared',
      },
    },
  };
}

for (let i = 0; i < manifest.nodes.length; i++) {
  const num = String(i + 1).padStart(2, '0');
  const prefix = `node${num}_`;
  const dir = join(__dirname, `node-${num}`);
  mkdirSync(dir, { recursive: true });

  const content = `const shared = require('../shared');

module.exports = {
  ...shared,
  database: ${JSON.stringify(databaseConfig(prefix), null, 4)},
};
`;

  writeFileSync(join(dir, 'default.js'), content);
}

console.log(`Generated ${manifest.nodes.length} per-node config directories`);
