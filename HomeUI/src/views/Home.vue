<template>
  <div>
    <b-card title="Welcome to Flux - The biggest decentralized computational network">
      <list-entry
        title="Dashboard"
        :data="dashboard"
      />
      <list-entry
        title="Applications"
        :data="applications"
      />
      <list-entry
        title="XDAO"
        :data="xdao"
      />
      <list-entry
        title="Administration"
        :data="administration"
      />
      <list-entry
        title="Node Status"
        :data="getNodeStatusResponse.nodeStatus"
        :variant="getNodeStatusResponse.class"
      />
    </b-card>

    <b-card v-if="privilege === 'none'">
      <b-card-title>Automated Login</b-card-title>
      <dl class="row">
        <dd class="col-sm-6">
          <b-tabs content-class="mt-0">
            <b-tab title="3rd Party Login" active>
              <div class="ssoLogin">
                <div id="ssoLoading">
                  <b-spinner variant="primary" />
                  <div>
                    Loading Sign In Options
                  </div>
                </div>
                <div
                  id="ssoLoggedIn"
                  style="display: none"
                >
                  <b-spinner variant="primary" />
                  <div>
                    Finishing Login Process
                  </div>
                </div>
                <div id="ssoVerify" style="display: none">
                  <b-button class="mb-2" variant="primary" type="submit" @click="cancelVerification">
                    Cancel Verification
                  </b-button>
                  <div>
                    <b-spinner variant="primary" />
                    <div>
                      Finishing Verification Process
                    </div>
                    <div>
                      <i>Please check email for verification link.</i>
                    </div>
                  </div>
                </div>
                <div id="firebaseui-auth-container" />
              </div>
            </b-tab>
            <b-tab title="Email/Password">
              <dl class="row">
                <dd class="col-sm-12 mt-1">
                  <b-form
                    id="emailLoginForm"
                    ref="emailLoginForm"
                    class="mx-5"
                    @submit.prevent
                  >
                    <b-row>
                      <b-col cols="12">
                        <b-form-group
                          label="Email"
                          label-for="h-email"
                          label-cols-md="4"
                        >
                          <b-form-input
                            id="h-email"
                            v-model="emailForm.email"
                            type="email"
                            placeholder="Email..."
                            required
                          />
                        </b-form-group>
                      </b-col>
                      <b-col cols="12">
                        <b-form-group
                          label="Password"
                          label-for="h-password"
                          label-cols-md="4"
                        >
                          <b-form-input
                            id="h-password"
                            v-model="emailForm.password"
                            type="password"
                            placeholder="Password..."
                            required
                          />
                        </b-form-group>
                      </b-col>
                      <b-col cols="12">
                        <b-form-group label-cols-md="4">
                          <b-button
                            type="submit"
                            variant="primary"
                            class="w-100"
                            @click="emailLogin"
                          >
                            <div id="emailLoginProcessing" style="display: none">
                              <b-spinner variant="secondary" small />
                            </div>
                            <div id="emailLoginExecute">
                              Login
                            </div>
                          </b-button>
                        </b-form-group>
                      </b-col>
                      <b-col cols="12">
                        <b-form-group label-cols-md="4">
                          <b-button
                            id="signUpButton"
                            v-b-modal.modal-prevent-closing
                            type="submit"
                            variant="secondary"
                            class="w-100"
                            @click="createAccount"
                          >
                            Sign Up
                          </b-button>
                        </b-form-group>
                      </b-col>
                    </b-row>
                  </b-form>
                  <div id="ssoEmailVerify" class="text-center" style="display: none">
                    <b-button class="mb-2" variant="primary" type="submit" @click="cancelVerification">
                      Cancel Verification
                    </b-button>
                    <div>
                      <b-spinner variant="primary" />
                      <div>
                        Finishing Verification Process
                      </div>
                      <div>
                        <i>Please check email for verification link.</i>
                      </div>
                    </div>
                  </div>
                </dd>
              </dl>
            </b-tab>
          </b-tabs>
        </dd>
        <dd class="col-sm-6">
          <b-card-text class="text-center loginText">
            Decentralized Login
          </b-card-text>
          <div class="loginRow">
            <a
              title="Login with Zelcore"
              @click="initiateLoginWS"
            >
              <img
                class="walletIcon"
                src="@/assets/images/FluxID.svg"
                alt="Flux ID"
                height="100%"
                width="100%"
              >
            </a>
            <a
              title="Login with SSP"
              @click="initSSP"
            >
              <img
                class="walletIcon"
                :src="skin === 'dark' ? require('@/assets/images/ssp-logo-white.svg') : require('@/assets/images/ssp-logo-black.svg')"
                alt="SSP"
                height="100%"
                width="100%"
              >
            </a>
          </div>
          <div class="loginRow">
            <a
              title="Login with WalletConnect"
              @click="initWalletConnect"
            >
              <img
                class="walletIcon"
                src="@/assets/images/walletconnect.svg"
                alt="WalletConnect"
                height="100%"
                width="100%"
              >
            </a>
            <a
              title="Login with Metamask"
              @click="initMetamask"
            >
              <img
                class="walletIcon"
                src="@/assets/images/metamask.svg"
                alt="Metamask"
                height="100%"
                width="100%"
              >
            </a>
          </div>
        </dd>
      </dl>
    </b-card>

    <b-card v-if="privilege === 'none'">
      <b-card-title>Manual Login</b-card-title>
      <dl class="row">
        <dd class="col-sm-12">
          <b-card-text class="text-center">
            Sign the following message with any Flux ID / SSP Wallet ID / Bitcoin / Ethereum address
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
                    placeholder="Insert Flux ID or Bitcoin address"
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
              <b-col cols="12">
                <b-form-group label-cols-md="3">
                  <b-button
                    type="submit"
                    variant="primary"
                    class="w-100"
                    @click="login"
                  >
                    Login
                  </b-button>
                </b-form-group>
              </b-col>
            </b-row>
          </b-form>
        </dd>
      </dl>
    </b-card>
    <b-modal
      id="modal-prevent-closing"
      ref="modal"
      title="Create Flux SSO Account"
      header-bg-variant="primary"
      title-class="modal-title"
      @show="resetModal"
      @hidden="resetModal"
      @ok="handleOk"
    >
      <form ref="form" @submit.stop.prevent="handleSubmit">
        <b-form-group
          label="Email"
          label-for="email-input"
          invalid-feedback="Email is required"
          :state="emailState"
        >
          <b-form-input
            id="email-input"
            v-model="createSSOForm.email"
            type="email"
            :state="emailState"
            required
          />
        </b-form-group>
        <b-form-group
          label="Password"
          label-for="pw1-input"
          invalid-feedback="Password is required"
          :state="pw1State"
        >
          <b-form-input
            id="pw1-input"
            v-model="createSSOForm.pw1"
            type="password"
            :state="pw1State"
            required
          />
        </b-form-group>
        <b-form-group
          label="Confirm Password"
          label-for="pw2-input"
          invalid-feedback="Password is required"
          :state="pw2State"
        >
          <b-form-input
            id="pw2-input"
            v-model="createSSOForm.pw2"
            type="password"
            :state="pw2State"
            required
          />
        </b-form-group>
      </form>
      <div class="sso-tos">
        <p style="width: 75%;">
          By continuing, you are indicating that you accept our
          <a class="highlight" href="https://cdn.runonflux.io/Flux_Terms_of_Service.pdf" referrerpolicy="no-referrer" target="_blank" rel="noopener noreferrer"> Terms of Service</a>
          and
          <a class="highlight" href="https://runonflux.io/privacyPolicy" referrerpolicy="no-referrer" target="_blank" rel="noopener noreferrer"> Privacy Policy</a>.
        </p>
      </div>
    </b-modal>
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

import firebase from 'firebase/compat/app';
import * as firebaseui from 'firebaseui';
import { getUser, loginWithEmail, createEmailSSO } from '@/libs/firebase';
import 'firebaseui/dist/firebaseui.css';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ListEntry from '@/views/components/ListEntry.vue';
import useAppConfig from '@core/app-config/useAppConfig';
import IDService from '@/services/IDService';
import DaemonService from '@/services/DaemonService';
import axios from 'axios';

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
let ethereum;

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
      modalShow: false,
      dashboard: 'Check Flux network information, resources available or a map with server locations.',
      xdao: 'See the list of changes proposed to Flux network, create new ones and vote.',
      applications: 'Buy on marketplace, register your own app, manage your active apps.',
      administration: 'Tools for the infrastructure administrators, node operators.',
      websocket: null,
      ui: null,
      ssoVerification: false,
      errorMessage: '',
      loginPhrase: '',
      loginForm: {
        zelid: '',
        signature: '',
        loginPhrase: '',
      },
      emailForm: {
        email: '',
        password: '',
      },
      createSSOForm: {
        email: '',
        pw1: '',
        pw2: '',
      },
      emailState: null,
      pw1State: null,
      pw2State: null,
      signClient: null,
      getNodeStatusResponse: {
        class: 'text-success',
        status: '',
        data: '',
        nodeStatus: 'Checking status...',
      },
    };
  },
  computed: {
    ...mapState('flux', [
      'userconfig',
      'config',
      'privilege',
    ]),
    skin() {
      return useAppConfig().skin.value;
    },
    callbackValue() {
      const backendURL = this.backendURL();
      const url = `${backendURL}/id/verifylogin`;
      return encodeURI(url);
    },
  },
  mounted() {
    this.daemonWelcomeGetFluxNodeStatus();
    this.getZelIdLoginPhrase();
    this.initMMSDK();
    const uiConfig = {
      callbacks: {
      // Called when the user has been successfully signed in.
        signInSuccessWithAuthResult: this.handleSignInSuccessWithAuthResult,
        uiShown() {
          document.getElementById('ssoLoading').style.display = 'none';
        },
      },
      popupMode: true,
      signInFlow: 'popup',
      signInOptions: [
        {
          provider: firebase.auth.GoogleAuthProvider.PROVIDER_ID,
          customParameters: {
            prompt: 'select_account',
          },
        },
        'apple.com',
      ],
      tosUrl: 'https://cdn.runonflux.io/Flux_Terms_of_Service.pdf',
      privacyPolicyUrl: 'https://runonflux.io/privacyPolicy',
    };
    // Initialize the FirebaseUI Widget using Firebase.
    if (this.privilege === 'none') {
      if (firebaseui.auth.AuthUI.getInstance()) {
        this.ui = firebaseui.auth.AuthUI.getInstance();
        this.ui.start('#firebaseui-auth-container', uiConfig);
      } else {
        this.ui = new firebaseui.auth.AuthUI(firebase.auth());
        this.ui.start('#firebaseui-auth-container', uiConfig);
      }
    }
  },
  methods: {
    handleSignInSuccessWithAuthResult(authResult) {
      if (authResult.user) {
        this.handleSignedInUser(authResult.user);
      }
      return false;
    },
    async handleSignedInUser(user) {
      try {
        if (user.emailVerified) {
          document.getElementById('ssoLoggedIn').style.display = 'block';
          const token = user.auth.currentUser.accessToken;
          const message = this.loginPhrase;
          const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          };
          const fluxLogin = await axios.post('https://service.fluxcore.ai/api/signInOrUp', { message }, { headers });
          if (fluxLogin.data?.status !== 'success') {
            throw new Error('Login Failed, please try again.');
          }
          const authLogin = {
            zelid: fluxLogin.data.public_address,
            signature: fluxLogin.data.signature,
            loginPhrase: this.loginPhrase,
          };
          IDService.verifyLogin(authLogin)
            .then((response) => {
              console.log(response);
              if (response.data.status === 'success') {
                // user is  now signed. Store their values
                const zelidauth = {
                  zelid: fluxLogin.data.public_address,
                  signature: fluxLogin.data.signature,
                  loginPhrase: this.loginPhrase,
                };
                this.$store.commit('flux/setPrivilege', response.data.data.privilage);
                this.$store.commit('flux/setZelid', zelidauth.zelid);
                localStorage.setItem('zelidauth', qs.stringify(zelidauth));
                this.showToast('success', response.data.data.message);
              } else {
                this.showToast(this.getVariant(response.data.status), response.data.data.message || response.data.data);
                this.resetLoginUI();
              }
            })
            .catch((e) => {
              console.log(e);
              this.resetLoginUI();
            });
        } else {
          if (user.displayName) {
            const urlPattern = /\b((http|https|ftp):\/\/[-A-Z0-9+&@#%?=~_|!:,.;]*[-A-Z0-9+&@#%=~_|]|www\.[-A-Z0-9+&@#%?=~_|!:,.;]*[-A-Z0-9+&@#%=~_|]|[-A-Z0-9]+\.[A-Z]{2,}[-A-Z0-9+&@#%?=~_|]*[-A-Z0-9+&@#%=~_|])/i;
            if (urlPattern.test(user.displayName)) {
              throw new Error('Login Failed, please try again.');
            }
          }
          user.sendEmailVerification()
            .then(() => {
              this.showToast('info', 'please verify email');
            })
            .catch(() => {
              this.showToast('warning', 'failed to send new verification email');
            })
            .finally(async () => {
              document.getElementById('ssoVerify').style.display = 'block';
              document.getElementById('ssoEmailVerify').style.display = 'block';
              document.getElementById('emailLoginForm').style.display = 'none';
              this.ssoVerification = true;
              await this.checkVerification();
            });
        }
      } catch (error) {
        this.resetLoginUI();
        this.showToast('warning', 'Login Failed, please try again.');
      }
    },
    async checkVerification() {
      try {
        let user = getUser();
        if (user && this.ssoVerification) {
          await user.reload();
          user = getUser();
          if (user.emailVerified) {
            this.showToast('info', 'email verified');
            document.getElementById('ssoVerify').style.display = 'none';
            this.handleSignedInUser(user);
            this.ssoVerification = false;
          } else {
            setTimeout(() => {
              this.checkVerification();
            }, 5000);
          }
        } else {
          this.resetLoginUI();
        }
      } catch (error) {
        this.showToast('warning', 'email verification failed');
        this.resetLoginUI();
      }
    },
    cancelVerification() {
      this.resetLoginUI();
    },
    resetLoginUI() {
      document.getElementById('ssoVerify').style.display = 'none';
      document.getElementById('ssoEmailVerify').style.display = 'none';
      document.getElementById('ssoLoggedIn').style.display = 'none';
      document.getElementById('emailLoginProcessing').style.display = 'none';
      document.getElementById('emailLoginExecute').style.display = 'block';
      document.getElementById('emailLoginForm').style.display = 'block';
      document.getElementById('signUpButton').style.display = 'block';
      this.emailForm.email = '';
      this.emailForm.password = '';
      this.ui.reset();
      this.ui.start('#firebaseui-auth-container');
      this.ssoVerification = false;
    },
    async daemonWelcomeGetFluxNodeStatus() {
      const response = await DaemonService.getFluxNodeStatus().catch(() => null);
      const blockchainInfo = await DaemonService.getBlockchainInfo().catch(() => null);

      if (!response || !blockchainInfo) {
        this.getNodeStatusResponse.status = 'UNKNOWN';
        this.getNodeStatusResponse.nodeStatus = 'Unable to connect to Flux Blockchain Daemon.';
        this.getNodeStatusResponse.class = 'danger';
        return;
      }

      this.getNodeStatusResponse.status = response.data.status;
      this.getNodeStatusResponse.data = response.data.data;
      if (this.getNodeStatusResponse.data && blockchainInfo.data.data) {
        if (blockchainInfo.data.data.blocks + 3 < blockchainInfo.data.data.headers) {
          this.getNodeStatusResponse.nodeStatus = 'Blockchain not synced, check Administration/Daemon/Blockchain info section.';
          this.getNodeStatusResponse.class = 'warning';
        } else if (this.getNodeStatusResponse.data.status === 'CONFIRMED' || this.getNodeStatusResponse.data.location === 'CONFIRMED') {
          this.getNodeStatusResponse.nodeStatus = 'Connected to the network';
          this.getNodeStatusResponse.class = 'success';
        } else if (this.getNodeStatusResponse.data.status === 'STARTED' || this.getNodeStatusResponse.data.location === 'STARTED') {
          this.getNodeStatusResponse.nodeStatus = 'Connecting to the network. Flux is running with limited capabilities.';
          this.getNodeStatusResponse.class = 'warning';
        } else {
          this.getNodeStatusResponse.nodeStatus = 'Not connected to the network. Flux is running with limited capabilities.';
          this.getNodeStatusResponse.class = 'danger';
        }
      }
    },
    async initMMSDK() {
      try {
        await MMSDK.init();
        ethereum = MMSDK.getProvider();
      } catch (error) {
        console.log(error);
      }
    },
    backendURL() {
      const { protocol, hostname, port } = window.location;
      let mybackend = '';
      mybackend += protocol;
      mybackend += '//';
      const regex = /[A-Za-z]/g;
      if (hostname.split('-')[4]) { // node specific domain
        const splitted = hostname.split('-');
        const names = splitted[4].split('.');
        const adjP = +names[0] + 1;
        names[0] = adjP.toString();
        names[2] = 'api';
        splitted[4] = '';
        mybackend += splitted.join('-');
        mybackend += names.join('.');
      } else if (hostname.match(regex)) { // home.runonflux.io -> api.runonflux.io
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
    initiateLoginWS() {
      const self = this;
      this.initZelcore();
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
    async emailLogin() {
      try {
        if (this.$refs.emailLoginForm.reportValidity()) {
          document.getElementById('emailLoginExecute').style.display = 'none';
          document.getElementById('emailLoginProcessing').style.display = 'block';
          document.getElementById('signUpButton').style.display = 'none';
          const checkUser = await loginWithEmail(this.emailForm);
          this.handleSignInSuccessWithAuthResult(checkUser);
        }
      } catch (error) {
        document.getElementById('emailLoginExecute').style.display = 'block';
        document.getElementById('emailLoginProcessing').style.display = 'none';
        document.getElementById('signUpButton').style.display = 'block';
        document.getElementById('ssoEmailVerify').style.display = 'none';
        this.showToast('danger', 'login failed, please try again');
      }
    },
    async createAccount() {
      this.modalShow = !this.modalShow;
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
      try {
        const signClient = await SignClient.init(walletConnectOptions);
        this.signClient = signClient;
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
      } catch (error) {
        console.error(error);
        this.showToast('danger', error.message);
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
    initZelcore() {
      try {
        const protocolUrl = `zel:?action=sign&message=${this.loginPhrase}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${this.callbackValue}`;

        if (window.zelcore) {
          window.zelcore.protocol(protocolUrl);
        } else {
          const hiddenLink = document.createElement('a');
          hiddenLink.href = protocolUrl;
          hiddenLink.style.display = 'none';
          document.body.appendChild(hiddenLink);
          hiddenLink.click();
          document.body.removeChild(hiddenLink);
        }
      } catch (error) {
        this.showToast('warning', 'Failed to sign message, please try again.');
      }
    },
    async initSSP() {
      try {
        if (!window.ssp) {
          this.showToast('danger', 'SSP Wallet not installed');
          return;
        }
        const responseData = await window.ssp.request('sspwid_sign_message', { message: this.loginPhrase });
        if (responseData.status === 'ERROR') {
          throw new Error(responseData.data || responseData.result);
        }
        const sspLogin = {
          zelid: responseData.address,
          signature: responseData.signature,
          loginPhrase: this.loginPhrase,
        };
        const response = await IDService.verifyLogin(sspLogin);
        console.log(response);
        if (response.data.status === 'success') {
          // user is  now signed. Store their values
          const zelidauth = sspLogin;
          this.$store.commit('flux/setPrivilege', response.data.data.privilage);
          this.$store.commit('flux/setZelid', zelidauth.zelid);
          localStorage.setItem('zelidauth', qs.stringify(zelidauth));
          this.showToast('success', response.data.data.message);
        } else {
          this.showToast(this.getVariant(response.data.status), response.data.data.message || response.data.data);
        }
      } catch (error) {
        this.showToast('danger', error.message);
      }
    },
    checkFormValidity() {
      const valid = this.$refs.form.reportValidity();

      if (this.createSSOForm.pw1.length >= 8) this.pw1State = true;
      else {
        this.showToast('info', 'password must be at least 8 chars');
        return null;
      }

      if (this.createSSOForm.pw2.length >= 8) this.pw2State = true;
      else {
        this.showToast('info', 'password must be at least 8 chars');
        return null;
      }

      if (this.createSSOForm.pw1 !== this.createSSOForm.pw2) {
        this.showToast('info', 'passwords do not match');
        this.pw1State = false;
        this.pw2State = false;
        return null;
      }

      return valid;
    },
    resetModal() {
      this.createSSOForm.email = '';
      this.createSSOForm.pw1 = '';
      this.createSSOForm.pw2 = '';
      this.emailState = null;
      this.pw1State = null;
      this.pw2State = null;
    },
    handleOk(bvModalEvent) {
      bvModalEvent.preventDefault();
      this.handleSubmit();
    },
    async handleSubmit() {
      if (!this.checkFormValidity()) {
        return;
      }
      try {
        const createUser = await createEmailSSO({ email: this.createSSOForm.email, password: this.createSSOForm.pw1 });
        this.handleSignInSuccessWithAuthResult(createUser);
      } catch (error) {
        this.resetLoginUI();
        this.showToast('danger', 'Account creation failed, try again');
      }
      this.$nextTick(() => {
        this.$bvModal.hide('modal-prevent-closing');
      });
    },
  },
};
</script>

<style>
.loginText {
  color: #2b61d1;
  font-size: 16px;
  font-weight: 500;
}
.loginRow {
  display: flex;
  flex-direction: row;
  justify-content: space-around;
  margin-top: 10px;
  padding-top: 10px;
}
.ssoLogin {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  margin-bottom: 10px;
  margin-top: 30px;
  text-align: center;
}
.walletIcon {
  height: 90px;
  width: 90px;
  padding: 10px;
}
.walletIcon img {
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

/* Custom styles for FirebaseUI widget */
.firebaseui-button {
  margin-left: 10px;
  border-radius: 3px;
}

.mdl-textfield.is-focused .mdl-textfield__label:after {
  bottom: 15px !important;
}

.firebaseui-title {
  color: black !important;
}

.sso-tos {
  color: lightgray;
  display: flex;
  justify-content: center;
  text-align: center;
  font-size: 12px;
}

.highlight {
  color:#2b61d1
}

.modal-title {
  color: white;
}
</style>
