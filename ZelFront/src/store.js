import Vue from 'vue';
import Vuex from 'vuex';

const config = require('../../config/default');
const userconfig = require('../../config/userconfig');

Vue.use(Vuex);

export default new Vuex.Store({
  strict: true,
  state: {
    userconfig: {
      zelid: userconfig.initial.zelid,
      externalip: userconfig.initial.ipaddress,
    },
    config: {
      apiPort: config.server.localport,
      zelTeamZelId: config.zelTeamZelId,
    },
    privilage: 'none', // user, admin, zelteam
    zelcashSection: 'getinfo',
    zelnodeSection: null,
    zelAdminSection: null,
    zelfluxVersion: '',
  },
  getters: {
  },
  mutations: {
    setPrivilage(state, privilage) {
      state.privilage = privilage;
    },
    setZelCashSection(state, section) {
      state.zelcashSection = section;
      // we always want to reset the other sections to null state
      state.zelnodeSection = null;
      state.zelAdminSection = null;
    },
    setZelNodeSection(state, section) {
      state.zelnodeSection = section;
      // we always want to reset the other sections to null state
      state.zelcashSection = null;
      state.zelAdminSection = null;
    },
    setZelAdminSection(state, section) {
      state.zelAdminSection = section;
      // we always want to reset the other sections to null state
      state.zelcashSection = null;
      state.zelnodeSection = null;
    },
    setZelFluxVersion(state, version) {
      state.zelfluxVersion = version;
    },
  },
  actions: {

  },
});
