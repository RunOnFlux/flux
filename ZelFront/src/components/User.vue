<template>
  <div class="zelnodeSection">
    <div v-if="userSection !== null">
      Hello User
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

Vue.use(Vuex);

export default {
  name: 'User',
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
      'userSection',
    ]),
  },
  watch: {
    userSection(val, oldVal) {
      console.log(val, oldVal);
      switch (val) {
        case null:
          console.log('User Section hidden');
          break;
        default:
          console.log('User Section: Unrecognised method'); // should not be seeable if all works correctly
      }
    },
  },
  mounted() {
    switch (this.userSection) {
      case null:
        console.log('User Section hidden');
        break;
      default:
        console.log('User Section: Unrecognised method');
    }
  },
  methods: {

  },
};
</script>
