import Api, { sourceCancelToken } from '@/services/Api';

export default {
  softUpdateFlux(zelidauthHeader) {
    return Api().get('/flux/softupdateflux', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  softUpdateInstallFlux(zelidauthHeader) {
    return Api().get('/flux/softupdatefluxinstall', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  updateFlux(zelidauthHeader) {
    return Api().get('/flux/updateflux', {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  hardUpdateFlux(zelidauthHeader) {
    return Api().get('/flux/hardupdateflux', {
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
    return Api().get(`/flux/connectedpeers?timestamp=${Date.now()}`);
  },
  connectedPeersInfo() {
    return Api().get(`/flux/connectedpeersinfo?timestamp=${Date.now()}`);
  },
  incomingConnections() {
    return Api().get(`/flux/incomingconnections?timestamp=${Date.now()}`);
  },
  incomingConnectionsInfo() {
    return Api().get(`/flux/incomingconnectionsinfo?timestamp=${Date.now()}`);
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
  adjustKadena(zelidauthHeader, account, chainid) {
    return Api().get(`/flux/adjustkadena/${account}/${chainid}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  adjustRouterIP(zelidauthHeader, routerip) {
    return Api().get(`/flux/adjustrouterip/${routerip}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  adjustBlockedPorts(zelidauthHeader, blockedPorts) {
    const data = { blockedPorts };
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().post('/flux/adjustblockedports', data, axiosConfig);
  },
  adjustAPIPort(zelidauthHeader, apiport) {
    return Api().get(`/flux/adjustapiport/${apiport}`, {
      headers: {
        zelidauth: zelidauthHeader,
      },
    });
  },
  adjustBlockedRepositories(zelidauthHeader, blockedRepositories) {
    const data = { blockedRepositories };
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
      },
    };
    return Api().post('/flux/adjustblockedrepositories', data, axiosConfig);
  },
  getKadenaAccount() {
    const axiosConfig = {
      headers: {
        'x-apicache-bypass': true,
      },
    };
    return Api().get('/flux/kadena', axiosConfig);
  },
  getRouterIP() {
    const axiosConfig = {
      headers: {
        'x-apicache-bypass': true,
      },
    };
    return Api().get('/flux/routerip', axiosConfig);
  },
  getBlockedPorts() {
    const axiosConfig = {
      headers: {
        'x-apicache-bypass': true,
      },
    };
    return Api().get('/flux/blockedports', axiosConfig);
  },
  getAPIPort() {
    const axiosConfig = {
      headers: {
        'x-apicache-bypass': true,
      },
    };
    return Api().get('/flux/apiport', axiosConfig);
  },
  getBlockedRepositories() {
    const axiosConfig = {
      headers: {
        'x-apicache-bypass': true,
      },
    };
    return Api().get('/flux/blockedrepositories', axiosConfig);
  },
  getMarketPlaceURL() {
    return Api().get('/flux/marketplaceurl');
  },
  getFluxInfo() {
    return Api().get('/flux/info');
  },
  getZelid() {
    const axiosConfig = {
      headers: {
        'x-apicache-bypass': true,
      },
    };
    return Api().get('/flux/zelid', axiosConfig);
  },
  getStaticIpInfo() {
    return Api().get('/flux/staticip');
  },
  restartFluxOS(zelidauthHeader) {
    const axiosConfig = {
      headers: {
        zelidauth: zelidauthHeader,
        'x-apicache-bypass': true,
      },
    };
    return Api().get('/flux/restart', axiosConfig);
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
