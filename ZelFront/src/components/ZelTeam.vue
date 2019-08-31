<template>
  <div class="zelnodeSection">
    <div v-if="zelteamSection === 'loggedsessions'">
      <ElButton
        class="generalButton"
        @click="logoutAllSessions()"
      >
        Logout all sessions
      </ElButton>
    </div>
    <div v-if="zelteamSection === 'manageflux'">
      <ElButton
        class="generalButton"
        @click="updateFlux()"
      >
        Update Flux
      </ElButton>
      <ElButton
        class="generalButton"
        @click="rebuildZelFront()"
      >
        Rebuild ZelFront
      </ElButton>
    </div>
    <div v-if="zelteamSection === 'managezelcash'">
      todo update zelcash button
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';
import axios from 'axios';

import zelIDService from '@/services/ZelIDService';
import zelnodeService from '@/services/zelnodeService';

const qs = require('qs');
const packageJson = require('../../../package.json');

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'ZelTeam',
  data() {
    return {
      version: packageJson.version,
    };
  },

  computed: {
    ...mapState([
      'config',
      'userconfig',
      'zelteamSection',
    ]),
  },
  watch: {
    zelteamSection(val, oldVal) {
      console.log(val, oldVal);
      switch (val) {
        case 'loggedsessions':
          break;
        case 'manageflux':
          this.getLatestFluxVersion();
          break;
        case 'managezelcash':
          break;
        case null:
          console.log('ZelTeam Section hidden');
          break;
        default:
          console.log('ZelTeam Section: Unrecognised method'); // should not be seeable if all works correctly
      }
    },
  },
  mounted() {
    switch (this.zelteamSection) {
      case 'loggedsessions':
        break;
      case 'manageflux':
        this.getLatestFluxVersion();
        break;
      case 'managezelcash':
        break;
      case null:
        console.log('ZelTeam Section hidden');
        break;
      default:
        console.log('ZelTeam Section: Unrecognised method'); // should not be seeable if all works correctly
    }
  },
  methods: {
    updateFlux() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      vue.$message.success('Flux is now updating in the background');
      zelnodeService.updateFlux(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$message.error(e.toString());
        });
    },
    rebuildZelFront() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      vue.$message.success('ZelFront is now rebuilding in the background');
      zelnodeService.rebuildZelFront(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$message.error(e.toString());
        });
    },
    getLatestFluxVersion() {
      const self = this;
      axios.get('https://raw.githubusercontent.com/zelcash/zelnoded/master/package.json')
        .then((response) => {
          console.log(response);
          if (response.data.version !== self.version) {
            vue.$message.warning('Flux requires an update!');
          } else {
            vue.$message.success('Flux is up to date');
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error verifying recent version');
        });
    },
    logoutAllSessions() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      zelIDService.logoutAllSessions(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
          } else {
            localStorage.removeItem('zelidauth');
            this.$store.commit('setZelCashSection', 'getinfo');
            this.$store.commit('setPrivilage', 'none');
            vue.$message.success(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$message.error(e.toString());
        });
    },
  },
};
</script>
