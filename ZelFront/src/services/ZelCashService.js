import Api, {sourceCancelToken} from '@/services/Api';

export default {
  help() { return Api().get('/zelcash/help');},
  helpSpecific(command) { return Api().get(`/zelcash/help/${command}`);},
  getInfo() { return Api().get('/zelcash/getinfo');},
  getZelNodeStatus() { return Api().get('/zelcash/getzelnodestatus');},
  getRawTransaction(txid, verbose) {
    return Api().get(`/zelcash/getrawtransaction/${txid}/${verbose}`);
  },
  listZelNodes() { return Api().get('/zelcash/listzelnodes');},
  viewDeterministicZelNodeList() {
    return Api().get('/zelcash/viewdeterministiczelnodelist');
  },
  getZelNodeCount() { return Api().get('/zelcash/getzelnodecount');},
  getStartList() { return Api().get('/zelcash/getstartlist');},
  getDOSList() { return Api().get('/zelcash/getdoslist');},
  zelnodeCurrentWinner() { return Api().get('/zelcash/zelnodecurrentwinner');},
  getBenchmarks() { return Api().get('/zelcash/getbenchmarks');},
  getBenchStatus() { return Api().get('/zelcash/getbenchstatus');},
  startZelBench(zelidauthHeader) {
    return Api().get('/zelcash/startzelbenchd', {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  stopZelBench(zelidauthHeader) {
    return Api().get('/zelcash/stopzelbenchd', {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  getBlockchainInfo() { return Api().get('/zelcash/getblockchaininfo');},
  getMiningInfo() { return Api().get('/zelcash/getmininginfo');},
  getNetworkInfo() { return Api().get('/zelcash/getnetworkinfo');},
  validateAddress(zelidauthHeader, address) {
    return Api().get(`/zelcash/validateaddress/${address}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  getWalletInfo(zelidauthHeader) {
    return Api().get('/zelcash/getwalletinfo', {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  listZelNodeConf(zelidauthHeader) {
    return Api().get('/zelcash/listzelnodeconf', {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  start(zelidauthHeader) {
    return Api().get('/zelcash/start', {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  restart(zelidauthHeader) {
    return Api().get('/zelcash/restart', {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  stopZelCash(zelidauthHeader) {
    return Api().get('/zelcash/stop', {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  rescanZelCash(zelidauthHeader, height) {
    return Api().get(`/zelcash/rescan/${height}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  getBlock(height, verbosity) {
    return Api().get(`/zelcash/getblock/${height}/${verbosity}`);
  },
  // DEBUG
  tailZelCashDebug(zelidauthHeader) {
    return Api().get('/zelnode/tailzelcashdebug', {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  // just api
  justAPI() { return Api();},
  // cancelToken
  cancelToken() { return sourceCancelToken;},
};
