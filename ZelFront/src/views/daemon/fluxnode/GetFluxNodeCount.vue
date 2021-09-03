<template>
  <b-card>
    <list-entry
      v-if="callResponse.data.total"
      title="Total"
      :data="callResponse.data.total.toFixed(0)"
    />
    <list-entry
      v-if="callResponse.data.stable"
      title="Stable"
      :data="callResponse.data.stable.toFixed(0)"
    />
    <list-entry
      v-if="callResponse.data['basic-enabled'] || callResponse.data['cumulus-enabled']"
      title="Cumulus Tier"
      :data="(callResponse.data['basic-enabled'] || callResponse.data['cumulus-enabled']).toFixed(0)"
    />
    <list-entry
      v-if="callResponse.data['super-enabled'] || callResponse.data['nimbus-enabled']"
      title="Nimbus Tier"
      :data="(callResponse.data['super-enabled'] || callResponse.data['nimbus-enabled']).toFixed(0)"
    />
    <list-entry
      v-if="callResponse.data['bamf-enabled'] || callResponse.data['stratus-enabled']"
      title="Stratus Tier"
      :data="(callResponse.data['bamf-enabled'] || callResponse.data['stratus-enabled']).toFixed(0)"
    />
    <list-entry
      v-if="callResponse.data.ipv4 >= 0"
      title="IPv4"
      :data="callResponse.data.ipv4.toFixed(0)"
    />
    <list-entry
      v-if="callResponse.data.ipv6 >= 0"
      title="IPv6"
      :data="callResponse.data.ipv6.toFixed(0)"
    />
    <list-entry
      v-if="callResponse.data.onion >= 0"
      title="Tor"
      :data="callResponse.data.onion.toFixed(0)"
    />
  </b-card>
</template>

<script>
import {
  BCard,
} from 'bootstrap-vue'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'
import DaemonService from '@/services/DaemonService'
import ListEntry from '@/views/components/ListEntry.vue'

export default {
  components: {
    ListEntry,
    BCard,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  data() {
    return {
      callResponse: {
        status: '',
        data: '',
      },
    }
  },
  mounted() {
    this.daemonGetZelNodeCount()
  },
  methods: {
    async daemonGetZelNodeCount() {
      const response = await DaemonService.getZelNodeCount()
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
