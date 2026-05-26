const shared = require('../shared');

module.exports = {
  ...shared,
  database: {
    "url": "198.18.0.2",
    "port": 27017,
    "local": {
        "database": "node11_zelfluxlocal",
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
        "database": "node11_zelcashdata",
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
        "database": "node11_localzelapps",
        "collections": {
            "appsInformation": "zelappsinformation"
        }
    },
    "appsglobal": {
        "database": "node11_globalzelapps",
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
        "database": "node11_chainparams",
        "collections": {
            "chainMessages": "chainmessages"
        }
    },
    "fluxshare": {
        "database": "node11_zelshare",
        "collections": {
            "shared": "shared"
        }
    }
},
};
