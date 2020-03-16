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
          Tier: {{ getZelNodeStatusResponse.tier }}
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
            ZelNode Address: {{ getZelNodeStatusResponse.data.addr }}
          </h4>
          <h4>
            <ElLink
              type="primary"
              :href="'https://explorer.zel.cash/tx/' + getZelNodeStatusResponse.data.collateral.split(', ')[0].split('COutPoint(')[1]"
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
          <br>
          <hr>
          <br>
          Force a connection to a peer
          <br>
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

            <ElButton
              class="generalButton"
              @click="connectPeer()"
            >
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
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'zelNodeSection',
    ]),
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
      switch (val) {
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
        case null:
          console.log('ZelNode Section hidden');
          break;
        default:
          console.log('ZelNode Section: Unrecognized method'); // should not be visible if everything works correctly
      }
    },
  },
  mounted() {
    switch (this.zelNodeSection) {
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
      case null:
        console.log('ZelNode Section hidden');
        break;
      default:
        console.log('ZelNode Section: Unrecognized method');
    }
  },
  methods: {
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
        if (this.getZelNodeStatusResponse.data.location === 'CONFIRMED') {
          this.getZelNodeStatusResponse.zelnodeStatus = 'ZelNode is working correctly';
        } else if (this.getZelNodeStatusResponse.data.location === 'STARTED') {
          this.getZelNodeStatusResponse.zelnodeStatus = 'ZelNode has just been started. ZelFlux is running with limited capabilities.';
        } else {
          this.getZelNodeStatusResponse.zelnodeStatus = 'ZelNode is not confirmed. ZelFlux is running with limited capabilities.';
        }
      }
      if (this.getZelNodeStatusResponse.data.collateral) {
        const collateral = this.getZelNodeStatusResponse.data.collateral.split(', ');
        const collateralHash = collateral[0].split('COutPoint(')[1];
        const collateralIndex = collateral[1].split(')')[0];
        const rawTxResponse = await ZelCashService.getRawTransaction(collateralHash);
        const rawtxdata = rawTxResponse.data.data;
        const address = rawtxdata.vout[collateralIndex].scriptPubKey.addresses[0];
        this.getZelNodeStatusResponse.data.addr = address;
      }
    },
    async broadcastMessage() {
      const zelidauth = localStorage.getItem('zelidauth');
      ZelFluxService.broadcastMessage(zelidauth, 'abcde')
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
          } else {
            vue.$message.success(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$message.error(e.toString());
        });
    },
    async zelfluxConnectedPeersInfo() {
      const response = await ZelFluxService.connectedPeersInfo();
      console.log(response);
      if (response.data.status === 'success') {
        this.connectedPeers = response.data.data;
      } else {
        vue.$message({
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
        vue.$message({
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
          vue.$message({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
          setTimeout(() => {
            self.zelfluxConnectedPeersInfo();
          }, 2000);
        })
        .catch((e) => {
          console.log(e);
          vue.$message.error(e.toString());
        });
    },
    disconnectIncoming(index, row) {
      const self = this;
      console.log(index, row);
      const zelidauth = localStorage.getItem('zelidauth');
      ZelFluxService.removeIncomingPeer(zelidauth, row.ip)
        .then((response) => {
          vue.$message({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
          setTimeout(() => {
            self.zelfluxIncomingConnectionsInfo();
          }, 2000);
        })
        .catch((e) => {
          console.log(e);
          vue.$message.error(e.toString());
        });
    },
    connectPeer() {
      const self = this;
      const zelidauth = localStorage.getItem('zelidauth');
      ZelFluxService.addPeer(zelidauth, self.connectPeerIP)
        .then((response) => {
          console.log(response);
          vue.$message({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
          setTimeout(() => {
            self.zelfluxConnectedPeersInfo();
          }, 2000);
        })
        .catch((e) => {
          console.log(e);
          vue.$message.error(e.toString());
        });
    },
  },
};
</script>
