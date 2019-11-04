import Api from '@/services/Api';

export default {
  updateZelFlux(zelidauthHeader) {
    return Api().get('/zelnode/updatezelflux', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  rebuildZelFront(zelidauthHeader) {
    return Api().get('/zelnode/rebuildzelfront', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  updateZelCash(zelidauthHeader) {
    return Api().get('/zelnode/updatezelcash', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  getZelFluxVersion() {
    return Api().get('/zelflux/version');
  },
};
