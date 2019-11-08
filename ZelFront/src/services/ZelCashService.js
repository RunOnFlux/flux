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
  listZelNodes() {
    return Api().get('/zelcash/listzelnodes');
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
};
