<template>
  <div class="mainDivStyle">
    <div class="header">
      <Header :privilage="privilage" />
    </div>
    <div
      v-if="loginPhrase && getInfoResponse.status === 'success'"
      class="content"
    >
      <div class="status">
        <h4>
          ZelNode owner Zel ID: {{ zelid }}
        </h4>
        <h4>
          Status: {{ getZelNodeStatusResponse.zelnodeStatus }}
        </h4>
      </div>

      <div class="getInfoResponse">
        <p>
          ZelCash version {{ getInfoResponse.message.version }}
        </p>
        <p>
          Protocol version {{ getInfoResponse.message.protocolversion }}
        </p>
        <p>
          Current Blockchain Height: {{ getInfoResponse.message.blocks }}
        </p>
        <div v-if="getInfoResponse.message.errors != ''">
          <p>
            Error: {{ getInfoResponse.message.errors }}
          </p>
        </div>
      </div>
      <br>
      <div v-if="privilage === 'none'">
        <Login />
      </div>

      <div v-if="privilage !== 'none'">
        <h4>logged privilage {{ privilage }}</h4>
        <div v-if="privilage === 'admin'">
          <ElButton
            class="loggedUsers"
            @click="loggedUsers()"
          >
            Logged Users
          </ElButton>
          <ElButton
            class="loggedUsers"
            @click="activeLoginPhrases()"
          >
            active Login Phrases
          </ElButton>
          <ElButton
            class="generalButton"
            @click="logoutCurrentSession()"
          >
            Logout current session
          </ElButton>
          <ElButton
            class="generalButton"
            @click="logoutAllSessions()"
          >
            Logout all sessions
          </ElButton>
          <ElButton
            class="generalButton"
            @click="logOutAllUsers()"
          >
            Logout all users
          </ElButton>
          <ElButton
            class="generalButton"
            @click="updateFlux()"
          >
            Update Flux
          </ElButton>
          <ElButton
            class="generalButton"
            @click="rebuildZelFront()"
          >
            Rebuild ZelFront
          </ElButton>
          <ElButton
            class="generalButton"
            @click="sayhi()"
          >
            Say Hi
          </ElButton>
        </div>
        <div v-if="privilage === 'user'">
          <ElButton
            class="generalButton"
            @click="logoutCurrentSession()"
          >
            Logout current session
          </ElButton>
          <ElButton
            class="generalButton"
            @click="logoutAllSessions()"
          >
            Logout all sessions
          </ElButton>
        </div>
        <div v-if="privilage === 'zelteam'">
          <ElButton
            class="generalButton"
            @click="logoutCurrentSession()"
          >
            Logout current session
          </ElButton>
          <ElButton
            class="generalButton"
            @click="logoutAllSessions()"
          >
            Logout all sessions
          </ElButton>
          <ElButton
            class="generalButton"
            @click="updateFlux()"
          >
            Update Flux
          </ElButton>
          <ElButton
            class="generalButton"
            @click="rebuildZelFront()"
          >
            Rebuild ZelFront
          </ElButton>
        </div>
      </div>
    </div>
    <div
      v-else-if="loginPhrase === ''"
      class="content"
    >
      <div v-if="errorMessage !== ''">
        <h4>
          {{ errorMessage }}
        </h4>
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
      <h4>
        Error connecting to ZelCash daemon
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
import axios from 'axios';

// eslint-disable-next-line import/no-unresolved
import ZelCashService from '@/services/ZelCashService';
// eslint-disable-next-line import/no-unresolved
import zelIDService from '@/services/ZelIDService';
// eslint-disable-next-line import/no-unresolved
import zelnodeService from '@/services/zelnodeService';

const Header = () => import('@/components/shared/Header.vue');
const Footer = () => import('@/components/shared/Footer.vue');
const Login = () => import('@/components/Login.vue');

const qs = require('qs');
const packageJson = require('../../../package.json');


Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'MainPage',
  components: { Header, Footer, Login },
  data() {
    return {
      getInfoResponse: {
        status: '',
        message: '',
      },
      getZelNodeStatusResponse: {
        status: '',
        message: '',
        zelnodeStatus: 'Checking status...',
      },
      errorMessage: '',
      version: packageJson.version,
    };
  },
  computed: {
    ...mapState([
      'userconfig',
      'config',
      'privilage',
      'loginPhrase',
    ]),
  },
  mounted() {
    this.getZelIdLoginPhrase();
    this.getLatestFluxVersion();
    this.loadSession();
    this.zelcashGetInfo();
    this.zelcashGetZelNodeStatus();
  },
  methods: {
    loadSession() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      this.$store.commit('setPrivilage', 'none');
      if (auth) {
        if (auth.zelid) {
          if (auth.zelid === this.config.zelTeamZelId) {
            this.$store.commit('setPrivilage', 'zelteam');
          } else if (auth.zelid === this.userconfig.zelid) {
            this.$store.commit('setPrivilage', 'admin');
          } else if (auth.zelid.length > 24) { // very basic check that does the job needed
            this.$store.commit('setPrivilage', 'user');
          }
        }
      }
    },
    getZelIdLoginPhrase() {
      zelIDService.loginPhrase()
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            this.errorMessage = response.data.data.message;
          } else {
            this.$store.commit('setLoginPhrase', response.data);
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error(error);
          this.errorMessage = 'Error connecting to ZelBack';
        });
    },
    async zelcashGetInfo() {
      const response = await ZelCashService.getInfo();
      this.getInfoResponse.status = response.data.status;
      this.getInfoResponse.message = response.data.data;
    },
    async zelcashGetZelNodeStatus() {
      // TODO
      const response = await ZelCashService.getZelNodeStatus();
      this.getZelNodeStatusResponse.status = response.data.status;
      this.getZelNodeStatusResponse.message = response.data.data;
      console.log(this.getZelNodeStatusResponse.message);
      if (this.getZelNodeStatusResponse.message) {
        if (this.getZelNodeStatusResponse.message.status === 4) {
          this.getZelNodeStatusResponse.zelnodeStatus = 'ZelNode is working correctly';
        } else {
          const statusCode = this.getZelNodeStatusResponse.message.code || this.getZelNodeStatusResponse.message.status;
          this.getZelNodeStatusResponse.zelnodeStatus = `Error status code: ${statusCode}. ZelNode not yet active. Flux is running with limited capabilities.`;
        }
      }
    },
    loggedUsers() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      zelIDService.loggedUsers(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$message.error(e.toString());
        });
    },
    logoutCurrentSession() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      zelIDService.logoutCurrentSession(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
          } else {
            localStorage.removeItem('zelidauth');
            this.$store.commit('setPrivilage', 'none');
            vue.$message.success(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$message.error(e.toString());
        });
    },
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
            this.$store.commit('setPrivilage', 'none');
            vue.$message.success(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$message.error(e.toString());
        });
    },
    logOutAllUsers() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      zelIDService.logoutAllUsers(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
          } else {
            localStorage.removeItem('zelidauth');
            this.$store.commit('setPrivilage', 'none');
            vue.$message.success(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$message.error(e.toString());
        });
    },
    activeLoginPhrases() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      zelIDService.activeLoginPhrases(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$message.error(e.toString());
        });
    },
    updateFlux() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      vue.$message.success('Flux is now updating in the background');
      zelnodeService.updateFlux(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$message.error(e.toString());
        });
    },
    rebuildZelFront() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      vue.$message.success('ZelFront is now rebuilding in the background');
      zelnodeService.rebuildZelFront(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          vue.$message.error(e.toString());
        });
    },
    getLatestFluxVersion() {
      const self = this;
      axios.get('https://raw.githubusercontent.com/zelcash/zelnoded/master/package.json')
        .then((response) => {
          console.log(response);
          if (response.data.version !== self.version) {
            vue.$message.warning('Flux requires an update!');
          } else {
            vue.$message.success('Flux is up to date');
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error verifying recent version');
        });
    },
    sayhi() {
      this.$router.push({
        name: 'Home',
      });
    },
  },
};
</script>
