<template>
  <div class="zelnodeSection">
    <div v-if="userSection === 'loggedsessions'">
      <ElButton
        class="generalButton"
        @click="logoutAllSessions()"
      >
        Logout all sessions
      </ElButton>
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

import zelIDService from '@/services/ZelIDService';

const qs = require('qs');

Vue.use(Vuex);
const vue = new Vue();

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
      'userSection',
    ]),
  },
  watch: {
    userSection(val, oldVal) {
      console.log(val, oldVal);
      switch (val) {
        case 'loggedsessions':
          break;
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
      case 'loggedsessions':
        break;
      case null:
        console.log('User Section hidden');
        break;
      default:
        console.log('User Section: Unrecognised method');
    }
  },
  methods: {
    logoutAllSessions() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      zelIDService.logoutAllSessions(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
          } else {
            localStorage.removeItem('zelidauth');
            this.$store.commit('setZelCashSection', 'getinfo');
            this.$store.commit('setPrivilage', 'none');
            vue.$message.success(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$message.error(e.toString());
        });
    },
  },
};
</script>
