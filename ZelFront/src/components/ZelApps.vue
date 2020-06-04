<template>
  <div>
    <div v-if="zelAppsSection === 'localzelapps'">
      <el-tabs v-model="activeName">
        <el-tab-pane
          label="Running"
          name="running"
        >
          <el-table
            :data="getRunningZelAppsResponse.data"
            empty-text="No ZelApp running"
            style="width: 100%"
          >
            <el-table-column
              label="Name"
              prop="Names"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.Names[0].substr(4, scope.row.Names[0].length) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Image"
              prop="Image"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="Visit"
              prop="visit"
              sortable
            >
              <template slot-scope="scope">
                <ElButton
                  class="generalButton"
                  @click="openZelApp(scope.row.Names[0].substr(1, scope.row.Names[0].length))"
                >
                  Visit
                </ElButton>
              </template>
            </el-table-column>
            <el-table-column
              label="Actions"
              prop="actions"
              sortable
            >
              <template slot-scope="scope">
                <ElButton
                  class="generalButton"
                  @click="stopZelApp(scope.row.Names[0].substr(1, scope.row.Names[0].length))"
                >
                  Stop
                </ElButton>
                <!-- <ElButton
                  class="generalButton"
                  @click="restartZelApp(scope.row.Names[0].substr(1, scope.row.Names[0].length))"
                >
                  Restart
                </ElButton> -->
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane
          label="Installed"
          name="installed"
        >
          <el-table
            :data="installedZelApps.data"
            empty-text="No ZelApp installed"
            style="width: 100%"
          >
            <el-table-column
              label="Name"
              prop="name"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.name.substr(3, scope.row.name.length) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Port"
              prop="port"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="CPU"
              prop="cpu"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveCpu(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="RAM"
              prop="ram"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveRam(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="HDD"
              prop="hdd"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveHdd(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Actions"
              prop="actions"
              sortable
            >
              <template slot-scope="scope">
                <ElButton
                  class="generalButton"
                  @click="startZelApp(scope.row.name)"
                >
                  Start
                </ElButton>
                <ElButton
                  class="generalButton"
                  @click="restartZelApp(scope.row.name)"
                >
                  Restart
                </ElButton>
              </template>
            </el-table-column>
            <el-table-column
              label="Remove"
              prop="remove"
              sortable
            >
              <template slot-scope="scope">
                <ElButton
                  class="generalButton"
                  @click="removeZelApp(scope.row.name)"
                >
                  Remove
                </ElButton>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane
          label="Available"
          name="available"
        >
          <el-table
            :data="availableZelApps.data"
            empty-text="No ZelApp available"
            style="width: 100%"
          >
            <el-table-column
              label="Name"
              prop="name"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.name.substr(3, scope.row.name.length) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Image"
              prop="repotag"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="Owner"
              prop="owner"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="Port"
              prop="port"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="CPU"
              prop="cpu"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveCpu(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="RAM"
              prop="ram"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveRam(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="HDD"
              prop="hdd"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveHdd(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Install"
              prop="install"
              sortable
            >
              <template slot-scope="scope">
                <ElButton
                  class="generalButton"
                  @click="installFoldingAtHome(scope.row.name)"
                >
                  Install
                </ElButton>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
      <br>
      <div class='actionCenter'>
        <el-input
          v-if="output"
          type="textarea"
          autosize
          v-model="stringOutput"
        >
        </el-input>
      </div>
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

import ZelCashService from '@/services/ZelCashService';
import ZelAppsService from '@/services/ZelAppsService';

const store = require('store');

Vue.use(Vuex);

const vue = new Vue();

export default {
  name: 'ZelApps',
  data() {
    return {
      activeName: 'running',
      getRunningZelAppsResponse: {
        status: '',
        data: '',
      },
      getAllZelAppsResponse: {
        status: '',
        data: '',
      },
      installedZelApps: {
        status: '',
        data: '',
      },
      availableZelApps: {
        status: '',
        data: '',
      },
      tier: '',
      output: '',
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'zelAppsSection',
    ]),
    stringOutput() {
      let string = '';
      this.output.forEach((output) => {
        string += `${JSON.stringify(output)}\r\n`;
      });
      return string;
    },
  },
  watch: {
    zelAppsSection(val, oldVal) {
      console.log(val, oldVal);
      switch (val) {
        case 'localzelapps':
          this.zelappsGetListRunningZelApps();
          // vue.$message.info('ZelApps coming soon!');
          break;
        case 'allzelapps':
          vue.$message.info('ZelApps coming soon!');
          break;
        default:
          console.log('ZelApps Section: Unrecognized method'); // should not be visible if everything works correctly
      }
    },
    activeName(val, oldVal) {
      console.log(val, oldVal);
      this.output = '';
      switch (val) {
        case 'running':
          this.zelappsGetListRunningZelApps();
          break;
        case 'all':
          this.zelappsGetListAllZelApps();
          break;
        case 'installed':
          this.zelappsGetInstalledZelApps();
          break;
        case 'available':
          this.zelappsGetAvailableZelApps();
          break;
        case 'stopped':
          // getting all and checking state?
          break;
        default:
          console.log('ZelApps Section: Unrecognized method'); // should not be visible if everything works correctly
      }
    },
  },
  mounted() {
    this.getZelNodeStatus();
    this.zelappsGetInstalledZelApps();
    switch (this.zelAppsSection) {
      case 'localzelapps':
        this.zelappsGetListRunningZelApps();
        // vue.$message.info('ZelApps coming soon!');
        break;
      case 'allzelapps':
        vue.$message.info('ZelApps coming soon!');
        break;
      default:
        console.log('ZelApps Section: Unrecognized method');
    }
  },
  methods: {
    async zelappsGetAvailableZelApps() {
      const response = await ZelAppsService.availableZelApps();
      this.availableZelApps.status = response.data.status;
      this.availableZelApps.data = response.data.data;
    },
    async zelappsGetInstalledZelApps() {
      const response = await ZelAppsService.installedZelApps();
      this.installedZelApps.status = response.data.status;
      this.installedZelApps.data = response.data.data;
    },
    async zelappsGetListRunningZelApps() {
      const response = await ZelAppsService.listRunningZelApps();
      console.log(response);
      this.getRunningZelAppsResponse.status = response.data.status;
      this.getRunningZelAppsResponse.data = response.data.data;
    },
    async zelappsGetListAllZelApps() {
      const response = await ZelAppsService.listAllZelApps();
      console.log(response);
      this.getAllZelAppsResponse.status = response.data.status;
      this.getAllZelAppsResponse.data = response.data.data;
    },
    async stopZelApp(zelapp) {
      this.output = '';
      vue.$message.success('Stopping ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.stopZelApp(zelidauth, zelapp);
      if (response.data.status === 'success') {
        vue.$message.success(response.data.data.messsage || response.data.data);
      } else {
        vue.$message.error(response.data.data.messsage || response.data.data);
      }
      this.zelappsGetListRunningZelApps();
      console.log(response);
    },
    async startZelApp(zelapp) {
      this.output = '';
      vue.$message.success('Starting ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.startZelApp(zelidauth, zelapp);
      if (response.data.status === 'success') {
        vue.$message.success(response.data.data.messsage || response.data.data);
      } else {
        vue.$message.error(response.data.data.messsage || response.data.data);
      }
      console.log(response);
    },
    async restartZelApp(zelapp) {
      this.output = '';
      vue.$message.success('Restarting ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.restartZelApp(zelidauth, zelapp);
      if (response.data.status === 'success') {
        vue.$message.success(response.data.data.messsage || response.data.data);
      } else {
        vue.$message.error(response.data.data.messsage || response.data.data);
      }
      console.log(response);
    },
    async removeZelApp(zelapp) {
      const self = this;
      this.output = '';
      vue.$message.success('Removing ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      // const response = await ZelAppsService.installFoldingAtHome(zelidauth, zelapp);
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.target.response);
          self.output = JSON.parse(`[${progressEvent.target.response.replace(/}{/g, '},{')}]`);
        },
      };
      const response = await ZelAppsService.justAPI().get(`/zelapps/zelappremove/${zelapp}`, axiosConfig);
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data);
      } else {
        this.zelappsGetInstalledZelApps();
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
        if (this.output[this.output.length - 1].status === 'error') {
          vue.$message.error(this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          vue.$message.success(this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        }
      }
    },
    async installFoldingAtHome(zelapp) { // todo rewrite to installZelApp later
      console.log(zelapp);
      const self = this;
      this.output = '';
      vue.$message.success('Installing ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      // const response = await ZelAppsService.installFoldingAtHome(zelidauth, zelapp);
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.target.response);
          self.output = JSON.parse(`[${progressEvent.target.response.replace(/}{/g, '},{')}]`);
        },
      };
      const response = await ZelAppsService.justAPI().get('/zelapps/zelapptemporarylocalregister/foldingathome', axiosConfig);
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data);
      } else {
        console.log(response);
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
        console.log(this.output);
        for (let i = 0; i < this.output; i += 1) {
          if (this.output[i] && this.output[i].data && this.output[i].data.message && this.output[i].data.message.includes('Error occured')) {
            // error is defined one line above
            if (this.output[i - 1] && this.output[i - 1].data) {
              vue.$message.error(this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
              return;
            }
          }
        }
        if (this.output[this.output.length - 1].status === 'error') {
          vue.$message.error(this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          vue.$message.success(this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        }
      }
    },
    installedZelApp(zelappName) {
      return this.installedZelApps.data.find((zelapp) => zelapp.name === zelappName);
    },
    openZelApp(name) {
      const zelappInfo = this.installedZelApp(name);
      if (zelappInfo) {
        const backendURL = store.get('backendURL') || `http://${this.userconfig.externalip}:${this.config.apiPort}`;
        const ip = backendURL.split(':')[1].split('//')[1];
        const url = `http://${ip}:${zelappInfo.port}`;
        this.openSite(url);
      } else {
        vue.$message.error('Unable to open ZelApp :(');
      }
    },
    async getZelNodeStatus() {
      const response = await ZelCashService.getZelNodeStatus();
      if (response.data.status === 'success') {
        this.tier = response.data.tier;
      }
    },
    resolveCpu(zelapp) {
      if (this.tier === 'BASIC') {
        return (`${zelapp.cpubasic || zelapp.cpu} cores`);
      }
      if (this.tier === 'SUPER') {
        return (`${zelapp.cpusuper || zelapp.cpu} cores`);
      }
      if (this.tier === 'BAMF') {
        return (`${zelapp.cpubamf || zelapp.cpu} cores`);
      }
      return (`${zelapp.cpu} cores`);
    },
    resolveRam(zelapp) {
      if (this.tier === 'BASIC') {
        return (`${zelapp.rambasic || zelapp.ram} MB`);
      }
      if (this.tier === 'SUPER') {
        return (`${zelapp.ramsuper || zelapp.ram} MB`);
      }
      if (this.tier === 'BAMF') {
        return (`${zelapp.rambamf || zelapp.ram} MB`);
      }
      return (`${zelapp.ram} MB`);
    },
    resolveHdd(zelapp) {
      if (this.tier === 'BASIC') {
        return (`${zelapp.hddbasic || zelapp.hdd} GB`);
      }
      if (this.tier === 'SUPER') {
        return (`${zelapp.hddsuper || zelapp.hdd} GB`);
      }
      if (this.tier === 'BAMF') {
        return (`${zelapp.hddbamf || zelapp.hdd} GB`);
      }
      return (`${zelapp.hdd} GB`);
    },
    openSite(url) {
      const win = window.open(url, '_blank');
      win.focus();
    },
  },
};
</script>
