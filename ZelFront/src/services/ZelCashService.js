import Api from '@/services/Api';

export default {
  help() {
    return Api().get('/zelcash/help');
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
  listZelNodeConf(zelidauthHeader) {
    return Api().get('/zelcash/listzelnodeconf', {
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
  getBlock(height, verbosity) {
    return Api().get(`/zelcash/getblock/${height}/${verbosity}`);
  },
};
