<template>
  <b-card>
    <b-form-textarea
      v-if="callResponse.data"
      plaintext
      no-resize
      rows="15"
      :value="callResponse.data"
    />
  </b-card>
</template>

<script>
import {
  BCard,
  BFormTextarea,
} from 'bootstrap-vue';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import DaemonService from '@/services/DaemonService';

export default {
  components: {
    BCard,
    BFormTextarea,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  data() {
    return {
      callResponse: {
        status: '',
        data: '',
      },
    };
  },
  mounted() {
    this.daemonGetMiningInfo();
  },
  methods: {
    async daemonGetMiningInfo() {
      const response = await DaemonService.getMiningInfo();
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
        this.callResponse.data = JSON.stringify(response.data.data, null, 4);
      }
    },
  },
};
</script>

<style>

</style>
