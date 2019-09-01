<template>
  <div class="loginSection">
    <p>
      Log in using Zel ID
    </p>
    <div>
      <a
        @click="initiateLoginWS"
        :href="'zel:?action=sign&message=' + loginPhrase + '&icon=http%3A%2F%2Fzelid.io%2Fimg%2FzelID.svg&callback=http%3A%2F%2F' + userconfig.externalip + ':' + config.apiPort + '%2Fzelid%2Fverifylogin%2F'"
      >
        <img
          class="zelidLogin"
          src="@/assets/img/zelID.svg"
        />
      </a>
    </div>

    <p>
      or sign the following message with any bitcoin address.
    </p>
    <ElForm
      :model="loginForm"
      class="loginForm"
    >
      <ElFormItem>
        <ElInput
          type="text"
          name="message"
          placeholder="message"
          v-model="loginForm.message"
          disabled
        >
          <template slot="prepend">Message: </template>
        </ElInput>
      </ElFormItem>
      <ElFormItem>
        <ElInput
          type="text"
          name="address"
          placeholder="insert bitcoin address"
          v-model="loginForm.address"
        >
          <template slot="prepend">Address: </template>
        </ElInput>
      </ElFormItem>
      <ElFormItem>
        <ElInput
          type="text"
          name="signature"
          placeholder="insert signature"
          v-model="loginForm.signature"
        >
          <template slot="prepend">Signature: </template>
        </ElInput>
      </ElFormItem>
      <ElButton
        class="generalButton"
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

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'Login',
  data() {
    return {
      loginForm: {
        address: '',
        signature: '',
        message: '',
      },
      loginphrase: null,
      websocket: null,
      errorMessage: '',
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
    ]),
  },
  mounted() {
    const isChrome = !!window.chrome;
    if (!isChrome) {
      vue.$message({
        message: 'Your browser does not support Flux websocket support. Logging with Zel ID is not available. For optional experience use Chrome browser.',
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
            this.errorMessage = response.data.data.message;
          } else {
            this.loginPhrase = response.data;
            this.loginForm.message = response.data;
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error(error);
          this.errorMessage = 'Error connecting to ZelBack';
        });
    },
    login() {
      console.log(this.loginForm);
      zelIDService.verifyLogin(this.loginForm)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'success' && response.data.data) {
            // we are now signed. Store our values
            const zelidauth = {
              zelid: this.loginForm.address,
              signature: this.loginForm.signature,
            };
            this.$store.commit('setPrivilage', response.data.data.privilage);
            localStorage.setItem('zelidauth', qs.stringify(zelidauth));
            vue.$message.success(response.data.data.message);
          } else {
            vue.$message.error(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$message.error(e.toString());
        });
    },
    initiateLoginWS() {
      const self = this;
      const wsuri = `ws://${this.userconfig.externalip}:${this.config.apiPort}/ws/zelid/${this.loginPhrase}`;
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
        // we are now signed. Store our values
        const zelidauth = {
          zelid: data.data.zelid,
          signature: data.data.signature,
        };
        this.$store.commit('setPrivilage', data.data.privilage);
        localStorage.setItem('zelidauth', qs.stringify(zelidauth));
        vue.$message.success(data.data.message);
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
