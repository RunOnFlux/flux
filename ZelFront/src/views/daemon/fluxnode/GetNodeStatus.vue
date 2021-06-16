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
      title="TX Hash"
      v-if="callResponse.data.txhash"
      :data="callResponse.data.txhash"
    />
    <list-entry
      title="Output ID"
      v-if="callResponse.data.outidx"
      :data="callResponse.data.outidx"
    />
    <list-entry
      title="IP Address"
      v-if="callResponse.data.ip"
      :data="callResponse.data.ip"
    />
    <list-entry
      title="Network"
      v-if="callResponse.data.network"
      :data="callResponse.data.network"
    />
    <list-entry
      title="Added Height"
      v-if="callResponse.data.added_height"
      :data="callResponse.data.added_height"
    />
    <list-entry
      title="Confirmed Height"
      v-if="callResponse.data.confirmed_height"
      :data="callResponse.data.confirmed_height"
    />
    <list-entry
      title="Last Confirmed Height"
      v-if="callResponse.data.last_confirmed_height"
      :data="callResponse.data.last_confirmed_height"
    />
    <list-entry
      title="Last Paid Height"
      v-if="callResponse.data.last_paid_height"
      :data="callResponse.data.last_paid_height"
    />
    <list-entry
      title="Tier"
      v-if="callResponse.data.tier"
      :data="callResponse.data.tier"
    />
    <list-entry
      title="Payment Address"
      v-if="callResponse.data.payment_address"
      :data="callResponse.data.payment_address"
    />
    <list-entry
      title="Public Key"
      v-if="callResponse.data.pubkey"
      :data="callResponse.data.pubkey"
    />
    <list-entry
      title="Active Since"
      v-if="callResponse.data.activesince"
      :data="new Date(callResponse.data.activesince * 1000).toLocaleString('en-GB', timeoptions.shortDate)"
    />
    <list-entry
      title="Last Paid"
      v-if="callResponse.data.lastpaid"
      :data="new Date(callResponse.data.lastpaid * 1000).toLocaleString('en-GB', timeoptions.shortDate)"
    />
  </b-card>
</template>

<script>
import {
  BCard,
} from 'bootstrap-vue'
import DaemonService from '@/services/DaemonService'
import ListEntry from '@/views/components/ListEntry.vue'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'

const timeoptions = require('@/libs/dateFormat')

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
    }
  },
  mounted() {
    this.daemonGetNodeStatus()
  },
  methods: {
    async daemonGetNodeStatus() {
      const response = await DaemonService.getZelNodeStatus()
      if (response.data.status === 'error') {
        this.$toast({
          component: ToastificationContent,
          props: {
            title: response.data.data.message || response.data.data,
            icon: 'InfoIcon',
            variant: 'danger',
          },
        })
      } else {
        this.callResponse.status = response.data.status
        this.callResponse.data = response.data.data
        console.log(response.data)
      }
    },
  },
}
</script>

<style>

</style>
