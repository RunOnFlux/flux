<template>
  <div class="app-details">
    <!-- Email Header -->
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

    <!-- Email Details -->
    <vue-perfect-scrollbar
      :settings="perfectScrollbarSettings"
      class="proposal-scroll-area scroll-area"
    >
      <b-row class="match-height">
        <b-col
          xxl="9"
          xl="8"
          lg="6"
        >
          <b-card title="Details">
            <b-form-textarea
              id="textarea-rows"
              rows="2"
              readonly
              :value="appData.description"
              class="description-text"
            />
            <b-card
              class="mt-1"
              no-body
            >
              <b-tabs
                @activate-tab="componentSelected"
              >
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
                    v-if="component.userParameters"
                    title="Parameters"
                    border-variant="primary"
                  >
                    <b-tabs v-if="component.userParameters">
                      <b-tab
                        v-for="(parameter, paramIndex) in component.userParameters"
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
          lg="6"
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
          variant="success"
          aria-label="Launch Marketplace App"
          class="mb-2"
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
          :data="constructAutomaticDomains(currentComponent.ports, currentComponent.name, appData.name).join(', ')"
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
      v-model="launchModalShowing"
      title="Launching Marketplace App"
      size="xlg"
      centered
      no-close-on-backdrop
      no-close-on-esc
      button-size="sm"
      ok-only
      ok-title="Cancel"
    >
      <form-wizard
        :color="tierColors.cumulus"
        :title="null"
        :subtitle="null"
        layout="vertical"
        back-button-text="Previous"
        class="wizard-vertical mb-3"
      >
        <tab-content title="Check Registration">
          <b-card
            title="Registration Message"
            class="text-center wizard-card"
          >
            <b-form-textarea
              id="registrationmessage"
              v-model="dataToSign"
              rows="6"
              readonly
            />
          </b-card>
        </tab-content>
        <tab-content
          title="Sign App Message"
          :before-change="() => signature !== null"
        >
          <b-card
            title="Sign App Message with Zelcore"
            class="text-center wizard-card"
          >
            <a
              :href="'zel:?action=sign&message=' + dataToSign + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=' + callbackValue"
              @click="initiateSignWS"
            >
              <img
                class="zelidLogin mb-2"
                src="@/assets/images/zelID.svg"
                alt="Zel ID"
                height="100%"
                width="100%"
              >
            </a>
            <b-form-input
              id="signature"
              v-model="signature"
            />
          </b-card>
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
              Price per Month: {{ appPricePerMonth }} FLUX
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
          <b-row class="match-height">
            <b-col
              lg="8"
            >
              <b-card
                title="Send Payment"
                class="text-center wizard-card"
              >
                <b-card-text>
                  To finish the application update, please make a transaction of {{ appPricePerMonth }} FLUX to address<br>
                  '{{ deploymentAddress }}'<br>
                  with the following message<br>
                  '{{ registrationHash }}'
                </b-card-text>
                <br>
                The transaction must be mined by {{ new Date(validTill).toLocaleString('en-GB', timeoptions.shortDate) }}
                <br><br>
                The application will be subscribed until {{ new Date(subscribedTill).toLocaleString('en-GB', timeoptions.shortDate) }}
              </b-card>
            </b-col>
            <b-col
              lg="4"
            >
              <b-card
                title="Pay with Zelcore"
                class="text-center wizard-card"
              >
                <a :href="'zel:?action=pay&coin=zelcash&address=' + deploymentAddress + '&amount=' + appPricePerMonth + '&message=' + registrationHash + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png'">
                  <img
                    class="zelidLogin"
                    src="@/assets/images/zelID.svg"
                    alt="Zel ID"
                    height="100%"
                    width="100%"
                  >
                </a>
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
} from '@vue/composition-api';

import ListEntry from '@/views/components/ListEntry.vue';
import AppsService from '@/services/AppsService';
import tierColors from '@/libs/colors';

const qs = require('qs');
const store = require('store');
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
  setup(props, ctx) {
    // Use toast
    const toast = useToast();

    const resolveTagVariant = (status) => {
      if (status === 'Open') return 'warning';
      if (status === 'Passed') return 'success';
      if (status === 'Unpaid') return 'info';
      if (status && status.startsWith('Rejected')) return 'danger';
      return 'primary';
    };

    const tier = ref('');
    tier.value = props.tier;
    const userZelid = ref('');
    userZelid.value = props.zelid;

    // Variables to control showing dialogs
    const launchModalShowing = ref(false);
    const componentParamsModalShowing = ref(false);

    // Holds the currently selected component, for viewing
    // additional parameters in a modal dialog
    const currentComponent = ref(null);

    // Registration variables
    const version = ref(1);
    const registrationtype = ref('fluxappregister');
    const dataToSign = ref(null);
    const signature = ref(null);
    const dataForAppRegistration = ref(null);
    const timestamp = ref(null);
    const appPricePerMonth = ref(0);
    const registrationHash = ref(null);
    const websocket = ref(null);

    const config = computed(() => ctx.root.$store.state.flux.config);
    const validTill = computed(() => timestamp.value + 60 * 60 * 1000); // 1 hour
    const subscribedTill = computed(() => timestamp.value + 30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000); // 1 month

    const callbackValue = computed(() => {
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
        if (typeof hostname === 'string') {
          ctx.root.$store.commit('flux/setUserIp', hostname);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += config.value.apiPort;
      }
      const backendURL = store.get('backendURL') || mybackend;
      const url = `${backendURL}/id/providesign`;
      return encodeURI(url);
    });

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

    const initiateSignWS = () => {
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
        if (typeof hostname === 'string') {
          ctx.root.$store.commit('flux/setUserIp', hostname);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += config.value.apiPort;
      }
      let backendURL = store.get('backendURL') || mybackend;
      backendURL = backendURL.replace('https://', 'wss://');
      backendURL = backendURL.replace('http://', 'ws://');
      const signatureMessage = props.appData.owner + timestamp.value;
      const wsuri = `${backendURL}/ws/sign/${signatureMessage}`;
      const ws = new WebSocket(wsuri);
      websocket.value = ws;

      ws.onopen = (evt) => { onOpen(evt); };
      ws.onclose = (evt) => { onClose(evt); };
      ws.onmessage = (evt) => { onMessage(evt); };
      ws.onerror = (evt) => { onError(evt); };
    };

    const perfectScrollbarSettings = {
      maxScrollbarLength: 150,
    };

    const globalApps = ref([]);
    const getGlobalAppList = async () => {
      const response = await AppsService.globalAppSpecifications();
      globalApps.value = response.data.data;
    };
    const isPortInUse = (port) => {
      for (let i = 0; i < globalApps.value.length; i += 1) {
        const app = globalApps.value[i];
        if (app.version <= 3) {
          if (app.ports.length > 0) {
            const used = app.ports.every((value) => Number(value) === port);
            if (used) return true;
          }
        } else {
          // v4 apps have 1 or more components
          for (let c = 0; c < app.compose.length; c += 1) {
            const component = app.compose[c];
            if (component.ports.length > 0) {
              const used = component.ports.every((value) => Number(value) === port);
              if (used) return true;
            }
          }
        }
      }
      // Check the current app spec, incase of a duplicate port from another component
      for (let c = 0; c < props.appData.compose.length; c += 1) {
        const component = props.appData.compose[c];
        if (component.ports.length > 0) {
          const used = component.ports.every((value) => Number(value) === port);
          if (used) return true;
        }
      }
      return false;
    };
    getGlobalAppList();

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

    watch(() => props.appData, () => {
      if (websocket.value !== null) {
        websocket.value.close();
        websocket.value = null;
      }
      cpu.value = {
        series: [((resolveCpu(props.appData) / 7) * 100)],
      };
      ram.value = {
        series: [((resolveRam(props.appData) / 28000) * 100)],
      };
      hdd.value = {
        series: [((resolveHdd(props.appData) / 570) * 100)],
      };
      // String model for the editable environment parameters
      props.appData.compose.forEach((component) => {
        // eslint-disable-next-line no-param-reassign
        component.environmentParametersModel = component.environmentParameters.join(', ');
      });

      // Create a random port from the app's port specs that is not present on any other app
      props.appData.compose.forEach((component) => {
        // eslint-disable-next-line no-param-reassign
        component.ports = [];
        component.portSpecs.forEach((portSpec) => {
          const portSpecParsed = portSpec.split('-');
          const minPort = Number(portSpecParsed[0]);
          const maxPort = Number(portSpecParsed[1]);
          let checking = true;
          do {
            const newPort = minPort + Math.round(Math.random() * (maxPort - minPort));
            if (!isPortInUse(newPort)) {
              checking = false;
              component.ports.push(newPort);
            }
          } while (checking);
        });
      });

      // Evaluate any user parameters from the database
      props.appData.compose.forEach((component) => {
        try {
          const paramModel = component.userEnvironmentParameters;
          // eslint-disable-next-line no-param-reassign
          component.userParameters = paramModel;

          // check if any of these parameters are special 'port' parameters
          component.userParameters.forEach((parameter) => {
            if (Object.prototype.hasOwnProperty.call(parameter, 'port')) {
              // eslint-disable-next-line no-param-reassign
              parameter.value = component.ports[parameter.port];
            }
          });
        } catch (error) {
          console.log(error);
        }
      });

      currentComponent.value = props.appData.compose[0];

      // Work out the current number of these apps on the network
      // so we can generate a unique name for the app
      console.log(globalApps.value);
      const appNames = globalApps.value.map((app) => app.name);
      // ok, for testing there are no matching marketplace apps
      const now = Date.now();
      appNames.push(`${props.appData.name}${now - 100000}`);
      appNames.push(`${props.appData.name}${now - 50000}`);
      appNames.push(`${props.appData.name}${now - 25000}`);
      appNames.push(`${props.appData.name}${now - 10000}`);
      appNames.push(`${props.appData.name}${now - 5000}`);
      console.log(appNames);
      const marketplaceApps = appNames.filter((name) => {
        if (name.length < 14) return false;
        const possibleDateString = name.substring(name.length - 13, name.length);
        const possibleDate = Number(possibleDateString);
        if (Number.isNaN(possibleDate)) return false;
        return true;
      });
      console.log(marketplaceApps);
      // const bitBeforenumberLength = `${props.appData.name}${separator}`.length + 2;
      // const marketplaceAppsMaxNumber = marketplaceApps.map((name) => Number(name.substring(bitBeforenumberLength, name.length))).reduce((acc, value) => Math.max(acc, value));
      // latestAppCount = marketplaceAppsMaxNumber;
      // console.log(marketplaceAppsMaxNumber);
    });

    const constructUniqueAppName = (appName) => `${appName}${Date.now()}`;

    const constructAutomaticDomains = (ports, componentName = '', appName) => {
      if (!userZelid.value) {
        return ['No ZelID'];
      }
      const domainString = 'abcdefghijklmno'; // enough
      const appNameWithTimestamp = constructUniqueAppName(appName);
      const lowerCaseName = appNameWithTimestamp.toLowerCase();
      const lowerCaseCopmonentName = componentName.toLowerCase();
      if (!lowerCaseCopmonentName) {
        const domains = [`${lowerCaseName}.app.runonflux.io`];
        // flux specs dont allow more than 10 ports so domainString is enough
        for (let i = 0; i < ports.length; i += 1) {
          const portDomain = `${domainString[i]}.${lowerCaseName}.app.runonflux.io`;
          domains.push(portDomain);
        }
        return domains;
      }
      const domains = [`${lowerCaseName}.app.runonflux.io`, `${lowerCaseCopmonentName}.${lowerCaseName}.app.runonflux.io`];
      // flux specs dont allow more than 10 ports so domainString is enough
      for (let i = 0; i < ports.length; i += 1) {
        const portDomain = `${domainString[i]}.${lowerCaseCopmonentName}.${lowerCaseName}.app.runonflux.io`;
        domains.push(portDomain);
      }
      return domains;
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

    const deploymentAddress = ref(null);
    const appsDeploymentInformation = async () => {
      const response = await AppsService.appsRegInformation();
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
        const appSpecification = {
          version: props.appData.version,
          name: constructUniqueAppName(props.appData.name),
          description: props.appData.description,
          owner: userZelid.value,
          instances: props.appData.instances,
          compose: [],
        };
        // formation, pre verificaiton
        props.appData.compose.forEach((component) => {
          const envParams = component.environmentParameters;
          component.userParameters.forEach((param) => {
            envParams.push(`${param.name}=${param.value}`);
          });
          const appComponent = {
            name: component.name,
            description: component.description,
            repotag: component.repotag,
            ports: component.ports,
            containerPorts: component.containerPorts,
            environmentParameters: envParams,
            commands: component.commands,
            containerData: component.containerData,
            domains: component.domains,
            cpu: component.cpu,
            ram: component.ram,
            hdd: component.hdd,
            tiered: component.tiered,
            cpubasic: component.cpubasic,
            rambasic: component.rambasic,
            hddbasic: component.hddbasic,
            cpusuper: component.cpusuper,
            ramsuper: component.ramsuper,
            hddsuper: component.hddsuper,
            cpubamf: component.cpubamf,
            rambamf: component.rambamf,
            hddbamf: component.hddbamf,
          };
          appSpecification.compose.push(appComponent);
        });

        console.log(appSpecification);
        // call api for verification of app registration specifications that returns formatted specs
        const responseAppSpecs = await AppsService.appRegistrationVerificaiton(appSpecification);
        console.log(responseAppSpecs);
        if (responseAppSpecs.data.status === 'error') {
          throw new Error(responseAppSpecs.data.data.message || responseAppSpecs.data.data);
        }
        const appSpecFormatted = responseAppSpecs.data.data;
        const response = await AppsService.appPrice(appSpecFormatted);
        if (response.data.status === 'error') {
          throw new Error(response.data.data.message || response.data.data);
        }
        if (response.data.data > props.appData.price) {
          throw new Error('Marketplace App Price is too low');
        }
        timestamp.value = new Date().getTime();
        dataForAppRegistration.value = appSpecFormatted;
        appPricePerMonth.value = props.appData.price;
        dataToSign.value = `${registrationtype.value}${version.value}${JSON.stringify(appSpecFormatted)}${new Date().getTime()}`;
        launchModalShowing.value = true;
      } catch (error) {
        console.log(error);
        showToast('danger', error.message || error);
      }
    };

    const cpuRadialBar = {
      chart: {
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
      },
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
              formatter: (val) => ((parseFloat(val) * 7) / 100).toFixed(1),
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

    const ramRadialBar = {
      chart: {
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
      },
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
              formatter: (val) => ((parseFloat(val) * 28000) / 100).toFixed(0),
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

    const hddRadialBar = {
      chart: {
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
      },
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
              formatter: (val) => ((parseFloat(val) * 570) / 100).toFixed(0),
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

    const register = async () => {
      const zelidauth = localStorage.getItem('zelidauth');
      const data = {
        type: registrationtype.value,
        version: version.value,
        appSpecification: dataForAppRegistration.value,
        timestamp: timestamp.value,
        signature: signature.value,
      };
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
      cpu,

      ramRadialBar,
      ram,

      hddRadialBar,
      hdd,

      userZelid,
      dataToSign,
      signature,
      appPricePerMonth,
      registrationHash,
      deploymentAddress,

      validTill,
      subscribedTill,

      register,
      callbackValue,
      initiateSignWS,

      launchModalShowing,
      componentParamsModalShowing,

      currentComponent,
      componentSelected,

      tierColors,
    };
  },
};
</script>

<style scoped>
.inline {
  display: inline;
  padding-left: 5px;
}
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
.text-decoration-line-through {
  text-decoration: line-through;
}
.wizard-card {
  height: 250px;
}
</style>
<style lang="scss">
  @import '@core/scss/vue/libs/vue-wizard.scss';
</style>
