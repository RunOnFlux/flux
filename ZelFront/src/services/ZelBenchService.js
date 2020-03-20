import Api from '@/services/Api';

export default {
  // == Benchmarks ==
  getStatus() {
    return Api().get('/zelbench/getstatus');
  },
  restartNodeBenchmarks(zelidauthHeader) {
    return Api().get('/zelbench/restartnodebenchmarks', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  signZelNodeTransaction(zelidauthHeader, hexstring) {
    return Api().get(`/zelbench/signzelnodetransaction/${hexstring}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  // == Control ==
  help() {
    return Api().get('/zelbench/help');
  },
  stop(zelidauthHeader) {
    return Api().get('/zelbench/stop', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  // == Zelnode ==
  getBenchmarks() {
    return Api().get('/zelbench/getbenchmarks');
  },
  getInfo() {
    return Api().get('/zelbench/getinfo');
  },
};
