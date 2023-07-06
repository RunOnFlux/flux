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
        title="Static Ip ISP/Org"
        :data="staticIp ? 'Yes': 'No'"
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
            Please log in using
          </b-card-text>
          <a
            :href="'zel:?action=sign&message=' + loginPhrase + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=' + callbackValue"
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
          <a
            @click="initWalletConnect"
          >
            <img
              class="walletconnectLogin"
              src="@/assets/images/walletconnect.svg"
              alt="WalletConnect"
              height="100%"
              width="100%"
            >
          </a>
          <a
            @click="initMetamask"
          >
            <img
              class="metamaskLogin"
              src="@/assets/images/metamask.svg"
              alt="Metamask"
              height="100%"
              width="100%"
            >
          </a>
        </dd>
        <dd class="col-sm-8">
          <b-card-text class="text-center">
            or sign the following message with any ZelID/Bitcoin/Ethereum address
          </b-card-text>
          <br><br>
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
import SignClient from '@walletconnect/sign-client';
import { WalletConnectModal } from '@walletconnect/modal';
import { MetaMaskSDK } from '@metamask/sdk';

import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ListEntry from '@/views/components/ListEntry.vue';

import DaemonService from '@/services/DaemonService';
import IDService from '@/services/IDService';
import FluxService from '../services/FluxService';

const projectId = 'df787edc6839c7de49d527bba9199eaa';

const walletConnectOptions = {
  projectId,
  metadata: {
    name: 'Flux Cloud',
    description: 'Flux, Your Gateway to a Decentralized World',
    url: 'https://home.runonflux.io',
    icons: ['https://home.runonflux.io/img/logo.png'],
  },
};
const walletConnectModal = new WalletConnectModal(walletConnectOptions);

const metamaskOptions = {
  enableDebug: true,
};
const MMSDK = new MetaMaskSDK(metamaskOptions);
const ethereum = MMSDK.getProvider();

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
      staticIp: false,
      walletConnectButton: {
        disabled: false,
      },
      signClient: null,
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
      const url = `${backendURL}/id/verifylogin`;
      return encodeURI(url);
    },
  },
  mounted() {
    this.daemonGetInfo();
    this.daemonWelcomeGetFluxNodeStatus();
    this.getZelIdLoginPhrase();
    this.getOwnerZelid();
    this.getStaticIpInfo();
  },
  methods: {
    backendURL() {
      const { protocol, hostname, port } = window.location;
      let mybackend = '';
      mybackend += protocol;
      mybackend += '//';
      const regex = /[A-Za-z]/g;
      if (hostname.match(regex)) {
        const names = hostname.split('.');
        names[0] = 'api';
        mybackend += names.join('.');
      } else {
        if (typeof hostname === 'string') {
          this.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          this.$store.commit('flux/setFluxPort', apiPort);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += this.config.apiPort;
      }
      return store.get('backendURL') || mybackend;
    },
    async getOwnerZelid() {
      const response = await FluxService.getZelid();
      const obtainedZelid = response.data.data;
      if (response.data.status === 'success' && typeof obtainedZelid === 'string') {
        this.$store.commit('flux/setUserZelid', obtainedZelid);
      }
    },
    async getStaticIpInfo() {
      const response = await FluxService.getStaticIpInfo();
      console.log(response);
      if (response.data.status === 'success') {
        this.staticIp = response.data.data;
      }
    },
    async daemonGetInfo() {
      const response = await DaemonService.getInfo();
      this.getInfoResponse.status = response.data.status;
      this.getInfoResponse.message = response.data.data;
    },
    async daemonWelcomeGetFluxNodeStatus() {
      const response = await DaemonService.getFluxNodeStatus();
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
        this.$store.commit('flux/setZelid', zelidauth.zelid);
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
            // we can fix daemon, benchmark problems. But cannot fix mongo, docker issues (docker may be possible to fix in the future, mongo not)...
            this.getEmergencyLoginPhrase();
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
            this.$store.commit('flux/setZelid', zelidauth.zelid);
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
    async onSessionConnect(session) {
      console.log(session);
      // const msg = `0x${Buffer.from(this.loginPhrase, 'utf8').toString('hex')}`;
      const result = await this.signClient.request({
        topic: session.topic,
        chainId: 'eip155:1',
        request: {
          method: 'personal_sign',
          params: [
            this.loginPhrase,
            session.namespaces.eip155.accounts[0].split(':')[2],
          ],
        },
      });
      console.log(result);
      const walletConnectInfo = {
        zelid: session.namespaces.eip155.accounts[0].split(':')[2],
        signature: result,
        loginPhrase: this.loginPhrase,
      };
      const response = await IDService.verifyLogin(walletConnectInfo);
      console.log(response);
      if (response.data.status === 'success') {
        // user is  now signed. Store their values
        const zelidauth = walletConnectInfo;
        this.$store.commit('flux/setPrivilege', response.data.data.privilage);
        this.$store.commit('flux/setZelid', zelidauth.zelid);
        localStorage.setItem('zelidauth', qs.stringify(zelidauth));
        this.showToast('success', response.data.data.message);
      } else {
        this.showToast(this.getVariant(response.data.status), response.data.data.message || response.data.data);
      }
    },
    onSessionUpdate(session) {
      console.log(session);
    },
    async initWalletConnect() {
      const self = this;
      if (this.walletConnectButton.disabled) {
        return;
      }
      try {
        this.walletConnectButton.disabled = true;
        const signClient = await SignClient.init(walletConnectOptions);
        this.signClient = signClient;
        const lastKeyIndex = signClient.session.getAll().length - 1;
        const lastSession = signClient.session.getAll()[lastKeyIndex];
        this.onSessionConnect(lastSession);
        // await this.signClient.ping({ topic: lastSession.topic });
        signClient.on('session_event', ({ event }) => {
          console.log(event);
          // Handle session events, such as "chainChanged", "accountsChanged", etc.
        });

        signClient.on('session_update', ({ topic, params }) => {
          const { namespaces } = params;
          // eslint-disable-next-line no-underscore-dangle
          const _session = signClient.session.get(topic);
          // Overwrite the `namespaces` of the existing session with the incoming one.
          const updatedSession = { ..._session, namespaces };
          // Integrate the updated session state into your dapp state.
          self.onSessionUpdate(updatedSession);
        });

        signClient.on('session_delete', () => {
          // Session was deleted -> reset the dapp state, clean up from user session, etc.
        });

        const { uri, approval } = await signClient.connect({
          // Provide the namespaces and chains (e.g. `eip155` for EVM-based chains) we want to use in this session.
          requiredNamespaces: {
            eip155: {
              methods: [
                'personal_sign',
              ],
              chains: ['eip155:1'],
              events: ['chainChanged', 'accountsChanged'],
            },
          },
        });

        // Open QRCode modal if a URI was returned (i.e. we're not connecting an existing pairing).
        if (uri) {
          walletConnectModal.openModal({ uri });
          // Await session approval from the wallet.
          const session = await approval();
          // Handle the returned session (e.g. update UI to "connected" state).
          // * You will need to create this function *
          this.onSessionConnect(session);
          // Close the QRCode modal in case it was open.
          walletConnectModal.closeModal();
        }
      } catch (err) {
        console.error(err);
      } finally {
        this.walletConnectButton.disabled = false;
      }
    },
    async siwe(siweMessage, from) {
      try {
        const msg = `0x${Buffer.from(siweMessage, 'utf8').toString('hex')}`;
        const sign = await ethereum.request({
          method: 'personal_sign',
          params: [msg, from],
        });
        console.log(sign); // this is signature
        const metamaskLogin = {
          zelid: from,
          signature: sign,
          loginPhrase: this.loginPhrase,
        };
        const response = await IDService.verifyLogin(metamaskLogin);
        console.log(response);
        if (response.data.status === 'success') {
          // user is  now signed. Store their values
          const zelidauth = metamaskLogin;
          this.$store.commit('flux/setPrivilege', response.data.data.privilage);
          this.$store.commit('flux/setZelid', zelidauth.zelid);
          localStorage.setItem('zelidauth', qs.stringify(zelidauth));
          this.showToast('success', response.data.data.message);
        } else {
          this.showToast(this.getVariant(response.data.status), response.data.data.message || response.data.data);
        }
      } catch (error) {
        console.error(error); // rejection occured
        this.showToast('danger', error.message);
      }
    },
    async initMetamask() {
      try {
        if (!ethereum) {
          this.showToast('danger', 'Metamask not detected');
          return;
        }
        let account;
        if (ethereum && !ethereum.selectedAddress) {
          const accounts = await ethereum.request({ method: 'eth_requestAccounts', params: [] });
          console.log(accounts);
          account = accounts[0];
        } else {
          account = ethereum.selectedAddress;
        }
        this.siwe(this.loginPhrase, account);
      } catch (error) {
        this.showToast('danger', error.message);
      }
    },
  },
};
</script>

<style>
.zelidLogin {
  height: 90px;
  padding: 10px;
}
.zelidLogin img {
  -webkit-app-region: no-drag;
  transition: 0.1s;
}

.walletconnectLogin {
  height: 100px;
  padding: 10px;
}
.walletconnectLogin img {
  -webkit-app-region: no-drag;
  transition: 0.1s;
}

.metamaskLogin {
  height: 80px;
  padding: 10px;
}
.metamaskLogin img {
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
