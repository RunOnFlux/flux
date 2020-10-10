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
      <p>
        Manage your Crux ID. In case of additional node rewards, users can send you assets to the following Crux ID.
      </p>
      <br>
      <el-input
        class="width25"
        placeholder="Crux ID"
        v-model="cruxidInput"
      >
      </el-input>
      <br>
      <el-popconfirm
        confirmButtonText='Update'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="orange"
        title="Flux will now update your Crux ID."
        @onConfirm="adjustCruxID()"
      >
        <ElButton slot="reference">
          Update Crux ID
        </ElButton>
      </el-popconfirm>
      <el-divider></el-divider>
      <p>
        Update your Flux to the latest version. Every Flux has to run the newest version to stay on par with the network.
      </p>
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
      <el-divider></el-divider>
      <p>
        This option rebuilds Flux User Interface. Shall be used only in situation when UI does not rebuild properly to latest Flux version.
      </p>
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
      <el-divider></el-divider>
      <p>
        Options to reindex Flux databases and so rebuild them from scratch. Reindexing may take several hours and shall be used only when an unrecoverable error is present in databases.
      </p>
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
      <el-divider></el-divider>
      <p>
        Options to rescan Flux databases from a given blockheight and rebuild them since. Rescanning may take several hours and shall be used only when an unrecoverable error is present in databases with a known blockheight.
        Rescanning Flux databases is a deeper option than just explorer databases and so while rescanning entire Flux databases, explorer parts will be rescanned as well.
      </p>
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
      <el-divider></el-divider>
      <p>
        Options to rescan Flux Global Application Database from a given blockheight and rebuild them since. Rescanning may take several hours and shall be used only when an unrecoverable error is present in databases with a known blockheight.
        If remove Last Information is wished. The current specifics will be dropped instead making it more deep option.
      </p>
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
      <el-divider></el-divider>
      <p>
        Reindexes Flux Global Application Database and rebuilds them entirely from stored permanent messages. Reindexing may take a few hours and shall be used only when an unrecoverable error is present.
      </p>
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
      <el-divider></el-divider>
      <p>
        Reindexes Flux Global Application Locations and rebuilds them from newly incoming messages. Shall be used only when index has inconsistencies.
      </p>
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
      <el-divider></el-divider>
      <p>
        These options manage Flux block processing which is a crucial process for Explorer and Apps functionality. Useful when Block Processing encounters an error and is stuck. Use with caution!
      </p>
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
      <p>
        An easy way to update your ZelCash daemon to the latest version. ZelCash will be automatically started once update is done.
      </p>
      <el-popconfirm
        confirmButtonText='Update ZelCash daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="orange"
        title="Updates ZelCash daemon to the latest version"
        @onConfirm="updateZelCash()"
      >
        <ElButton slot="reference">
          Update ZelCash
        </ElButton>
      </el-popconfirm>
      <el-divider></el-divider>
      <p>
        Here you can manage your ZelCash daemon process.
      </p>
      <el-popconfirm
        confirmButtonText='Start ZelCash daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="green"
        title="Starts ZelCash daemon"
        @onConfirm="startZelCash()"
      >
        <ElButton slot="reference">
          Start ZelCash
        </ElButton>
      </el-popconfirm>
      <el-popconfirm
        confirmButtonText='Stop ZelCash daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Stops ZelCash daemon"
        @onConfirm="stopZelCash()"
      >
        <ElButton slot="reference">
          Stop ZelCash
        </ElButton>
      </el-popconfirm>
      <el-popconfirm
        confirmButtonText='Restart ZelCash daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="orange"
        title="Restarts ZelCash daemon"
        @onConfirm="restartZelCash()"
      >
        <ElButton slot="reference">
          Restart ZelCash
        </ElButton>
      </el-popconfirm>
      <el-divider></el-divider>
      <p>
        Choose a blockheight to rescan ZelCash from and click on Rescan ZelCash to begin rescanning.
      </p>
      BlockHeight:
      <el-input-number
        controls-position="right"
        placeholder="insert blockheight"
        v-model="rescanZelCashHeight"
        :min="0"
        :max="1000000"
      ></el-input-number>
      <el-popconfirm
        confirmButtonText='Rescan ZelCash blockhain data'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Rescan ZelCash daemon"
        @onConfirm="rescanZelCash()"
      >
        <ElButton slot="reference">
          Rescan ZelCash
        </ElButton>
      </el-popconfirm>
      <el-divider></el-divider>
      <p>
        This option reindexes ZelCash blockchain data. It will take several hours to finish the operation.
      </p>
      <el-popconfirm
        confirmButtonText='Reindex ZelCash blockhain data'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Reindexes ZelCash daemon"
        @onConfirm="reindexZelCash()"
      >
        <ElButton slot="reference">
          Reindex ZelCash
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="zelAdminSection === 'managezelbench'">
      <p>
        An easy way to update your ZelBench daemon to the latest version. ZelBench will be automatically started once update is done.
      </p>
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
      <el-divider></el-divider>
      <p>
        Here you can manage your ZelBench daemon process.
      </p>
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
        title="Stops ZelBench daemon"
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
      <el-divider></el-divider>
      <p>
        Option to trigger a complete new run of node benchmarking. Useful when your node falls down in category or fails benchmarking tests.
      </p>
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

import ZelFluxService from '@/services/ZelFluxService';
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
      cruxidInput: '',
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
      this.switcher(val);
    },
  },
  mounted() {
    this.switcher(this.zelAdminSection);
  },
  methods: {
    switcher(value) {
      switch (value) {
        case 'loggedsessions':
          this.loggedSessions();
          break;
        case 'manageflux':
          this.getCruxID();
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
    async getCruxID() {
      const response = await ZelFluxService.getCruxID();
      this.cruxidInput = response.data.data;
    },
    updateZelFlux() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      const self = this;
      axios.get('https://raw.githubusercontent.com/zelcash/zelflux/master/package.json')
        .then((response) => {
          console.log(response);
          if (response.data.version !== self.zelfluxVersion) {
            vue.$customMes.success('Flux is now updating in the background');
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
                vue.$customMes.success('Update completed. Flux will now reload');
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
                  vue.$customMes.error(responseB.data.data.message || responseB.data.data);
                }
                if (responseB.data.data.code === 401) {
                  self.updateDialogVisible = false;
                  self.updateProgress = 0;
                }
              })
              .catch((e) => {
                console.log(e);
                console.log(e.code);
                if (e.toString() === 'Error: Network Error') {
                  self.updateProgress = 50;
                } else {
                  self.updateDialogVisible = false;
                  self.updateProgress = 0;
                  vue.$customMes.error(e.toString());
                }
              });
          } else {
            vue.$customMes.success('Flux is already up to date.');
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error verifying recent version');
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
                vue.$customMes.success('ZelCash is now updating in the background');
                ZelNodeService.updateZelCash(zelidauth)
                  .then((responseUpdateZelCash) => {
                    console.log(responseUpdateZelCash);
                    if (responseUpdateZelCash.data.status === 'error') {
                      vue.$customMes.error(responseUpdateZelCash.data.data.message || responseUpdateZelCash.data.data);
                    }
                  })
                  .catch((e) => {
                    console.log(e);
                    console.log(e.code);
                    vue.$customMes.error(e.toString());
                  });
              } else {
                vue.$customMes.success('ZelCash is already up to date');
              }
            })
            .catch((error) => {
              console.log(error);
              vue.$customMes.error('Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error connecting to ZelCash daemon');
        });
    },
    startZelCash() {
      vue.$customMes.warning('ZelCash will start');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelCashService.start(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to start ZelCash');
        });
    },
    stopZelCash() {
      vue.$customMes.warning('ZelCash will be stopped');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelCashService.stopZelCash(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to stop ZelCash');
        });
    },
    restartZelCash() {
      vue.$customMes.warning('ZelCash will now restart');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelCashService.restart(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to restart ZelCash');
        });
    },
    startZelBench() {
      vue.$customMes.warning('ZelBench will start');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelBenchService.start(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to start ZelBench');
        });
    },
    stopZelBench() {
      vue.$customMes.warning('ZelBench will be stopped');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelBenchService.stop(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to stop ZelBench');
        });
    },
    restartZelBench() {
      vue.$customMes.warning('ZelBench will now restart');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelBenchService.restart(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to restart ZelBench');
        });
    },
    restartBenchmarks() {
      vue.$customMes.warning('Initiating new benchmarks...');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelBenchService.restartNodeBenchmarks(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to run new benchmarks');
        });
    },
    rescanZelCash() {
      vue.$customMes.warning('ZelCash will now rescan. This will take up to an hour.');
      const zelidauth = localStorage.getItem('zelidauth');
      const blockheight = this.rescanZelCashHeight > 0 ? this.rescanZelCashHeight : 0;
      ZelCashService.rescanZelCash(zelidauth, blockheight)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to rescan ZelCash');
        });
    },
    reindexZelCash() {
      vue.$customMes.warning('ZelCash will now reindex. This will take several hours.');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelNodeService.reindexZelCash(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to reindex ZelCash');
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
                vue.$customMes.success('ZelBench is now updating in the background');
                ZelNodeService.updateZelBench(zelidauth)
                  .then((responseUpdateZelBench) => {
                    console.log(responseUpdateZelBench);
                    if (responseUpdateZelBench.data.status === 'error') {
                      vue.$customMes.error(responseUpdateZelBench.data.data.message || responseUpdateZelBench.data.data);
                    }
                  })
                  .catch((e) => {
                    console.log(e);
                    console.log(e.code);
                    vue.$customMes.error(e.toString());
                  });
              } else {
                vue.$customMes.success('ZelBench is already up to date');
              }
            })
            .catch((error) => {
              console.log(error);
              vue.$customMes.error('Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error connecting to ZelBench daemon');
        });
    },
    rebuildZelFront() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      vue.$customMes.success('ZelFront is now rebuilding in the background');
      ZelNodeService.rebuildZelFront(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$customMes.error(e.toString());
        });
    },
    rescanExplorer() {
      vue.$customMes.warning('Explorer will now rescan');
      const zelidauth = localStorage.getItem('zelidauth');
      const blockheight = this.rescanExplorerHeight > 0 ? this.rescanExplorerHeight : 0;
      ExplorerService.rescanExplorer(zelidauth, blockheight)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to rescan Explorer');
        });
    },
    rescanFlux() {
      vue.$customMes.warning('Flux will now rescan');
      const zelidauth = localStorage.getItem('zelidauth');
      const blockheight = this.rescanFluxHeight > 0 ? this.rescanFluxHeight : 0;
      ExplorerService.rescanFlux(zelidauth, blockheight)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to rescan Flux');
        });
    },
    reindexExplorer() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      vue.$customMes.success('Explorer databases will begin to reindex soon');
      ExplorerService.reindexExplorer(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$customMes.error(e.toString());
        });
    },
    reindexFlux() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      vue.$customMes.success('Flux databases will begin to reindex soon');
      ExplorerService.reindexFlux(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$customMes.error(e.toString());
        });
    },
    reindexGlobalApps() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      vue.$customMes.success('Global Applications information will reindex soon');
      ZelAppsService.reindexGlobalApps(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$customMes.error(e.toString());
        });
    },
    reindexLocations() {
      const zelidauth = localStorage.getItem('zelidauth');
      vue.$customMes.warning('Global Applications location will reindex soon...');
      ZelAppsService.reindexLocations(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          vue.$customMes.error(e.toString());
        });
    },
    rescanGlobalApps() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      vue.$customMes.success('Global Applications information will reindex soon');
      const blockheight = this.rescanExplorerHeight > 0 ? this.rescanExplorerHeight : 0;
      ZelAppsService.rescanGlobalApps(zelidauth, blockheight, this.removeLastInformation)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$customMes.error(e.toString());
        });
    },
    restartBlockProcessing() {
      const zelidauth = localStorage.getItem('zelidauth');
      vue.$customMes.warning('Restarting block processing...');
      ExplorerService.restartBlockProcessing(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          vue.$customMes.error(e.toString());
        });
    },
    stopBlockProcessing() {
      const zelidauth = localStorage.getItem('zelidauth');
      vue.$customMes.warning('Stopping block processing...');
      ExplorerService.stopBlockProcessing(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          vue.$customMes.error(e.toString());
        });
    },
    getLatestZelFluxVersion() {
      const self = this;
      axios.get('https://raw.githubusercontent.com/zelcash/zelflux/master/package.json')
        .then((response) => {
          console.log(response);
          if (response.data.version !== self.zelfluxVersion) {
            vue.$customMes.warning('Flux requires an update!');
          } else {
            vue.$customMes.success('Flux is up to date');
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error verifying recent version');
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
                vue.$customMes.warning('ZelCash requires an update!');
              } else {
                vue.$customMes.success('ZelCash is up to date');
              }
            })
            .catch((error) => {
              console.log(error);
              vue.$customMes.error('Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error connecting to ZelCash daemon');
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
                vue.$customMes.warning('ZelBench requires an update!');
              } else {
                vue.$customMes.success('ZelBench is up to date');
              }
            })
            .catch((error) => {
              console.log(error);
              vue.$customMes.error('Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error connecting to ZelBench daemon');
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
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            localStorage.removeItem('zelidauth');
            this.$store.commit('setZelCashSection', 'getinfo');
            this.$store.commit('setPrivilage', 'none');
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$customMes.error(e.toString());
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
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            localStorage.removeItem('zelidauth');
            this.$store.commit('setZelCashSection', 'getinfo');
            this.$store.commit('setPrivilage', 'none');
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$customMes.error(e.toString());
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
            vue.$customMes.error(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$customMes.error(e.toString());
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
            vue.$customMes.error(response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$customMes.error(e.toString());
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
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
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
          vue.$customMes.error(e.toString());
        });
    },
    async adjustCruxID() {
      const cruxId = this.cruxidInput;
      const zelidauth = localStorage.getItem('zelidauth');
      try {
        const cruxIDResponse = await ZelFluxService.adjustCruxID(zelidauth, cruxId);
        if (cruxIDResponse.data.status === 'error') {
          vue.$customMes.error(cruxIDResponse.data.data.message || cruxIDResponse.data.data);
        } else {
          vue.$customMes.success(cruxIDResponse.data.data.message || cruxIDResponse.data.data);
        }
      } catch (error) {
        vue.$customMes.error(error.message || error);
      }
    },
  },
};
</script>
