const shared = require('../shared');

module.exports = {
  ...shared,
  database: {
    "url": "198.18.0.2",
    "port": 27017,
    "local": {
        "database": "node03_zelfluxlocal",
        "collections": {
            "loggedUsers": "loggedusers",
            "activeLoginPhrases": "activeloginphrases",
            "activeSignatures": "activesignatures",
            "activePaymentRequests": "activepaymentrequests",
            "completedPayments": "completedpayments",
            "geolocation": "geolocation",
            "benchmark": "benchmark",
            "appTamperingEvents": "apptamperingevents",
            "nodeStartupTracker": "nodestartuptracker"
        }
    },
    "daemon": {
        "database": "node03_zelcashdata",
        "collections": {
            "scannedHeight": "scannedheight",
            "utxoIndex": "utxoindex",
            "addressTransactionIndex": "addresstransactionindex",
            "fluxTransactions": "zelnodetransactions",
            "appsHashes": "zelappshashes",
            "coinbaseFusionIndex": "coinbasefusionindex"
        }
    },
    "appslocal": {
        "database": "node03_localzelapps",
        "collections": {
            "appsInformation": "zelappsinformation"
        }
    },
    "appsglobal": {
        "database": "node03_globalzelapps",
        "collections": {
            "appsMessages": "zelappsmessages",
            "appsInformation": "zelappsinformation",
            "appsTemporaryMessages": "zelappstemporarymessages",
            "appsLocations": "zelappslocation",
            "appsInstallingLocations": "appsinstallinglocations",
            "appsInstallingErrorsLocations": "appsInstallingErrorsLocations"
        }
    },
    "chainparams": {
        "database": "node03_chainparams",
        "collections": {
            "chainMessages": "chainmessages"
        }
    },
    "fluxshare": {
        "database": "node03_zelshare",
        "collections": {
            "shared": "shared"
        }
    }
},
};
