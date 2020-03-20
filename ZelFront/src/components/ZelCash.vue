<template>
  <div class="zelcashsection">
    <div v-if="zelCashSection === 'getinfo'">
      <div class="status">
        <h4>
          ZelNode owner Zel ID: {{ userconfig.zelid }}
        </h4>
        <h4>
          Status: {{ getZelNodeStatusResponse.zelnodeStatus }}
        </h4>
      </div>

      <div>
        <p>
          ZelCash version: {{ callResponse.data.version }}
        </p>
        <p>
          Protocol version: {{ callResponse.data.protocolversion }}
        </p>
        <p>
          Current Blockchain Height: {{ callResponse.data.blocks }}
        </p>
        <div v-if="callResponse.data.errors != ''">
          <p>
            Error: {{ callResponse.data.errors }}
          </p>
        </div>
      </div>
    </div>
    <div
      v-if="zelCashSection === 'help'"
      class="helpSection"
    >
      {{ callResponse.data || 'Obtaining help section...' }}
    </div>
    <div
      v-if="zelCashSection === 'restart'"
      class="restartSection"
    >
      <ElButton
        class="generalButton"
        @click="restartZelCashDaemon()"
      >
        Restart ZelCash
      </ElButton>
    </div>
    <div v-if="callResponse.status === 'error'">
      <p>
        Error: {{ callResponse.data.message || callResponse.data }}
      </p>
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

import ZelCashService from '@/services/ZelCashService';

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'ZelCash',
  data() {
    return {
      callResponse: { // general
        status: '',
        data: '',
      },
      getZelNodeStatusResponse: {
        status: '',
        data: '',
        zelnodeStatus: 'Checking status...',
      },
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'zelCashSection',
    ]),
  },
  watch: {
    zelCashSection(val, oldVal) {
      console.log(val, oldVal);
      this.callResponse.status = '';
      this.callResponse.data = '';
      switch (val) {
        case 'getinfo':
          this.zelcashGetInfo();
          this.zelcashGetZelNodeStatus();
          break;
        case 'help':
          this.zelcashHelp();
          break;
        case 'restart':
          break;
        case null:
          console.log('ZelCash Section hidden');
          break;
        default:
          console.log('ZelCash Section: Unrecognized method'); // should not be seeable if all works correctly
      }
    },
  },
  mounted() {
    switch (this.zelCashSection) {
      case 'getinfo':
        this.zelcashGetInfo();
        this.zelcashGetZelNodeStatus();
        break;
      case 'help':
        this.zelcashHelp();
        break;
      case 'restart':
        break;
      case null:
        console.log('ZelCash Section hidden');
        break;
      default:
        console.log('ZelCash Section: Unrecognized method');
    }
  },
  methods: {
    async zelcashGetInfo() {
      const response = await ZelCashService.getInfo();
      this.callResponse.status = response.data.status;
      this.callResponse.data = response.data.data;
    },
    async zelcashHelp() {
      const response = await ZelCashService.help();
      this.callResponse.status = response.data.status;
      this.callResponse.data = response.data.data;
    },
    async restartZelCashDaemon() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelCashService.restart(zelidauth);
      vue.$message({
        type: response.data.status,
        message: response.data.data.message || response.data.data,
      });
    },
    async zelcashGetZelNodeStatus() {
      // TODO more code statuses?
      const response = await ZelCashService.getZelNodeStatus();
      this.getZelNodeStatusResponse.status = response.data.status;
      this.getZelNodeStatusResponse.data = response.data.data;
      console.log(this.getZelNodeStatusResponse.data);
      if (this.getZelNodeStatusResponse.data) {
        if (this.getZelNodeStatusResponse.data.status === 'CONFIRMED' || this.getZelNodeStatusResponse.data.location === 'CONFIRMED') {
          this.getZelNodeStatusResponse.zelnodeStatus = 'ZelNode is working correctly';
        } else if (this.getZelNodeStatusResponse.data.status === 'STARTED' || this.getZelNodeStatusResponse.data.location === 'STARTED') {
          this.getZelNodeStatusResponse.zelnodeStatus = 'ZelNode has just been started. ZelFlux is running with limited capabilities.';
        } else {
          this.getZelNodeStatusResponse.zelnodeStatus = 'ZelNode is not confirmed. ZelFlux is running with limited capabilities.';
        }
      }
    },
  },
};
</script>
