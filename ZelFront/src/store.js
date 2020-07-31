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
    zelBenchSection: null,
    zelNodeSection: null,
    zelAdminSection: null,
    zelAppsSection: null,
    explorerSection: null,
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
      state.zelBenchSection = null;
      state.zelNodeSection = null;
      state.zelAdminSection = null;
      state.zelAppsSection = null;
      state.explorerSection = null;
    },
    setZelBenchSection(state, section) {
      state.zelBenchSection = section;
      // we always want to reset the other sections to null state
      state.zelCashSection = null;
      state.zelNodeSection = null;
      state.zelAdminSection = null;
      state.zelAppsSection = null;
      state.explorerSection = null;
    },
    setZelNodeSection(state, section) {
      state.zelNodeSection = section;
      // we always want to reset the other sections to null state
      state.zelCashSection = null;
      state.zelBenchSection = null;
      state.zelAdminSection = null;
      state.zelAppsSection = null;
      state.explorerSection = null;
    },
    setZelAdminSection(state, section) {
      state.zelAdminSection = section;
      // we always want to reset the other sections to null state
      state.zelCashSection = null;
      state.zelBenchSection = null;
      state.zelNodeSection = null;
      state.zelAppsSection = null;
      state.explorerSection = null;
    },
    setZelAppsSection(state, section) {
      state.zelAppsSection = section;
      // we always want to reset the other sections to null state
      state.zelCashSection = null;
      state.zelBenchSection = null;
      state.zelNodeSection = null;
      state.zelAdminSection = null;
      state.explorerSection = null;
    },
    setExplorerSection(state, section) {
      state.explorerSection = section;
      // we always want to reset the other sections to null state
      state.zelCashSection = null;
      state.zelBenchSection = null;
      state.zelNodeSection = null;
      state.zelAdminSection = null;
      state.zelAppsSection = null;
    },
    setZelFluxVersion(state, version) {
      state.zelfluxVersion = version;
    },
  },
  actions: {

  },
});
