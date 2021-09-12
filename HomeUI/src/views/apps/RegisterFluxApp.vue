<template>
  <div>
    <b-card>
      <b-card-sub-title>
        Note: Only verified developers and images can currently run on Flux. To become a verified developer with whitelisted images, please contact the Flux Team via
        <b-link
          href="https://discord.io/runonflux"
          target="_blank"
          active-class="primary"
        >
          Discord
        </b-link>.
      </b-card-sub-title>
    </b-card>
    <b-row class="match-height">
      <b-col
        xs="12"
        xl="6"
      >
        <b-card title="Details">
          <b-form-group
            label-cols="2"
            label="Version"
            label-for="version"
          >
            <b-form-input
              id="version"
              v-model="appRegistrationSpecification.version"
              placeholder="2"
              readonly
            />
          </b-form-group>
          <b-form-group
            label-cols="2"
            label="Name"
            label-for="name"
          >
            <b-form-input
              id="name"
              v-model="appRegistrationSpecification.name"
              placeholder="App Name"
            />
          </b-form-group>
          <b-form-group
            label-cols="2"
            label="Desc."
            label-for="desc"
          >
            <b-form-textarea
              id="desc"
              v-model="appRegistrationSpecification.description"
              placeholder="Description"
              rows="3"
            />
          </b-form-group>
          <b-form-group
            label-cols="2"
            label="Repo"
            label-for="repo"
          >
            <b-form-input
              id="repo"
              v-model="appRegistrationSpecification.repotag"
              placeholder="Docker Hub namespace/repository:tag"
            />
          </b-form-group>
          <b-form-group
            label-cols="2"
            label="Owner"
            label-for="owner"
          >
            <b-form-input
              id="owner"
              v-model="appRegistrationSpecification.owner"
              placeholder="ZelID of Application Owner"
            />
          </b-form-group>
        </b-card>
      </b-col>
      <b-col
        xs="12"
        xl="6"
      >
        <b-card title="Environment">
          <div class="form-row form-group">
            <label class="col-3 col-form-label">
              Ports
              <v-icon
                v-b-tooltip.hover.top="'Array of Ports on which application will be available'"
                name="info-circle"
                class="mr-1"
              />
            </label>
            <div class="col">
              <b-form-input
                id="ports"
                v-model="appRegistrationSpecification.ports"
              />
            </div>
          </div>
          <div class="form-row form-group">
            <label class="col-3 col-form-label">
              Domains
              <v-icon
                v-b-tooltip.hover.top="'Array of strings of Domains managed by Flux Domain Manager (FDM). Length must correspond to available ports. Use empty strings for no domains'"
                name="info-circle"
                class="mr-1"
              />
            </label>
            <div class="col">
              <b-form-input
                id="domains"
                v-model="appRegistrationSpecification.domains"
              />
            </div>
          </div>
          <div class="form-row form-group">
            <label class="col-3 col-form-label">
              Environment
              <v-icon
                v-b-tooltip.hover.top="'Array of strings of Environmental Parameters'"
                name="info-circle"
                class="mr-1"
              />
            </label>
            <div class="col">
              <b-form-input
                id="enviromentParameters"
                v-model="appRegistrationSpecification.enviromentParameters"
              />
            </div>
          </div>
          <div class="form-row form-group">
            <label class="col-3 col-form-label">
              Commands
              <v-icon
                v-b-tooltip.hover.top="'Array of strings of Commands'"
                name="info-circle"
                class="mr-1"
              />
            </label>
            <div class="col">
              <b-form-input
                id="commands"
                v-model="appRegistrationSpecification.commands"
              />
            </div>
          </div>
          <div class="form-row form-group">
            <label class="col-3 col-form-label">
              Cont. Ports
              <v-icon
                v-b-tooltip.hover.top="'Container Ports - Array of ports which your container has'"
                name="info-circle"
                class="mr-1"
              />
            </label>
            <div class="col">
              <b-form-input
                id="containerPorts"
                v-model="appRegistrationSpecification.containerPorts"
              />
            </div>
          </div>
          <div class="form-row form-group">
            <label class="col-3 col-form-label">
              Cont. Data
              <v-icon
                v-b-tooltip.hover.top="'Data folder that is shared by application to App volume'"
                name="info-circle"
                class="mr-1"
              />
            </label>
            <div class="col">
              <b-form-input
                id="containerData"
                v-model="appRegistrationSpecification.containerData"
              />
            </div>
          </div>
        </b-card>
      </b-col>
    </b-row>
    <b-row class="match-height">
      <b-col xs="12">
        <b-card>
          <b-card-title>
            Resources &nbsp;&nbsp;&nbsp;<h6 class="inline text-small">
              (Tiered:
              <b-form-checkbox
                id="tiered"
                v-model="appRegistrationSpecification.tiered"
                switch
                class="custom-control-primary inline"
              />
              )
            </h6>
          </b-card-title>
          <b-form-group
            label-cols="2"
            label-cols-lg="1"
            label="CPU"
            label-for="cpu"
          >
            <div class="mx-1">
              {{ appRegistrationSpecification.cpu }}
            </div>
            <b-form-input
              id="cpu"
              v-model="appRegistrationSpecification.cpu"
              placeholder="CPU cores to use by default"
              type="range"
              min="0"
              max="7"
              step="0.1"
            />
          </b-form-group>
          <b-form-group
            label-cols="2"
            label-cols-lg="1"
            label="RAM"
            label-for="ram"
          >
            <div class="mx-1">
              {{ appRegistrationSpecification.ram }}
            </div>
            <b-form-input
              id="ram"
              v-model="appRegistrationSpecification.ram"
              placeholder="RAM in MB value to use by default"
              type="range"
              min="0"
              max="28000"
              step="100"
            />
          </b-form-group>
          <b-form-group
            label-cols="2"
            label-cols-lg="1"
            label="SSD"
            label-for="ssd"
          >
            <div class="mx-1">
              {{ appRegistrationSpecification.hdd }}
            </div>
            <b-form-input
              id="ssd"
              v-model="appRegistrationSpecification.hdd"
              placeholder="SSD in GB value to use by default"
              type="range"
              min="0"
              max="570"
              step="1"
            />
          </b-form-group>
        </b-card>
      </b-col>
    </b-row>
    <b-row v-if="appRegistrationSpecification.tiered">
      <b-col
        xs="12"
        md="6"
        lg="4"
      >
        <b-card title="Cumulus">
          <div>
            CPU: {{ appRegistrationSpecification.cpubasic }}
          </div>
          <b-form-input
            v-model="appRegistrationSpecification.cpubasic"
            type="range"
            min="0"
            max="1"
            step="0.1"
          />
          <div>
            RAM: {{ appRegistrationSpecification.rambasic }}
          </div>
          <b-form-input
            v-model="appRegistrationSpecification.rambasic"
            type="range"
            min="0"
            max="1000"
            step="100"
          />
          <div>
            SSD: {{ appRegistrationSpecification.hddbasic }}
          </div>
          <b-form-input
            v-model="appRegistrationSpecification.hddbasic"
            type="range"
            min="0"
            max="20"
            step="1"
          />
        </b-card>
      </b-col>
      <b-col
        xs="12"
        md="6"
        lg="4"
      >
        <b-card title="Nimbus">
          <div>
            CPU: {{ appRegistrationSpecification.cpusuper }}
          </div>
          <b-form-input
            v-model="appRegistrationSpecification.cpusuper"
            type="range"
            min="0"
            max="3"
            step="0.1"
          />
          <div>
            RAM: {{ appRegistrationSpecification.ramsuper }}
          </div>
          <b-form-input
            v-model="appRegistrationSpecification.ramsuper"
            type="range"
            min="0"
            max="5000"
            step="100"
          />
          <div>
            SSD: {{ appRegistrationSpecification.hddsuper }}
          </div>
          <b-form-input
            v-model="appRegistrationSpecification.hddsuper"
            type="range"
            min="0"
            max="120"
            step="1"
          />
        </b-card>
      </b-col>
      <b-col
        xs="12"
        lg="4"
      >
        <b-card title="Stratus">
          <div>
            CPU: {{ appRegistrationSpecification.cpubamf }}
          </div>
          <b-form-input
            v-model="appRegistrationSpecification.cpubamf"
            type="range"
            min="0"
            max="7"
            step="0.1"
          />
          <div>
            RAM: {{ appRegistrationSpecification.rambamf }}
          </div>
          <b-form-input
            v-model="appRegistrationSpecification.rambamf"
            type="range"
            min="0"
            max="28000"
            step="100"
          />
          <div>
            SSD: {{ appRegistrationSpecification.hddbamf }}
          </div>
          <b-form-input
            v-model="appRegistrationSpecification.hddbamf"
            type="range"
            min="0"
            max="570"
            step="1"
          />
        </b-card>
      </b-col>
    </b-row>
    <div class="text-center">
      <b-button
        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
        variant="success"
        aria-label="Compute Registration Message"
        class="mb-2"
        @click="checkFluxSpecificationsAndFormatMessage"
      >
        Compute Registration Message
      </b-button>
    </div>
    <div v-if="dataToSign">
      <b-form-group
        label-cols="3"
        label-cols-lg="2"
        label="Registration Message"
        label-for="registrationmessage"
      >
        <b-form-textarea
          id="registrationmessage"
          v-model="dataToSign"
          rows="6"
          readonly
        />
      </b-form-group>
      <b-form-group
        label-cols="3"
        label-cols-lg="2"
        label="Signature"
        label-for="signature"
      >
        <b-form-input
          id="signature"
          v-model="signature"
        />
      </b-form-group>
      <b-row class="match-height">
        <b-col
          xs="6"
          lg="8"
        >
          <b-card title="Register App">
            <b-card-text>
              Price per Month: {{ appPricePerMonth }} FLUX
            </b-card-text>
            <b-button
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Register Flux App"
              class="my-1"
              @click="register"
            >
              Register Flux App
            </b-button>
          </b-card>
        </b-col>
        <b-col
          xs="6"
          lg="4"
        >
          <b-card title="Sign with ZelCore">
            <a
              :href="'zel:?action=sign&message=' + dataToSign + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=' + callbackValue"
              @click="initiateSignWS"
            >
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
      <b-row
        v-if="registrationHash"
        class="match-height"
      >
        <b-col
          xs="6"
          lg="8"
        >
          <b-card>
            <b-card-text>
              To finish the application update, please make a transaction of {{ appPricePerMonth }} FLUX to address
              '{{ fluxapps.apps.address }}'
              with the following message:
              '{{ registrationHash }}'
            </b-card-text>
            <br>
            The transaction must be mined by {{ new Date(validTill).toLocaleString('en-GB', timeoptions.shortDate) }}
            <br><br>
            The application will be subscribed until {{ new Date(subscribedTill).toLocaleString('en-GB', timeoptions.shortDate) }}
          </b-card>
        </b-col>
        <b-col
          xs="6"
          lg="4"
        >
          <b-card title="Pay with ZelCore">
            <a :href="'zel:?action=pay&coin=zelcash&address=' + fluxapps.apps.address + '&amount=' + appPricePerMonth + '&message=' + registrationHash + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png'">
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
    </div>
  </div>
</template>

<script>
import {
  BButton,
  BCard,
  BCardSubTitle,
  BCardText,
  BCardTitle,
  BFormCheckbox,
  BFormGroup,
  BFormInput,
  BFormTextarea,
  BLink,
  VBTooltip,
} from 'bootstrap-vue';

import { mapState } from 'vuex';
import Ripple from 'vue-ripple-directive';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import fluxapps from '@/libs/fluxApps';
import AppsService from '@/services/AppsService';

const qs = require('qs');
const store = require('store');
const timeoptions = require('@/libs/dateFormat');

export default {
  components: {
    BButton,
    BCard,
    BCardSubTitle,
    BCardText,
    BCardTitle,
    BFormCheckbox,
    BFormGroup,
    BFormInput,
    BFormTextarea,
    BLink,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    'b-tooltip': VBTooltip,
    Ripple,
  },
  data() {
    return {
      fluxapps,
      timeoptions,
      version: 1,
      websocket: null,
      dataToSign: '',
      timestamp: '',
      signature: '',
      registrationHash: '',
      registrationtype: 'fluxappregister',
      appRegistrationSpecification: {
        version: 2,
        name: '',
        description: '',
        repotag: '',
        owner: '',
        ports: '', // []
        domains: '[]',
        enviromentParameters: '[]',
        commands: '[]',
        containerPorts: '[]',
        containerData: '',
        cpu: 0.5,
        ram: 2000,
        hdd: 40,
        tiered: false,
        cpubasic: 0.5,
        rambasic: 500,
        hddbasic: 10,
        cpusuper: 1.5,
        ramsuper: 2500,
        hddsuper: 60,
        cpubamf: 3.5,
        rambamf: 14000,
        hddbamf: 285,
      },
      dataForAppRegistration: {},
    };
  },
  computed: {
    ...mapState('flux', [
      'config',
      'privilege',
    ]),
    appPricePerMonth() {
      const price = fluxapps.appPricePerMonthMethod(this.dataForAppRegistration);
      return price;
    },
    validTill() {
      const expTime = this.timestamp + 60 * 60 * 1000; // 1 hour
      return expTime;
    },
    subscribedTill() {
      const expTime = this.timestamp + 30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000; // 1 month
      return expTime;
    },
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
        if (typeof hostname === 'string') {
          this.$store.commit('flux/setUserIp', hostname);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += this.config.apiPort;
      }
      const backendURL = store.get('backendURL') || mybackend;
      const url = `${backendURL}/zelid/providesign`;
      return encodeURI(url);
    },
  },
  watch: {
    appRegistrationSpecification: {
      handler() {
        this.dataToSign = '';
        this.signature = '';
        this.timestamp = null;
        this.dataForAppRegistration = {};
        this.registrationHash = '';
        if (this.websocket !== null) {
          this.websocket.close();
          this.websocket = null;
        }
      },
      deep: true,
    },
  },
  mounted() {
    this.getRandomPort();
    this.registrationInformation();
    const zelidauth = localStorage.getItem('zelidauth');
    const auth = qs.parse(zelidauth);
    this.appRegistrationSpecification.owner = auth.zelid;
  },
  methods: {
    async checkFluxSpecificationsAndFormatMessage() {
      try {
        let appSpecification = this.appRegistrationSpecification;
        console.log(appSpecification);
        appSpecification = this.ensureObject(appSpecification);
        let { version } = appSpecification; // shall be 2
        let { name } = appSpecification;
        let { description } = appSpecification;
        let { repotag } = appSpecification;
        let { owner } = appSpecification;
        let { ports } = appSpecification;
        let { domains } = appSpecification;
        let { enviromentParameters } = appSpecification;
        let { commands } = appSpecification;
        let { containerPorts } = appSpecification;
        let { containerData } = appSpecification;
        let { cpu } = appSpecification;
        let { ram } = appSpecification;
        let { hdd } = appSpecification;
        const { tiered } = appSpecification;
        // check if signature of received data is correct
        if (!version || !name || !description || !repotag || !owner || !ports || !domains || !enviromentParameters || !commands || !containerPorts || !containerData || !cpu || !ram || !hdd) {
          throw new Error('Missing App specification parameter');
        }
        version = this.ensureNumber(version);
        name = this.ensureString(name);
        description = this.ensureString(description);
        repotag = this.ensureString(repotag);
        owner = this.ensureString(owner);
        ports = this.ensureObject(ports);
        const portsCorrect = [];
        if (Array.isArray(ports)) {
          ports.forEach((parameter) => {
            const param = this.ensureString(parameter); // todo ensureNumber
            portsCorrect.push(param);
          });
        } else {
          throw new Error('Ports parameters for App are invalid');
        }
        domains = this.ensureObject(domains);
        const domainsCorrect = [];
        if (Array.isArray(domains)) {
          domains.forEach((parameter) => {
            const param = this.ensureString(parameter);
            domainsCorrect.push(param);
          });
        } else {
          throw new Error('Domains for Flux App are invalid');
        }
        enviromentParameters = this.ensureObject(enviromentParameters);
        const envParamsCorrected = [];
        if (Array.isArray(enviromentParameters)) {
          enviromentParameters.forEach((parameter) => {
            const param = this.ensureString(parameter);
            envParamsCorrected.push(param);
          });
        } else {
          throw new Error('Enviromental parameters for App are invalid');
        }
        commands = this.ensureObject(commands);
        const commandsCorrected = [];
        if (Array.isArray(commands)) {
          commands.forEach((command) => {
            const cmm = this.ensureString(command);
            commandsCorrected.push(cmm);
          });
        } else {
          throw new Error('App commands are invalid');
        }
        containerPorts = this.ensureObject(containerPorts);
        const containerportsCorrect = [];
        if (Array.isArray(containerPorts)) {
          containerPorts.forEach((parameter) => {
            const param = this.ensureString(parameter); // todo ensureNumber
            containerportsCorrect.push(param);
          });
        } else {
          throw new Error('Container Ports parameters for App are invalid');
        }
        containerData = this.ensureString(containerData);
        cpu = this.ensureNumber(cpu);
        ram = this.ensureNumber(ram);
        hdd = this.ensureNumber(hdd);
        if (typeof tiered !== 'boolean') {
          throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
        }

        // finalised parameters that will get stored in global database
        const appSpecFormatted = {
          version, // integer
          name, // string
          description, // string
          repotag, // string
          owner, // zelid string
          ports: portsCorrect, // array of integers
          domains: domainsCorrect, //  array of strings
          enviromentParameters: envParamsCorrected, // array of strings
          commands: commandsCorrected, // array of strings
          containerPorts: containerportsCorrect, // array of integers
          containerData, // string
          cpu, // float 0.1 step
          ram, // integer 100 step (mb)
          hdd, // integer 1 step
          tiered, // boolean
        };

        if (tiered) {
          let { cpubasic } = appSpecification;
          let { cpusuper } = appSpecification;
          let { cpubamf } = appSpecification;
          let { rambasic } = appSpecification;
          let { ramsuper } = appSpecification;
          let { rambamf } = appSpecification;
          let { hddbasic } = appSpecification;
          let { hddsuper } = appSpecification;
          let { hddbamf } = appSpecification;
          if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
            throw new Error('App was requested as tiered setup but specifications are missing');
          }
          cpubasic = this.ensureNumber(cpubasic);
          cpusuper = this.ensureNumber(cpusuper);
          cpubamf = this.ensureNumber(cpubamf);
          rambasic = this.ensureNumber(rambasic);
          ramsuper = this.ensureNumber(ramsuper);
          rambamf = this.ensureNumber(rambamf);
          hddbasic = this.ensureNumber(hddbasic);
          hddsuper = this.ensureNumber(hddsuper);
          hddbamf = this.ensureNumber(hddbamf);

          appSpecFormatted.cpubasic = cpubasic;
          appSpecFormatted.cpusuper = cpusuper;
          appSpecFormatted.cpubamf = cpubamf;
          appSpecFormatted.rambasic = rambasic;
          appSpecFormatted.ramsuper = ramsuper;
          appSpecFormatted.rambamf = rambamf;
          appSpecFormatted.hddbasic = hddbasic;
          appSpecFormatted.hddsuper = hddsuper;
          appSpecFormatted.hddbamf = hddbamf;
        }
        // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper port, repotag exists, string lengths, specs are ok
        if (version !== 2) {
          throw new Error('App message version specification is invalid');
        }
        if (name.length > 32) {
          throw new Error('App name is too long');
        }
        // furthermore name cannot contain any special character
        if (!name.match(/^[a-zA-Z0-9]+$/)) {
          throw new Error('App name contains special characters. Only a-z, A-Z and 0-9 are allowed');
        }
        if (name.startsWith('zel')) {
          throw new Error('App name can not start with zel');
        }
        if (name.startsWith('flux')) {
          throw new Error('App name can not start with flux');
        }
        if (description.length > 256) {
          throw new Error('Description is too long. Maximum of 256 characters is allowed');
        }
        const parameters = fluxapps.checkHWParameters(appSpecFormatted);
        if (parameters !== true) {
          const errorMessage = parameters;
          throw new Error(errorMessage);
        }

        // check ports is within range
        appSpecFormatted.ports.forEach((port) => {
          if (port < fluxapps.apps.portMin || port > fluxapps.apps.portMax) {
            throw new Error(`Assigned port ${port} is not within Apps range ${fluxapps.apps.portMin}-${fluxapps.apps.portMax}`);
          }
        });

        // check if containerPorts makes sense
        appSpecFormatted.containerPorts.forEach((port) => {
          if (port < 0 || port > 65535) {
            throw new Error(`Container Port ${port} is not within system limits 0-65535`);
          }
        });

        if (appSpecFormatted.containerPorts.length !== appSpecFormatted.ports.length) {
          throw new Error('Ports specifications do not match');
        }

        if (appSpecFormatted.domains.length !== appSpecFormatted.ports.length) {
          throw new Error('Domains specifications do not match available ports');
        }

        if (appSpecFormatted.ports.length > 5) {
          throw new Error('Too many ports defined. Maximum of 5 allowed.');
        }

        // check wheter shared Folder is not root
        if (containerData.length < 2) {
          throw new Error('App container data folder not specified. If no data folder is required, use /tmp');
        }

        // check repotag if available for download
        const splittedRepo = appSpecFormatted.repotag.split(':');
        console.log(splittedRepo);
        if (splittedRepo[0] && splittedRepo[1] && !splittedRepo[2]) {
          const zelidauth = localStorage.getItem('zelidauth');
          const data = {
            repotag: appSpecFormatted.repotag,
          };
          const resDocker = await AppsService.checkDockerExistance(zelidauth, data).catch((error) => {
            this.showToast('danger', error.message || error);
          });
          console.log(resDocker);
          if (resDocker.data.status === 'error') {
            throw resDocker.data.data;
          }
        } else {
          throw new Error('Repository is not in valid format "namespace/repository:tag"');
        }
        this.timestamp = new Date().getTime();
        this.dataForAppRegistration = appSpecFormatted;
        this.dataToSign = this.registrationtype + this.version + JSON.stringify(appSpecFormatted) + this.timestamp;
      } catch (error) {
        console.log(error);
        this.showToast('danger', error.message || error);
      }
    },

    initiateSignWS() {
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
        if (typeof hostname === 'string') {
          this.$store.commit('flux/setUserIp', hostname);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += this.config.apiPort;
      }
      let backendURL = store.get('backendURL') || mybackend;
      backendURL = backendURL.replace('https://', 'wss://');
      backendURL = backendURL.replace('http://', 'ws://');
      const signatureMessage = this.appRegistrationSpecification.owner + this.timestamp;
      const wsuri = `${backendURL}/ws/sign/${signatureMessage}`;
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
        this.signature = data.data.signature;
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

    async register() {
      const zelidauth = localStorage.getItem('zelidauth');
      const data = {
        type: this.registrationtype,
        version: this.version,
        appSpecification: this.dataForAppRegistration,
        timestamp: this.timestamp,
        signature: this.signature,
      };
      const response = await AppsService.registerApp(zelidauth, data).catch((error) => {
        this.showToast('danger', error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        this.registrationHash = response.data.data;
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
    },

    async registrationInformation() {
      const response = await AppsService.appsRegInformation();
      const { data } = response.data;
      if (response.data.status === 'success') {
        fluxapps.apps.price.cpu = data.price.cpu;
        fluxapps.apps.price.hdd = data.price.hdd;
        fluxapps.apps.price.ram = data.price.ram;
        fluxapps.apps.address = data.address;
        fluxapps.apps.epochstart = data.epochstart;
        fluxapps.apps.portMin = data.portMin;
        fluxapps.apps.portMax = data.portMax;
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
    },

    getRandomPort() {
      const min = 31001;
      const max = 39998;
      const portsArray = [];
      const port = Math.floor(Math.random() * (max - min) + min);
      portsArray.push(port);
      this.appRegistrationSpecification.ports = JSON.stringify(portsArray);
    },

    ensureBoolean(parameter) {
      let param;
      if (parameter === 'false' || parameter === 0 || parameter === '0' || parameter === false) {
        param = false;
      }
      if (parameter === 'true' || parameter === 1 || parameter === '1' || parameter === true) {
        param = true;
      }
      return param;
    },
    ensureNumber(parameter) {
      return typeof parameter === 'number' ? parameter : Number(parameter);
    },
    ensureObject(parameter) {
      if (typeof parameter === 'object') {
        return parameter;
      }
      let param;
      try {
        param = JSON.parse(parameter);
      } catch (e) {
        param = qs.parse(parameter);
      }
      return param;
    },
    ensureString(parameter) {
      return typeof parameter === 'string' ? parameter : JSON.stringify(parameter);
    },

    showToast(variant, title, icon = 'InfoIcon') {
      this.$toast({
        component: ToastificationContent,
        props: {
          title,
          icon,
          variant,
        },
      });
    },
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
</style>
