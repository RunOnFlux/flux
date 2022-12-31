<template>
  <b-card
    v-if="callResponse.data !== ''"
    title="Get FluxNode Status"
  >
    <list-entry
      title="Status"
      :data="callResponse.data.status"
    />
    <list-entry
      title="Collateral"
      :data="callResponse.data.collateral"
    />
    <list-entry
      v-if="callResponse.data.txhash"
      title="TX Hash"
      :data="callResponse.data.txhash"
    />
    <list-entry
      v-if="callResponse.data.outidx"
      title="Output ID"
      :data="callResponse.data.outidx"
    />
    <list-entry
      v-if="callResponse.data.ip"
      title="IP Address"
      :data="callResponse.data.ip"
    />
    <list-entry
      v-if="callResponse.data.network"
      title="Network"
      :data="callResponse.data.network"
    />
    <list-entry
      v-if="callResponse.data.added_height"
      title="Added Height"
      :number="callResponse.data.added_height"
    />
    <list-entry
      v-if="callResponse.data.confirmed_height"
      title="Confirmed Height"
      :number="callResponse.data.confirmed_height"
    />
    <list-entry
      v-if="callResponse.data.last_confirmed_height"
      title="Last Confirmed Height"
      :number="callResponse.data.last_confirmed_height"
    />
    <list-entry
      v-if="callResponse.data.last_paid_height"
      title="Last Paid Height"
      :number="callResponse.data.last_paid_height"
    />
    <list-entry
      v-if="callResponse.data.tier"
      title="Tier"
      :data="callResponse.data.tier"
    />
    <list-entry
      v-if="callResponse.data.payment_address"
      title="Payment Address"
      :data="callResponse.data.payment_address"
    />
    <list-entry
      v-if="callResponse.data.pubkey"
      title="Public Key"
      :data="callResponse.data.pubkey"
    />
    <list-entry
      v-if="callResponse.data.activesince"
      title="Active Since"
      :data="new Date(callResponse.data.activesince * 1000).toLocaleString('en-GB', timeoptions.shortDate)"
    />
    <list-entry
      v-if="callResponse.data.lastpaid"
      title="Last Paid"
      :data="new Date(callResponse.data.lastpaid * 1000).toLocaleString('en-GB', timeoptions.shortDate)"
    />
  </b-card>
</template>

<script>
import {
  BCard,
} from 'bootstrap-vue';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import DaemonService from '@/services/DaemonService';
import ListEntry from '@/views/components/ListEntry.vue';

const timeoptions = require('@/libs/dateFormat');

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
    };
  },
  mounted() {
    this.daemonGetNodeStatus();
  },
  methods: {
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
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
        console.log(response.data);
      }
    },
  },
};
</script>

<style>

</style>
