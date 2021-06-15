<template>
  <b-card>
  </b-card>
</template>

<script>
import {
  BCard,
} from 'bootstrap-vue'
import DaemonService from '@/services/DaemonService'

export default {
  data() {
    return {
    }
  },
  components: {
    BCard,
  },
  mounted() {
    this.daemonGetNodeStatus()
  },
  methods: {
    async daemonGetNodeStatus() {
      const response = await DaemonService.getZelNodeStatus()
      if (response.data.status === 'error') {
        // vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        // this.callResponse.status = response.data.status;
        // this.callResponse.data = response.data.data;
        console.log(response.data)
      }
    },
  },
}
</script>

<style>

</style>
