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
  },
  reindexExplorer(zelidauthHeader) {
    return Api().get('/explorer/reindex/false', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  reindexFlux(zelidauthHeader) {
    return Api().get('/explorer/reindex/true', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
};
