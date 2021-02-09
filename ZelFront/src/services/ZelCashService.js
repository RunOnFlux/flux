import Api, { sourceCancelToken } from '@/services/Api';

export default {
  help() {
    return Api().get('/daemon/help');
  },
  helpSpecific(command) {
    return Api().get(`/daemon/help/${command}`);
  },
  getInfo() {
    return Api().get('/daemon/getinfo');
  },
  getZelNodeStatus() {
    return Api().get('/daemon/getzelnodestatus');
  },
  getRawTransaction(txid, verbose) {
    return Api().get(`/daemon/getrawtransaction/${txid}/${verbose}`);
  },
  listZelNodes() {
    return Api().get('/daemon/listzelnodes');
  },
  viewDeterministicZelNodeList() {
    return Api().get('/daemon/viewdeterministiczelnodelist');
  },
  getZelNodeCount() {
    return Api().get('/daemon/getzelnodecount');
  },
  getStartList() {
    return Api().get('/daemon/getstartlist');
  },
  getDOSList() {
    return Api().get('/daemon/getdoslist');
  },
  zelnodeCurrentWinner() {
    return Api().get('/daemon/zelnodecurrentwinner');
  },
  getBenchmarks() {
    return Api().get('/daemon/getbenchmarks');
  },
  getBenchStatus() {
    return Api().get('/daemon/getbenchstatus');
  },
  startZelBench(zelidauthHeader) {
    return Api().get('/daemon/startbenchmark', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  stopZelBench(zelidauthHeader) {
    return Api().get('/daemon/stopbenchmark', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  getBlockchainInfo() {
    return Api().get('/daemon/getblockchaininfo');
  },
  getMiningInfo() {
    return Api().get('/daemon/getmininginfo');
  },
  getNetworkInfo() {
    return Api().get('/daemon/getnetworkinfo');
  },
  validateAddress(zelidauthHeader, address) {
    return Api().get(`/daemon/validateaddress/${address}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  getWalletInfo(zelidauthHeader) {
    return Api().get('/daemon/getwalletinfo', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  listZelNodeConf(zelidauthHeader) {
    return Api().get('/daemon/listzelnodeconf', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  start(zelidauthHeader) {
    return Api().get('/daemon/start', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  restart(zelidauthHeader) {
    return Api().get('/daemon/restart', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  stopZelCash(zelidauthHeader) {
    return Api().get('/daemon/stop', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  rescanZelCash(zelidauthHeader, height) {
    return Api().get(`/daemon/rescan/${height}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  getBlock(height, verbosity) {
    return Api().get(`/daemon/getblock/${height}/${verbosity}`);
  },
  // DEBUG
  tailZelCashDebug(zelidauthHeader) {
    return Api().get('/flux/taildaemondebug', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  // just api
  justAPI() {
    return Api();
  },
  // cancelToken
  cancelToken() {
    return sourceCancelToken;
  },
};
