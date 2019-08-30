<template>
  <div class="zelnodeSection">
    <div v-if="zelteamSection !== null">
      Hello ZelTeam
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

Vue.use(Vuex);

export default {
  name: 'ZelTeam',
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
      'zelteamSection',
    ]),
  },
  watch: {
    zelteamSection(val, oldVal) {
      console.log(val, oldVal);
      switch (val) {
        case null:
          console.log('ZelTeam Section hidden');
          break;
        default:
          console.log('ZelTeam Section: Unrecognised method'); // should not be seeable if all works correctly
      }
    },
  },
  mounted() {
    switch (this.zelteamSection) {
      case null:
        console.log('ZelTeam Section hidden');
        break;
      default:
        console.log('ZelTeam Section: Unrecognised method');
    }
  },
  methods: {

  },
};
</script>
