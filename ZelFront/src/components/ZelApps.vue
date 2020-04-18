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
      </el-tabs>
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

import ZelAppsService from '@/services/ZelAppsService';

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
      installZelApps: {
        status: '',
        data: '',
      },
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
      switch (val) {
        case 'running':
          this.zelappsGetListRunningZelApps();
          // vue.$message.info('ZelApps coming soon!');
          break;
        case 'all':
          this.zelappsGetListAllZelApps();
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
    async zelappsGetInstalledZelApps() {
      const response = await ZelAppsService.installZelApps();
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
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.stopZelApp(zelidauth, zelapp);
      console.log(response);
    },
    async startZelApp(zelapp) {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.startZelApp(zelidauth, zelapp);
      console.log(response);
    },
    async restartZelApp(zelapp) {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.restartZelApp(zelidauth, zelapp);
      console.log(response);
    },
    async removeZelApp(zelapp) {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.removeZelApp(zelidauth, zelapp);
      console.log(response);
    },
    async installFoldingAtHome() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.removeZelApp(zelidauth);
      console.log(response);
    },
  },
};
</script>
