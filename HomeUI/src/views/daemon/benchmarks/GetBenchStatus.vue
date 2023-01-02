<template>
  <b-card
    v-if="callResponse.data !== ''"
  >
    <list-entry
      v-if="callResponse.data.status"
      title="Status"
      :data="callResponse.data.status"
    />
    <list-entry
      v-if="callResponse.data.benchmarking"
      title="Benchmarking"
      :data="callResponse.data.benchmarking"
    />
    <list-entry
      v-if="callResponse.data.zelback || callResponse.data.flux"
      title="Flux"
      :data="callResponse.data.zelback || callResponse.data.flux"
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
} from 'bootstrap-vue';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ListEntry from '@/views/components/ListEntry.vue';
import DaemonService from '@/services/DaemonService.js';

const timeoptions = require('@/libs/dateFormat.js');

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
    this.daemonGetBenchStatus();
  },
  methods: {
    async daemonGetBenchStatus() {
      const response = await DaemonService.getBenchStatus();
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
        this.callResponse.data = JSON.parse(response.data.data);
        console.log(this.callResponse);
      }
    },
  },
};
</script>

<style>

</style>
