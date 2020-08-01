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
      <div>
        <p>Help section output is listed below. Click on a command to find more specifics about it</p>
      </div>
      <div
        class="helpSectionData"
        v-if="callResponse.data"
      >
        <el-collapse
          accordion
          v-model="activeHelpNames"
          @change="zelcashHelpSpecific"
        >
          <div
            v-for="help of helpResponse"
            :key=help
          >
            <div v-if="help.startsWith('=')">
              <br>
              <h2>
                {{ help.split(' ')[1] }}
              </h2>
            </div>
            <el-collapse-item
              :name="help"
              v-if="!help.startsWith('=')"
            >
              <template slot="title">
                <p>
                  <b>{{ help }}</b>
                </p>
              </template>
              <p class="helpSpecific">{{ currentHelpResponse || 'Loading help message...' }}</p>
            </el-collapse-item>
          </div>
        </el-collapse>

      </div>
      <div v-else>
        Obtaining help section...
      </div>
    </div>
    <div
      v-if="zelCashSection === 'restart'"
      class="restartSection"
    >
      <ElButton @click="restartZelCashDaemon()">
        Restart ZelCash
      </ElButton>
    </div>
    <div v-if="zelCashSection === 'debug'">
      <div>
        <p>Following action will download ZelCash debug file. This may take a few minutes depending on file size</p>
      </div>
      <el-popconfirm
        confirmButtonText='Download Debug'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Download ZelCash Debug file?"
        @onConfirm="downloadZelCashDebugFile()"
      >
        <ElButton slot="reference">
          Download Debug File
        </ElButton>
      </el-popconfirm>
      <p v-if="total && downloaded">
        {{ (downloaded / 1e6).toFixed(2) + " / " + (total / 1e6).toFixed(2) }} MB - {{ ((downloaded / total) * 100).toFixed(2) + "%" }}
        <el-tooltip
          content="Cancel Download"
          placement="top"
        >
          <el-button
            v-if="total && downloaded && total !== downloaded"
            type="danger"
            icon="el-icon-close"
            circle
            size="mini"
            @click="cancelDownload"
          ></el-button>
        </el-tooltip>
      </p>
      <br><br>
      <div>
        <div>
          <p>Following action will show last 100 lines of ZelCash debug file</p>
        </div>
        <el-popconfirm
          confirmButtonText='Show Debug'
          cancelButtonText='No, Thanks'
          icon="el-icon-info"
          iconColor="red"
          title="Show ZelCash Debug file?"
          @onConfirm="tailZelCashDebug()"
        >
          <ElButton slot="reference">
            Show Debug File
          </ElButton>
        </el-popconfirm>
        <br><br>
        <el-input
          v-if="callResponse.data.message"
          type="textarea"
          autosize
          v-model="zelcashDebugTail"
        >
        </el-input>
      </div>
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
      total: '',
      downloaded: '',
      abortToken: {},
      activeHelpNames: '',
      currentHelpResponse: '',
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'zelCashSection',
    ]),
    zelcashDebugTail() {
      if (this.callResponse.data.message) {
        return this.callResponse.data.message.split('\n').reverse().filter((el) => el !== '').join('\n');
      }
      return this.callResponse.data;
    },
    helpResponse() {
      if (this.callResponse.data) {
        return this.callResponse.data.split('\n').filter((el) => el !== '').map((el) => (el.startsWith('=') ? el : el.split(' ')[0]));
      }
      return [];
    },
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
        case 'debug':
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
      case 'debug':
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
    async zelcashHelpSpecific() {
      this.currentHelpResponse = '';
      const response = await ZelCashService.helpSpecific(this.activeHelpNames);
      const modifiedHelp = response.data.data.split('\n');
      const ml = modifiedHelp.length;
      let spaces = 0;
      for (let i = 0; i < ml; i += 1) {
        let whiteSpaceAdd = '';
        if (modifiedHelp[i].trim() === '{' || modifiedHelp[i].trim() === '[') {
          spaces += 4;
          for (let j = 0; j < spaces; j += 1) {
            whiteSpaceAdd += '\u00A0';
          }
          modifiedHelp[i] = whiteSpaceAdd + modifiedHelp[i];
          spaces += 4;
        } else if (modifiedHelp[i].trim() === '}' || modifiedHelp[i].trim() === ']') {
          spaces -= 4;
          for (let j = 0; j < spaces; j += 1) {
            whiteSpaceAdd += '\u00A0';
          }
          modifiedHelp[i] = whiteSpaceAdd + modifiedHelp[i];
          spaces -= 4;
        } else {
          for (let j = 0; j < spaces; j += 1) {
            whiteSpaceAdd += '\u00A0';
          }
          modifiedHelp[i] = whiteSpaceAdd + modifiedHelp[i];
        }
      }
      this.currentHelpResponse = modifiedHelp.join('\n');
    },
    async restartZelCashDaemon() {
      const zelidauth = localStorage.getItem('zelidauth');
      vue.$message.success('Restarting ZelCash...');
      const response = await ZelCashService.restart(zelidauth);
      console.log(response);
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
          this.getZelNodeStatusResponse.zelnodeStatus = 'ZelNode has just been started. Flux is running with limited capabilities.';
        } else {
          this.getZelNodeStatusResponse.zelnodeStatus = 'ZelNode is not confirmed. Flux is running with limited capabilities.';
        }
      }
    },
    cancelDownload() {
      this.abortToken.cancel('User download cancelled');
      this.downloaded = '';
      this.total = '';
    },
    async downloadZelCashDebugFile() {
      const self = this;
      self.abortToken = ZelCashService.cancelToken();
      const zelidauth = localStorage.getItem('zelidauth');
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        responseType: 'blob',
        onDownloadProgress(progressEvent) {
          self.downloaded = progressEvent.loaded;
          self.total = progressEvent.total;
        },
        cancelToken: self.abortToken.token,
      };
      console.log('abc');
      const response = await ZelCashService.justAPI().get('/zelnode/zelcashdebug', axiosConfig);
      console.log(response);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'debug.log');
      document.body.appendChild(link);
      link.click();
    },
    tailZelCashDebug() {
      const zelidauth = localStorage.getItem('zelidauth');
      ZelCashService.tailZelCashDebug(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            this.callResponse.status = response.data.status;
            this.callResponse.data = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error while trying to restart ZelCash');
        });
    },
  },
};
</script>
