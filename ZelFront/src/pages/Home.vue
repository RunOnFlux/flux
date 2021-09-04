<template>
  <div class="mainDivStyle">
    <div class="header">
      <Header />
    </div>
    <div class="content">
      Hey
    </div>
    <div class="footer">
      <Footer />
    </div>
  </div>
</template>

<script>
import Vue from 'vue';
import Vuex, { mapState } from 'vuex';

const Header = () => import('@/components/shared/Header');
const Footer = () => import('@/components/shared/Footer');

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'Home',
  components: { Header, Footer },
  data() {
    return {
    };
  },
  computed: {
    ...mapState([
      'userconfig',
      'config',
      'privilage',
    ]),
  },
  mounted() {
    vue.$customMes.success('Hi!');
  },
  methods: {
  },
};
</script>
