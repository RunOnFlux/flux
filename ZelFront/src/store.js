import Vue from 'vue';
import Vuex from 'vuex';

const config = require('../../ZelBack/config/default');
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
      apiPort: config.server.apiport,
      zelTeamZelId: config.zelTeamZelId,
    },
    privilage: 'none', // user, admin, zelteam
    zelCashSection: 'getinfo',
    zelNodeSection: null,
    zelAdminSection: null,
    zelAppsSection: null,
    zelfluxVersion: '',
  },
  getters: {
  },
  mutations: {
    setPrivilage(state, privilage) {
      state.privilage = privilage;
    },
    setZelCashSection(state, section) {
      state.zelCashSection = section;
      // we always want to reset the other sections to null state
      state.zelNodeSection = null;
      state.zelAdminSection = null;
      state.zelAppsSection = null;
    },
    setZelNodeSection(state, section) {
      state.zelNodeSection = section;
      // we always want to reset the other sections to null state
      state.zelCashSection = null;
      state.zelAdminSection = null;
      state.zelAppsSection = null;
    },
    setZelAdminSection(state, section) {
      state.zelAdminSection = section;
      // we always want to reset the other sections to null state
      state.zelCashSection = null;
      state.zelNodeSection = null;
      state.zelAppsSection = null;
    },
    setZelAppsSection(state, section) {
      state.zelAppsSection = section;
      // we always want to reset the other sections to null state
      state.zelCashSection = null;
      state.zelNodeSection = null;
      state.zelAdminSection = null;
    },
    setZelFluxVersion(state, version) {
      state.zelfluxVersion = version;
    },
  },
  actions: {

  },
});
