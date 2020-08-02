import Api, { sourceCancelToken } from '@/services/Api';

export default {
  help() {
    return Api().get('/zelcash/help');
  },
  helpSpecific(command) {
    return Api().get(`/zelcash/help/${command}`);
  },
  getInfo() {
    return Api().get('/zelcash/getinfo');
  },
  getZelNodeStatus() {
    return Api().get('/zelcash/getzelnodestatus');
  },
  getRawTransaction(txid, verbose) {
    return Api().get(`/zelcash/getrawtransaction/${txid}/${verbose}`);
  },
  listZelNodes() {
    return Api().get('/zelcash/listzelnodes');
  },
  viewDeterministicZelNodeList() {
    return Api().get('/zelcash/viewdeterministiczelnodelist');
  },
  getZelNodeCount() {
    return Api().get('/zelcash/getzelnodecount');
  },
  getStartList() {
    return Api().get('/zelcash/getstartlist');
  },
  getDOSList() {
    return Api().get('/zelcash/getdoslist');
  },
  zelnodeCurrentWinner() {
    return Api().get('/zelcash/zelnodecurrentwinner');
  },
  getBenchmarks() {
    return Api().get('/zelcash/getbenchmarks');
  },
  listZelNodeConf(zelidauthHeader) {
    return Api().get('/zelcash/listzelnodeconf', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  start(zelidauthHeader) {
    return Api().get('/zelcash/start', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  restart(zelidauthHeader) {
    return Api().get('/zelcash/restart', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  stopZelCash(zelidauthHeader) {
    return Api().get('/zelcash/stop', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  rescanZelCash(zelidauthHeader, height) {
    return Api().get(`/zelcash/rescan/${height}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  getBlock(height, verbosity) {
    return Api().get(`/zelcash/getblock/${height}/${verbosity}`);
  },
  // DEBUG
  tailZelCashDebug(zelidauthHeader) {
    return Api().get('/zelnode/tailzelcashdebug', {
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
