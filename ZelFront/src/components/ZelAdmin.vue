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
            <el-tooltip
              content="Currently logged and used session by you"
              placement="top"
            >
              <i
                v-if="scope.row.loginPhrase === currentLoginPhrase"
                class="el-icon-warning"
              ></i>&nbsp;
            </el-tooltip>
            <el-popconfirm
              confirmButtonText='Log Out!'
              cancelButtonText='No, Thanks'
              icon="el-icon-info"
              iconColor="red"
              title="This action will log out your selected session."
              @onConfirm="logoutSpecificSession(scope.$index, scope.row)"
            >
              <ElButton
                size="mini"
                type="danger"
                slot="reference"
              >
                Log Out
              </ElButton>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <el-popconfirm
        confirmButtonText='Log Out all sessions!'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="This action will log out ALL your sessions include the one currently used!"
        @onConfirm="logoutAllSessions()"
      >
        <ElButton slot="reference">
          Log Out all sessions
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="zelAdminSection === 'manageflux'">
      <el-dialog
        :close-on-click-modal="false"
        :close-on-press-escape="false"
        :show-close="false"
        title="Flux is updating"
        :visible.sync="updateDialogVisible"
        width="50%"
      >
        <el-progress :percentage="updateProgress"></el-progress>
      </el-dialog>
      <el-popconfirm
        confirmButtonText='OK'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="orange"
        title="Flux will now begin updating itself."
        @onConfirm="updateZelFlux()"
      >
        <ElButton slot="reference">
          Update Flux
        </ElButton>
      </el-popconfirm>
      <br>
      <el-popconfirm
        confirmButtonText='Rebuild!'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Rebuilds Flux User Interface. Useful for resolving minor UI issues."
        @onConfirm="rebuildZelFront()"
      >
        <ElButton slot="reference">
          Rebuild ZelFront
        </ElButton>
      </el-popconfirm>
      <br>
      <el-popconfirm
        confirmButtonText='Reindex Flux!'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Reindexes ALL Flux databases and rebuilds them from scratch"
        @onConfirm="reindexFlux()"
      >
        <ElButton slot="reference">
          Reindex Flux databases
        </ElButton>
      </el-popconfirm>
      <el-popconfirm
        confirmButtonText='Reindex Explorer!'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Reindexes Explorer tied databases and rebuilds them from scratch"
        @onConfirm="reindexExplorer()"
      >
        <ElButton slot="reference">
          Reindex Explorer databases
        </ElButton>
      </el-popconfirm>
      <br>
      BlockHeight:
      <el-input-number
        controls-position="right"
        placeholder="insert blockheight"
        v-model="rescanFluxHeight"
        :min="0"
        :max="1000000"
      ></el-input-number>
      <el-popconfirm
        confirmButtonText='Rescan Flux!'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Rescans ALL Flux databases and rebuilds them from scratch"
        @onConfirm="rescanFlux()"
      >
        <ElButton slot="reference">
          Rescan Flux databases
        </ElButton>
      </el-popconfirm>
      <br>
      BlockHeight:
      <el-input-number
        controls-position="right"
        placeholder="insert blockheight"
        v-model="rescanExplorerHeight"
        :min="0"
        :max="1000000"
      ></el-input-number>
      <el-popconfirm
        confirmButtonText='Rescan Explorer!'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Rescans Explorer tied databases and rebuilds them from scratch"
        @onConfirm="rescanExplorer()"
      >
        <ElButton slot="reference">
          Rescan Explorer databases
        </ElButton>
      </el-popconfirm>
      <br>
      BlockHeight:
      <el-input-number
        controls-position="right"
        placeholder="insert blockheight"
        v-model="rescanGlobalAppsHeight"
        :min="0"
        :max="1000000"
      ></el-input-number>
      <el-tooltip
        :content="removeLastInformation ? 'Remove last app information' : 'Do NOT remove last app information'"
        placement="top"
      >
        <el-switch
          v-model="removeLastInformation"
          active-color="#13ce66"
          inactive-color="#ff4949"
        >
        </el-switch>
      </el-tooltip>
      <el-popconfirm
        confirmButtonText='Rescan Global Apps!'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Rescans Global Applications from stored permanent messages given a blockheight."
        @onConfirm="rescanGlobalApps()"
      >
        <ElButton slot="reference">
          Rescan Global Apps Information
        </ElButton>
      </el-popconfirm>
      <br>
      <el-popconfirm
        confirmButtonText='Reindex Global Apps!'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Reindexes Global Application Speicifications from stored permanent messages"
        @onConfirm="reindexGlobalApps()"
      >
        <ElButton slot="reference">
          Reindex Global Apps Information
        </ElButton>
      </el-popconfirm>
      <br>
      <el-popconfirm
        confirmButtonText='Reindex Locations!'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Reindexes that drops information about where each application on the network is located and rebuilds collection indexes. Locations will be rebuild from incoming messages."
        @onConfirm="reindexLocations()"
      >
        <ElButton slot="reference">
          Reindex Global Apps Locations
        </ElButton>
      </el-popconfirm>
      <br>
      <el-popconfirm
        confirmButtonText='Restart Block Processing!'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="This will restart Flux block processing which is a crucial process for Explorer and Apps functionality. Use with caution!"
        @onConfirm="restartBlockProcessing()"
      >
        <ElButton slot="reference">
          Restart Block Processing
        </ElButton>
      </el-popconfirm>
      <el-popconfirm
        confirmButtonText='Stop Block Processing!'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="This will stop Flux block processing which is a crucial process for Explorer and Apps functionality. Your node may go offline if block processing is not running!"
        @onConfirm="stopBlockProcessing()"
      >
        <ElButton slot="reference">
          Stop Block Processing
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="zelAdminSection === 'managezelcash'">
      <el-popconfirm
        confirmButtonText='Update Zel daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="orange"
        title="Updates Zel daemon to the latest version"
        @onConfirm="updateZelCash()"
      >
        <ElButton slot="reference">
          Update ZelCash
        </ElButton>
      </el-popconfirm>
      <br>
      <el-popconfirm
        confirmButtonText='Start Zel daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="green"
        title="Starts Zel daemon"
        @onConfirm="startZelCash()"
      >
        <ElButton slot="reference">
          Start ZelCash
        </ElButton>
      </el-popconfirm>
      <el-popconfirm
        confirmButtonText='Stop Zel daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Stops Zel daemon"
        @onConfirm="stopZelCash()"
      >
        <ElButton slot="reference">
          Stop ZelCash
        </ElButton>
      </el-popconfirm>
      <el-popconfirm
        confirmButtonText='Restart Zel daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="orange"
        title="Restarts Zel daemon"
        @onConfirm="restartZelCash()"
      >
        <ElButton slot="reference">
          Restart ZelCash
        </ElButton>
      </el-popconfirm>
      <br>
      BlockHeight:
      <el-input-number
        controls-position="right"
        placeholder="insert blockheight"
        v-model="rescanZelCashHeight"
        :min="0"
        :max="1000000"
      ></el-input-number>
      <el-popconfirm
        confirmButtonText='Rescan Zel blockhain data'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Reindexes Zel daemon"
        @onConfirm="rescanZelCash()"
      >
        <ElButton slot="reference">
          Rescan ZelCash
        </ElButton>
      </el-popconfirm>
      <br>
      <el-popconfirm
        confirmButtonText='Reindex Zel blockhain data'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Reindexes Zel daemon"
        @onConfirm="reindexZelCash()"
      >
        <ElButton slot="reference">
          Reindex ZelCash
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="zelAdminSection === 'managezelbench'">
      <el-popconfirm
        confirmButtonText='Update ZelBench'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="orange"
        title="Updates Zel daemon to the latest version"
        @onConfirm="updateZelBench()"
      >
        <ElButton slot="reference">
          Update ZelBench
        </ElButton>
      </el-popconfirm>
      <br>
      <el-popconfirm
        confirmButtonText='Start ZelBench daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="green"
        title="Starts ZelBench daemon"
        @onConfirm="startZelBench()"
      >
        <ElButton slot="reference">
          Start ZelBench
        </ElButton>
      </el-popconfirm>
      <el-popconfirm
        confirmButtonText='Stop ZelBench daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Stops Zel daemon"
        @onConfirm="stopZelBench()"
      >
        <ElButton slot="reference">
          Stop ZelBench
        </ElButton>
      </el-popconfirm>
      <el-popconfirm
        confirmButtonText='Restart ZelBench daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="orange"
        title="Restarts ZelBench daemon"
        @onConfirm="restartZelBench()"
      >
        <ElButton slot="reference">
          Restart ZelBench
        </ElButton>
      </el-popconfirm>
      <br>
      <el-popconfirm
        confirmButtonText='Restart Benchmarks'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="orange"
        title="Runs a complete new test of node benchmarking"
        @onConfirm="restartBenchmarks()"
      >
        <ElButton slot="reference">
          Restart Benchmarks
        </ElButton>
      </el-popconfirm>
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
            <el-tooltip
              content="Currently logged and used session by you"
              placement="top"
            >
              <i
                v-if="scope.row.loginPhrase === currentLoginPhrase"
                class="el-icon-warning"
              ></i>&nbsp;
            </el-tooltip>
            <el-popconfirm
              confirmButtonText='Log Out!'
              cancelButtonText='No, Thanks'
              icon="el-icon-info"
              iconColor="red"
              title="This action will log out selected user session."
              @onConfirm="logoutSpecificSession(scope.$index, scope.row)"
            >
              <ElButton
                size="mini"
                type="danger"
                slot="reference"
              >
                Log Out
              </ElButton>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <el-popconfirm
        confirmButtonText='Log Out all users!'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="This action will log out ALL users including you!"
        @onConfirm="logOutAllUsers()"
      >
        <ElButton slot="reference">
          Log Out all users
        </ElButton>
      </el-popconfirm>
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
import ExplorerService from '@/services/ExplorerService';
import ZelAppsService from '@/services/ZelAppsService';

const qs = require('qs');

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'ZelAdmin',
  data() {
    return {
      filterLoggedUsers: '',
      loggedUsersTable: [],
      updateDialogVisible: false,
      updateProgress: 0,
      rescanZelCashHeight: 0,
      rescanFluxHeight: 0,
      rescanExplorerHeight: 0,
      rescanGlobalAppsHeight: 0,
      removeLastInformation: false,
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
            self.updateDialogVisible = true;
            self.updateProgress = 5;
            const interval = setInterval(() => {
              if (self.updateProgress === 99) {
                self.updateProgress += 1;
              } else {
                self.updateProgress += 2;
              }
              if (self.updateProgress >= 100) {
                clearInterval(interval);
                vue.$message.success('Update completed. Flux will now reload');
                setTimeout(() => {
                  if (self.updateDialogVisible) {
                    window.location.reload(true);
                  }
                }, 5000);
              }
              if (!self.updateDialogVisible) {
                clearInterval(interval);
                self.updateProgress = 0;
              }
            }, 1000);
            ZelNodeService.updateZelFlux(zelidauth)
              .then((responseB) => {
                console.log(responseB);
                if (responseB.data.status === 'error') {
                  vue.$message.error(responseB.data.data.message || responseB.data.data);
                }
                if (responseB.data.data.code === 401) {
                  self.updateDialogVisible = false;
                  self.updateProgress = 0;
                }
              })
              .catch((e) => {
                self.updateDialogVisible = false;
                self.updateProgress = 0;
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
                      vue.$message.error(responseUpdateZelCash.data.data.message || responseUpdateZelCash.data.data);
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
    startZelCash() {
      vue.$message.warning('ZelCash will start');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelCashService.start(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error while trying to start ZelCash');
        });
    },
    stopZelCash() {
      vue.$message.warning('ZelCash will be stopped');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelCashService.stopZelCash(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error while trying to stop ZelCash');
        });
    },
    restartZelCash() {
      vue.$message.warning('ZelCash will now restart');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelCashService.restart(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error while trying to restart ZelCash');
        });
    },
    startZelBench() {
      vue.$message.warning('ZelBench will start');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelBenchService.start(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error while trying to start ZelBench');
        });
    },
    stopZelBench() {
      vue.$message.warning('ZelBench will be stopped');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelBenchService.stop(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error while trying to stop ZelBench');
        });
    },
    restartZelBench() {
      vue.$message.warning('ZelBench will now restart');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelBenchService.restart(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error while trying to restart ZelBench');
        });
    },
    restartBenchmarks() {
      vue.$message.warning('Initiating new benchmarks...');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelBenchService.restartNodeBenchmarks(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error while trying to run new benchmarks');
        });
    },
    rescanZelCash() {
      vue.$message.warning('ZelCash will now rescan. This will take up to an hour.');
      const zelidauth = localStorage.getItem('zelidauth');
      const blockheight = this.rescanZelCashHeight > 0 ? this.rescanZelCashHeight : 0;
      ZelCashService.rescanZelCash(zelidauth, blockheight)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error while trying to rescan ZelCash');
        });
    },
    reindexZelCash() {
      vue.$message.warning('ZelCash will now reindex. This will take several hours.');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelNodeService.reindexZelCash(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            vue.$message.success(response.data.data.message || response.data.data);
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
                      vue.$message.error(responseUpdateZelBench.data.data.message || responseUpdateZelBench.data.data);
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
            vue.$message.error(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$message.error(e.toString());
        });
    },
    rescanExplorer() {
      vue.$message.warning('Explorer will now rescan');
      const zelidauth = localStorage.getItem('zelidauth');
      const blockheight = this.rescanExplorerHeight > 0 ? this.rescanExplorerHeight : 0;
      ExplorerService.rescanExplorer(zelidauth, blockheight)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error while trying to rescan Explorer');
        });
    },
    rescanFlux() {
      vue.$message.warning('Flux will now rescan');
      const zelidauth = localStorage.getItem('zelidauth');
      const blockheight = this.rescanFluxHeight > 0 ? this.rescanFluxHeight : 0;
      ExplorerService.rescanFlux(zelidauth, blockheight)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error while trying to rescan Flux');
        });
    },
    reindexExplorer() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      vue.$message.success('Explorer databases will begin to reindex soon');
      ExplorerService.reindexExplorer(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$message.error(e.toString());
        });
    },
    reindexFlux() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      vue.$message.success('Flux databases will begin to reindex soon');
      ExplorerService.reindexFlux(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$message.error(e.toString());
        });
    },
    reindexGlobalApps() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      vue.$message.success('Global Applications information will reindex soon');
      ZelAppsService.reindexGlobalApps(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$message.error(e.toString());
        });
    },
    reindexLocations() {
      const zelidauth = localStorage.getItem('zelidauth');
      vue.$message.warning('Global Applications location will reindex soon...');
      ZelAppsService.reindexLocations(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          vue.$message.error(e.toString());
        });
    },
    rescanGlobalApps() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      vue.$message.success('Global Applications information will reindex soon');
      const blockheight = this.rescanExplorerHeight > 0 ? this.rescanExplorerHeight : 0;
      ZelAppsService.rescanGlobalApps(zelidauth, blockheight, this.removeLastInformation)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$message.error(e.toString());
        });
    },
    restartBlockProcessing() {
      const zelidauth = localStorage.getItem('zelidauth');
      vue.$message.warning('Restarting block processing...');
      ZelAppsService.restartBlockProcessing(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          vue.$message.error(e.toString());
        });
    },
    stopBlockProcessing() {
      const zelidauth = localStorage.getItem('zelidauth');
      vue.$message.warning('Stopping block processing...');
      ZelAppsService.stopBlockProcessing(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            vue.$message.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
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
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            localStorage.removeItem('zelidauth');
            this.$store.commit('setZelCashSection', 'getinfo');
            this.$store.commit('setPrivilage', 'none');
            vue.$message.success(response.data.data.message || response.data.data);
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
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            localStorage.removeItem('zelidauth');
            this.$store.commit('setZelCashSection', 'getinfo');
            this.$store.commit('setPrivilage', 'none');
            vue.$message.success(response.data.data.message || response.data.data);
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
            vue.$message.error(response.data.data.message || response.data.data);
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
            vue.$message.error(response.data.data.message || response.data.data);
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
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            vue.$message.success(response.data.data.message || response.data.data);
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
