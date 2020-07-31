import Api from '@/services/Api';

export default {
  // actually zelnode service
  start(zelidauthHeader) {
    return Api().get('/zelbench/start', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  restart(zelidauthHeader) {
    return Api().get('/zelbench/restart', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
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
  // DEBUG
  tailZelBenchDebug(zelidauthHeader) {
    return Api().get('/zelnode/tailzelbenchdebug', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  // just api
  justAPI() {
    return Api();
  },
};
