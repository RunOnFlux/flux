import Api from '@/services/Api';

export default {
  getAddressBalance(address) {
    return Api().get(`/explorer/balance/${address}`);
  },
  getAddressTransactions(address) {
    return Api().get(`/explorer/transactions/${address}`);
  },
};
