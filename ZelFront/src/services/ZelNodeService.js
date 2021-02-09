import Api from '@/services/Api';

export default {
  updateZelFlux(zelidauthHeader) {
    return Api().get('/flux/updateflux', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  rebuildZelFront(zelidauthHeader) {
    return Api().get('/flux/rebuildzelfront', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  updateZelCash(zelidauthHeader) {
    return Api().get('/flux/updatedaemon', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  reindexZelCash(zelidauthHeader) {
    return Api().get('/flux/reindexdaemon', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  updateZelBench(zelidauthHeader) {
    return Api().get('/flux/updatebenchmark', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  getZelFluxVersion() {
    return Api().get('/flux/version');
  },
};
