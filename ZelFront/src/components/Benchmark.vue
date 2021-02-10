<template>
  <div class="benchmarksection">
    <div
      v-if="benchmarkSection === 'help'"
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
          @change="benchmarkHelpSpecific"
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
                  {{ help }}
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
    <div v-if="benchmarkSection === 'start'">
      <div>
        <p>Click on Start Benchmark button to Start Benchmark daemon</p>
      </div>
      <el-popconfirm
        confirmButtonText='Start Benchmark daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="green"
        title="Starts Benchmark daemon"
        @onConfirm="startBenchmark()"
        @confirm="startBenchmark()"
      >
        <ElButton slot="reference">
          Start Benchmark
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="benchmarkSection === 'restart'">
      <div>
        <p>Click on Restart Benchmark button to restart Benchmark daemon</p>
      </div>
      <el-popconfirm
        confirmButtonText='Restart Benchmark daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="orange"
        title="Restarts Benchmark daemon"
        @onConfirm="restartBenchmark()"
        @confirm="restartBenchmark()"
      >
        <ElButton slot="reference">
          Restart Benchmark
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="benchmarkSection === 'stop'">
      <div>
        <p>Click on Stop Benchmark button to stop Benchmark daemon</p>
      </div>
      <el-popconfirm
        confirmButtonText='Stop Benchmark daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Stops Benchmark daemon"
        @onConfirm="stopBenchmark()"
        @confirm="stopBenchmark()"
      >
        <ElButton slot="reference">
          Stop Benchmark
        </ElButton>
      </el-popconfirm>
    </div>

    <div v-if="benchmarkSection === 'getbenchmarks'">
      <div>
        <p>Output from Get Benchmarks command</p>
      </div>
      <div>
        <p>
          Status: {{ callResponse.data.status }}
        </p>
        <p>
          Time: {{ new Date(callResponse.data.time * 1000).toLocaleString('en-GB', timeoptions) }}
        </p>
        <p>
          IP address: {{ callResponse.data.ipaddress }}
        </p>
        <p>
          CPU cores: {{ callResponse.data.cores }}
        </p>
        <p>
          RAM (GB): {{ callResponse.data.ram }}
        </p>
        <p>
          SSD (GB): {{ callResponse.data.ssd }}
        </p>
        <p>
          HDD (GB): {{ callResponse.data.hdd }}
        </p>
        <p>
          Write Speed (MB/s): {{ callResponse.data.ddwrite }}
        </p>
        <p>
          CPU Speed (eps): {{ callResponse.data.eps }}
        </p>
      </div>
    </div>
    <div v-if="benchmarkSection === 'getinfo'">
      <div>
        <p>Output from Get Info command</p>
      </div>
      <div>
        <p>
          Benchmark version: {{ callResponse.data.version }}
        </p>
        <p>
          RPC port: {{ callResponse.data.rpcport }}
        </p>
      </div>
    </div>
    <div v-if="benchmarkSection === 'getstatus'">
      <div>
        <p>Output from Get Status command</p>
      </div>
      <div>
        <p>
          Status: {{ callResponse.data.status }}
        </p>
        <p>
          Benchmarking: {{ callResponse.data.benchmarking }}
        </p>
        <p>
          Flux: {{ callResponse.data.zelback }}
        </p>
      </div>
    </div>
    <div v-if="benchmarkSection === 'restartnodebenchmarks'">
      <div>
        <p>Following action will trigger a complete new test of node benchmarking</p>
      </div>
      <div>
        <el-popconfirm
          confirmButtonText='Restart Benchmarks'
          cancelButtonText='No, Thanks'
          icon="el-icon-info"
          iconColor="orange"
          title="Runs a complete new test of node benchmarking"
          @onConfirm="restartBenchmarks()"
          @confirm="restartBenchmarks()"
        >
          <ElButton slot="reference">
            Restart Benchmarks
          </ElButton>
        </el-popconfirm>
      </div>
    </div>
    <div v-if="benchmarkSection === 'signzelnodetransaction'">
      <div>
        <p>Following action signs hex of a valid Flux transaction</p>
      </div>
      <div>
        <el-input
          type="textarea"
          placeholder="Please insert hex of ZelNode transaction to sign"
          autosize
          v-model="hexFluxTransaction"
        >
        </el-input>
      </div>
      <div>
        <el-popconfirm
          confirmButtonText='Sign Transaction'
          cancelButtonText='No, Thanks'
          icon="el-icon-info"
          iconColor="orange"
          title="Signs valid hex of Flux transaction"
          @onConfirm="signZelNodeTransaction()"
          @confirm="signZelNodeTransaction()"
        >
          <ElButton slot="reference">
            Sign Transaction
          </ElButton>
        </el-popconfirm>
      </div>
      <div v-if="callResponse.status === 'success'">
        <p>
          Status: {{ callResponse.data.status }}
        </p>
        <p v-if="callResponse.data.tier">
          Tier: {{ callResponse.data.tier }}
        </p>
        <p v-if="callResponse.data.hex">
          Hex: {{ callResponse.data.hex }}
        </p>
      </div>
    </div>
    <div v-if="benchmarkSection === 'debug'">
      <div>
        <p>Following action will download Benchmark debug file. This may take a few minutes depending on file size</p>
      </div>
      <el-popconfirm
        confirmButtonText='Download Debug'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Download Benchmark Debug file?"
        @onConfirm="downloadBenchmarkDebugFile()"
        @confirm="downloadBenchmarkDebugFile()"
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
          <p>Following action will show last 100 lines of Benchmark debug file</p>
        </div>
        <el-popconfirm
          confirmButtonText='Show Debug'
          cancelButtonText='No, Thanks'
          icon="el-icon-info"
          iconColor="red"
          title="Show Benchmark Debug file?"
          @onConfirm="tailBenchmarkDebug()"
          @confirm="tailBenchmarkDebug()"
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
          v-model="benchmarkDebugTail"
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

import BenchmarkService from '@/services/BenchmarkService';

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'Benchmark',
  data() {
    return {
      timeoptions: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
      callResponse: { // general
        status: '',
        data: '',
      },
      hexFluxTransaction: '',
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
      'benchmarkSection',
    ]),
    benchmarkDebugTail() {
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
    benchmarkSection(val, oldVal) {
      console.log(val, oldVal);
      this.callResponse.status = '';
      this.callResponse.data = '';
      this.switcher(val);
    },
  },
  mounted() {
    this.switcher(this.benchmarkSection);
  },
  methods: {
    switcher(value) {
      switch (value) {
        case 'getbenchmarks':
          this.benchmarkGetBenchmarks();
          break;
        case 'getinfo':
          this.benchmarkGetInfo();
          break;
        case 'help':
          this.benchmarkHelp();
          break;
        case 'getstatus':
          this.benchmarkGetStatus();
          break;
        case 'restartnodebenchmarks':
          break;
        case 'signzelnodetransaction':
          break;
        case 'restart':
          break;
        case 'stop':
          break;
        case 'start':
          break;
        case 'debug':
          break;
        case null:
          console.log('Benchmark Section hidden');
          break;
        default:
          console.log('Benchmark Section: Unrecognized method');
      }
    },
    async benchmarkGetBenchmarks() {
      const response = await BenchmarkService.getBenchmarks();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async benchmarkGetInfo() {
      const response = await BenchmarkService.getInfo();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async benchmarkHelp() {
      const response = await BenchmarkService.help();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async benchmarkHelpSpecific() {
      this.currentHelpResponse = '';
      const response = await BenchmarkService.helpSpecific(this.activeHelpNames);
      const modifiedHelp = response.data.data.split('\n');
      const ml = modifiedHelp.length;
      let spaces = 0;
      for (let i = 0; i < ml; i += 1) {
        let whiteSpaceAdd = '';
        if (modifiedHelp[i].trim().startsWith('{') || modifiedHelp[i].trim().startsWith('[')) {
          spaces += 4;
          for (let j = 0; j < spaces; j += 1) {
            whiteSpaceAdd += '\u00A0';
          }
          modifiedHelp[i] = whiteSpaceAdd + modifiedHelp[i];
          spaces += 4;
        } else if (modifiedHelp[i].trim().startsWith('}') || modifiedHelp[i].trim().startsWith(']')) {
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
    cancelDownload() {
      this.abortToken.cancel('User download cancelled');
      this.downloaded = '';
      this.total = '';
    },
    async downloadBenchmarkDebugFile() {
      const self = this;
      self.abortToken = BenchmarkService.cancelToken();
      const zelidauth = localStorage.getItem('zelidauth');
      // const response = await AppsService.installTemporaryLocalApp(zelidauth, app);
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
      const response = await BenchmarkService.justAPI().get('/flux/benchmarkdebug', axiosConfig);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'debug.log');
      document.body.appendChild(link);
      link.click();
    },
    tailBenchmarkDebug() {
      const zelidauth = localStorage.getItem('zelidauth');
      BenchmarkService.tailBenchmarkDebug(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            this.callResponse.status = response.data.status;
            this.callResponse.data = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to get latest debug of Benchmark');
        });
    },
    async benchmarkGetStatus() {
      const response = await BenchmarkService.getStatus();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
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
    signZelNodeTransaction() {
      const zelidauth = localStorage.getItem('zelidauth');
      if (!this.hexFluxTransaction) {
        vue.$customMes.error('No Flux transaction hex provided');
        return;
      }
      BenchmarkService.signZelNodeTransaction(zelidauth, this.hexFluxTransaction)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            this.callResponse.status = response.data.status;
            this.callResponse.data = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to sign Flux transaction');
        });
    },
  },
};
</script>
