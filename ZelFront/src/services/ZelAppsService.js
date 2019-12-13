import Api from '@/services/Api';

export default {
  listRunningZelApps() {
    return Api().get('/zelapps/listrunningzelapps');
  },
  listAllZelApps() {
    return Api().get('/zelapps/listallzelapps');
  },
};
