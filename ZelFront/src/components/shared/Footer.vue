<template>
  <div class="footer-grid">
    <div class="footer-left">
      <!--<span class="helper"></span>
      <img src="@/assets/img/ZelNodes.svg">-->
    </div>
    <div class="footer-middle">
      <ElLink
        type="primary"
        href="https://github.com/zelcash/zelflux"
        target="_blank"
      >The gateway to the Zel Network</ElLink>
    </div>
    <div class="footer-right">
      ZelFlux {{ 'v' + zelfluxVersion}}
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';
import axios from 'axios';

import ZelNodeService from '@/services/ZelNodeService';

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'Footer',
  data() {
    return {
    };
  },
  computed: {
    ...mapState([
      'zelfluxVersion',
    ]),
  },
  mounted() {
    const self = this;
    ZelNodeService.getZelFluxVersion()
      .then((response) => {
        console.log(response);
        const version = response.data.data;
        this.$store.commit('setZelFluxVersion', version);
        self.getLatestZelFluxVersion();
      })
      .catch((e) => {
        console.log(e);
        console.log(e.code);
        vue.$message.error(e.toString());
      });
  },
  methods: {
    getLatestZelFluxVersion() {
      const self = this;
      axios.get('https://raw.githubusercontent.com/zelcash/zelflux/master/package.json')
        .then((response) => {
          console.log(response);
          if (response.data.version !== self.zelfluxVersion) {
            vue.$message.warning('ZelFlux needs to be updated!');
          } else {
            vue.$message.success('ZelFlux is up to date');
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error verifying recent version');
        });
    },
  },
};
</script>
