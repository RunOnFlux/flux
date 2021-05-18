<template>
  <div class="mainDivStyle">
    <div class="header">
      <Header :privilage="privilage" />
    </div>
    <div
      v-if="loginPhrase && getInfoResponse.status === 'success'"
      class="content"
    >
      <div v-if="privilage === 'none' && daemonSection === 'welcomeinfo'">
        <Daemon />
        <br><br>
        <Login />
      </div>
      <div v-else-if="daemonSection !== null">
        <Daemon />
      </div>
      <div v-else-if="benchmarkSection !== null">
        <Benchmark />
      </div>
      <div v-else-if="nodeSection !== null">
        <Node />
      </div>
      <div v-else-if="adminSection !== null">
        <Admin />
      </div>
      <div v-else-if="appsSection !== null">
        <Apps />
      </div>
      <div v-else-if="explorerSection !== null">
        <Explorer />
      </div>
      <div v-else-if="dashboardSection !== null">
        <Dashboard />
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
      <h3>
        Error connecting to the Flux Daemon
      </h3>
      <br>
      <div v-if="privilage === 'none'">
        <Login />
      </div>
      <div v-if="privilage ==='admin' || privilage ==='fluxteam'">
        <p>
          Please try to restart your Flux Daemon in Daemon section.
        </p>
        <div v-if="daemonSection !== null">
          <Daemon />
        </div>
        <div v-else-if="benchmarkSection !== null">
          <Benchmark />
        </div>
        <div v-else-if="nodeSection !== null">
          <Node />
        </div>
        <div v-else-if="adminSection !== null">
          <Admin />
        </div>
        <div v-else-if="appsSection !== null">
          <Apps />
        </div>
        <div v-else-if="explorerSection !== null">
          <Explorer />
        </div>
        <div v-else-if="dashboardSection !== null">
          <Dashboard />
        </div>
      </div>
      <Dashboard />
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

const Header = () => import('@/components/shared/Header');
const Footer = () => import('@/components/shared/Footer');
const Login = () => import('@/components/Login');
const Daemon = () => import('@/components/Daemon');
const Benchmark = () => import('@/components/Benchmark');
const Node = () => import('@/components/Node');
const Admin = () => import('@/components/Admin');
const Apps = () => import('@/components/Apps');
const Explorer = () => import('@/components/Explorer');
const Dashboard = () => import('@/components/Dashboard');

const qs = require('qs');

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'MainPage',
  components: {
    Header, Footer, Login, Daemon, Benchmark, Node, Admin, Apps, Explorer, Dashboard,
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
      'nodeSection',
      'adminSection',
      'appsSection',
      'explorerSection',
      'dashboardSection',
    ]),
  },
  mounted() {
    this.loadSession();
    this.getZelIdLoginPhrase();
    this.daemonGetInfo();
    if (this.$router.currentRoute.name === 'Dashboard') {
      this.$store.commit('setDashboardSection', 'dashboard');
    }
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
              // we can fix daemon, benchmark problems. But cannot fix mongo, docker issues (docker may be possible to fix in the future, mongo not)...
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
    async daemonGetInfo() {
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
