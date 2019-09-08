<template>
  <div class="zelAdminSection">
    <div v-if="zelAdminSection === 'loggedsessions'">
      <ElButton
        class="generalButton"
        @click="logoutAllSessions()"
      >
        Logout all sessions
      </ElButton>
    </div>
    <div v-if="zelAdminSection === 'manageflux'">
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
    <div v-if="zelAdminSection === 'managezelcash'">
      <ElButton
        class="generalButton"
        @click="updateZelCash()"
      >
        Update ZelCash
      </ElButton>
    </div>
    <div v-if="zelAdminSection === 'manageusers'">
      <ElButton
        class="generalButton"
        @click="logOutAllUsers()"
      >
        Logout all Users
      </ElButton>
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';
import axios from 'axios';

import zelIDService from '@/services/ZelIDService';
import ZelNodeService from '@/services/ZelNodeService';
import ZelCashService from '@/services/ZelCashService';

const qs = require('qs');

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'ZelAdmin',
  data() {
    return {
    };
  },
  computed: {
    ...mapState([
      'fluxVersion',
      'config',
      'userconfig',
      'privilage',
      'zelAdminSection',
    ]),
  },
  watch: {
    zelAdminSection(val, oldVal) {
      console.log(val, oldVal);
      switch (val) {
        case 'loggedsessions':
          break;
        case 'manageflux':
          this.getLatestFluxVersion();
          break;
        case 'managezelcash':
          break;
        case 'manageusers':
          this.loggedUsers();
          break;
        case null:
          console.log('Admin Section hidden');
          break;
        default:
          console.log('Admin Section: Unrecognised method'); // should not be seeable if all works correctly
      }
    },
  },
  mounted() {
    switch (this.zelAdminSection) {
      case 'loggedsessions':
        break;
      case 'manageflux':
        this.getLatestFluxVersion();
        break;
      case 'managezelcash':
        this.checkZelCashVersion();
        break;
      case 'manageusers':
        this.loggedUsers();
        break;
      case null:
        console.log('zelAdmin Section hidden');
        break;
      default:
        console.log('zelAdmin Section: Unrecognised method'); // should not be seeable if all works correctly
    }
  },
  methods: {
    updateFlux() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      const self = this;
      axios.get('https://raw.githubusercontent.com/zelcash/zelnoded/master/package.json')
        .then((response) => {
          console.log(response);
          if (response.data.version !== self.fluxVersion) {
            vue.$message.success('Flux is now updating in the background');
            ZelNodeService.updateFlux(zelidauth)
              .then((responseB) => {
                console.log(responseB);
                if (responseB.data.status === 'error') {
                  vue.$message.error(responseB.data.data.message);
                }
              })
              .catch((e) => {
                console.log(e);
                console.log(e.code);
                vue.$message.error(e.toString());
              });
          } else {
            vue.$message.success('Flux is already up to date.');
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error verifying recent version');
        });
    },
    updateZelCash() {
      ZelCashService.getInfo()
        .then((zelcashResponse) => {
          console.log(zelcashResponse);
          const zelcashVersion = zelcashResponse.data.data.version;
          axios.get('https://zelcore.io/zelflux/zelcashinfo.php')
            .then((response) => {
              console.log(response);
              if (response.data.version !== zelcashVersion) {
                const zelidauth = localStorage.getItem('zelidauth');
                const auth = qs.parse(zelidauth);
                console.log(auth);
                vue.$message.success('ZelCash is now updating in the background');
                ZelNodeService.updateZelCash(zelidauth)
                  .then((responseUpdateZelCash) => {
                    console.log(responseUpdateZelCash);
                    if (responseUpdateZelCash.data.status === 'error') {
                      vue.$message.error(responseUpdateZelCash.data.data.message);
                    }
                  })
                  .catch((e) => {
                    console.log(e);
                    console.log(e.code);
                    vue.$message.error(e.toString());
                  });
              } else {
                vue.$message.success('ZelCash is already up to date');
              }
            })
            .catch((error) => {
              console.log(error);
              vue.$message.error('Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error connecting to ZelCash daemon');
        });
    },
    rebuildZelFront() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      vue.$message.success('ZelFront is now rebuilding in the background');
      ZelNodeService.rebuildZelFront(zelidauth)
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
          if (response.data.version !== self.fluxVersion) {
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
    checkZelCashVersion() {
      ZelCashService.getInfo()
        .then((zelcashResponse) => {
          console.log(zelcashResponse);
          const zelcashVersion = zelcashResponse.data.data.version;
          axios.get('https://zelcore.io/zelflux/zelcashinfo.php')
            .then((response) => {
              console.log(response);
              if (response.data.version !== zelcashVersion) {
                vue.$message.warning('ZelCash requires an update!');
              } else {
                vue.$message.success('ZelCash is up to date');
              }
            })
            .catch((error) => {
              console.log(error);
              vue.$message.error('Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error connecting to ZelCash daemon');
        });
    },
    logOutAllUsers() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      zelIDService.logoutAllUsers(zelidauth)
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
    loggedUsers() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      zelIDService.loggedUsers(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
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
