<template>
  <b-card />
</template>

<script>
import {
  BCard,
} from 'bootstrap-vue'
import DaemonService from '@/services/DaemonService'

export default {
  components: {
    BCard,
  },
  data() {
    return {
    }
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
