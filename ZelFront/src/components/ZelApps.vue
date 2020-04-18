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
                {{ scope.row.Names[0].substr(1, scope.row.Names[0].length) }}
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
                <ElButton
                  class="generalButton"
                  @click="restartZelApp(scope.row.Names[0].substr(1, scope.row.Names[0].length))"
                >
                  Restart
                </ElButton>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane
          label="All"
          name="all"
        >
          <el-table
            :data="getAllZelAppsResponse.data"
            empty-text="No ZelApp installed"
            style="width: 100%"
          >
            <el-table-column
              label="Name"
              prop="Names"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="Image"
              prop="Image"
              sortable
            >
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
            </el-table-column>
            <el-table-column
              label="Image"
              prop="image"
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
              label="CPU resource"
              prop="cpu"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveCpu(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="RAM resource"
              prop="ram"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveRam(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="HDD resource"
              prop="hdd"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveHdd(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Port"
              prop="port"
              sortable
            >
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
      <div class='actionCenter'>
        <el-input
          v-if="output"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 10}"
          v-model="output"
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
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.stopZelApp(zelidauth, zelapp);
      this.output = response;
      console.log(response);
    },
    async startZelApp(zelapp) {
      this.output = '';
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.startZelApp(zelidauth, zelapp);
      this.output = response;
      console.log(response);
    },
    async restartZelApp(zelapp) {
      this.output = '';
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.restartZelApp(zelidauth, zelapp);
      this.output = response;
      console.log(response);
    },
    async removeZelApp(zelapp) {
      this.output = '';
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.removeZelApp(zelidauth, zelapp);
      this.output = response;
      console.log(response);
    },
    async installFoldingAtHome() {
      this.output = '';
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.removeZelApp(zelidauth);
      this.output = response;
      console.log(response);
    },
    installedZelApp(zelappName) {
      return this.installedZelApps.find((zelapp) => zelapp.name === zelappName);
    },
    openZelApp(name) {
      const zelappInfo = this.installedZelApp(name);
      if (zelappInfo) {
        const backendURL = store.get('backendURL') || `http://${this.userconfig.initial.externalip}:${this.userconfig.initial.port}`;
        const ip = backendURL.split(':')[0].split('//')[1];
        window.location.href = `http://${ip}:${zelappInfo.port}`;
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
    async resolveCpu(zelapp) {
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
    async resolveRam(zelapp) {
      if (this.tier === 'BASIC') {
        return (`${zelapp.rambasic || zelapp.ram} MB`);
      }
      if (this.tier === 'SUPER') {
        return (`${zelapp.ramsuper || zelapp.ram} MB`);
      }
      if (this.tier === 'BAMF') {
        return (`${zelapp.rambamf || zelapp.ram} MB`);
      }
      return zelapp.ram;
    },
    async resolveHdd(zelapp) {
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
  },
};
</script>
