<template>
  <div class="zelappssection">
    <div>
      ZelApps coming December 2019!
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

Vue.use(Vuex);

const vue = new Vue();

export default {
  name: 'ZelApps',
  data() {
    return {
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'zelAppsSection',
    ]),
  },
  watch: {
    zelAppsSection(val, oldVal) {
      console.log(val, oldVal);
      switch (val) {
        case 'information':
          vue.$message.info('ZelApps coming soon!');
          break;
        default:
          console.log('ZelApps Section: Unrecognized method'); // should not be visible if everything works correctly
      }
    },
  },
  mounted() {
    switch (this.zelAppsSection) {
      case 'information':
        vue.$message.info('ZelApps coming soon!');
        break;
      default:
        console.log('ZelApps Section: Unrecognized method');
    }
  },
  methods: {
  },
};
</script>
