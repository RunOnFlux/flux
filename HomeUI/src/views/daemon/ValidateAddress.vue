<template>
  <b-overlay
    :show="addressLoading"
    variant="transparent"
    blur="5px"
  >
    <b-card>
      <b-card-text>
        Please paste a transparent Flux address below to display information about it.
      </b-card-text>
      <b-form-input
        v-model="address"
        placeholder="FLUX Address"
      />
      <b-button
        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
        variant="outline-primary"
        size="md"
        class="my-1"
        @click="fluxValidateAddress"
      >
        Validate Address
      </b-button>
      <b-form-textarea
        v-if="callResponse.data"
        plaintext
        no-resize
        rows="30"
        :value="callResponse.data"
      />
    </b-card>
  </b-overlay>
</template>

<script>
import {
  BCard,
  BCardText,
  BButton,
  BFormInput,
  BFormTextarea,
  BOverlay,
} from 'bootstrap-vue';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import Ripple from 'vue-ripple-directive';
import DaemonService from '@/services/DaemonService';

export default {
  components: {
    BCard,
    BCardText,
    BButton,
    BFormInput,
    BFormTextarea,
    BOverlay,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    Ripple,
  },
  data() {
    return {
      address: '',
      callResponse: {
        status: '',
        data: '',
      },
      addressLoading: false,
    };
  },
  methods: {
    async fluxValidateAddress() {
      this.addressLoading = true;
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await DaemonService.validateAddress(zelidauth, this.address);
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
        this.callResponse.data = JSON.stringify(response.data.data, undefined, 4);
      }
      this.addressLoading = false;
    },
  },
};
</script>

<style>

</style>
