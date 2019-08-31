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
    userSection: null,
    zelteamSection: null,
    adminSection: null,
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
      state.userSection = null;
      state.zelteamSection = null;
      state.adminSection = null;
    },
    setZelNodeSection(state, section) {
      state.zelnodeSection = section;
      // we always want to reset the other sections to null state
      state.zelcashSection = null;
      state.userSection = null;
      state.zelteamSection = null;
      state.adminSection = null;
    },
    setUserSection(state, section) {
      state.userSection = section;
      // we always want to reset the other sections to null state
      state.zelcashSection = null;
      state.zelnodeSection = null;
      state.zelteamSection = null;
      state.adminSection = null;
    },
    setZelTeamSection(state, section) {
      state.zelteamSection = section;
      // we always want to reset the other sections to null state
      state.zelcashSection = null;
      state.zelnodeSection = null;
      state.userSection = null;
      state.adminSection = null;
    },
    setAdminSection(state, section) {
      state.adminSection = section;
      // we always want to reset the other sections to null state
      state.zelcashSection = null;
      state.zelnodeSection = null;
      state.userSection = null;
      state.zelteamSection = null;
    },
  },
  actions: {

  },
});
