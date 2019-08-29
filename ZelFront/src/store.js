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
    loginPhrase: '',
  },
  getters: {

  },
  mutations: {
    setPrivilage(state, privilage) {
      state.privilage = privilage;
    },
    setLoginPhrase(state, phrase) {
      state.loginPhrase = phrase;
    },
  },
  actions: {

  },
});
