import Api from '@/services/Api';

export default {
  listZelNodes() {
    return Api().get('/daemon/listzelnodes');
  },
};
