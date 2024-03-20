<template>
  <div class="app-details">
    <!-- App Header -->
    <div class="app-detail-header">
      <!-- Header: Left -->
      <div class="app-header-left d-flex align-items-center">
        <span class="go-back mr-1">
          <feather-icon
            :icon="$store.state.appConfig.isRTL ? 'ChevronRightIcon' : 'ChevronLeftIcon'"
            size="20"
            class="align-bottom"
            @click="$emit('close-app-view')"
          />
        </span>
        <h4 class="app-name mb-0">
          {{ appData.name }}
        </h4>
      </div>
    </div>

    <!-- App Details -->
    <vue-perfect-scrollbar
      :settings="perfectScrollbarSettings"
      class="app-scroll-area scroll-area"
    >
      <b-row class="match-height">
        <b-col
          xxl="9"
          xl="8"
          lg="8"
          md="12"
        >
          <b-card title="Details">
            <b-form-textarea
              id="textarea-rows"
              rows="2"
              readonly
              :value="appData.description"
              class="description-text"
            />
            <br>
            <div
              v-if="appData.contacts"
              class="form-row form-group"
            >
              <label class="col-3 col-form-label">
                Contact
                <v-icon
                  v-b-tooltip.hover.top="'Add your email contact to get notifications ex. app about to expire, app spawns. Your contact will be uploaded to Flux Storage to not be public visible'"
                  name="info-circle"
                  class="mr-1"
                />
              </label>
              <div class="col">
                <b-form-input
                  id="contact"
                  v-model="contact"
                />
              </div>
            </div>
            <br>
            <div v-if="appData.geolocationOptions">
              <b-form-group
                label-cols="3"
                label-cols-lg="20"
                :label="`Deployment Location`"
                label-for="geolocation"
              >
                <b-form-select
                  id="geolocation"
                  v-model="selectedGeolocation"
                  :options="appData.geolocationOptions"
                >
                  <template #first>
                    <b-form-select-option
                      :value="null"
                      disabled
                    >
                      Worldwide
                    </b-form-select-option>
                  </template>
                </b-form-select>
              </b-form-group>
            </div>

            <b-card
              class="mt-1"
              no-body
            >
              <b-tabs @activate-tab="componentSelected">
                <b-tab
                  v-for="(component, index) in appData.compose"
                  :key="index"
                  :title="component.name"
                >
                  <list-entry
                    title="Description"
                    :data="component.description"
                  />
                  <list-entry
                    title="Repository"
                    :data="component.repotag"
                  />
                  <b-card
                    v-if="component.userEnvironmentParameters"
                    title="Parameters"
                    border-variant="primary"
                  >
                    <b-tabs v-if="component.userEnvironmentParameters">
                      <b-tab
                        v-for="(parameter, paramIndex) in component.userEnvironmentParameters"
                        :key="paramIndex"
                        :title="parameter.name"
                      >
                        <div class="form-row form-group">
                          <label class="col-2 col-form-label">
                            Value
                            <v-icon
                              v-b-tooltip.hover.top="parameter.description"
                              name="info-circle"
                              class="mr-1"
                            />
                          </label>
                          <div class="col">
                            <b-form-input
                              id="enviromentParameters"
                              v-model="parameter.value"
                              :placeholder="parameter.placeholder"
                            />
                          </div>
                        </div>
                      </b-tab>
                    </b-tabs>
                  </b-card>
                  <b-card
                    v-if="component.userSecrets"
                    title="Secrets"
                    border-variant="primary"
                  >
                    <b-tabs v-if="component.userSecrets">
                      <b-tab
                        v-for="(parameter, paramIndex) in component.userSecrets"
                        :key="paramIndex"
                        :title="parameter.name"
                      >
                        <div class="form-row form-group">
                          <label class="col-2 col-form-label">
                            Value
                            <v-icon
                              v-b-tooltip.hover.top="parameter.description"
                              name="info-circle"
                              class="mr-1"
                            />
                          </label>
                          <div class="col">
                            <b-form-input
                              id="secrets"
                              v-model="parameter.value"
                              :placeholder="parameter.placeholder"
                            />
                          </div>
                        </div>
                      </b-tab>
                    </b-tabs>
                  </b-card>
                  <b-button
                    v-if="userZelid"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="outline-warning"
                    aria-label="View Additional Details"
                    class="mb-2"
                    @click="componentParamsModalShowing = true"
                  >
                    View Additional Details
                  </b-button>
                </b-tab>
              </b-tabs>
            </b-card>
          </b-card>
        </b-col>
        <b-col
          xxl="3"
          xl="4"
          lg="4"
          class="d-lg-flex d-none"
        >
          <b-card no-body>
            <b-card-header class="app-requirements-header">
              <h4 class="mb-0">
                CPU
              </h4>
            </b-card-header>
            <vue-apex-charts
              class="mt-1"
              type="radialBar"
              height="200"
              :options="cpuRadialBar"
              :series="cpu.series"
            />
          </b-card>
          <b-card no-body>
            <b-card-header class="app-requirements-header">
              <h4 class="mb-0">
                RAM
              </h4>
            </b-card-header>
            <vue-apex-charts
              class="mt-1"
              type="radialBar"
              height="200"
              :options="ramRadialBar"
              :series="ram.series"
            />
          </b-card>
          <b-card no-body>
            <b-card-header class="app-requirements-header">
              <h4 class="mb-0">
                HDD
              </h4>
            </b-card-header>
            <vue-apex-charts
              class="mt-1"
              type="radialBar"
              height="200"
              :options="hddRadialBar"
              :series="hdd.series"
            />
          </b-card>
        </b-col>
        <b-row class="d-lg-none d-sm-none d-md-flex d-none">
          <b-col md="4">
            <b-card no-body>
              <b-card-header class="app-requirements-header">
                <h5 class="mb-0">
                  CPU
                </h5>
              </b-card-header>
              <vue-apex-charts
                class="mt-1"
                type="radialBar"
                height="200"
                :options="cpuRadialBar"
                :series="cpu.series"
              />
            </b-card>
          </b-col>
          <b-col md="4">
            <b-card no-body>
              <b-card-header class="app-requirements-header">
                <h5 class="mb-0">
                  RAM
                </h5>
              </b-card-header>
              <vue-apex-charts
                class="mt-1"
                type="radialBar"
                height="200"
                :options="ramRadialBar"
                :series="ram.series"
              />
            </b-card>
          </b-col>
          <b-col md="4">
            <b-card no-body>
              <b-card-header class="app-requirements-header">
                <h5 class="mb-0">
                  HDD
                </h5>
              </b-card-header>
              <vue-apex-charts
                class="mt-1"
                type="radialBar"
                height="200"
                :options="hddRadialBar"
                :series="hdd.series"
              />
            </b-card>
          </b-col>
        </b-row>
        <b-row class="d-md-none">
          <b-col cols="4">
            <b-card no-body>
              <b-card-header class="app-requirements-header">
                <h6 class="mb-0">
                  CPU
                </h6>
              </b-card-header>
              <vue-apex-charts
                class="mt-3"
                type="radialBar"
                height="130"
                :options="cpuRadialBarSmall"
                :series="cpu.series"
              />
            </b-card>
          </b-col>
          <b-col cols="4">
            <b-card no-body>
              <b-card-header class="app-requirements-header">
                <h6 class="mb-0">
                  RAM
                </h6>
              </b-card-header>
              <vue-apex-charts
                class="mt-3"
                type="radialBar"
                height="130"
                :options="ramRadialBarSmall"
                :series="ram.series"
              />
            </b-card>
          </b-col>
          <b-col cols="4">
            <b-card no-body>
              <b-card-header class="app-requirements-header">
                <h6 class="mb-0">
                  HDD
                </h6>
              </b-card-header>
              <vue-apex-charts
                class="mt-3"
                type="radialBar"
                height="130"
                :options="hddRadialBarSmall"
                :series="hdd.series"
              />
            </b-card>
          </b-col>
        </b-row>
      </b-row>
      <div
        v-if="!appData.enabled"
        class="text-center"
      >
        <h4>
          This app is temporarily disabled
        </h4>
      </div>
      <div
        v-else
        class="text-center"
      >
        <b-button
          v-if="userZelid"
          v-ripple.400="'rgba(255, 255, 255, 0.15)'"
          variant="outline-success"
          aria-label="Launch Marketplace App"
          class="mb-2 w-100"
          @click="checkFluxSpecificationsAndFormatMessage"
        >
          Start Launching Marketplace App
        </b-button>
        <h4 v-else>
          Please login using your ZelID to deploy Marketplace Apps
        </h4>
      </div>
    </vue-perfect-scrollbar>

    <b-modal
      v-model="componentParamsModalShowing"
      title="Extra Component Parameters"
      size="lg"
      centered
      button-size="sm"
      ok-only
      ok-title="Close"
    >
      <div v-if="currentComponent">
        <list-entry
          title="Static Parameters"
          :data="currentComponent.environmentParameters.join(', ')"
        />
        <list-entry
          title="Custom Domains"
          :data="currentComponent.domains.join(', ') || 'none'"
        />
        <list-entry
          title="Automatic Domains"
          :data="constructAutomaticDomains(appData.name).join(', ')"
        />
        <list-entry
          title="Ports"
          :data="currentComponent.ports.join(', ')"
        />
        <list-entry
          title="Container Ports"
          :data="currentComponent.containerPorts.join(', ')"
        />
        <list-entry
          title="Container Data"
          :data="currentComponent.containerData"
        />
        <list-entry
          title="Commands"
          :data="currentComponent.commands.length > 0 ? currentComponent.commands.join(', ') : 'none'"
        />
      </div>
    </b-modal>

    <b-modal
      v-model="confirmLaunchDialogCloseShowing"
      title="Finish Launching App?"
      size="sm"
      centered
      button-size="sm"
      ok-title="Yes"
      cancel-title="No"
      @ok="confirmLaunchDialogCloseShowing = false; launchModalShowing = false;"
    >
      <h3 class="text-center">
        Please ensure that you have paid for your app, or saved the payment details for later.
      </h3>
      <br>
      <h4 class="text-center">
        Close the Launch App dialog?
      </h4>
    </b-modal>

    <b-modal
      v-model="launchModalShowing"
      title="Launching Marketplace App"
      size="xlg"
      centered
      no-close-on-backdrop
      no-close-on-esc
      hide-footer
      @ok="confirmLaunchDialogCancel"
    >
      <form-wizard
        ref="formWizard"
        :color="tierColors.cumulus"
        :title="null"
        :subtitle="null"
        layout="vertical"
        back-button-text="Previous"
        class="wizard-vertical mb-3"
        @on-complete="confirmLaunchDialogFinish()"
      >
        <template slot="footer" scope="props">
          <div>
            <b-button v-if="props.activeTabIndex > 0" class="wizard-footer-left" type="button" variant="outline-dark" @click="$refs.formWizard.prevTab()">
              Previous
            </b-button>
            <!-- Original Next button -->
            <b-button class="wizard-footer-right" type="button" variant="outline-dark" @click="$refs.formWizard.nextTab()">
              {{ props.isLastStep ? 'Done' : 'Next' }}
            </b-button>
          </div>
        </template>
        <tab-content title="Check Registration">
          <b-card
            title="Registration Message"
            class="text-center wizard-card"
          >
            <div class="text-wrap">
              <b-form-textarea
                id="registrationmessage"
                v-model="dataToSign"
                rows="6"
                readonly
              />
              <b-icon ref="copyButtonRef" v-b-tooltip="tooltipText" class="clipboard icon" scale="1.5" icon="clipboard" @click="copyMessageToSign" />
            </div>
          </b-card>
        </tab-content>
        <tab-content
          title="Sign App Message"
          :before-change="() => signature !== null"
        >
          <div class="mx-auto" style="width: 600px;">
            <h4 class="text-center">
              Sign Message with same method you have used for login
            </h4>
            <div class="loginRow mx-auto" style="width: 400px;">
              <a @click="initiateSignWS">
                <img
                  class="zelidLogin"
                  src="@/assets/images/zelID.svg"
                  alt="Zel ID"
                  height="100%"
                  width="100%"
                >
              </a>
              <a @click="initSSP">
                <img
                  class="sspLogin"
                  :src="isDark ? require('@/assets/images/ssp-logo-white.svg') : require('@/assets/images/ssp-logo-black.svg')"
                  alt="SSP"
                  height="100%"
                  width="100%"
                >
              </a>
            </div>
            <div class="loginRow mx-auto" style="width: 400px;">
              <a @click="initWalletConnect">
                <img
                  class="walletconnectLogin"
                  src="@/assets/images/walletconnect.svg"
                  alt="WalletConnect"
                  height="100%"
                  width="100%"
                >
              </a>
              <a @click="initMetamask">
                <img
                  class="metamaskLogin"
                  src="@/assets/images/metamask.svg"
                  alt="Metamask"
                  height="100%"
                  width="100%"
                >
              </a>
            </div>
          </div>
          <b-form-input
            id="signature"
            v-model="signature"
            class="mb-2"
          />
        </tab-content>
        <tab-content
          title="Register App"
          :before-change="() => registrationHash !== null"
        >
          <b-card
            title="Register App"
            class="text-center wizard-card"
          >
            <b-card-text>
              <b-icon class="mr-1" scale="1.4" icon="cash-coin" />Price:&nbsp;&nbsp;<b>{{ appPricePerDeploymentUSD }} USD + VAT</b>
            </b-card-text>
            <b-button
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Register Flux App"
              class="my-1"
              :disabled="registrationHash && registrationHash.length > 0"
              @click="register"
            >
              Register Flux App
            </b-button>
            <b-card-text
              v-if="registrationHash"
              v-b-tooltip
              :title="registrationHash"
              class="mt-1"
            >
              Registration Hash received
            </b-card-text>
          </b-card>
        </tab-content>
        <tab-content title="Send Payment">
          <b-row
            class="match-height"
          >
            <b-col
              xs="6"
              lg="8"
            >
              <b-card
                title="Send Payment"
                class="text-center wizard-card"
              >
                <div class="d-flex justify-content-center align-items-center mb-1">
                  <b-icon class="mr-1" scale="1.4" icon="cash-coin" />Price:&nbsp;&nbsp;<b>{{ appPricePerDeploymentUSD }} USD + VAT</b>
                </div>
                <b-card-text>
                  <b>Everything is ready, your payment option links, both for fiat and flux, are valid for the next 30 minutes.</b>
                </b-card-text>
                <br>
                The application will be subscribed until <b>{{ new Date(subscribedTill).toLocaleString('en-GB', timeoptions.shortDate) }}</b>
                <br>
                To finish the application registration, pay your application with your prefered payment method or check below how to pay with Flux crypto currency.
              </b-card>
            </b-col>
            <b-col
              xs="6"
              lg="4"
            >
              <b-card
                title="Pay with Stripe/PayPal"
                class="text-center wizard-card"
              >
                <div class="loginRow">
                  <a @click="initStripePay">
                    <img
                      class="stripePay"
                      src="@/assets/images/Stripe.svg"
                      alt="Stripe"
                      height="100%"
                      width="100%"
                    >
                  </a>
                  <a @click="initPaypalPay">
                    <img
                      class="paypalPay"
                      src="@/assets/images/PayPal.png"
                      alt="PayPal"
                      height="100%"
                      width="100%"
                    >
                  </a>
                </div>
                <div v-if="fiatCheckoutURL" className="loginRow">
                  <a :href="fiatCheckoutURL" target="_blank" rel="noopener noreferrer">
                    Click here for checkout if not redirected
                  </a>
                </div>
              </b-card>
            </b-col>
          </b-row>
          <b-row
            v-if="!applicationPriceFluxError"
            class="match-height"
          >
            <b-col xs="6" lg="8">
              <b-card
                class="text-center wizard-card"
              >
                <b-card-text>
                  To pay in <kbd class="bg-primary"><b>FLUX{{ applicationPriceFluxDiscount }}</b></kbd>, please make a transaction of <b>{{ appPricePerDeployment }} FLUX</b> to address<br>
                  <b>'{{ deploymentAddress }}'</b><br>
                  with the following message<br>
                  <b>'{{ registrationHash }}'</b>
                </b-card-text>
              </b-card>
            </b-col>
            <b-col xs="6" lg="4">
              <b-card
                title="Pay with Zelcore/SSP"
                class="text-center wizard-card"
              >
                <div class="loginRow">
                  <a :href="`zel:?action=pay&coin=zelcash&address=${deploymentAddress}&amount=${appPricePerDeployment}&message=${registrationHash}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png`">
                    <img
                      class="zelidLogin"
                      src="@/assets/images/zelID.svg"
                      alt="Zel ID"
                      height="100%"
                      width="100%"
                    >
                  </a>
                  <a @click="initSSPpay">
                    <img
                      class="sspLogin"
                      :src="isDark ? require('@/assets/images/ssp-logo-white.svg') : require('@/assets/images/ssp-logo-black.svg')"
                      alt="SSP"
                      height="100%"
                      width="100%"
                    >
                  </a>
                </div>
              </b-card>
            </b-col>
          </b-row>
        </tab-content>
      </form-wizard>
    </b-modal>
  </div>
</template>

<script>
import {
  BButton,
  BCard,
  BCardHeader,
  BCardText,
  BCol,
  BFormInput,
  BFormTextarea,
  BModal,
  BRow,
  BTabs,
  BTab,
  VBModal,
  VBToggle,
  VBTooltip,
  BFormSelect,
  BFormSelectOption,
  BFormGroup,
} from 'bootstrap-vue';
import {
  FormWizard,
  TabContent,
} from 'vue-form-wizard';
import VuePerfectScrollbar from 'vue-perfect-scrollbar';
import VueApexCharts from 'vue-apexcharts';
import Ripple from 'vue-ripple-directive';
import { useToast } from 'vue-toastification/composition';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';

import { $themeColors } from '@themeConfig';
import 'vue-form-wizard/dist/vue-form-wizard.min.css';

import {
  ref,
  watch,
  computed,
  getCurrentInstance,
  nextTick,
} from 'vue';

import ListEntry from '@/views/components/ListEntry.vue';
import AppsService from '@/services/AppsService';
import tierColors from '@/libs/colors';
import SignClient from '@walletconnect/sign-client';
import { MetaMaskSDK } from '@metamask/sdk';
import useAppConfig from '@core/app-config/useAppConfig';
import { useClipboard } from '@vueuse/core';

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

const metamaskOptions = {
  enableDebug: true,
};

const MMSDK = new MetaMaskSDK(metamaskOptions);
let ethereum;

const qs = require('qs');
const axios = require('axios');
const store = require('store');
const openpgp = require('openpgp');
const timeoptions = require('@/libs/dateFormat');

export default {
  components: {
    BButton,
    BCard,
    BCardHeader,
    BCardText,
    BCol,
    BFormInput,
    BFormTextarea,
    BModal,
    BRow,
    BTabs,
    BTab,
    BFormSelect,
    BFormSelectOption,
    BFormGroup,
    FormWizard,
    TabContent,

    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
    ListEntry,

    // 3rd Party
    VuePerfectScrollbar,
    VueApexCharts,
  },
  directives: {
    Ripple,
    'b-modal': VBModal,
    'b-toggle': VBToggle,
    'b-tooltip': VBTooltip,
  },
  props: {
    appData: {
      type: Object,
      required: true,
    },
    zelid: {
      type: String,
      required: false,
      default: '',
    },
    tier: {
      type: String,
      required: true,
      default: '',
    },
  },
  setup(props) {
    const vm = getCurrentInstance().proxy;
    // Use toast
    const toast = useToast();

    const { skin } = useAppConfig();

    const isDark = computed(() => skin.value === 'dark');

    const resolveTagVariant = (status) => {
      if (status === 'Open') return 'warning';
      if (status === 'Passed') return 'success';
      if (status === 'Unpaid') return 'info';
      if (status && status.startsWith('Rejected')) return 'danger';
      return 'primary';
    };

    const showToast = (variant, title, icon = 'InfoIcon') => {
      toast({
        component: ToastificationContent,
        props: {
          title,
          icon,
          variant,
        },
      });
    };
    const tier = ref('');
    tier.value = props.tier;
    const userZelid = ref('');
    userZelid.value = props.zelid;

    // Variables to control showing dialogs
    const launchModalShowing = ref(false);
    const componentParamsModalShowing = ref(false);
    const confirmLaunchDialogCloseShowing = ref(false);

    // Holds the currently selected component, for viewing
    // additional parameters in a modal dialog
    const currentComponent = ref(null);

    // Registration variables
    const version = ref(1);
    const registrationtype = ref('fluxappregister');
    const dataToSign = ref(null);
    const signature = ref(null);
    const signClient = ref(null);
    const dataForAppRegistration = ref(null);
    const timestamp = ref(null);
    const appPricePerDeployment = ref(0);
    const appPricePerDeploymentUSD = ref(0);
    const fiatCheckoutURL = ref(null);
    const applicationPriceFluxError = ref(false);
    const applicationPriceFluxDiscount = ref('');
    const registrationHash = ref(null);
    const websocket = ref(null);
    const selectedEnterpriseNodes = ref([]);
    const enterprisePublicKeys = ref([]);
    const selectedGeolocation = ref(null);
    const contact = ref(null);
    const appRegistrationSpecification = ref(null);
    const paymentBridge = 'https://fiatpaymentsbridge.runonflux.io';
    const tooltipText = ref('Copy to clipboard');
    const copyButtonRef = ref(null);

    const config = computed(() => vm.$store.state.flux.config);
    const validTill = computed(() => timestamp.value + 60 * 60 * 1000); // 1 hour
    const subscribedTill = computed(() => timestamp.value + 30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000); // 1 month

    const callbackValue = () => {
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
          vm.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          vm.$store.commit('flux/setFluxPort', apiPort);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += config.value.apiPort;
      }
      const backendURL = store.get('backendURL') || mybackend;
      const url = `${backendURL}/id/providesign`;
      return encodeURI(url);
    };

    const onError = (evt) => {
      console.log(evt);
    };
    const onMessage = (evt) => {
      const data = qs.parse(evt.data);
      if (data.status === 'success' && data.data) {
        // user is now signed. Store their values
        signature.value = data.data.signature;
      }
      console.log(data);
      console.log(evt);
    };
    const onClose = (evt) => {
      console.log(evt);
    };
    const onOpen = (evt) => {
      console.log(evt);
    };

    const initiateSignWS = async () => {
      if (dataToSign.value.length > 1800) {
        const message = dataToSign.value;
        // upload to flux storage
        const data = {
          publicid: Math.floor((Math.random() * 999999999999999)).toString(),
          public: message,
        };
        await axios.post(
          'https://storage.runonflux.io/v1/public',
          data,
        );
        const zelProtocol = `zel:?action=sign&message=FLUX_URL=https://storage.runonflux.io/v1/public/${data.publicid}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${callbackValue()}`;
        window.location.href = zelProtocol;
      } else {
        window.location.href = `zel:?action=sign&message=${dataToSign.value}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${callbackValue()}`;
      }
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
          vm.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          vm.$store.commit('flux/setFluxPort', apiPort);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += config.value.apiPort;
      }
      let backendURL = store.get('backendURL') || mybackend;
      backendURL = backendURL.replace('https://', 'wss://');
      backendURL = backendURL.replace('http://', 'ws://');
      const signatureMessage = userZelid.value + timestamp.value;
      console.log(`signatureMessage: ${signatureMessage}`);
      const wsuri = `${backendURL}/ws/sign/${signatureMessage}`;
      const ws = new WebSocket(wsuri);
      websocket.value = ws;

      ws.onopen = (evt) => { onOpen(evt); };
      ws.onclose = (evt) => { onClose(evt); };
      ws.onmessage = (evt) => { onMessage(evt); };
      ws.onerror = (evt) => { onError(evt); };
    };

    const initMMSDK = async () => {
      try {
        await MMSDK.init();
        ethereum = MMSDK.getProvider();
      } catch (error) {
        console.log(error);
      }
    };
    initMMSDK();

    const siwe = async (siweMessage, from) => {
      try {
        const msg = `0x${Buffer.from(siweMessage, 'utf8').toString('hex')}`;
        const sign = await ethereum.request({
          method: 'personal_sign',
          params: [msg, from],
        });
        console.log(sign); // this is signature
        signature.value = sign;
      } catch (error) {
        console.error(error); // rejection occured
        showToast('danger', error.message);
      }
    };

    const initMetamask = async () => {
      try {
        if (!ethereum) {
          showToast('danger', 'Metamask not detected');
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
        siwe(dataToSign.value, account);
      } catch (error) {
        showToast('danger', error.message);
      }
    };
    const initSSP = async () => {
      try {
        if (!window.ssp) {
          showToast('danger', 'SSP Wallet not installed');
          return;
        }
        const responseData = await window.ssp.request('sspwid_sign_message', { message: dataToSign.value });
        if (responseData.status === 'ERROR') {
          throw new Error(responseData.data || responseData.result);
        }
        signature.value = responseData.signature;
      } catch (error) {
        showToast('danger', error.message);
      }
    };

    const initSSPpay = async () => {
      try {
        if (!window.ssp) {
          showToast('danger', 'SSP Wallet not installed');
          return;
        }
        const data = {
          message: this.registrationHash,
          amount: (+this.appPricePerDeployment || 0).toString(),
          address: this.deploymentAddress,
          chain: 'flux',
        };
        const responseData = await window.ssp.request('pay', data);
        if (responseData.status === 'ERROR') {
          throw new Error(responseData.data || responseData.result);
        } else {
          showToast('success', `${responseData.data}: ${responseData.txid}`);
        }
      } catch (error) {
        showToast('danger', error.message);
      }
    };

    const openSite = (url) => {
      const win = window.open(url, '_blank');
      win.focus();
    };

    const initStripePay = async () => {
      try {
        const hash = registrationHash.value;
        const { name } = appRegistrationSpecification.value;
        const price = appPricePerDeploymentUSD.value;
        const { description } = appRegistrationSpecification.value;
        const zelidauth = localStorage.getItem('zelidauth');
        const auth = qs.parse(zelidauth);
        const data = {
          zelid: auth.zelid,
          signature: auth.signature,
          loginPhrase: auth.loginPhrase,
          details: {
            name,
            description,
            hash,
            price,
            productName: name,
            success_url: 'https://home.runonflux.io/successcheckout',
            cancel_url: 'https://home.runonflux.io',
            kpi: {
              origin: 'FluxOS',
              marketplace: true,
              registration: true,
            },
          },
        };
        const checkoutURL = await axios.post(`${paymentBridge}/api/v1/stripe/checkout/create`, data);
        if (checkoutURL.data.status === 'error') {
          showToast('error', 'Failed to create stripe checkout');
          return;
        }
        fiatCheckoutURL.value = checkoutURL.data.data;
        openSite(checkoutURL.data.data);
      } catch (error) {
        showToast('error', 'Failed to create stripe checkout');
      }
    };

    const initPaypalPay = async () => {
      try {
        const hash = registrationHash.value;
        const { name } = appRegistrationSpecification.value;
        const price = appPricePerDeploymentUSD.value;
        const { description } = appRegistrationSpecification.value;
        const zelidauth = localStorage.getItem('zelidauth');
        const auth = qs.parse(zelidauth);
        const data = {
          zelid: auth.zelid,
          signature: auth.signature,
          loginPhrase: auth.loginPhrase,
          details: {
            name,
            description,
            hash,
            price,
            productName: name,
            return_url: 'home.runonflux.io/successcheckout',
            cancel_url: 'home.runonflux.io',
            kpi: {
              origin: 'FluxOS',
              marketplace: true,
              registration: true,
            },
          },
        };
        const checkoutURL = await axios.post(`${paymentBridge}/api/v1/paypal/checkout/create`, data);
        if (checkoutURL.data.status === 'error') {
          showToast('error', 'Failed to create PayPal checkout');
          return;
        }
        fiatCheckoutURL.value = checkoutURL.data.data;
        openSite(checkoutURL.data.data);
      } catch (error) {
        showToast('error', 'Failed to create PayPal checkout');
      }
    };

    const onSessionConnect = async (session) => {
      console.log(session);
      // const msg = `0x${Buffer.from(this.loginPhrase, 'utf8').toString('hex')}`;
      const result = await signClient.value.request({
        topic: session.topic,
        chainId: 'eip155:1',
        request: {
          method: 'personal_sign',
          params: [
            dataToSign.value,
            session.namespaces.eip155.accounts[0].split(':')[2],
          ],
        },
      });
      console.log(result);
      signature.value = result;
    };

    const initWalletConnect = async () => {
      try {
        const signClientAux = await SignClient.init(walletConnectOptions);
        signClient.value = signClientAux;
        const lastKeyIndex = signClientAux.session.getAll().length - 1;
        const lastSession = signClientAux.session.getAll()[lastKeyIndex];
        if (lastSession) {
          onSessionConnect(lastSession);
        } else {
          throw new Error('WalletConnect session expired. Please log into FluxOS again');
        }
      } catch (error) {
        console.error(error);
        showToast('danger', error.message);
      }
    };

    const perfectScrollbarSettings = {
      maxScrollbarLength: 150,
    };

    const resolveCpu = (app) => app.compose.reduce((total, component) => total + component.cpu, 0);

    const resolveRam = (app) => app.compose.reduce((total, component) => total + component.ram, 0);

    const resolveHdd = (app) => app.compose.reduce((total, component) => total + component.hdd, 0);

    const cpu = ref({
      series: [],
    });
    const ram = ref({
      series: [],
    });
    const hdd = ref({
      series: [],
    });

    const fetchEnterpriseKey = async (nodeip) => { // we must have at least +5 nodes or up to 10% of spare keys
      try {
        const node = nodeip.split(':')[0];
        const port = Number(nodeip.split(':')[1] || 16127);
        // const agent = new https.Agent({
        //   rejectUnauthorized: false,
        // });
        const { hostname } = window.location;
        const regex = /[A-Za-z]/g;
        let ipAccess = true;
        if (hostname.match(regex)) {
          ipAccess = false;
        }
        let queryUrl = `https://${node.replace(/\./g, '-')}-${port}.node.api.runonflux.io/flux/pgp`;
        if (ipAccess) {
          queryUrl = `http://${node}:${port}/flux/pgp`;
        }
        const response = await axios.get(queryUrl); // ip with port
        if (response.data.status === 'error') {
          showToast('danger', response.data.data.message || response.data.data);
        } else {
          const pgpKey = response.data.data;
          return pgpKey;
        }
        return null;
      } catch (error) {
        console.log(error);
        return null;
      }
    };

    const getEnterpriseNodes = async () => {
      const enterpriseList = sessionStorage.getItem('flux_enterprise_nodes');
      if (enterpriseList) {
        return JSON.parse(enterpriseList);
      }
      try {
        const entList = await AppsService.getEnterpriseNodes();
        if (entList.data.status === 'error') {
          showToast('danger', entList.data.data.message || entList.data.data);
        } else {
          sessionStorage.setItem('flux_enterprise_nodes', JSON.stringify(entList.data.data));
          return entList.data.data;
        }
      } catch (error) {
        console.log(error);
      }
      return [];
    };
    /**
    * To encrypt a message with an array of encryption public keys
    * @param {string} message Message to encrypt
    * @param {array} encryptionKeys Armored version of array of public key
    * @returns {string} Return armored version of encrypted message
    */
    const encryptMessage = async (message, encryptionKeys) => {
      try {
        const encKeys = encryptionKeys.map((key) => key.nodekey);
        const publicKeys = await Promise.all(encKeys.map((armoredKey) => openpgp.readKey({ armoredKey })));
        const pgpMessage = await openpgp.createMessage({ text: message.replace('\\“', '\\"') });
        const encryptedMessage = await openpgp.encrypt({
          message: pgpMessage, // input as Message object
          encryptionKeys: publicKeys,
        });
        // '-----BEGIN PGP MESSAGE ... END PGP MESSAGE-----'
        return encryptedMessage;
      } catch (error) {
        showToast('danger', 'Data encryption failed');
        return null;
      }
    };
    const autoSelectNodes = async () => {
      const { instances } = props.appData;
      const maxSamePubKeyNodes = +instances + 3;
      const maxNumberOfNodes = +instances + Math.ceil(Math.max(7, +instances * 0.15));
      const notSelectedEnterpriseNodes = await getEnterpriseNodes();
      const nodesToSelect = [];
      const selectedEnNodes = [];
      const kycNodes = notSelectedEnterpriseNodes.filter((x) => x.enterprisePoints > 0 && x.score > 1000); // allows to install multiple apps 3 to 4 only in kyc nodes
      for (let i = 0; i < kycNodes.length; i += 1) {
        // todo here check if max same pub key is satisfied
        const alreadySelectedPubKeyOccurances = selectedEnNodes.filter((node) => node.pubkey === kycNodes[i].pubkey).length;
        const toSelectPubKeyOccurances = nodesToSelect.filter((node) => node.pubkey === kycNodes[i].pubkey).length;
        if (alreadySelectedPubKeyOccurances + toSelectPubKeyOccurances < maxSamePubKeyNodes) {
          nodesToSelect.push(kycNodes[i]);
        }
        if (nodesToSelect.length + selectedEnNodes.length >= maxNumberOfNodes) {
          break;
        }
      }
      if (nodesToSelect.length < maxNumberOfNodes) {
        throw new Error('Not enough kyc nodes available to run your enterprise app.');
      }
      nodesToSelect.forEach(async (node) => {
        const nodeExists = selectedEnNodes.find((existingNode) => existingNode.ip === node.ip);
        if (!nodeExists) {
          selectedEnNodes.push(node);
          // fetch pgp key
          // we do not need pgp key as we dont do encryption
          const keyExists = enterprisePublicKeys.value.find((key) => key.nodeip === node.ip);
          if (!keyExists) {
            const pgpKey = await fetchEnterpriseKey(node.ip);
            if (pgpKey) {
              const pair = {
                nodeip: node.ip,
                nodekey: pgpKey,
              };
              const keyExistsB = enterprisePublicKeys.value.find((key) => key.nodeip === node.ip);
              if (!keyExistsB) {
                enterprisePublicKeys.value.push(pair);
              }
            }
          }
        }
      });
      console.log(selectedEnNodes);
      console.log(enterprisePublicKeys.value);
      return selectedEnNodes.map((node) => node.ip);
    };

    watch(() => props.appData, () => {
      if (websocket.value !== null) {
        websocket.value.close();
        websocket.value = null;
      }
      cpu.value = {
        series: [((resolveCpu(props.appData) / 15) * 100)],
      };
      ram.value = {
        series: [((resolveRam(props.appData) / 59000) * 100)],
      };
      hdd.value = {
        series: [((resolveHdd(props.appData) / 820) * 100)],
      };

      // Evaluate any user parameters from the database
      props.appData.compose.forEach((component) => {
        const paramModel = component.userEnvironmentParameters || [];
        // check if any of these parameters are special 'port' parameters
        paramModel.forEach((parameter) => {
          if (Object.prototype.hasOwnProperty.call(parameter, 'port')) {
            // eslint-disable-next-line no-param-reassign
            parameter.value = component.ports[parameter.port];
          }
        });
      });
      currentComponent.value = props.appData.compose[0];
      if (props.appData.isAutoEnterprise) {
        autoSelectNodes().then((v) => {
          // appSpecification.nodes = v;
          selectedEnterpriseNodes.value = v;
          console.log('auto selected nodes', v);
        }).catch(console.log);
      }
    });

    const constructUniqueAppName = (appName) => `${appName}${Date.now()}`;

    const constructAutomaticDomains = (appName) => {
      if (!userZelid.value) {
        return ['No ZelID'];
      }
      const appNameWithTimestamp = constructUniqueAppName(appName);
      const lowerCaseName = appNameWithTimestamp.toLowerCase();
      const domains = [`${lowerCaseName}.app.runonflux.io`];
      return domains;
    };

    const deploymentAddress = ref(null);
    const appsDeploymentInformation = async () => {
      const response = await AppsService.appsDeploymentInformation();
      const { data } = response.data;
      if (response.data.status === 'success') {
        deploymentAddress.value = data.address;
      } else {
        showToast('danger', response.data.data.message || response.data.data);
      }
    };
    appsDeploymentInformation();

    const checkFluxSpecificationsAndFormatMessage = async () => {
      try {
        // construct a valid v4 app spec from the marketplace app spec,
        // filtering out unnecessary fields like 'price' and 'category'
        const appName = constructUniqueAppName(props.appData.name);
        const appSpecification = {
          version: props.appData.version,
          name: appName,
          description: props.appData.description,
          owner: userZelid.value,
          instances: props.appData.instances,
          compose: [],
        };
        if (props.appData.version >= 5) {
          appSpecification.contacts = [];
          appSpecification.geolocation = [];
          if (selectedGeolocation.value) {
            appSpecification.geolocation.push(selectedGeolocation.value);
          }
          if (contact.value) {
            const contacts = [contact.value];
            const contactsid = Math.floor((Math.random() * 999999999999999)).toString();
            const data = {
              contactsid,
              contacts,
            };
            // eslint-disable-next-line no-await-in-loop
            const resp = await axios.post('https://storage.runonflux.io/v1/contacts', data);
            if (resp.data.status === 'error') {
              throw new Error(resp.data.message || resp.data);
            }
            showToast('success', 'Successful upload of Contact Parameter to Flux Storage');
            appSpecification.contacts = [`F_S_CONTACTS=https://storage.runonflux.io/v1/contacts/${contactsid}`];
          }
        }
        if (props.appData.version >= 6) {
          appSpecification.expire = props.appData.expire || 22000;
        }
        if (props.appData.version >= 7) {
          appSpecification.staticip = props.appData.staticip;
          if (props.appData.isAutoEnterprise) {
            if (selectedEnterpriseNodes.value.length === 0) {
              const v = await autoSelectNodes();
              // appSpecification.nodes = v;
              selectedEnterpriseNodes.value = v;
            }
            appSpecification.nodes = selectedEnterpriseNodes.value;
          } else {
            appSpecification.nodes = props.appData.nodes || [];
          }
        }
        // formation, pre verification
        for (let i = 0; i < props.appData.compose.length; i += 1) {
          const component = props.appData.compose[i];
          let envParams = JSON.parse(JSON.stringify(component.environmentParameters));
          const assignedEnv = component.userEnvironmentParameters || [];
          assignedEnv.forEach((param) => {
            envParams.push(`${param.name}=${param.value}`);
          });
          if (component.envFluxStorage) {
            const envid = Math.floor((Math.random() * 999999999999999)).toString();
            const data = {
              envid,
              env: envParams,
            };
            // eslint-disable-next-line no-await-in-loop
            const resp = await axios.post('https://storage.runonflux.io/v1/env', data);
            if (resp.data.status === 'error') {
              throw new Error(resp.data.message || resp.data);
            }
            showToast('success', 'Successful upload of Environment Parameters to Flux Storage');
            envParams = [`F_S_ENV=https://storage.runonflux.io/v1/env/${envid}`];
          }
          let { ports } = component;
          if (component.portSpecs) {
            ports = [];
            for (let y = 0; y < component.portSpecs.length; y += 1) {
              const portInterval = component.portSpecs[y];
              if (typeof portInterval === 'string') { // '0-10'
                const minPort = Number(portInterval.split('-')[0]);
                const maxPort = Number(portInterval.split('-')[1]);
                ports.push(Math.floor(Math.random() * (maxPort - minPort + 1) + minPort));
              } else {
                throw new Error('Port Specs Range for the application on Marketplace is not properly configured');
              }
            }
          }
          if (props.appData.name.toLowerCase().includes('streamr')) {
            envParams.push(`STREAMR__BROKER__CLIENT__NETWORK__CONTROL_LAYER__WEBSOCKET_PORT_RANGE__MIN=${ports[0]}`);
            envParams.push(`STREAMR__BROKER__CLIENT__NETWORK__CONTROL_LAYER__WEBSOCKET_PORT_RANGE__MAX=${ports[0]}`);
            envParams.push('LOG_COLORS=false');
            component.containerPorts = [ports[0]];
          }
          const appComponent = {
            name: component.name,
            description: component.description,
            repotag: component.repotag,
            ports,
            containerPorts: component.containerPorts,
            environmentParameters: envParams,
            commands: component.commands,
            containerData: component.containerData,
            domains: component.domains,
            cpu: component.cpu,
            ram: component.ram,
            hdd: component.hdd,
            tiered: component.tiered,
          };
          if (component.tiered) {
            appComponent.cpubasic = component.cpubasic;
            appComponent.rambasic = component.rambasic;
            appComponent.hddbasic = component.hddbasic;
            appComponent.cpusuper = component.cpusuper;
            appComponent.ramsuper = component.ramsuper;
            appComponent.hddsuper = component.hddsuper;
            appComponent.cpubamf = component.cpubamf;
            appComponent.rambamf = component.rambamf;
            appComponent.hddbamf = component.hddbamf;
          }
          if (props.appData.version >= 7) {
            appComponent.secrets = props.appData.secrets || '';
            appComponent.repoauth = props.appData.repoauth || '';
            const userSecrets = [];
            const assignedSecrets = component.userSecrets || [];
            assignedSecrets.forEach((param) => {
              userSecrets.push(`${param.name}=${param.value}`);
            });
            if (userSecrets.length > 0) {
              // eslint-disable-next-line no-await-in-loop
              const encryptedMessage = await encryptMessage(JSON.stringify(userSecrets), enterprisePublicKeys.value);
              if (encryptedMessage) {
                appComponent.secrets = encryptedMessage;
              } else {
                throw new Error('Secrets failed to encrypt');
              }
            }
          }
          appSpecification.compose.push(appComponent);
        }
        appRegistrationSpecification.value = appSpecification;

        // call api for verification of app registration specifications that returns formatted specs
        const responseAppSpecs = await AppsService.appRegistrationVerificaiton(appSpecification);
        console.log(responseAppSpecs);
        if (responseAppSpecs.data.status === 'error') {
          throw new Error(responseAppSpecs.data.data.message || responseAppSpecs.data.data);
        }
        const appSpecFormatted = responseAppSpecs.data.data;
        appPricePerDeployment.value = 0;
        appPricePerDeploymentUSD.value = 0;
        applicationPriceFluxError.value = false;
        applicationPriceFluxDiscount.value = '';
        const auxSpecsFormatted = JSON.parse(JSON.stringify(appSpecFormatted));
        auxSpecsFormatted.priceUSD = props.appData.priceUSD;

        const response = await AppsService.appPriceUSDandFlux(auxSpecsFormatted);
        if (response.data.status === 'error') {
          throw new Error(response.data.data.message || response.data.data);
        }
        appPricePerDeploymentUSD.value = +response.data.data.usd;
        if (Number.isNaN(+response.data.data.fluxDiscount)) {
          applicationPriceFluxError.value = true;
          showToast('danger', 'Not possible to complete payment with Flux crypto currency');
        } else {
          appPricePerDeployment.value = +response.data.data.flux;
          applicationPriceFluxDiscount.value = +response.data.data.fluxDiscount > 0 ? ` with ${+response.data.data.fluxDiscount}% discount` : '';
        }
        if (websocket.value !== null) {
          websocket.value.close();
          websocket.value = null;
        }
        timestamp.value = Date.now();
        dataForAppRegistration.value = appSpecFormatted;
        dataToSign.value = `${registrationtype.value}${version.value}${JSON.stringify(appSpecFormatted)}${Date.now()}`;
        registrationHash.value = null;
        signature.value = null;
        launchModalShowing.value = true;
      } catch (error) {
        console.log(error);
        showToast('danger', error.message || error);
      }
    };

    const smallchart = {
      height: 100,
      type: 'radialBar',
      sparkline: {
        enabled: true,
      },
      dropShadow: {
        enabled: true,
        blur: 3,
        left: 1,
        top: 1,
        opacity: 0.1,
      },
    };

    const largechart = {
      height: 200,
      type: 'radialBar',
      sparkline: {
        enabled: true,
      },
      dropShadow: {
        enabled: true,
        blur: 3,
        left: 1,
        top: 1,
        opacity: 0.1,
      },
    };

    const cpuRadialBar = {
      chart: largechart,
      colors: [$themeColors.primary],
      labels: ['Cores'],
      plotOptions: {
        radialBar: {
          offsetY: -10,
          startAngle: -150,
          endAngle: 150,
          hollow: {
            size: '77%',
          },
          track: {
            background: $themeColors.dark,
            strokeWidth: '50%',
          },
          dataLabels: {
            name: {
              offsetY: -15,
              color: $themeColors.light,
              fontSize: '1.5rem',
            },
            value: {
              formatter: (val) => ((parseFloat(val) * 15) / 100).toFixed(1),
              offsetY: 10,
              color: $themeColors.light,
              fontSize: '2.86rem',
              fontWeight: '600',
            },
          },
        },
      },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'horizontal',
          shadeIntensity: 0.5,
          gradientToColors: [$themeColors.success],
          inverseColors: true,
          opacityFrom: 1,
          opacityTo: 1,
          stops: [0, 100],
        },
      },
      stroke: {
        lineCap: 'round',
      },
      grid: {
        padding: {
          bottom: 30,
        },
      },
    };

    const cpuRadialBarSmall = {
      chart: smallchart,
      colors: [$themeColors.primary],
      labels: ['Cores'],
      plotOptions: {
        radialBar: {
          offsetY: -10,
          startAngle: -150,
          endAngle: 150,
          hollow: {
            size: '70%',
          },
          track: {
            background: $themeColors.dark,
            strokeWidth: '50%',
          },
          dataLabels: {
            name: {
              offsetY: -15,
              color: $themeColors.light,
              fontSize: '1.2rem',
            },
            value: {
              formatter: (val) => ((parseFloat(val) * 15) / 100).toFixed(1),
              offsetY: 10,
              color: $themeColors.light,
              fontSize: '2rem',
              fontWeight: '400',
            },
          },
        },
      },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'horizontal',
          shadeIntensity: 0.5,
          gradientToColors: [$themeColors.success],
          inverseColors: true,
          opacityFrom: 1,
          opacityTo: 1,
          stops: [0, 100],
        },
      },
      stroke: {
        lineCap: 'round',
      },
      grid: {
        padding: {
          bottom: 10,
        },
      },
    };

    const ramRadialBar = {
      chart: largechart,
      colors: [$themeColors.primary],
      labels: ['MB'],
      plotOptions: {
        radialBar: {
          offsetY: -10,
          startAngle: -150,
          endAngle: 150,
          hollow: {
            size: '77%',
          },
          track: {
            background: $themeColors.dark,
            strokeWidth: '50%',
          },
          dataLabels: {
            name: {
              offsetY: -15,
              color: $themeColors.light,
              fontSize: '1.5rem',
            },
            value: {
              formatter: (val) => ((parseFloat(val) * 59000) / 100).toFixed(0),
              offsetY: 10,
              color: $themeColors.light,
              fontSize: '2.86rem',
              fontWeight: '600',
            },
          },
        },
      },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'horizontal',
          shadeIntensity: 0.5,
          gradientToColors: [$themeColors.success],
          inverseColors: true,
          opacityFrom: 1,
          opacityTo: 1,
          stops: [0, 100],
        },
      },
      stroke: {
        lineCap: 'round',
      },
      grid: {
        padding: {
          bottom: 30,
        },
      },
    };

    const ramRadialBarSmall = {
      chart: smallchart,
      colors: [$themeColors.primary],
      labels: ['MB'],
      plotOptions: {
        radialBar: {
          offsetY: -10,
          startAngle: -150,
          endAngle: 150,
          hollow: {
            size: '70%',
          },
          track: {
            background: $themeColors.dark,
            strokeWidth: '50%',
          },
          dataLabels: {
            name: {
              offsetY: -15,
              color: $themeColors.light,
              fontSize: '1.2rem',
            },
            value: {
              formatter: (val) => ((parseFloat(val) * 59000) / 100).toFixed(0),
              offsetY: 10,
              color: $themeColors.light,
              fontSize: '2rem',
              fontWeight: '400',
            },
          },
        },
      },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'horizontal',
          shadeIntensity: 0.5,
          gradientToColors: [$themeColors.success],
          inverseColors: true,
          opacityFrom: 1,
          opacityTo: 1,
          stops: [0, 100],
        },
      },
      stroke: {
        lineCap: 'round',
      },
      grid: {
        padding: {
          bottom: 10,
        },
      },
    };

    const hddRadialBar = {
      chart: largechart,
      colors: [$themeColors.primary],
      labels: ['GB'],
      plotOptions: {
        radialBar: {
          offsetY: -10,
          startAngle: -150,
          endAngle: 150,
          hollow: {
            size: '77%',
          },
          track: {
            background: $themeColors.dark,
            strokeWidth: '50%',
          },
          dataLabels: {
            name: {
              offsetY: -15,
              color: $themeColors.light,
              fontSize: '1.5rem',
            },
            value: {
              formatter: (val) => ((parseFloat(val) * 820) / 100).toFixed(0),
              offsetY: 10,
              color: $themeColors.light,
              fontSize: '2.86rem',
              fontWeight: '600',
            },
          },
        },
      },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'horizontal',
          shadeIntensity: 0.5,
          gradientToColors: [$themeColors.success],
          inverseColors: true,
          opacityFrom: 1,
          opacityTo: 1,
          stops: [0, 100],
        },
      },
      stroke: {
        lineCap: 'round',
      },
      grid: {
        padding: {
          bottom: 30,
        },
      },
    };

    const hddRadialBarSmall = {
      chart: smallchart,
      colors: [$themeColors.primary],
      labels: ['GB'],
      plotOptions: {
        radialBar: {
          offsetY: -10,
          startAngle: -150,
          endAngle: 150,
          hollow: {
            size: '70%',
          },
          track: {
            background: $themeColors.dark,
            strokeWidth: '50%',
          },
          dataLabels: {
            name: {
              offsetY: -15,
              color: $themeColors.light,
              fontSize: '1.2rem',
            },
            value: {
              formatter: (val) => ((parseFloat(val) * 820) / 100).toFixed(0),
              offsetY: 10,
              color: $themeColors.light,
              fontSize: '2rem',
              fontWeight: '400',
            },
          },
        },
      },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'horizontal',
          shadeIntensity: 0.5,
          gradientToColors: [$themeColors.success],
          inverseColors: true,
          opacityFrom: 1,
          opacityTo: 1,
          stops: [0, 100],
        },
      },
      stroke: {
        lineCap: 'round',
      },
      grid: {
        padding: {
          bottom: 10,
        },
      },
    };

    const copyMessageToSign = async () => {
      const { copy } = useClipboard({ source: dataToSign.value, legacy: true });
      copy();
      tooltipText.value = 'Copied!';
      setTimeout(async () => {
        await nextTick();
        const button = copyButtonRef.value;
        if (button) {
          button.blur();
          tooltipText.value = '';
        }
      }, 1000);
      setTimeout(() => {
        tooltipText.value = 'Copy to clipboard';
      }, 1500);
    };

    const register = async () => {
      const zelidauth = localStorage.getItem('zelidauth');
      const data = {
        type: registrationtype.value,
        version: version.value,
        appSpecification: dataForAppRegistration.value,
        timestamp: timestamp.value,
        signature: signature.value,
      };
      showToast('info', 'Propagating message accross Flux network...');
      const response = await AppsService.registerApp(zelidauth, data).catch((error) => {
        showToast('danger', error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        registrationHash.value = response.data.data;
        showToast('success', response.data.data.message || response.data.data);
      } else {
        showToast('danger', response.data.data.message || response.data.data);
      }
    };

    const componentSelected = (component) => {
      currentComponent.value = props.appData.compose[component];
    };

    const confirmLaunchDialogFinish = () => {
      confirmLaunchDialogCloseShowing.value = true;
    };

    const confirmLaunchDialogCancel = (modalEvt) => {
      if (registrationHash.value !== null) {
        modalEvt.preventDefault();
        confirmLaunchDialogCloseShowing.value = true;
      }
    };

    return {
      // UI
      perfectScrollbarSettings,
      resolveTagVariant,

      resolveCpu,
      resolveRam,
      resolveHdd,

      constructAutomaticDomains,
      checkFluxSpecificationsAndFormatMessage,

      timeoptions,

      cpuRadialBar,
      cpuRadialBarSmall,
      cpu,

      ramRadialBar,
      ramRadialBarSmall,
      ram,

      hddRadialBar,
      hddRadialBarSmall,
      hdd,

      userZelid,
      dataToSign,
      selectedGeolocation,
      contact,
      signClient,
      signature,
      appPricePerDeployment,
      appPricePerDeploymentUSD,
      applicationPriceFluxDiscount,
      applicationPriceFluxError,
      fiatCheckoutURL,
      registrationHash,
      deploymentAddress,

      validTill,
      subscribedTill,

      register,
      callbackValue,
      initiateSignWS,
      initMetamask,
      initSSP,
      initSSPpay,
      initPaypalPay,
      initStripePay,
      openSite,
      initWalletConnect,
      onSessionConnect,
      siwe,
      copyMessageToSign,

      launchModalShowing,
      componentParamsModalShowing,
      confirmLaunchDialogCloseShowing,
      confirmLaunchDialogFinish,
      confirmLaunchDialogCancel,

      currentComponent,
      componentSelected,

      tierColors,

      skin,
      isDark,
      tooltipText,
      copyButtonRef,
    };
  },
};
</script>

<style scoped>
#registrationmessage {
  padding-right: 25px !important;
}
.text-wrap {
  position: relative;
  padding: 0em;
}
.clipboard.icon {
  position: absolute;
    top: 0.4em;
    right: 1.7em;
  margin-top: 4px;
  margin-left: 4px;
  width: 12px;
  height: 12px;
  border: solid 1px #333333;
  border-top: none;
  border-radius: 1px;
  cursor: pointer;
}
.inline {
  display: inline;
  padding-left: 5px;
}
.loginRow {
  display: flex;
  flex-direction: row;
  justify-content: space-around;
  align-items: center;
  margin-bottom: 10px;
}
.zelidLogin {
  margin-left: 5px;
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
.sspLogin {
  height: 90px;
  padding: 10px;
  margin-left: 5px;
}
.sspLogin img {
  -webkit-app-region: no-drag;
  transition: 0.1s;
}

.stripePay {
  margin-left: 5px;
  height: 90px;
  padding: 10px;
}
.stripePay img {
  -webkit-app-region: no-drag;
  transition: 0.1s;
}
.paypalPay {
  margin-left: 5px;
  height: 90px;
  padding: 10px;
}
.paypalPay img {
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
.text-decoration-line-through {
  text-decoration: line-through;
}
.wizard-card {
  height: 250px;
}
</style>
<style lang="scss">
@import "@core/scss/vue/libs/vue-wizard.scss";
</style>
