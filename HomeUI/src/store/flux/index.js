import * as config from 'ZelBack/config/default';

export default {
  namespaced: true,
  state: {
    userconfig: {
      zelid: '',
      externalip: '',
    },
    config: {
      apiPort: config.server.apiport,
      fluxTeamZelId: config.fluxTeamZelId,
    },
    privilege: 'none', // user, admin, fluxteam
    fluxVersion: '',
    xdaoOpen: 0,
  },
  getters: {
    xdaoOpen(state) {
      return state.xdaoOpen;
    },
  },
  mutations: {
    setPrivilege(state, privilege) {
      state.privilege = privilege;
    },
    setFluxVersion(state, version) {
      state.fluxVersion = version;
    },
    setUserZelid(state, zelid) {
      state.userconfig.zelid = zelid;
    },
    setUserIp(state, externalip) {
      state.userconfig.externalip = externalip;
    },
    setFluxPort(state, port) {
      state.config.apiPort = port;
    },
    setXDAOOpen(state, open) {
      state.xdaoOpen = open;
    },
  },
  actions: {},
};
