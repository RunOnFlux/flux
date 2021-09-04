<template>
  <b-card>
    <list-entry
      title="Status"
      :data="callResponse.data.status"
    />
    <list-entry
      title="Benchmarking"
      :data="callResponse.data.benchmarking"
    />
    <list-entry
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
import BenchmarkService from '@/services/BenchmarkService';

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
    this.benchmarkGetStatus();
  },
  methods: {
    async benchmarkGetStatus() {
      const response = await BenchmarkService.getStatus();
      if (response.data.status === 'error') {
        this.$toast({
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
      }
    },
  },
};
</script>

<style>

</style>
