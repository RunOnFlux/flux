<template>
  <b-overlay
    :show="!callResponse.data"
    variant="transparent"
    blur="5px"
  >
    <b-card>
      <b-card-title
        v-if="!callResponse.data"
      >
        Loading...
      </b-card-title>
      <b-form-textarea
        v-if="callResponse.data"
        plaintext
        no-resize
        rows="11"
        :value="callResponse.data"
      />
    </b-card>
  </b-overlay>
</template>

<script>
import {
  BCard,
  BCardTitle,
  BFormTextarea,
  BOverlay,
} from 'bootstrap-vue';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import DaemonService from '@/services/DaemonService';

export default {
  components: {
    BCard,
    BCardTitle,
    BFormTextarea,
    BOverlay,
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
    this.daemonGetWalletInfo();
  },
  methods: {
    async daemonGetWalletInfo() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await DaemonService.getWalletInfo(zelidauth);
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
        this.callResponse.data = JSON.stringify(response.data.data, null, 4);
      }
    },
  },
};
</script>

<style>

</style>
