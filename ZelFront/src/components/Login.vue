<template>
  <div class="loginSection">
    <p>
      Please log in using Zel ID
    </p>
    <div>
      <a
        @click="initiateLoginWS"
        :href="'zel:?action=sign&message=' + loginPhrase + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Fzelcash%2Fzelflux%2Fmaster%2FZelFront%2Fsrc%2Fassets%2Fimg%2FzelID.svg&callback=' + callbackValue"
      >
        <img
          class="zelidLogin"
          src="@/assets/img/zelID.svg"
        />
      </a>
    </div>

    <p>
      or sign the following message with any Bitcoin address.
    </p>
    <ElForm
      :model="loginForm"
      class="loginForm"
    >
      <ElFormItem>
        <ElInput
          type="text"
          name="message"
          placeholder="insert Login Phrase"
          v-model="loginForm.loginPhrase"
        >
          <template slot="prepend">Message: </template>
        </ElInput>
      </ElFormItem>
      <ElFormItem>
        <ElInput
          type="text"
          name="address"
          placeholder="insert Zel ID or Bitcoin address"
          v-model="loginForm.zelid"
        >
          <template slot="prepend">Address: </template>
        </ElInput>
      </ElFormItem>
      <ElFormItem>
        <ElInput
          type="text"
          name="signature"
          placeholder="insert Signature"
          v-model="loginForm.signature"
        >
          <template slot="prepend">Signature: </template>
        </ElInput>
      </ElFormItem>
      <ElButton
        @click="login()"
      >
        Login
      </ElButton>
    </ElForm>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

import zelIDService from '@/services/ZelIDService';

const qs = require('qs');
const store = require('store');

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'Login',
  data() {
    return {
      loginForm: {
        zelid: '',
        signature: '',
        loginPhrase: '',
      },
      loginPhrase: null,
      websocket: null,
      errorMessage: '',
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
    ]),
    callbackValue() {
      const { protocol, hostname } = window.location;
      let mybackend = '';
      mybackend += protocol;
      mybackend += '//';
      const regex = /[A-Za-z]/g;
      if (hostname.match(regex)) {
        const names = hostname.split('.');
        names[0] = 'api';
        mybackend += names.join('.');
      } else {
        mybackend += this.userconfig.externalip;
        mybackend += ':';
        mybackend += this.config.apiPort;
      }
      const backendURL = store.get('backendURL') || mybackend;
      const url = `${backendURL}/zelid/verifylogin`;
      return encodeURI(url);
    },
  },
  mounted() {
    const isChrome = !!window.chrome;
    if (!isChrome) {
      vue.$customMes({
        message: 'Your browser does not support Flux websockets. Logging in with Zel ID is not possible. For an optimal experience, please use Chrome or Edge',
        type: 'warning',
        duration: 0,
        showClose: true,
      });
    }
    this.getZelIdLoginPhrase();
  },
  methods: {
    getZelIdLoginPhrase() {
      zelIDService.loginPhrase()
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            if (JSON.stringify(response.data.data).includes('CONN')) {
              // we can fix zelcash, zelbench problems. But cannot fix mongo, docker issues (docker may be possible to fix in the future, mongo not)...
              this.getEmergencyLoginPhrase();
            } else {
              this.errorMessage = response.data.data.message;
            }
          } else {
            this.loginPhrase = response.data.data;
            this.loginForm.loginPhrase = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error(error);
          this.errorMessage = 'Error connecting to ZelBack';
        });
    },
    getEmergencyLoginPhrase() {
      zelIDService.emergencyLoginPhrase()
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            this.errorMessage = response.data.data.message;
          } else {
            this.loginPhrase = response.data.data;
            this.loginForm.loginPhrase = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error(error);
          this.errorMessage = 'Error connecting to ZelBack';
        });
    },
    login() {
      console.log(this.loginForm);
      zelIDService.verifyLogin(this.loginForm)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'success') {
            // user is  now signed. Store their values
            const zelidauth = {
              zelid: this.loginForm.zelid,
              signature: this.loginForm.signature,
              loginPhrase: this.loginForm.loginPhrase,
            };
            this.$store.commit('setPrivilage', response.data.data.privilage);
            localStorage.setItem('zelidauth', qs.stringify(zelidauth));
            vue.$customMes.success(response.data.data.message);
          } else {
            vue.$customMes({
              type: response.data.status,
              message: response.data.data.message || response.data.data,
            });
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$customMes.error(e.toString());
        });
    },
    initiateLoginWS() {
      const self = this;
      const { protocol, hostname } = window.location;
      let mybackend = '';
      mybackend += protocol;
      mybackend += '//';
      const regex = /[A-Za-z]/g;
      if (hostname.match(regex)) {
        const names = hostname.split('.');
        names[0] = 'api';
        mybackend += names.join('.');
      } else {
        mybackend += this.userconfig.externalip;
        mybackend += ':';
        mybackend += this.config.apiPort;
      }
      let backendURL = store.get('backendURL') || mybackend;
      backendURL = backendURL.replace('https://', 'wss://');
      backendURL = backendURL.replace('http://', 'ws://');
      const wsuri = `${backendURL}/ws/zelid/${this.loginPhrase}`;
      const websocket = new WebSocket(wsuri);
      this.websocket = websocket;

      websocket.onopen = (evt) => { self.onOpen(evt); };
      websocket.onclose = (evt) => { self.onClose(evt); };
      websocket.onmessage = (evt) => { self.onMessage(evt); };
      websocket.onerror = (evt) => { self.onError(evt); };
    },
    onError(evt) {
      console.log(evt);
    },
    onMessage(evt) {
      const data = qs.parse(evt.data);
      if (data.status === 'success' && data.data) {
        // user is now signed. Store their values
        const zelidauth = {
          zelid: data.data.zelid,
          signature: data.data.signature,
          loginPhrase: data.data.loginPhrase,
        };
        this.$store.commit('setPrivilage', data.data.privilage);
        localStorage.setItem('zelidauth', qs.stringify(zelidauth));
        vue.$customMes.success(data.data.message);
      }
      console.log(data);
      console.log(evt);
    },
    onClose(evt) {
      console.log(evt);
    },
    onOpen(evt) {
      console.log(evt);
    },
  },
};
</script>
