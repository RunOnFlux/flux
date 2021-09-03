<template>
  <b-card
    v-if="getInfoResponse.data !== ''"
    title="Get Info"
  >
    <list-entry
      title="Daemon Version"
      :data="getInfoResponse.data.version.toFixed(0)"
    />
    <list-entry
      title="Protocol Version"
      :data="getInfoResponse.data.protocolversion.toFixed(0)"
    />
    <list-entry
      title="Wallet Version"
      :data="getInfoResponse.data.walletversion.toFixed(0)"
    />
    <list-entry
      v-if="getInfoResponse.data.balance"
      title="Balance"
      :data="getInfoResponse.data.balance.toFixed(0)"
    />
    <list-entry
      title="Blocks"
      :data="getInfoResponse.data.blocks.toFixed(0)"
    />
    <list-entry
      title="Time Offset"
      :data="getInfoResponse.data.timeoffset.toString()"
    />
    <list-entry
      title="Connections"
      :data="getInfoResponse.data.connections.toFixed(0)"
    />
    <list-entry
      title="Proxy"
      :data="getInfoResponse.data.proxy"
    />
    <list-entry
      title="Difficulty"
      :data="getInfoResponse.data.difficulty.toFixed(0)"
    />
    <list-entry
      title="Testnet"
      :data="getInfoResponse.data.testnet.toString()"
    />
    <list-entry
      title="Key Pool Oldest"
      :data="new Date(getInfoResponse.data.keypoololdest * 1000).toLocaleString('en-GB', timeoptions.shortDate)"
    />
    <list-entry
      title="Key Pool Size"
      :data="getInfoResponse.data.keypoolsize.toFixed(0)"
    />
    <list-entry
      title="Pay TX Fee"
      :data="getInfoResponse.data.paytxfee.toString()"
    />
    <list-entry
      title="Relay Fee"
      :data="getInfoResponse.data.relayfee.toString()"
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
import {
  BCard,
} from 'bootstrap-vue'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'
import ListEntry from '@/views/components/ListEntry.vue'
import DaemonService from '@/services/DaemonService'

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
      getInfoResponse: {
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
      const response = await DaemonService.getInfo()
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
        this.getInfoResponse.status = response.data.status
        this.getInfoResponse.data = response.data.data
      }
    },
  },
}
</script>

<style>

</style>
