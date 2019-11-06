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
        <div v-if="getZelNodeStatusResponse.code != -1">
          <h4>
            ZelNode Address: {{ getZelNodeStatusResponse.data.addr }}
          </h4>
          <h4>
            Network: {{ getZelNodeStatusResponse.data.netaddr }}
          </h4>
          <h4>
            <ElLink
              type="primary"
              :href="'https://explorer.zel.cash/tx/' + getZelNodeStatusResponse.data.txhash"
              target="_blank"
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
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'zelNodeSection',
    ]),
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
          this.zelfluxIncomingConnections();
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
        this.zelfluxIncomingConnections();
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
        if (this.getZelNodeStatusResponse.data.status === 4) {
          this.getZelNodeStatusResponse.zelnodeStatus = 'ZelNode is working correctly';
        } else {
          const statusCode = this.getZelNodeStatusResponse.data.code || this.getZelNodeStatusResponse.data.status;
          this.getZelNodeStatusResponse.code = statusCode;
          this.getZelNodeStatusResponse.zelnodeStatus = `Error status code: ${statusCode}. ZelNode not activated yet. ZelFlux is running but with limited capabilities.`;
        }
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
      const responsePeers = await ZelFluxService.connectedPeersInfo();
      console.log(responsePeers);
    },
    async zelfluxIncomingConnections() {
      const response = await ZelFluxService.incomingConnections();
      console.log(response);
    },
  },
};
</script>
