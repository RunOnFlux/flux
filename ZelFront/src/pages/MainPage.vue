<template>
  <div class="mainDivStyle">
    <div class="header">
      <Header :privilage="privilage" />
    </div>
    <div
      v-if="loginPhrase && getInfoResponse.status === 'success'"
      class="content"
    >
      <div v-if="daemonSection !== null">
        <Daemon />
      </div>
      <div v-if="benchmarkSection !== null">
        <Benchmark />
      </div>
      <div v-if="zelNodeSection !== null">
        <Node />
      </div>
      <div v-if="adminSection !== null">
        <Admin />
      </div>
      <div v-if="appsSection !== null">
        <Apps />
      </div>
      <div v-if="explorerSection !== null">
        <Explorer />
      </div>
      <br>
      <div v-if="privilage === 'none' && explorerSection === null">
        <Login />
      </div>
    </div>
    <div
      v-else-if="loginPhrase === ''"
      class="content"
    >
      <div v-if="errorMessage !== ''">
        <h3>
          {{ errorMessage }}
        </h3>
      </div>
      <div v-else>
        <h4>
          Loading...
        </h4>
      </div>
    </div>
    <div
      v-else-if="getInfoResponse.status === 'error'"
      class="content"
    >
      <div v-if="privilage === 'none'">
        <Login />
      </div>
      <br>
      <h3>
        Error connecting to the ZelCash Daemon
        <div v-if="privilage ==='admin' || privilage ==='fluxteam'">
          <p>
            Please try to restart your ZelCash Daemon in Daemon section.
          </p>
          <div v-if="daemonSection !== null">
            <Daemon />
          </div>
          <div v-if="benchmarkSection !== null">
            <Benchmark />
          </div>
          <div v-if="zelNodeSection !== null">
            <Node />
          </div>
          <div v-if="adminSection !== null">
            <Admin />
          </div>
          <div v-if="appsSection !== null">
            <Apps />
          </div>
          <div v-if="explorerSection !== null">
            <Explorer />
          </div>
        </div>
      </h3>
    </div>
    <div
      v-else
      class="content"
    >
      <h4>
        Loading...
      </h4>
    </div>
    <div class="footer">
      <Footer />
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

import DaemonService from '@/services/DaemonService';
import IDService from '@/services/IDService';

const Header = () => import('@/components/shared/Header.vue');
const Footer = () => import('@/components/shared/Footer.vue');
const Login = () => import('@/components/Login.vue');
const Daemon = () => import('@/components/Daemon.vue');
const Benchmark = () => import('@/components/Benchmark.vue');
const Node = () => import('@/components/Node.vue');
const Admin = () => import('@/components/Admin.vue');
const Apps = () => import('@/components/Apps.vue');
const Explorer = () => import('@/components/Explorer.vue');

const qs = require('qs');

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'MainPage',
  components: {
    Header, Footer, Login, Daemon, Benchmark, Node, Admin, Apps, Explorer,
  },
  data() {
    return {
      getInfoResponse: {
        status: '',
        message: '',
      },
      errorMessage: '',
      loginPhrase: '',
    };
  },
  computed: {
    ...mapState([
      'userconfig',
      'config',
      'privilage',
      'daemonSection',
      'benchmarkSection',
      'zelNodeSection',
      'adminSection',
      'appsSection',
      'explorerSection',
    ]),
  },
  mounted() {
    this.loadSession();
    this.getZelIdLoginPhrase();
    this.zelcashGetInfo();
  },
  methods: {
    async loadSession() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      this.$store.commit('setPrivilage', 'none');
      if (auth && auth.zelid && auth.signature) {
        try {
          const response = await IDService.checkUserLogged(auth.zelid, auth.signature);
          console.log(response);
          const privilege = response.data.data.message;
          this.$store.commit('setPrivilage', privilege);
          if (privilege === 'none') {
            localStorage.removeItem('zelidauth');
          }
        } catch (error) {
          console.log(error);
        }
      }
    },
    getZelIdLoginPhrase() {
      IDService.loginPhrase()
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            if (response.data.data.name === 'MongoNetworkError') {
              this.errorMessage = 'Failed to connect to MongoDB.';
            } else if (JSON.stringify(response.data.data).includes('CONN')) {
              // we can fix zelcash, zelbench problems. But cannot fix mongo, docker issues (docker may be possible to fix in the future, mongo not)...
              this.getEmergencyLoginPhrase();
            } else {
              this.errorMessage = response.data.data.message;
            }
          } else {
            this.loginPhrase = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error(error);
          this.errorMessage = 'Error connecting to Flux Backend';
        });
    },
    getEmergencyLoginPhrase() {
      IDService.emergencyLoginPhrase()
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            this.errorMessage = response.data.data.message;
          } else {
            this.loginPhrase = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error(error);
          this.errorMessage = 'Error connecting to Flux Backend';
        });
    },
    async zelcashGetInfo() {
      const response = await DaemonService.getInfo();
      this.getInfoResponse.status = response.data.status;
      this.getInfoResponse.message = response.data.data;
    },
    activeLoginPhrases() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      IDService.activeLoginPhrases(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$customMes.error(e.toString());
        });
    },
  },
};
</script>
