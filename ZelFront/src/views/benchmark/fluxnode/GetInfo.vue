<template>
  <b-card
    v-if="getInfoResponse.data !== ''"
    title="Get Info"
  >
    <list-entry
      title="Benchmark Version"
      :data="getInfoResponse.data.version"
    />
    <list-entry
      title="RPC Port"
      :number="getInfoResponse.data.rpcport"
    />
    <list-entry
      v-if="getInfoResponse.data.errors"
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
import ListEntry from '@/views/components/ListEntry.vue'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'
import BenchmarkService from '@/services/BenchmarkService'

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
    this.benchmarkGetInfo()
  },
  methods: {
    async benchmarkGetInfo() {
      const response = await BenchmarkService.getInfo()
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
