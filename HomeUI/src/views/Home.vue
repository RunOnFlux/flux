<template>
  <div>
    <b-card title="FluxOS - Node Details">
      <list-entry
        title="Flux owner ZelID"
        :data="userconfig.zelid"
      />
      <list-entry
        title="Status"
        :data="getNodeStatusResponse.nodeStatus"
        :variant="getNodeStatusResponse.class"
      />
      <list-entry
        v-if="getInfoResponse.message !== ''"
        title="Daemon Version"
        :data="getInfoResponse.message.version.toString()"
      />
      <list-entry
        v-if="getInfoResponse.message !== ''"
        title="Protocol Version"
        :data="getInfoResponse.message.protocolversion.toString()"
      />
      <list-entry
        v-if="getInfoResponse.message !== ''"
        title="Current Blockchain Height"
        :data="getInfoResponse.message.blocks.toString()"
      />
      <list-entry
        v-if="getInfoResponse.status.length > 0 && getInfoResponse.message.errors != ''"
        title="Error"
        :data="getInfoResponse.message.errors"
        variant="danger"
      />
    </b-card>

    <b-card v-if="privilege === 'none'">
      <b-card-title>Log In</b-card-title>
      <dl class="row">
        <dd class="col-sm-4">
          <b-card-text class="text-center">
            Please log in using ZelID
          </b-card-text>
          <a
            :href="'zel:?action=sign&message=' + loginPhrase + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FZelFront%2Fsrc%2Fassets%2Fimg%2FzelID.svg&callback=' + callbackValue"
            @click="initiateLoginWS"
          >
            <img
              class="zelidLogin"
              src="@/assets/images/zelID.svg"
              alt="Zel ID"
              height="100%"
              width="100%"
            >
          </a>
        </dd>
        <dd class="col-sm-8">
          <b-card-text class="text-center">
            or sign the following message with any Bitcoin address
          </b-card-text>
          <b-form
            class="mx-5"
            @submit.prevent
          >
            <b-row>
              <b-col cols="12">
                <b-form-group
                  label="Message"
                  label-for="h-message"
                  label-cols-md="3"
                >
                  <b-form-input
                    id="h-message"
                    v-model="loginForm.loginPhrase"
                    placeholder="Insert Login Phrase"
                  />
                </b-form-group>
              </b-col>
              <b-col cols="12">
                <b-form-group
                  label="Address"
                  label-for="h-address"
                  label-cols-md="3"
                >
                  <b-form-input
                    id="h-address"
                    v-model="loginForm.zelid"
                    placeholder="Insert ZelID or Bitcoin address"
                  />
                </b-form-group>
              </b-col>
              <b-col cols="12">
                <b-form-group
                  label="Signature"
                  label-for="h-signature"
                  label-cols-md="3"
                >
                  <b-form-input
                    id="h-signature"
                    v-model="loginForm.signature"
                    placeholder="Insert Signature"
                  />
                </b-form-group>
              </b-col>

              <!-- submit and reset -->
              <b-col offset-md="5">
                <b-button
                  type="submit"
                  variant="primary"
                  class="mr-1"
                  @click="login"
                >
                  Login
                </b-button>
              </b-col>
            </b-row>
          </b-form>
        </dd>
      </dl>
    </b-card>
  </div>
</template>

<script>
import {
  BCard, BCardText, BCardTitle, BButton, BForm, BCol, BRow, BFormInput, BFormGroup,
} from 'bootstrap-vue';
import { mapState } from 'vuex';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ListEntry from '@/views/components/ListEntry.vue';

import DaemonService from '@/services/DaemonService';
import IDService from '@/services/IDService';

const qs = require('qs');
const store = require('store');

export default {
  components: {
    BCard,
    BCardText,
    BCardTitle,
    BButton,
    BForm,
    BCol,
    BRow,
    BFormInput,
    BFormGroup,
    ListEntry,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  data() {
    return {
      getInfoResponse: {
        status: '',
        message: '',
      },
      getNodeStatusResponse: {
        class: 'text-success',
        status: '',
        data: '',
        nodeStatus: 'Checking status...',
      },
      websocket: null,
      errorMessage: '',
      loginPhrase: '',
      loginForm: {
        zelid: '',
        signature: '',
        loginPhrase: '',
      },
    };
  },
  computed: {
    ...mapState('flux', [
      'userconfig',
      'config',
      'privilege',
    ]),
    callbackValue() {
      const backendURL = this.backendURL();
      const url = `${backendURL}/zelid/verifylogin`;
      return encodeURI(url);
    },
  },
  mounted() {
    this.daemonGetInfo();
    this.daemonWelcomeGetZelNodeStatus();
    this.getZelIdLoginPhrase();
  },
  methods: {
    backendURL() {
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
      return store.get('backendURL') || mybackend;
    },
    async daemonGetInfo() {
      const response = await DaemonService.getInfo();
      this.getInfoResponse.status = response.data.status;
      this.getInfoResponse.message = response.data.data;
    },
    async daemonWelcomeGetZelNodeStatus() {
      const response = await DaemonService.getZelNodeStatus();
      this.getNodeStatusResponse.status = response.data.status;
      this.getNodeStatusResponse.data = response.data.data;
      if (this.getNodeStatusResponse.data) {
        if (this.getNodeStatusResponse.data.status === 'CONFIRMED' || this.getNodeStatusResponse.data.location === 'CONFIRMED') {
          this.getNodeStatusResponse.nodeStatus = 'Flux is working correctly';
          this.getNodeStatusResponse.class = 'success';
        } else if (this.getNodeStatusResponse.data.status === 'STARTED' || this.getNodeStatusResponse.data.location === 'STARTED') {
          this.getNodeStatusResponse.nodeStatus = 'Flux has just been started. Flux is running with limited capabilities.';
          this.getNodeStatusResponse.class = 'warning';
        } else {
          this.getNodeStatusResponse.nodeStatus = 'Flux is not confirmed. Flux is running with limited capabilities.';
          this.getNodeStatusResponse.class = 'danger';
        }
      }
    },
    initiateLoginWS() {
      const self = this;
      let backendURL = this.backendURL();
      backendURL = backendURL.replace('https://', 'wss://');
      backendURL = backendURL.replace('http://', 'ws://');
      const wsuri = `${backendURL}/ws/id/${this.loginPhrase}`;
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
      console.log(data);
      if (data.status === 'success' && data.data) {
        // user is now signed. Store their values
        const zelidauth = {
          zelid: data.data.zelid,
          signature: data.data.signature,
          loginPhrase: data.data.loginPhrase,
        };
        this.$store.commit('flux/setPrivilege', data.data.privilage);
        localStorage.setItem('zelidauth', qs.stringify(zelidauth));
        this.showToast('success', data.data.message);
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
    showToast(variant, title) {
      this.$toast({
        component: ToastificationContent,
        props: {
          title,
          icon: 'BellIcon',
          variant,
        },
      });
    },
    getZelIdLoginPhrase() {
      IDService.loginPhrase()
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            if (JSON.stringify(response.data.data).includes('CONN')) {
              // we can fix daemon, benchmark problems. But cannot fix mongo, docker issues (docker may be possible to fix in the future, mongo not)...
              this.getEmergencyLoginPhrase();
            } else {
              this.showToast('danger', response.data.data.message);
            }
          } else {
            this.loginPhrase = response.data.data;
            this.loginForm.loginPhrase = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', error);
        });
    },
    getEmergencyLoginPhrase() {
      IDService.emergencyLoginPhrase()
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message);
          } else {
            this.loginPhrase = response.data.data;
            this.loginForm.loginPhrase = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', error);
        });
    },
    getVariant(status) {
      if (status === 'error') {
        return 'danger';
      }
      if (status === 'message') {
        return 'info';
      }
      return status;
    },
    login() {
      console.log(this.loginForm);
      IDService.verifyLogin(this.loginForm)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'success') {
            // user is  now signed. Store their values
            const zelidauth = {
              zelid: this.loginForm.zelid,
              signature: this.loginForm.signature,
              loginPhrase: this.loginForm.loginPhrase,
            };
            this.$store.commit('flux/setPrivilege', response.data.data.privilage);
            localStorage.setItem('zelidauth', qs.stringify(zelidauth));
            this.showToast('success', response.data.data.message);
          } else {
            this.showToast(this.getVariant(response.data.status), response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          this.showToast('danger', e.toString());
        });
    },
  },
};
</script>

<style>
.zelidLogin {
  height: 100px;
}
.zelidLogin img {
  -webkit-app-region: no-drag;
  transition: 0.1s;
}

a img {
  transition: all 0.05s ease-in-out;
}

a:hover img {
  filter: opacity(70%);
  transform: scale(1.1);
}
</style>
