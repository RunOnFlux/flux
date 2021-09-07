<template>
  <div class="adminsection">
    <div v-if="adminSection === 'loggedsessions'">
      <el-table
        :data="loggedUsersTable.filter(data => !filterLoggedUsers || data.zelid.toLowerCase().includes(filterLoggedUsers.toLowerCase()) || data.loginPhrase.toLowerCase().includes(filterLoggedUsers.toLowerCase()))"
        style="width: 100%"
      >
        <el-table-column
          label="ZelID"
          prop="zelid"
        />
        <el-table-column
          label="Login Phrase"
          prop="loginPhrase"
        />
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
              />&nbsp;
            </el-tooltip>
            <el-popconfirm
              confirm-button-text="Log Out!"
              cancel-button-text="No, Thanks"
              icon="el-icon-info"
              icon-color="red"
              title="This action will log out your selected session."
              @onConfirm="logoutSpecificSession(scope.$index, scope.row)"
              @confirm="logoutSpecificSession(scope.$index, scope.row)"
            >
              <ElButton
                slot="reference"
                size="mini"
                type="danger"
              >
                Log Out
              </ElButton>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <el-popconfirm
        confirm-button-text="Log Out all sessions!"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="This action will log out ALL your sessions include the one currently used!"
        @onConfirm="logoutAllSessions()"
        @confirm="logoutAllSessions()"
      >
        <ElButton slot="reference">
          Log Out all sessions
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="adminSection === 'manageflux'">
      <p>
        Running Kadena node makes you eligible for Kadena Rewards. Adjust your Kadena Account and Chain ID to ensure the reward distribution.
      </p>
      <br>
      Account:
      <el-input
        v-model="kadenaAccountInput"
        class="width50"
        placeholder="Kadena Account"
      />
      Chain ID:
      <el-input-number
        v-model="kadenaChainIDInput"
        controls-position="right"
        :min="0"
        :max="19"
      />
      <br>
      <el-popconfirm
        confirm-button-text="Update"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="orange"
        title="Flux will now update your Kadena Account"
        @onConfirm="adjustKadena()"
        @confirm="adjustKadena()"
      >
        <ElButton slot="reference">
          Update Kadena account
        </ElButton>
      </el-popconfirm>
      <el-divider />
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
        <el-progress :percentage="updateProgress" />
      </el-dialog>
      <el-popconfirm
        confirm-button-text="OK"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="orange"
        title="Flux will now begin updating itself."
        @onConfirm="updateFlux()"
        @confirm="updateFlux()"
      >
        <ElButton slot="reference">
          Update Flux
        </ElButton>
      </el-popconfirm>
      <el-divider />
      <p>
        This option rebuilds Flux Home User Interface. Shall be used only in situation when UI does not rebuild properly to latest Flux version.
      </p>
      <el-popconfirm
        confirm-button-text="Rebuild!"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="Rebuilds Flux Home User Interface. Useful for resolving minor UI issues."
        @onConfirm="rebuildHome()"
        @confirm="rebuildHome()"
      >
        <ElButton slot="reference">
          Rebuild Home
        </ElButton>
      </el-popconfirm>
      <el-divider />
      <p>
        Options to reindex Flux databases and so rebuild them from scratch. Reindexing may take several hours and shall be used only when an unrecoverable error is present in databases.
      </p>
      <el-popconfirm
        confirm-button-text="Reindex Flux!"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="Reindexes ALL Flux databases and rebuilds them from scratch"
        @onConfirm="reindexFlux()"
        @confirm="reindexFlux()"
      >
        <ElButton slot="reference">
          Reindex Flux databases
        </ElButton>
      </el-popconfirm>
      <el-popconfirm
        confirm-button-text="Reindex Explorer!"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="Reindexes Explorer tied databases and rebuilds them from scratch"
        @onConfirm="reindexExplorer()"
        @confirm="reindexExplorer()"
      >
        <ElButton slot="reference">
          Reindex Explorer databases
        </ElButton>
      </el-popconfirm>
      <el-divider />
      <p>
        Options to rescan Flux databases from a given blockheight and rebuild them since. Rescanning may take several hours and shall be used only when an unrecoverable error is present in databases with a known blockheight.
        Rescanning Flux databases is a deeper option than just explorer databases and so while rescanning entire Flux databases, explorer parts will be rescanned as well.
      </p>
      BlockHeight:
      <el-input-number
        v-model="rescanFluxHeight"
        controls-position="right"
        placeholder="insert blockheight"
        :min="0"
        :max="1000000"
      />
      <el-popconfirm
        confirm-button-text="Rescan Flux!"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="Rescans ALL Flux databases and rebuilds them from scratch"
        @onConfirm="rescanFlux()"
        @confirm="rescanFlux()"
      >
        <ElButton slot="reference">
          Rescan Flux databases
        </ElButton>
      </el-popconfirm>
      <br>
      BlockHeight:
      <el-input-number
        v-model="rescanExplorerHeight"
        controls-position="right"
        placeholder="insert blockheight"
        :min="0"
        :max="1000000"
      />
      <el-popconfirm
        confirm-button-text="Rescan Explorer!"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="Rescans Explorer tied databases and rebuilds them from scratch"
        @onConfirm="rescanExplorer()"
        @confirm="rescanExplorer()"
      >
        <ElButton slot="reference">
          Rescan Explorer databases
        </ElButton>
      </el-popconfirm>
      <el-divider />
      <p>
        Options to rescan Flux Global Application Database from a given blockheight and rebuild them since. Rescanning may take several hours and shall be used only when an unrecoverable error is present in databases with a known blockheight.
        If remove Last Information is wished. The current specifics will be dropped instead making it more deep option.
      </p>
      BlockHeight:
      <el-input-number
        v-model="rescanGlobalAppsHeight"
        controls-position="right"
        placeholder="insert blockheight"
        :min="0"
        :max="1000000"
      />
      <el-tooltip
        :content="removeLastInformation ? 'Remove last app information' : 'Do NOT remove last app information'"
        placement="top"
      >
        <el-switch
          v-model="removeLastInformation"
          active-color="#13ce66"
          inactive-color="#ff4949"
        />
      </el-tooltip>
      <el-popconfirm
        confirm-button-text="Rescan Global Apps!"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="Rescans Global Applications from stored permanent messages given a blockheight."
        @onConfirm="rescanGlobalApps()"
        @confirm="rescanGlobalApps()"
      >
        <ElButton slot="reference">
          Rescan Global Apps Information
        </ElButton>
      </el-popconfirm>
      <el-divider />
      <p>
        Reindexes Flux Global Application Database and rebuilds them entirely from stored permanent messages. Reindexing may take a few hours and shall be used only when an unrecoverable error is present.
      </p>
      <el-popconfirm
        confirm-button-text="Reindex Global Apps!"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="Reindexes Global Application Speicifications from stored permanent messages"
        @onConfirm="reindexGlobalApps()"
        @confirm="reindexGlobalApps()"
      >
        <ElButton slot="reference">
          Reindex Global Apps Information
        </ElButton>
      </el-popconfirm>
      <el-divider />
      <p>
        Reindexes Flux Global Application Locations and rebuilds them from newly incoming messages. Shall be used only when index has inconsistencies.
      </p>
      <el-popconfirm
        confirm-button-text="Reindex Locations!"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="Reindexes that drops information about where each application on the network is located and rebuilds collection indexes. Locations will be rebuild from incoming messages."
        @onConfirm="reindexLocations()"
        @confirm="reindexLocations()"
      >
        <ElButton slot="reference">
          Reindex Global Apps Locations
        </ElButton>
      </el-popconfirm>
      <el-divider />
      <p>
        These options manage Flux block processing which is a crucial process for Explorer and Apps functionality. Useful when Block Processing encounters an error and is stuck. Use with caution!
      </p>
      <el-popconfirm
        confirm-button-text="Restart Block Processing!"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="This will restart Flux block processing which is a crucial process for Explorer and Apps functionality. Use with caution!"
        @onConfirm="restartBlockProcessing()"
        @confirm="restartBlockProcessing()"
      >
        <ElButton slot="reference">
          Restart Block Processing
        </ElButton>
      </el-popconfirm>
      <el-popconfirm
        confirm-button-text="Stop Block Processing!"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="This will stop Flux block processing which is a crucial process for Explorer and Apps functionality. Your node may go offline if block processing is not running!"
        @onConfirm="stopBlockProcessing()"
        @confirm="stopBlockProcessing()"
      >
        <ElButton slot="reference">
          Stop Block Processing
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="adminSection === 'managedaemon'">
      <p>
        An easy way to update your Flux daemon to the latest version. Flux will be automatically started once update is done.
      </p>
      <el-popconfirm
        confirm-button-text="Update Flux daemon"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="orange"
        title="Updates Flux daemon to the latest version"
        @onConfirm="updateDaemon()"
        @confirm="updateDaemon()"
      >
        <ElButton slot="reference">
          Update Daemon
        </ElButton>
      </el-popconfirm>
      <el-divider />
      <p>
        Here you can manage your Flux daemon process.
      </p>
      <el-popconfirm
        confirm-button-text="Start Flux daemon"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="green"
        title="Starts Flux daemon"
        @onConfirm="startDaemon()"
        @confirm="startDaemon()"
      >
        <ElButton slot="reference">
          Start Daemon
        </ElButton>
      </el-popconfirm>
      <el-popconfirm
        confirm-button-text="Stop Flux daemon"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="Stops Flux daemon"
        @onConfirm="stopDaemon()"
        @confirm="stopDaemon()"
      >
        <ElButton slot="reference">
          Stop Daemon
        </ElButton>
      </el-popconfirm>
      <el-popconfirm
        confirm-button-text="Restart Flux daemon"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="orange"
        title="Restarts Flux daemon"
        @onConfirm="restartDaemon()"
        @confirm="restartDaemon()"
      >
        <ElButton slot="reference">
          Restart Daemon
        </ElButton>
      </el-popconfirm>
      <el-divider />
      <p>
        Choose a blockheight to rescan Daemon from and click on Rescan Daemon to begin rescanning.
      </p>
      BlockHeight:
      <el-input-number
        v-model="rescanDaemonHeight"
        controls-position="right"
        placeholder="insert blockheight"
        :min="0"
        :max="1000000"
      />
      <el-popconfirm
        confirm-button-text="Rescan Flux blockhain data"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="Rescan Flux daemon"
        @onConfirm="rescanDaemon()"
        @confirm="rescanDaemon()"
      >
        <ElButton slot="reference">
          Rescan Daemon
        </ElButton>
      </el-popconfirm>
      <el-divider />
      <p>
        This option reindexes Flux blockchain data. It will take several hours to finish the operation.
      </p>
      <el-popconfirm
        confirm-button-text="Reindex Flux blockhain data"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="Reindexes Flux daemon"
        @onConfirm="reindexDaemon()"
        @confirm="reindexDaemon()"
      >
        <ElButton slot="reference">
          Reindex Daemon
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="adminSection === 'managebenchmark'">
      <p>
        An easy way to update your Benchmark daemon to the latest version. Benchmark will be automatically started once update is done.
      </p>
      <el-popconfirm
        confirm-button-text="Update Benchmark"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="orange"
        title="Updates Benchmark to the latest version"
        @onConfirm="updateBenchmark()"
        @confirm="updateBenchmark()"
      >
        <ElButton slot="reference">
          Update Benchmark
        </ElButton>
      </el-popconfirm>
      <el-divider />
      <p>
        Here you can manage your Benchmark daemon process.
      </p>
      <el-popconfirm
        confirm-button-text="Start Benchmark daemon"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="green"
        title="Starts Benchmark daemon"
        @onConfirm="startBenchmark()"
        @confirm="startBenchmark()"
      >
        <ElButton slot="reference">
          Start Benchmark
        </ElButton>
      </el-popconfirm>
      <el-popconfirm
        confirm-button-text="Stop Benchmark daemon"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="Stops Benchmark daemon"
        @onConfirm="stopBenchmark()"
        @confirm="stopBenchmark()"
      >
        <ElButton slot="reference">
          Stop Benchmark
        </ElButton>
      </el-popconfirm>
      <el-popconfirm
        confirm-button-text="Restart Benchmark daemon"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="orange"
        title="Restarts Benchmark daemon"
        @onConfirm="restartBenchmark()"
        @confirm="restartBenchmark()"
      >
        <ElButton slot="reference">
          Restart Benchmark
        </ElButton>
      </el-popconfirm>
      <el-divider />
      <p>
        Option to trigger a complete new run of node benchmarking. Useful when your node falls down in category or fails benchmarking tests.
      </p>
      <el-popconfirm
        confirm-button-text="Restart Benchmarks"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="orange"
        title="Runs a complete new test of node benchmarking"
        @onConfirm="restartBenchmarks()"
        @confirm="restartBenchmarks()"
      >
        <ElButton slot="reference">
          Restart Benchmarks
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="adminSection === 'manageusers'">
      <el-table
        :data="loggedUsersTable.filter(data => !filterLoggedUsers || data.zelid.toLowerCase().includes(filterLoggedUsers.toLowerCase()) || data.loginPhrase.toLowerCase().includes(filterLoggedUsers.toLowerCase()))"
        style="width: 100%"
      >
        <el-table-column
          label="ZelID"
          prop="zelid"
        />
        <el-table-column
          label="Login Phrase"
          prop="loginPhrase"
        />
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
              />&nbsp;
            </el-tooltip>
            <el-popconfirm
              confirm-button-text="Log Out!"
              cancel-button-text="No, Thanks"
              icon="el-icon-info"
              icon-color="red"
              title="This action will log out selected user session."
              @onConfirm="logoutSpecificSession(scope.$index, scope.row)"
              @confirm="logoutSpecificSession(scope.$index, scope.row)"
            >
              <ElButton
                slot="reference"
                size="mini"
                type="danger"
              >
                Log Out
              </ElButton>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <el-popconfirm
        confirm-button-text="Log Out all users!"
        cancel-button-text="No, Thanks"
        icon="el-icon-info"
        icon-color="red"
        title="This action will log out ALL users including you!"
        @onConfirm="logOutAllUsers()"
        @confirm="logOutAllUsers()"
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

import FluxService from '@/services/FluxService';
import IDService from '@/services/IDService';
import DaemonService from '@/services/DaemonService';
import BenchmarkService from '@/services/BenchmarkService';
import ExplorerService from '@/services/ExplorerService';
import AppsService from '@/services/AppsService';

const qs = require('qs');

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'Admin',
  data() {
    return {
      filterLoggedUsers: '',
      loggedUsersTable: [],
      updateDialogVisible: false,
      updateProgress: 0,
      rescanDaemonHeight: 0,
      rescanFluxHeight: 0,
      rescanExplorerHeight: 0,
      rescanGlobalAppsHeight: 0,
      removeLastInformation: false,
      cruxidInput: '',
      kadenaAccountInput: '',
      kadenaChainIDInput: '',
    };
  },
  computed: {
    ...mapState([
      'fluxVersion',
      'config',
      'userconfig',
      'privilage',
      'adminSection',
    ]),
    currentLoginPhrase() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      return auth.loginPhrase;
    },
  },
  watch: {
    adminSection(val, oldVal) {
      console.log(val, oldVal);
      this.switcher(val);
    },
  },
  mounted() {
    this.switcher(this.adminSection);
  },
  methods: {
    switcher(value) {
      switch (value) {
        case 'loggedsessions':
          this.loggedSessions();
          break;
        case 'manageflux':
          this.getCruxID();
          this.getKadenaAccount();
          this.getLatestFluxVersion();
          break;
        case 'managedaemon':
          this.checkDaemonVersion();
          break;
        case 'managebenchmark':
          this.checkBenchmarkVersion();
          break;
        case 'manageusers':
          this.loggedUsers();
          break;
        case null:
          console.log('admin Section hidden');
          break;
        default:
          console.log('admin Section: Unrecognized method'); // should not be seeable if all works correctly
      }
    },
    async getCruxID() {
      const response = await FluxService.getCruxID();
      if (response.data.status === 'success' && response.data.data) {
        this.cruxidInput = response.data.data;
      }
    },
    async getKadenaAccount() {
      const response = await FluxService.getKadenaAccount();
      if (response.data.status === 'success' && response.data.data) {
        const acc = response.data.data.split('?chainid=');
        const chainID = acc.pop();
        const account = acc.join('?chainid=').substr(7);
        this.kadenaAccountInput = account;
        this.kadenaChainIDInput = chainID;
      }
    },
    updateFlux() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      const self = this;
      axios.get('https://raw.githubusercontent.com/runonflux/flux/master/package.json')
        .then((response) => {
          console.log(response);
          if (response.data.version !== self.fluxVersion) {
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
            FluxService.updateFlux(zelidauth)
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
    updateDaemon() {
      DaemonService.getInfo()
        .then((daemonResponse) => {
          console.log(daemonResponse);
          const daemonVersion = daemonResponse.data.data.version;
          axios.get('https://raw.githubusercontent.com/runonflux/flux/master/helpers/daemoninfo.json')
            .then((response) => {
              console.log(response);
              if (response.data.version !== daemonVersion) {
                const zelidauth = localStorage.getItem('zelidauth');
                const auth = qs.parse(zelidauth);
                console.log(auth);
                vue.$customMes.success('Daemon is now updating in the background');
                FluxService.updateDaemon(zelidauth)
                  .then((responseUpdateDaemon) => {
                    console.log(responseUpdateDaemon);
                    if (responseUpdateDaemon.data.status === 'error') {
                      vue.$customMes.error(responseUpdateDaemon.data.data.message || responseUpdateDaemon.data.data);
                    }
                  })
                  .catch((e) => {
                    console.log(e);
                    console.log(e.code);
                    vue.$customMes.error(e.toString());
                  });
              } else {
                vue.$customMes.success('Daemon is already up to date');
              }
            })
            .catch((error) => {
              console.log(error);
              vue.$customMes.error('Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error connecting to Daemon daemon');
        });
    },
    startDaemon() {
      vue.$customMes.warning('Daemon will start');
      const zelidauth = localStorage.getItem('zelidauth');
      DaemonService.start(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to start Daemon');
        });
    },
    stopDaemon() {
      vue.$customMes.warning('Daemon will be stopped');
      const zelidauth = localStorage.getItem('zelidauth');
      DaemonService.stopDaemon(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to stop Daemon');
        });
    },
    restartDaemon() {
      vue.$customMes.warning('Daemon will now restart');
      const zelidauth = localStorage.getItem('zelidauth');
      DaemonService.restart(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to restart Daemon');
        });
    },
    startBenchmark() {
      vue.$customMes.warning('Benchmark will start');
      const zelidauth = localStorage.getItem('zelidauth');
      BenchmarkService.start(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to start Benchmark');
        });
    },
    stopBenchmark() {
      vue.$customMes.warning('Benchmark will be stopped');
      const zelidauth = localStorage.getItem('zelidauth');
      BenchmarkService.stop(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to stop Benchmark');
        });
    },
    restartBenchmark() {
      vue.$customMes.warning('Benchmark will now restart');
      const zelidauth = localStorage.getItem('zelidauth');
      BenchmarkService.restart(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to restart Benchmark');
        });
    },
    restartBenchmarks() {
      vue.$customMes.warning('Initiating new benchmarks...');
      const zelidauth = localStorage.getItem('zelidauth');
      BenchmarkService.restartNodeBenchmarks(zelidauth)
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
    rescanDaemon() {
      vue.$customMes.warning('Daemon will now rescan. This will take up to an hour.');
      const zelidauth = localStorage.getItem('zelidauth');
      const blockheight = this.rescanDaemonHeight > 0 ? this.rescanDaemonHeight : 0;
      DaemonService.rescanDaemon(zelidauth, blockheight)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to rescan Daemon');
        });
    },
    reindexDaemon() {
      vue.$customMes.warning('Daemon will now reindex. This will take several hours.');
      const zelidauth = localStorage.getItem('zelidauth');
      FluxService.reindexDaemon(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to reindex Daemon');
        });
    },
    updateBenchmark() {
      BenchmarkService.getInfo()
        .then((benchmarkResponse) => {
          console.log(benchmarkResponse);
          const benchmarkVersion = benchmarkResponse.data.data.version;
          axios.get('https://raw.githubusercontent.com/runonflux/flux/master/helpers/benchmarkinfo.json')
            .then((response) => {
              console.log(response);
              if (response.data.version !== benchmarkVersion) {
                const zelidauth = localStorage.getItem('zelidauth');
                const auth = qs.parse(zelidauth);
                console.log(auth);
                vue.$customMes.success('Benchmark is now updating in the background');
                FluxService.updateBenchmark(zelidauth)
                  .then((responseUpdateBenchmark) => {
                    console.log(responseUpdateBenchmark);
                    if (responseUpdateBenchmark.data.status === 'error') {
                      vue.$customMes.error(responseUpdateBenchmark.data.data.message || responseUpdateBenchmark.data.data);
                    }
                  })
                  .catch((e) => {
                    console.log(e);
                    console.log(e.code);
                    vue.$customMes.error(e.toString());
                  });
              } else {
                vue.$customMes.success('Benchmark is already up to date');
              }
            })
            .catch((error) => {
              console.log(error);
              vue.$customMes.error('Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error connecting to Benchmark');
        });
    },
    rebuildHome() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      vue.$customMes.success('Flux Home is now rebuilding in the background');
      FluxService.rebuildHome(zelidauth)
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
      AppsService.reindexGlobalApps(zelidauth)
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
      AppsService.reindexLocations(zelidauth)
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
      AppsService.rescanGlobalApps(zelidauth, blockheight, this.removeLastInformation)
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
    getLatestFluxVersion() {
      const self = this;
      axios.get('https://raw.githubusercontent.com/runonflux/flux/master/package.json')
        .then((response) => {
          console.log(response);
          if (response.data.version !== self.fluxVersion) {
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
    checkDaemonVersion() {
      DaemonService.getInfo()
        .then((daemonResponse) => {
          console.log(daemonResponse);
          const daemonVersion = daemonResponse.data.data.version;
          axios.get('https://raw.githubusercontent.com/runonflux/flux/master/helpers/daemoninfo.json')
            .then((response) => {
              console.log(response);
              if (response.data.version !== daemonVersion) {
                vue.$customMes.warning('Daemon requires an update!');
              } else {
                vue.$customMes.success('Daemon is up to date');
              }
            })
            .catch((error) => {
              console.log(error);
              vue.$customMes.error('Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error connecting to Daemon');
        });
    },
    checkBenchmarkVersion() {
      BenchmarkService.getInfo()
        .then((benchmarkResponse) => {
          console.log(benchmarkResponse);
          const benchmarkVersion = benchmarkResponse.data.data.version;
          axios.get('https://raw.githubusercontent.com/runonflux/flux/master/helpers/benchmarkinfo.json')
            .then((response) => {
              console.log(response);
              if (response.data.version !== benchmarkVersion) {
                vue.$customMes.warning('Benchmark requires an update!');
              } else {
                vue.$customMes.success('Benchmark is up to date');
              }
            })
            .catch((error) => {
              console.log(error);
              vue.$customMes.error('Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error connecting to Benchmark');
        });
    },
    logOutAllUsers() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      IDService.logoutAllUsers(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            localStorage.removeItem('zelidauth');
            this.$store.commit('setDaemonSection', 'getinfo');
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
      IDService.logoutAllSessions(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            localStorage.removeItem('zelidauth');
            this.$store.commit('setDaemonSection', 'getinfo');
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
      IDService.loggedSessions(zelidauth)
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
      IDService.loggedUsers(zelidauth)
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
      IDService.logoutSpecificSession(zelidauth, row.loginPhrase)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            vue.$customMes.success(response.data.data.message || response.data.data);
            if (row.loginPhrase === auth.loginPhrase) {
              localStorage.removeItem('zelidauth');
              this.$store.commit('setDaemonSection', 'getinfo');
              this.$store.commit('setPrivilage', 'none');
            } else {
              switch (self.adminSection) {
                case 'loggedsessions':
                  self.loggedSessions();
                  break;
                case 'manageusers':
                  self.loggedUsers();
                  break;
                case null:
                  console.log('admin Section hidden');
                  break;
                default:
                  console.log('admin Section: Unrecognized method'); // should not be seeable if all works correctly
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
        const cruxIDResponse = await FluxService.adjustCruxID(zelidauth, cruxId);
        if (cruxIDResponse.data.status === 'error') {
          vue.$customMes.error(cruxIDResponse.data.data.message || cruxIDResponse.data.data);
        } else {
          vue.$customMes.success(cruxIDResponse.data.data.message || cruxIDResponse.data.data);
        }
      } catch (error) {
        vue.$customMes.error(error.message || error);
      }
    },
    async adjustKadena() {
      const account = this.kadenaAccountInput;
      const chainid = this.kadenaChainIDInput;
      const zelidauth = localStorage.getItem('zelidauth');
      try {
        const cruxIDResponse = await FluxService.adjustKadena(zelidauth, account, chainid);
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
