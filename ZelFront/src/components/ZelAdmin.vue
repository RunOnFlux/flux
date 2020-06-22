<template>
  <div class="zeladminsection">
    <div v-if="zelAdminSection === 'loggedsessions'">
      <el-table
        :data="loggedUsersTable.filter(data => !filterLoggedUsers || data.zelid.toLowerCase().includes(filterLoggedUsers.toLowerCase()) || data.loginPhrase.toLowerCase().includes(filterLoggedUsers.toLowerCase()))"
        style="width: 100%"
      >
        <el-table-column
          label="Zel ID"
          prop="zelid"
        >
        </el-table-column>
        <el-table-column
          label="Login Phrase"
          prop="loginPhrase"
        >
        </el-table-column>
        <el-table-column align="right">
          <template
            slot="header"
            slot-scope="scope"
          >
            <el-input
              v-if="scope"
              v-model="filterLoggedUsers"
              size="mini"
              placeholder="Type to search"
            />
          </template>
          <template slot-scope="scope">
            <i
              v-if="scope.row.loginPhrase === currentLoginPhrase"
              class="el-icon-warning"
            ></i>&nbsp;
            <el-button
              size="mini"
              type="danger"
              @click="logoutSpecificSession(scope.$index, scope.row)"
            >Log Out</el-button>
          </template>
        </el-table-column>
      </el-table>
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
        @click="updateZelFlux()"
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
      <ElButton
        class="generalButton"
        @click="reindexZelCash()"
      >
        Reindex ZelCash
      </ElButton>
    </div>
    <div v-if="zelAdminSection === 'managezelbench'">
      <ElButton
        class="generalButton"
        @click="updateZelBench()"
      >
        Update ZelBench
      </ElButton>
    </div>
    <div v-if="zelAdminSection === 'manageusers'">
      <el-table
        :data="loggedUsersTable.filter(data => !filterLoggedUsers || data.zelid.toLowerCase().includes(filterLoggedUsers.toLowerCase()) || data.loginPhrase.toLowerCase().includes(filterLoggedUsers.toLowerCase()))"
        style="width: 100%"
      >
        <el-table-column
          label="Zel ID"
          prop="zelid"
        >
        </el-table-column>
        <el-table-column
          label="Login Phrase"
          prop="loginPhrase"
        >
        </el-table-column>
        <el-table-column align="right">
          <template
            slot="header"
            slot-scope="scope"
          >
            <el-input
              v-if="scope"
              v-model="filterLoggedUsers"
              size="mini"
              placeholder="Type to search"
            />
          </template>
          <template slot-scope="scope">
            <i
              v-if="scope.row.loginPhrase === currentLoginPhrase"
              class="el-icon-warning"
            ></i>&nbsp;
            <el-button
              size="mini"
              type="danger"
              @click="logoutSpecificSession(scope.$index, scope.row)"
            >Log Out</el-button>
          </template>
        </el-table-column>
      </el-table>
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
import ZelBenchService from '@/services/ZelBenchService';

const qs = require('qs');

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'ZelAdmin',
  data() {
    return {
      filterLoggedUsers: '',
      loggedUsersTable: [],
    };
  },
  computed: {
    ...mapState([
      'zelfluxVersion',
      'config',
      'userconfig',
      'privilage',
      'zelAdminSection',
    ]),
    currentLoginPhrase() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      return auth.loginPhrase;
    },
  },
  watch: {
    zelAdminSection(val, oldVal) {
      console.log(val, oldVal);
      switch (val) {
        case 'loggedsessions':
          this.loggedUsersTable = [];
          this.filterLoggedUsers = '';
          this.loggedSessions();
          break;
        case 'manageflux':
          this.getLatestZelFluxVersion();
          break;
        case 'managezelcash':
          this.checkZelCashVersion();
          break;
        case 'managezelbench':
          this.checkZelBenchVersion();
          break;
        case 'manageusers':
          this.loggedUsersTable = [];
          this.filterLoggedUsers = '';
          this.loggedUsers();
          break;
        case null:
          console.log('Admin Section hidden');
          break;
        default:
          console.log('Admin Section: Unrecognized method'); // should not be seeable if all works correctly
      }
    },
  },
  mounted() {
    switch (this.zelAdminSection) {
      case 'loggedsessions':
        this.loggedSessions();
        break;
      case 'manageflux':
        this.getLatestZelFluxVersion();
        break;
      case 'managezelcash':
        this.checkZelCashVersion();
        break;
      case 'managezelbench':
        this.checkZelBenchVersion();
        break;
      case 'manageusers':
        this.loggedUsers();
        break;
      case null:
        console.log('zelAdmin Section hidden');
        break;
      default:
        console.log('zelAdmin Section: Unrecognized method'); // should not be seeable if all works correctly
    }
  },
  methods: {
    updateZelFlux() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      const self = this;
      axios.get('https://raw.githubusercontent.com/zelcash/zelflux/master/package.json')
        .then((response) => {
          console.log(response);
          if (response.data.version !== self.zelfluxVersion) {
            vue.$message.success('Flux is now updating in the background');
            ZelNodeService.updateZelFlux(zelidauth)
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
    reindexZelCash() {
      const zelidauth = localStorage.getItem('zelidauth');
      ZelNodeService.reindexZelCash(zelidauth)
        .then((response) => {
          vue.$message.success('ZelCash is now reindexing. This will take several hours.');
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error while trying to reindex ZelCash');
        });
    },
    updateZelBench() {
      ZelBenchService.getInfo()
        .then((zelbenchResponse) => {
          console.log(zelbenchResponse);
          const zelbenchVersion = zelbenchResponse.data.data.version;
          axios.get('https://zelcore.io/zelflux/zelbenchinfo.php')
            .then((response) => {
              console.log(response);
              if (response.data.version !== zelbenchVersion) {
                const zelidauth = localStorage.getItem('zelidauth');
                const auth = qs.parse(zelidauth);
                console.log(auth);
                vue.$message.success('ZelBench is now updating in the background');
                ZelNodeService.updateZelBench(zelidauth)
                  .then((responseUpdateZelBench) => {
                    console.log(responseUpdateZelBench);
                    if (responseUpdateZelBench.data.status === 'error') {
                      vue.$message.error(responseUpdateZelBench.data.data.message);
                    }
                  })
                  .catch((e) => {
                    console.log(e);
                    console.log(e.code);
                    vue.$message.error(e.toString());
                  });
              } else {
                vue.$message.success('ZelBench is already up to date');
              }
            })
            .catch((error) => {
              console.log(error);
              vue.$message.error('Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error connecting to ZelBench daemon');
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
    getLatestZelFluxVersion() {
      const self = this;
      axios.get('https://raw.githubusercontent.com/zelcash/zelflux/master/package.json')
        .then((response) => {
          console.log(response);
          if (response.data.version !== self.zelfluxVersion) {
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
    checkZelBenchVersion() {
      ZelBenchService.getInfo()
        .then((zelbenchResponse) => {
          console.log(zelbenchResponse);
          const zelbenchVersion = zelbenchResponse.data.data.version;
          axios.get('https://zelcore.io/zelflux/zelbenchinfo.php')
            .then((response) => {
              console.log(response);
              if (response.data.version !== zelbenchVersion) {
                vue.$message.warning('ZelBench requires an update!');
              } else {
                vue.$message.success('ZelBench is up to date');
              }
            })
            .catch((error) => {
              console.log(error);
              vue.$message.error('Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error connecting to ZelBench daemon');
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
    loggedSessions() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      zelIDService.loggedSessions(zelidauth)
        .then((response) => {
          console.log(response);
          this.loggedUsersTable = response.data.data;
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
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
          this.loggedUsersTable = response.data.data;
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$message.error(e.toString());
        });
    },
    logoutSpecificSession(index, row) {
      const self = this;
      console.log(index, row);
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      zelIDService.logoutSpecificSession(zelidauth, row.loginPhrase)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
          } else {
            vue.$message.success(response.data.data.message);
            if (row.loginPhrase === auth.loginPhrase) {
              localStorage.removeItem('zelidauth');
              this.$store.commit('setZelCashSection', 'getinfo');
              this.$store.commit('setPrivilage', 'none');
            } else {
              switch (self.zelAdminSection) {
                case 'loggedsessions':
                  self.loggedSessions();
                  break;
                case 'manageusers':
                  self.loggedUsers();
                  break;
                case null:
                  console.log('zelAdmin Section hidden');
                  break;
                default:
                  console.log('zelAdmin Section: Unrecognized method'); // should not be seeable if all works correctly
              }
            }
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
