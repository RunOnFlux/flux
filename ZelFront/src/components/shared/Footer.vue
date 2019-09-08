<template>
  <div class="footer-grid">
    <div class="footer-left">
      <!--<span class="helper"></span>
      <img src="@/assets/img/ZelNodes.svg">-->
    </div>
    <div class="footer-middle">
      <ElLink
        type="primary"
        href="https://github.com/zelcash/zelnoded"
        target="_blank"
      >Your freedom empowered</ElLink>
    </div>
    <div class="footer-right">
      Flux {{ 'v' + version}}
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';
import zelnodeService from '@/services/zelnodeService';

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
      'version',
    ]),
  },
  mounted() {
    zelnodeService.getFluxVersion()
      .then((response) => {
        console.log(response);
        const version = response.data;
        this.$store.commit('setFluxVersion', version);
      })
      .catch((e) => {
        console.log(e);
        console.log(e.code);
        vue.$message.error(e.toString());
      });
  },
};
</script>
