<template>
  <b-card
    v-if="getInfoResponse.data !== ''"
  >
    <list-entry
      title="Flux owner ZelID"
      :data="userconfig.zelid"
    />
    <list-entry
      title="Status"
      :data="getNodeStatusResponse.nodeStatus"
      :variant="getNodeStatusResponse.class"
    />
    <list-entry
      title="Flux Payment Address"
      :data="getNodeStatusResponse.data.payment_address"
    />
    <list-entry
      v-if="getInfoResponse.data.balance"
      title="Tier"
      :data="getNodeStatusResponse.data.tier"
    />
    <list-entry
      title="Flux IP Address"
      :data="getNodeStatusResponse.data.ip"
    />
    <list-entry
      title="Flux IP Network"
      :data="getNodeStatusResponse.data.network"
    />
    <list-entry
      title="Flux Public Key"
      :data="getNodeStatusResponse.data.pubkey"
    />
    <div v-if="getNodeStatusResponse.data.collateral">
      <list-entry
        title="Added Height"
        :number="getNodeStatusResponse.data.added_height"
        :href="'https://explorer.runonflux.io/block-index/' + getNodeStatusResponse.data.added_height"
      />
      <list-entry
        title="Confirmed Height"
        :number="getNodeStatusResponse.data.confirmed_height"
        :href="'https://explorer.runonflux.io/block-index/' + getNodeStatusResponse.data.confirmed_height"
      />
      <list-entry
        title="Last Confirmed Height"
        :number="getNodeStatusResponse.data.last_confirmed_height"
        :href="'https://explorer.runonflux.io/block-index/' + getNodeStatusResponse.data.last_confirmed_height"
      />
      <list-entry
        title="Last Paid Height"
        :number="getNodeStatusResponse.data.last_paid_height"
        :href="'https://explorer.runonflux.io/block-index/' + getNodeStatusResponse.data.last_paid_height"
      />
      <list-entry
        title="Locked Transaction"
        :data="'Click to view'"
        :href="'https://explorer.runonflux.io/tx/' + getNodeStatusResponse.data.txhash"
      />
    </div>
    <list-entry
      title="Flux Daemon version"
      :number="getInfoResponse.data.version"
    />
    <list-entry
      title="Protocol version"
      :number="getInfoResponse.data.protocolversion"
    />
    <list-entry
      title="Current Blockchain Height"
      :number="getInfoResponse.data.blocks"
    />

    <list-entry
      v-if="getInfoResponse.data.errors != ''"
      title="Error"
      :data="getInfoResponse.data.errors"
      variant="danger"
    />
  </b-card>
</template>

<script>
import { computed } from 'vue';
import {
  BCard,
} from 'bootstrap-vue';
import { mapState } from 'vuex';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ListEntry from '@/views/components/ListEntry.vue';
import DaemonService from '@/services/DaemonService.js';
import FluxService from '@/services/FluxService.js';

import timeoptions from '@/libs/dateFormat.js';

export default {
  components: {
    ListEntry,
    BCard,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  data() {
    return {
      timeoptions,
      callResponse: {
        status: '',
        data: '',
      },
      getNodeStatusResponse: {
        status: '',
        data: '',
      },
      getInfoResponse: {
        status: '',
        data: '',
      },
      connectedPeers: [],
      incomingConnections: [],
      filterConnectedPeer: '',
    };
  },
  setup() {
    const { ...mapState } = computed(() => {
      ('flux', [
        'config',
        'userconfig',
        'nodeSection',
      ]);
    });

    const fluxLogTail = computed(() => {
      if (this.callResponse.data.message) {
        return this.callResponse.data.message.split('\n').reverse().filter((el) => el !== '').join('\n');
      }
      return this.callResponse.data;
    });

    const connectedPeersFilter = computed(() => {
      return this.connectedPeers.filter((data) => !this.filterConnectedPeer || data.ip.toLowerCase().includes(this.filterConnectedPeer.toLowerCase()));
    });

    const incomingConnectionsFilter = computed(() => {
      return this.incomingConnections.filter((data) => !this.filterConnectedPeer || data.ip.toLowerCase().includes(this.filterConnectedPeer.toLowerCase()));
    });

    return {
      mapState,
      fluxLogTail,
      connectedPeersFilter,
      incomingConnectionsFilter
    }
  },
  mounted() {
    this.daemonGetInfo();
    this.daemonGetNodeStatus();
    this.getOwnerZelid();
  },
  methods: {
    async getOwnerZelid() {
      const response = await FluxService.getZelid();
      const obtainedZelid = response.data.data;
      if (response.data.status === 'success' && typeof obtainedZelid === 'string') {
        this.$store.commit('flux/setUserZelid', obtainedZelid);
      }
    },
    async daemonGetInfo() {
      const response = await DaemonService.getInfo();
      if (response.data.status === 'error') {
        this.$bvToast.toast({
          component: ToastificationContent,
          props: {
            title: response.data.data.message || response.data.data,
            icon: 'InfoIcon',
            variant: 'danger',
          },
        });
      } else {
        this.getInfoResponse.status = response.data.status;
        this.getInfoResponse.data = response.data.data;
      }
    },
    async daemonGetNodeStatus() {
      const response = await DaemonService.getZelNodeStatus();
      if (response.data.status === 'error') {
        this.$bvToast.toast({
          component: ToastificationContent,
          props: {
            title: response.data.data.message || response.data.data,
            icon: 'InfoIcon',
            variant: 'danger',
          },
        });
      } else {
        this.getNodeStatusResponse.status = response.data.status;
        this.getNodeStatusResponse.data = response.data.data;
        if (this.getNodeStatusResponse.data.status === 'CONFIRMED' || this.getNodeStatusResponse.data.location === 'CONFIRMED') {
          this.getNodeStatusResponse.nodeStatus = 'Flux is working correctly';
          this.getNodeStatusResponse.class = 'success';
        } else if (this.getNodeStatusResponse.data.status === 'STARTED' || this.getNodeStatusResponse.data.location === 'STARTED') {
          this.getNodeStatusResponse.nodeStatus = 'Flux has just been started. Flux is running with limited capabilities.';
          this.getNodeStatusResponse.class = 'warning';
        } else {
          this.getNodeStatusResponse.nodeStatus = 'Flux is not confirmed. Flux is running with limited capabilities.';
          this.getNodeStatusResponse.class = 'danger';
        }
      }
    },
  },
};
</script>

<style>

</style>
