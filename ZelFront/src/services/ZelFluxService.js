import Api, {sourceCancelToken} from '@/services/Api';

export default {
  getZelFluxVersion() { return Api().get('/zelflux/version');},
  broadcastMessage(zelidauthHeader, message) {
    const data = message;
    const axiosConfig = {
      headers : {
        zelidauth : zelidauthHeader,
      },
    };
    return Api().post('/zelflux/broadcastmessage', JSON.stringify(data),
                      axiosConfig);
  },
  connectedPeers() { return Api().get('/zelflux/connectedpeers');},
  connectedPeersInfo() { return Api().get('/zelflux/connectedpeersinfo');},
  incomingConnections() { return Api().get('/zelflux/incomingconnections');},
  incomingConnectionsInfo() {
    return Api().get('/zelflux/incomingconnectionsinfo');
  },
  addPeer(zelidauthHeader, ip) {
    return Api().get(`/zelflux/addpeer/${ip}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  removePeer(zelidauthHeader, ip) {
    return Api().get(`/zelflux/removepeer/${ip}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  removeIncomingPeer(zelidauthHeader, ip) {
    return Api().get(`/zelflux/removeincomingpeer/${ip}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  adjustCruxID(zelidauthHeader, cruxid) {
    return Api().get(`/zelflux/adjustcruxid/${cruxid}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  adjustKadena(zelidauthHeader, account, chainid) {
    return Api().get(`/zelflux/adjustkadena/${account}/${chainid}`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  getCruxID() { return Api().get('/zelflux/cruxid');},
  getKadenaAccount() { return Api().get('/zelflux/kadena');},
  // DEBUG
  tailFluxLog(name, zelidauthHeader) {
    return Api().get(`/zelnode/tailzelflux${name}log`, {
      headers : {
        zelidauth : zelidauthHeader,
      },
    });
  },
  // just api
  justAPI() { return Api();},
  // cancelToken
  cancelToken() { return sourceCancelToken;},
};
