import Api, { sourceCancelToken } from '@/services/Api';

export default {
  // actually flux service
  start(zelidauthHeader) {
    return Api().get('/benchmark/start', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  restart(zelidauthHeader) {
    return Api().get('/benchmark/restart', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  // == Benchmarks ==
  getStatus() {
    return Api().get('/benchmark/getstatus');
  },
  restartNodeBenchmarks(zelidauthHeader) {
    return Api().get('/benchmark/restartnodebenchmarks', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  signFluxTransaction(zelidauthHeader, hexstring) {
    return Api().get(`/benchmark/signzelnodetransaction/${hexstring}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  // == Control ==
  helpSpecific(command) {
    return Api().get(`/benchmark/help/${command}`);
  },
  help() {
    return Api().get('/benchmark/help');
  },
  stop(zelidauthHeader) {
    return Api().get('/benchmark/stop', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  // == Fluxnode ==
  getBenchmarks() {
    return Api().get('/benchmark/getbenchmarks');
  },
  getInfo() {
    return Api().get('/benchmark/getinfo');
  },
  // DEBUG
  tailBenchmarkDebug(zelidauthHeader) {
    return Api().get('/flux/tailbenchmarkdebug', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  // just api
  justAPI() {
    return Api();
  },
  // cancelToken
  cancelToken() {
    return sourceCancelToken;
  },
};
