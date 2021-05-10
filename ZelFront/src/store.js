import Vue from 'vue';
import Vuex from 'vuex';

const config = require('../../ZelBack/config/default');
const userconfig = require('../../config/userconfig');
const ALL_SECTIONS = [
  'adminSection', 'appsSection', 'benchmarkSection', 'daemonSection',
  'dashboardSection', 'explorerSection', 'nodeSection'
];

Vue.use(Vuex);

const nullSections = (state) => {
  for (const section of ALL_SECTIONS)
    state[section] = null;
};

const setSection = (sectionId, state, section) => {
  nullSections(state);
  state[sectionId] = section;
};

export default new Vuex.Store({

  strict : process.env.NODE_ENV !== 'production',

  state : {
    userconfig : {
      cruxid : userconfig.initial.cruxid,
      externalip : userconfig.initial.ipaddress,
      kadena : userconfig.initial.kadena,
      testnet : userconfig.initial.testnet,
      zelid : userconfig.initial.zelid,
    },

    config : {
      apiPort : config.server.apiport,
      fluxTeamZelId : config.fluxTeamZelId,
    },

    privilage : 'none', // user, admin, fluxteam
    adminSection : null,
    appsSection : null,
    benchmarkSection : null,
    daemonSection : 'welcomeinfo',
    dashboardSection : null,
    explorerSection : null,
    fluxVersion : '',
    nodeSection : null,
  },

  getters : {},

  mutations : {
    setPrivilage(state, privilage) { state.privilage = privilage;},

    setAdminSection(state,
                    section) { setSection('adminSection', state, section);},
    setAppsSection(state,
                   section) { setSection('appsSection', state, section);},
    setBenchmarkSection(
        state, section) { setSection('benchmarkSection', state, section);},
    setDaemonSection(state,
                     section) { setSection('daemonSection', state, section);},
    setDashboardSection(
        state, section) { setSection('dashboardSection', state, section);},
    setExplorerSection(
        state, section) { setSection('explorerSection', state, section);},
    setNodeSection(state,
                   section) { setSection('nodeSection', state, section);},

    setFluxVersion(state, version) { state.fluxVersion = version;},
  },

  actions : {},

});
