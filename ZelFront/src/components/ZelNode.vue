<template>
  <div class="zelnodesection">
    <div v-if="zelNodeSection === 'getinfo'">
      <div class="status">
        <h4>
          ZelNode owner Zel ID: {{ userconfig.zelid }}
        </h4>
        <h4>
          Status: {{ getZelNodeStatusResponse.zelnodeStatus }}
        </h4>
        <h4>
          ZelNode Payment Address: {{ getZelNodeStatusResponse.data.payment_address }}
        </h4>
        <h4>
          Tier: {{ getZelNodeStatusResponse.data.tier }}
        </h4>
        <h4>
          ZelNode IP Address: {{ getZelNodeStatusResponse.data.ip }}
        </h4>
        <h4>
          ZelNode IP Network: {{ getZelNodeStatusResponse.data.network }}
        </h4>
        <h4>
          ZelNode Public Key: {{ getZelNodeStatusResponse.data.pubkey }}
        </h4>
        <div v-if="getZelNodeStatusResponse.data.collateral">
          <h4>
            Added Height: <ElLink
              type="primary"
              :href="'https://explorer.zel.cash/block-index/' + getZelNodeStatusResponse.data.added_height"
              target="_blank"
              rel="noopener noreferrer"
            >{{ getZelNodeStatusResponse.data.added_height }}</ElLink>
          </h4>
          <h4>
            Confirmed Height: <ElLink
              type="primary"
              :href="'https://explorer.zel.cash/block-index/' + getZelNodeStatusResponse.data.confirmed_height"
              target="_blank"
              rel="noopener noreferrer"
            >{{ getZelNodeStatusResponse.data.confirmed_height }}</ElLink>
          </h4>
          <h4>
            Last Confirmed Height: <ElLink
              type="primary"
              :href="'https://explorer.zel.cash/block-index/' + getZelNodeStatusResponse.data.last_confirmed_height"
              target="_blank"
              rel="noopener noreferrer"
            >{{ getZelNodeStatusResponse.data.last_confirmed_height }}</ElLink>
          </h4>
          <h4>
            Last Paid Height: <ElLink
              type="primary"
              :href="'https://explorer.zel.cash/block-index/' + getZelNodeStatusResponse.data.last_paid_height"
              target="_blank"
              rel="noopener noreferrer"
            >{{ getZelNodeStatusResponse.data.last_paid_height }}</ElLink>
          </h4>
          <h4>
            <ElLink
              type="primary"
              :href="'https://explorer.zel.cash/tx/' + getZelNodeStatusResponse.data.txhash"
              target="_blank"
              rel="noopener noreferrer"
            >Show Locked transaction</ElLink>
          </h4>
        </div>
      </div>

      <div class="getInfoResponse">
        <p>
          ZelCash version: {{ getInfoResponse.data.version }}
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
    <div v-if="zelNodeSection === 'network'">
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
            >
            </el-table-column>
            <el-table-column
              label="Round Trip Time"
              prop="rtt"
              sortable
            >
            </el-table-column>
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
                >Disconnect</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-divider></el-divider>
          Force a connection to a peer
          <ElForm class="loginForm">
            <ElFormItem>
              <ElInput
                type="text"
                placeholder="insert IP address"
                v-model="connectPeerIP"
              >
                <template slot="prepend">IP: </template>
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
            >
            </el-table-column>
            <el-table-column
              label="Round Trip Time"
              prop="rtt"
              sortable
            >
            </el-table-column>
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
                >Disconnect</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>
    <div v-if="zelNodeSection === 'debug'">
      <div>
        <p>Following action will download Flux debug file. This may take a few minutes depending on file size</p>
      </div>
      <el-popconfirm
        confirmButtonText='Download Debug'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Download Flux Debug file?"
        @onConfirm="downloadFluxDebugFile()"
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
          <p>Following action will show last 100 lines of Flux debug file</p>
        </div>
        <el-popconfirm
          confirmButtonText='Show Debug'
          cancelButtonText='No, Thanks'
          icon="el-icon-info"
          iconColor="red"
          title="Show Flux Debug file?"
          @onConfirm="tailFluxDebug()"
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
          v-model="fluxDebugTail"
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
import ZelFluxService from '@/services/ZelFluxService';

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'ZelNode',
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
      getZelNodeStatusResponse: {
        status: '',
        data: '',
        zelnodeStatus: 'Checking status...',
      },
      activeName: 'outgoing',
      connectedPeers: [],
      incomingConnections: [],
      filterConnectedPeer: '',
      connectPeerIP: '',
      total: '',
      downloaded: '',
      abortToken: {},
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'zelNodeSection',
    ]),
    fluxDebugTail() {
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
    zelNodeSection(val, oldVal) {
      console.log(val, oldVal);
      this.switcher(val);
    },
  },
  mounted() {
    this.switcher(this.zelNodeSection);
  },
  methods: {
    switcher(value) {
      switch (value) {
        case 'getinfo':
          this.zelcashGetInfo();
          this.zelcashGetZelNodeStatus();
          break;
        case 'network':
          this.zelfluxConnectedPeersInfo();
          this.zelfluxIncomingConnectionsInfo();
          break;
        case 'messages':
          this.broadcastMessage();
          break;
        case 'debug':
          break;
        case null:
          console.log('ZelNode Section hidden');
          break;
        default:
          console.log('ZelNode Section: Unrecognized method');
      }
    },
    async zelcashGetInfo() {
      const response = await ZelCashService.getInfo();
      this.getInfoResponse.status = response.data.status;
      this.getInfoResponse.data = response.data.data;
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
    async broadcastMessage() {
      const zelidauth = localStorage.getItem('zelidauth');
      ZelFluxService.broadcastMessage(zelidauth, 'abcde')
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
    async zelfluxConnectedPeersInfo() {
      const response = await ZelFluxService.connectedPeersInfo();
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
    async zelfluxIncomingConnectionsInfo() {
      const response = await ZelFluxService.incomingConnectionsInfo();
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
      ZelFluxService.removePeer(zelidauth, row.ip)
        .then((response) => {
          vue.$customMes({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
          setTimeout(() => {
            self.zelfluxConnectedPeersInfo();
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
      ZelFluxService.removeIncomingPeer(zelidauth, row.ip)
        .then((response) => {
          vue.$customMes({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
          setTimeout(() => {
            self.zelfluxIncomingConnectionsInfo();
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
      ZelFluxService.addPeer(zelidauth, self.connectPeerIP)
        .then((response) => {
          console.log(response);
          vue.$customMes({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
          setTimeout(() => {
            self.zelfluxConnectedPeersInfo();
          }, 2000);
        })
        .catch((e) => {
          console.log(e);
          vue.$customMes.error(e.toString());
        });
    },
    cancelDownload() {
      this.abortToken.cancel('User download cancelled');
      this.downloaded = '';
      this.total = '';
    },
    async downloadFluxDebugFile() {
      const self = this;
      self.abortToken = ZelFluxService.cancelToken();
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
      const response = await ZelFluxService.justAPI().get('/zelnode/zelfluxerrorlog', axiosConfig);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'debug.log');
      document.body.appendChild(link);
      link.click();
    },
    tailFluxDebug() {
      const zelidauth = localStorage.getItem('zelidauth');
      ZelFluxService.tailFluxDebug(zelidauth)
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
          vue.$customMes.error('Error while trying to get latest debug of Flux');
        });
    },
  },
};
</script>
