import Api, { sourceCancelToken } from '@/services/Api';

export default {
  updateFlux(zelidauthHeader) {
    return Api().get('/flux/updateflux', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  rebuildHome(zelidauthHeader) {
    return Api().get('/flux/rebuildhome', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  updateDaemon(zelidauthHeader) {
    return Api().get('/flux/updatedaemon', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  reindexDaemon(zelidauthHeader) {
    return Api().get('/flux/reindexdaemon', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  updateBenchmark(zelidauthHeader) {
    return Api().get('/flux/updatebenchmark', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  getFluxVersion() {
    return Api().get('/flux/version');
  },
  broadcastMessage(zelidauthHeader, message) {
    const data = message;
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().post('/flux/broadcastmessage', JSON.stringify(data), axiosConfig);
  },
  connectedPeers() {
    return Api().get(`/flux/connectedpeers?timestamp=${new Date().getTime()}`);
  },
  connectedPeersInfo() {
    return Api().get(`/flux/connectedpeersinfo?timestamp=${new Date().getTime()}`);
  },
  incomingConnections() {
    return Api().get(`/flux/incomingconnections?timestamp=${new Date().getTime()}`);
  },
  incomingConnectionsInfo() {
    return Api().get(`/flux/incomingconnectionsinfo?timestamp=${new Date().getTime()}`);
  },
  addPeer(zelidauthHeader, ip) {
    return Api().get(`/flux/addpeer/${ip}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  removePeer(zelidauthHeader, ip) {
    return Api().get(`/flux/removepeer/${ip}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  removeIncomingPeer(zelidauthHeader, ip) {
    return Api().get(`/flux/removeincomingpeer/${ip}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  adjustCruxID(zelidauthHeader, cruxid) {
    return Api().get(`/flux/adjustcruxid/${cruxid}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  adjustKadena(zelidauthHeader, account, chainid) {
    return Api().get(`/flux/adjustkadena/${account}/${chainid}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  getCruxID() {
    return Api().get('/flux/cruxid');
  },
  getKadenaAccount() {
    return Api().get('/flux/kadena');
  },
  // DEBUG
  tailFluxLog(name, zelidauthHeader) {
    return Api().get(`/flux/tail${name}log`, {
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
