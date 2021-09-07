import config from 'ZelBack/config/default';

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
  },
  getters: {},
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
  },
  actions: {},
};
