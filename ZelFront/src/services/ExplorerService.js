import Api from '@/services/Api';

export default {
  getAddressBalance(address) {
    return Api().get(`/explorer/balance/${address}`);
  },
  getAddressTransactions(address) {
    return Api().get(`/explorer/transactions/${address}`);
  },
  getZelNodeTransactions(filter) {
    return Api().get(`/explorer/zelnodetxs/${filter}`);
  },
  getScannedHeight() {
    return Api().get('/explorer/scannedheight');
  }
};
