<template>
  <div class="nodesction">
    <div v-if="nodeSection === 'getinfo'">
      <div class="status">
        <h4>
          Flux owner ZelID: {{ userconfig.zelid }}
        </h4>
        <h4>
          Status: {{ getNodeStatusResponse.nodeStatus }}
        </h4>
        <h4>
          Flux Payment Address: {{ getNodeStatusResponse.data.payment_address }}
        </h4>
        <h4>
          Tier: {{ getNodeStatusResponse.data.tier }}
        </h4>
        <h4>
          Flux IP Address: {{ getNodeStatusResponse.data.ip }}
        </h4>
        <h4>
          Flux IP Network: {{ getNodeStatusResponse.data.network }}
        </h4>
        <h4>
          Flux Public Key: {{ getNodeStatusResponse.data.pubkey }}
        </h4>
        <div v-if="getNodeStatusResponse.data.collateral">
          <h4>
            Added Height: <ElLink
              type="primary"
              :href="'https://explorer.runonflux.io/block-index/' + getNodeStatusResponse.data.added_height"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ getNodeStatusResponse.data.added_height }}
            </ElLink>
          </h4>
          <h4>
            Confirmed Height: <ElLink
              type="primary"
              :href="'https://explorer.runonflux.io/block-index/' + getNodeStatusResponse.data.confirmed_height"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ getNodeStatusResponse.data.confirmed_height }}
            </ElLink>
          </h4>
          <h4>
            Last Confirmed Height: <ElLink
              type="primary"
              :href="'https://explorer.runonflux.io/block-index/' + getNodeStatusResponse.data.last_confirmed_height"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ getNodeStatusResponse.data.last_confirmed_height }}
            </ElLink>
          </h4>
          <h4>
            Last Paid Height: <ElLink
              type="primary"
              :href="'https://explorer.runonflux.io/block-index/' + getNodeStatusResponse.data.last_paid_height"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ getNodeStatusResponse.data.last_paid_height }}
            </ElLink>
          </h4>
          <h4>
            <ElLink
              type="primary"
              :href="'https://explorer.runonflux.io/tx/' + getNodeStatusResponse.data.txhash"
              target="_blank"
              rel="noopener noreferrer"
            >
              Show Locked transaction
            </ElLink>
          </h4>
        </div>
      </div>

      <div class="getInfoResponse">
        <p>
          Flux Daemon version: {{ getInfoResponse.data.version }}
        </p>
        <p>
          Protocol version: {{ getInfoResponse.data.protocolversion }}
        </p>
        <p>
          Current Blockchain Height: {{ getInfoResponse.data.blocks }}
        </p>
        <div v-if="getInfoResponse.data.errors != ''">
          <p>
            Error: {{ getInfoResponse.data.errors }}
          </p>
        </div>
      </div>
    </div>
    <div v-if="nodeSection === 'network'">
      <el-tabs v-model="activeName">
        <el-tab-pane
          label="Outgoing"
          name="outgoing"
        >
          <el-table
            :data="connectedPeersFilter"
            empty-text="No outgoing connections"
            style="width: 100%"
          >
            <el-table-column
              label="IP address"
              prop="ip"
              sortable
            />
            <el-table-column
              label="Latency"
              prop="latency"
              sortable
            />
            <el-table-column
              label="Last Ping"
              prop="lastPingTime"
              sortable
            />
            <el-table-column align="right">
              <template
                slot="header"
                slot-scope="scope"
              >
                <el-input
                  v-if="scope"
                  v-model="filterConnectedPeer"
                  size="mini"
                  placeholder="Type to search"
                />
              </template>
              <template slot-scope="scope">
                <el-button
                  size="mini"
                  type="danger"
                  @click="disconnectPeer(scope.$index, scope.row)"
                >
                  Disconnect
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-divider />
          Force a connection to a peer
          <ElForm class="loginForm">
            <ElFormItem>
              <ElInput
                v-model="connectPeerIP"
                type="text"
                placeholder="insert IP address"
              >
                <template slot="prepend">
                  IP:
                </template>
              </ElInput>
            </ElFormItem>

            <ElButton @click="connectPeer()">
              Connect to Peer
            </ElButton>
          </ElForm>
        </el-tab-pane>
        <el-tab-pane
          label="Incoming"
          name="incoming"
        >
          <el-table
            :data="incomingConnectionsFilter"
            empty-text="No incoming connections"
            style="width: 100%"
          >
            <el-table-column
              label="IP address"
              prop="ip"
              sortable
            />
            <el-table-column align="right">
              <template
                slot="header"
                slot-scope="scope"
              >
                <el-input
                  v-if="scope"
                  v-model="filterConnectedPeer"
                  size="mini"
                  placeholder="Type to search"
                />
              </template>
              <template slot-scope="scope">
                <el-button
                  size="mini"
                  type="danger"
                  @click="disconnectIncoming(scope.$index, scope.row)"
                >
                  Disconnect
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>
    <div v-if="nodeSection === 'debug'">
      <div>
        <p>Following section can download or show Flux log files. This may take up to a few minutes depending on file size</p>
      </div>
      <el-row :gutter="20">
        <el-col
          v-for="logType in logTypes"
          :key="logType"
          :span="6"
        >
          <el-popconfirm
            :confirm-button-text="`Download ${logType}.log`"
            cancel-button-text="No, Thanks"
            icon="el-icon-info"
            icon-color="orange"
            :title="`Download Flux ${logType}.log file?`"
            @onConfirm="downloadFluxLogFile(logType)"
            @confirm="downloadFluxLogFile(logType)"
          >
            <ElButton slot="reference">
              Download {{ logType }} file
            </ElButton>
          </el-popconfirm>
          <p
            v-if="total[logType] && downloaded[logType]"
            style="margin: 0px; height: 30px;"
          >
            {{ (downloaded[logType] / 1e6).toFixed(2) + " / " + (total[logType] / 1e6).toFixed(2) }} MB - {{ ((downloaded[logType] / total[logType]) * 100).toFixed(2) + "%" }}
            <el-tooltip
              content="Cancel Download"
              placement="top"
            >
              <el-button
                v-if="total[logType] && downloaded[logType] && total[logType] !== downloaded[logType]"
                type="danger"
                icon="el-icon-close"
                circle
                size="mini"
                @click="cancelDownload(logType)"
              />
            </el-tooltip>
          </p>
          <p
            v-else
            style="margin: 0px; height: 30px;"
          >
            &nbsp;
            <br>
          </p>
          <br>
          <div>
            <el-popconfirm
              :confirm-button-text="`Show ${logType}.log`"
              cancel-button-text="No, Thanks"
              icon="el-icon-info"
              icon-color="orange"
              :title="`Show Flux ${logType}.log file?`"
              @onConfirm="tailFluxLog(logType)"
              @confirm="tailFluxLog(logType)"
            >
              <ElButton slot="reference">
                Show {{ logType }} file
              </ElButton>
            </el-popconfirm>
            <br>
          </div>
        </el-col>
      </el-row>
      <el-input
        v-if="callResponse.data.message"
        v-model="fluxLogTail"
        type="textarea"
        autosize
      />
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';
import axios from 'axios';

import DaemonService from '@/services/DaemonService';
import FluxService from '@/services/FluxService';

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'Node',
  data() {
    return {
      callResponse: { // general
        status: '',
        data: '',
      },
      getInfoResponse: {
        status: '',
        data: '',
      },
      getNodeStatusResponse: {
        status: '',
        data: '',
        nodeStatus: 'Checking status...',
      },
      activeName: 'outgoing',
      connectedPeers: [],
      incomingConnections: [],
      filterConnectedPeer: '',
      connectPeerIP: '',
      abortToken: {},
      downloaded: {},
      total: {},
      logTypes: ['error', 'warn', 'info', 'debug'],
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'nodeSection',
    ]),
    fluxLogTail() {
      if (this.callResponse.data.message) {
        return this.callResponse.data.message.split('\n').reverse().filter((el) => el !== '').join('\n');
      }
      return this.callResponse.data;
    },
    connectedPeersFilter() {
      return this.connectedPeers.filter((data) => !this.filterConnectedPeer || data.ip.toLowerCase().includes(this.filterConnectedPeer.toLowerCase()));
    },
    incomingConnectionsFilter() {
      return this.incomingConnections.filter((data) => !this.filterConnectedPeer || data.ip.toLowerCase().includes(this.filterConnectedPeer.toLowerCase()));
    },
  },
  watch: {
    nodeSection(val, oldVal) {
      console.log(val, oldVal);
      this.switcher(val);
    },
  },
  mounted() {
    this.switcher(this.nodeSection);
  },
  methods: {
    switcher(value) {
      switch (value) {
        case 'getinfo':
          this.daemonGetInfo();
          this.daemonGetNodeStatus();
          break;
        case 'network':
          this.fluxConnectedPeersInfo();
          this.fluxIncomingConnectionsInfo();
          break;
        case 'messages':
          this.broadcastMessage();
          break;
        case 'debug':
          break;
        case null:
          console.log('Node Section hidden');
          break;
        default:
          console.log('Node Section: Unrecognized method');
      }
    },
    async daemonGetInfo() {
      const response = await DaemonService.getInfo();
      this.getInfoResponse.status = response.data.status;
      this.getInfoResponse.data = response.data.data;
    },
    async daemonGetNodeStatus() {
      const response = await DaemonService.getZelNodeStatus();
      this.getNodeStatusResponse.status = response.data.status;
      this.getNodeStatusResponse.data = response.data.data;
      console.log(this.getNodeStatusResponse.data);
      if (this.getNodeStatusResponse.data) {
        if (this.getNodeStatusResponse.data.status === 'CONFIRMED' || this.getNodeStatusResponse.data.location === 'CONFIRMED') {
          this.getNodeStatusResponse.nodeStatus = 'Flux is working correctly';
        } else if (this.getNodeStatusResponse.data.status === 'STARTED' || this.getNodeStatusResponse.data.location === 'STARTED') {
          this.getNodeStatusResponse.nodeStatus = 'Flux has just been started. Flux is running with limited capabilities.';
        } else {
          this.getNodeStatusResponse.nodeStatus = 'Flux is not confirmed. Flux is running with limited capabilities.';
        }
      }
    },
    async broadcastMessage() {
      const zelidauth = localStorage.getItem('zelidauth');
      FluxService.broadcastMessage(zelidauth, 'abcde')
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message);
          } else {
            vue.$customMes.success(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$customMes.error(e.toString());
        });
    },
    async fluxConnectedPeersInfo() {
      const response = await FluxService.connectedPeersInfo();
      console.log(response);
      if (response.data.status === 'success') {
        this.connectedPeers = response.data.data;
      } else {
        vue.$customMes({
          type: response.data.status,
          message: response.data.data.message || response.data.data,
        });
      }
    },
    async fluxIncomingConnectionsInfo() {
      const response = await FluxService.incomingConnectionsInfo();
      if (response.data.status === 'success') {
        this.incomingConnections = response.data.data;
      } else {
        vue.$customMes({
          type: response.data.status,
          message: response.data.data.message || response.data.data,
        });
      }
    },
    disconnectPeer(index, row) {
      const self = this;
      console.log(index, row);
      const zelidauth = localStorage.getItem('zelidauth');
      FluxService.removePeer(zelidauth, row.ip)
        .then((response) => {
          vue.$customMes({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
          setTimeout(() => {
            self.fluxConnectedPeersInfo();
          }, 2000);
        })
        .catch((e) => {
          console.log(e);
          vue.$customMes.error(e.toString());
        });
    },
    disconnectIncoming(index, row) {
      const self = this;
      console.log(index, row);
      const zelidauth = localStorage.getItem('zelidauth');
      FluxService.removeIncomingPeer(zelidauth, row.ip)
        .then((response) => {
          vue.$customMes({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
          setTimeout(() => {
            self.fluxIncomingConnectionsInfo();
          }, 2000);
        })
        .catch((e) => {
          console.log(e);
          vue.$customMes.error(e.toString());
        });
    },
    connectPeer() {
      const self = this;
      const zelidauth = localStorage.getItem('zelidauth');
      FluxService.addPeer(zelidauth, self.connectPeerIP)
        .then((response) => {
          console.log(response);
          vue.$customMes({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
          setTimeout(() => {
            self.fluxConnectedPeersInfo();
          }, 2000);
        })
        .catch((e) => {
          console.log(e);
          vue.$customMes.error(e.toString());
        });
    },
    cancelDownload(name) {
      this.abortToken[name].cancel(`Download of ${name} cancelled`);
      this.downloaded[name] = '';
      this.total[name] = '';
    },
    async downloadFluxLogFile(name) {
      try {
        const self = this;
        if (self.abortToken[name]) {
          self.abortToken[name].cancel();
        }
        const sourceCancelToken = axios.CancelToken;
        const cancelToken = sourceCancelToken.source();
        this.$set(this.abortToken, name, cancelToken);
        const zelidauth = localStorage.getItem('zelidauth');
        const axiosConfig = {
          headers: {
            zelidauth,
          },
          responseType: 'blob',
          onDownloadProgress(progressEvent) {
            Vue.set(self.downloaded, name, progressEvent.loaded);
            Vue.set(self.total, name, progressEvent.total);
          },
          cancelToken: self.abortToken[name].token,
        };
        const response = await FluxService.justAPI().get(`/flux/${name}log`, axiosConfig);
        if (response.data.status === 'error') {
          vue.$customMes.error(response.data.data.message || response.data.data);
        } else {
          const url = window.URL.createObjectURL(new Blob([response.data]));
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', `${name}.log`);
          document.body.appendChild(link);
          link.click();
        }
      } catch (error) {
        console.log(error.message);
        if (error.message) {
          if (!error.message.startsWith('Download')) {
            vue.$customMes.error(error.message);
          }
        } else {
          vue.$customMes.error(error);
        }
      }
    },
    tailFluxLog(name) {
      const zelidauth = localStorage.getItem('zelidauth');
      FluxService.tailFluxLog(name, zelidauth)
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
          vue.$customMes.error(`Error while trying to get latest ${name}.log of Flux`);
        });
    },
  },
};
</script>
