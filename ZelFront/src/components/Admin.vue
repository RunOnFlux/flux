<template>
  <div class="zelnodeSection">
    <div v-if="adminSection !== null">
      Hello Admin
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

Vue.use(Vuex);

export default {
  name: 'Admin',
  data() {
    return {

    };
  },

  computed: {
    ...mapState([
      'config',
      'userconfig',
      'privilage',
      'loginPhrase',
      'adminSection',
    ]),
  },
  watch: {
    adminSection(val, oldVal) {
      console.log(val, oldVal);
      switch (val) {
        case null:
          console.log('Admin Section hidden');
          break;
        default:
          console.log('Admin Section: Unrecognised method'); // should not be seeable if all works correctly
      }
    },
  },
  mounted() {
    switch (this.adminSection) {
      case null:
        console.log('Admin Section hidden');
        break;
      default:
        console.log('Admin Section: Unrecognised method');
    }
  },
  methods: {

  },
};
</script>
