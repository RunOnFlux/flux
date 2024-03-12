<template>
  <!-- Success checkout Fiat Payment-->
  <div class="misc-wrapper">
    <b-link
      class="brand-logo"
      style="height: 100px;"
    >
      <vuexy-logo />
    </b-link>

    <div class="misc-inner p-2 p-sm-3">
      <div class="w-100 text-center">
        <h2 class="mb-1">
          Your application payment was completed!
        </h2>
        <p class="mb-2">
          It can take up to 30 minutes for the payment be broadcasted/processed on the Flux network.
        </p>
        <b-button
          variant="primary"
          class="mb-2 btn-sm-block"
          :to="{ path: '/' }"
        >
          Back to home
        </b-button>

        <!-- image -->
        <b-img
          fluid
          :src="imgUrl"
          alt="Payment Completed"
        />
      </div>
    </div>
  </div>
<!-- / Success checkout Fiat Payment-->
</template>

<script>
/* eslint-disable global-require */
import { BLink, BButton, BImg } from 'bootstrap-vue';
import VuexyLogo from '@core/layouts/components/Logo.vue';
import store from '@/store/index';

export default {
  components: {
    VuexyLogo,
    BLink,
    BButton,
    BImg,
  },
  data() {
    return {
      downImg: require('@/assets/images/pages/error.svg'),
    };
  },
  computed: {
    imgUrl() {
      if (store.state.appConfig.layout.skin === 'dark') {
        // eslint-disable-next-line vue/no-side-effects-in-computed-properties
        this.downImg = require('@/assets/images/pages/error-dark.svg');
        return this.downImg;
      }
      return this.downImg;
    },
  },
};
</script>

<style lang="scss">
@import '@core/scss/vue/pages/page-misc.scss';
</style>
