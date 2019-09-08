import Api from '@/services/Api';

export default {
  updateFlux(zelidauthHeader) {
    return Api().get('/zelnode/updateflux', {
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
  getFluxVersion() {
    return Api().get('/zelnode/version');
  },
};
