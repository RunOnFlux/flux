import config from 'ZelBack/config/default';
import userconfig from 'Config/userconfig';

export default {
  namespaced: true,
  state: {
    userconfig: {
      zelid: userconfig.initial.zelid,
      externalip: userconfig.initial.ipaddress,
      cruxid: userconfig.initial.cruxid,
      kadena: userconfig.initial.kadena,
      testnet: userconfig.initial.testnet,
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
  },
  actions: {},
};
