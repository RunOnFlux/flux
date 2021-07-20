<template>
  <b-card
    v-if="callResponse.data !== ''"
    title="Get Benchmarks"
  >
    <list-entry
      v-if="callResponse.data.status"
      title="Status"
      :data="callResponse.data.status"
    />
    <list-entry
      v-if="callResponse.data.time"
      title="Time"
      :data="new Date(callResponse.data.time * 1000).toLocaleString('en-GB', timeoptions.short)"
    />
    <list-entry
      v-if="callResponse.data.ipaddress"
      title="IP Address"
      :data="callResponse.data.ipaddress"
    />
    <list-entry
      v-if="callResponse.data.cores"
      title="CPU Cores"
      :number="callResponse.data.cores"
    />
    <list-entry
      v-if="callResponse.data.ram"
      title="RAM"
      :data="`${callResponse.data.ram} GB`"
    />
    <list-entry
      v-if="callResponse.data.ssd"
      title="SSD"
      :data="`${callResponse.data.ssd} GB`"
    />
    <list-entry
      v-if="callResponse.data.hdd"
      title="HDD"
      :data="`${callResponse.data.hdd} GB`"
    />
    <list-entry
      v-if="callResponse.data.ddwrite"
      title="Write Speed"
      :data="`${callResponse.data.ddwrite} MB/s`"
    />
    <list-entry
      v-if="callResponse.data.eps"
      title="CPU Speed"
      :data="`${callResponse.data.eps} eps`"
    />
    <list-entry
      v-if="callResponse.data.errors"
      title="Error"
      :data="callResponse.data.errors"
      variant="danger"
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
    this.daemonGetBenchmarks()
  },
  methods: {
    async daemonGetBenchmarks() {
      const response = await DaemonService.getBenchmarks()
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
        this.callResponse.data = JSON.parse(response.data.data)
      }
    },
  },
}
</script>

<style>

</style>
