import Api from '@/services/Api';

export default {
  listFluxNodes() {
    return Api().get('/daemon/listzelnodes');
  },
  zelnodeCount() {
    return Api().get('/daemon/getzelnodecount');
  },
  blockReward() {
    return Api().get('/daemon/getblocksubsidy');
  },
};
