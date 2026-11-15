const shared = require('../shared');

module.exports = {
  ...shared,
  database: {
    "url": "25.192.0.2",
    "port": 27017,
    "local": {
        "database": "node08_zelfluxlocal",
        "collections": {
            "loggedUsers": "loggedusers",
            "activeLoginPhrases": "activeloginphrases",
            "activeSignatures": "activesignatures",
            "loginSignatures": "loginsignatures",
            "geolocation": "geolocation",
            "benchmark": "benchmark",
            "appTamperingEvents": "apptamperingevents",
            "nodeStartupTracker": "nodestartuptracker",
            "policyDocuments": "policydocuments",
            "ipRanges": "ipranges",
            "nodeLocations": "nodelocations",
            "ownAddress": "ownaddress",
            "upnpMappings": "upnpmappings"
        }
    },
    "daemon": {
        "database": "node08_zelcashdata",
        "collections": {
            "scannedHeight": "scannedheight",
            "appsHashes": "zelappshashes"
        }
    },
    "appslocal": {
        "database": "node08_localzelapps",
        "collections": {
            "appsInformation": "zelappsinformation"
        }
    },
    "appsglobal": {
        "database": "node08_globalzelapps",
        "collections": {
            "appsMessages": "zelappsmessages",
            "appsInformation": "zelappsinformation",
            "appsTemporaryMessages": "zelappstemporarymessages",
            "appsHeldMessages": "zelappsheldmessages",
            "appsLocations": "zelappslocation",
            "appsInstallingLocations": "appsinstallinglocations",
            "appsInstallingErrorsLocations": "appsInstallingErrorsLocations"
        }
    },
    "chainparams": {
        "database": "node08_chainparams",
        "collections": {
            "chainMessages": "chainmessages"
        }
    }
},
};
