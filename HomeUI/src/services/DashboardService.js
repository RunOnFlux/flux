import Api from '@/services/Api.js';

export default {
  listZelNodes() {
    return Api().get('/daemon/listzelnodes');
  },
  zelnodeCount() {
    return Api().get('/daemon/getzelnodecount');
  },
};
