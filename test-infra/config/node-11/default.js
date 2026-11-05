const shared = require('../shared');

module.exports = {
  ...shared,
  database: {
    "url": "25.192.0.2",
    "port": 27017,
    "local": {
        "database": "node11_zelfluxlocal",
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
        "database": "node11_zelcashdata",
        "collections": {
            "scannedHeight": "scannedheight",
            "appsHashes": "zelappshashes"
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
            "appsHeldMessages": "zelappsheldmessages",
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
    }
},
};
