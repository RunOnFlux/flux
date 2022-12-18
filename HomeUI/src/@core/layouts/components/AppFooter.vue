<template>
  <p class="clearfix mb-0">
    <span class="float-md-left d-block d-md-inline-block mt-25">
      <b-link
        class="ml-25"
        href="https://github.com/runonflux/flux"
        target="_blank"
      >Flux, Your Gateway to a Decentralized World</b-link>
    </span>

    <span class="float-md-right d-none d-md-block">FluxOS {{ 'v' + fluxVersion }}
    </span>
  </p>
</template>

<script>
import { mapState } from 'pinia';
import { BLink } from 'bootstrap-vue';
import axios from 'axios';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import FluxService from '@/services/FluxService';

export default {
  components: {
    BLink,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  computed: {
    ...mapState('flux', [
      'fluxVersion',
    ]),
  },
  mounted() {
    const self = this;
    FluxService.getFluxVersion()
      .then((response) => {
        // console.log(response)
        const version = response.data.data;
        this.$store.commit('flux/setFluxVersion', version);
        self.getLatestFluxVersion();
      })
      .catch((e) => {
        console.log(e);
        console.log(e.code);
        this.showToast('danger', e.toString());
      });
  },
  methods: {
    getLatestFluxVersion() {
      const self = this;
      axios.get('https://raw.githubusercontent.com/runonflux/flux/master/package.json')
        .then((response) => {
          if (response.data.version !== self.fluxVersion) {
            this.showToast('danger', 'Flux needs to be updated!');
          } else {
            this.showToast('success', 'Flux is up to date');
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error verifying recent version');
        });
    },
    showToast(variant, title) {
      this.$toast({
        component: ToastificationContent,
        props: {
          title,
          icon: 'BellIcon',
          variant,
        },
      });
    },
  },
};
</script>
