<template>
  <div>
    <div v-if="zelAppsSection === 'localzelapps'">
      <el-tabs v-model="activeName">
        <el-tab-pane
          label="Running"
          name="running"
        >
          <el-table
            :data="getRunningZelAppsResponse.data"
            empty-text="No ZelApp running"
            style="width: 100%"
          >
            <el-table-column
              label="Name"
              prop="Names"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.Names[0].substr(4, scope.row.Names[0].length) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Image"
              prop="Image"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="Visit"
              prop="visit"
              sortable
            >
              <template slot-scope="scope">
                <ElButton
                  class="generalButton"
                  @click="openZelApp(scope.row.Names[0].substr(1, scope.row.Names[0].length))"
                >
                  Visit
                </ElButton>
              </template>
            </el-table-column>
            <el-table-column
              label="Actions"
              prop="actions"
              sortable
            >
              <template slot-scope="scope">
                <ElButton
                  class="generalButton"
                  @click="stopZelApp(scope.row.Names[0].substr(1, scope.row.Names[0].length))"
                >
                  Stop
                </ElButton>
                <!-- <ElButton
                  class="generalButton"
                  @click="restartZelApp(scope.row.Names[0].substr(1, scope.row.Names[0].length))"
                >
                  Restart
                </ElButton> -->
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane
          label="Installed"
          name="installed"
        >
          <el-table
            :data="installedZelApps.data"
            empty-text="No ZelApp installed"
            style="width: 100%"
          >
            <el-table-column
              label="Name"
              prop="name"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.name.substr(3, scope.row.name.length) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Port"
              prop="port"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="CPU"
              prop="cpu"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveCpu(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="RAM"
              prop="ram"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveRam(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="HDD"
              prop="hdd"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveHdd(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Actions"
              prop="actions"
              sortable
            >
              <template slot-scope="scope">
                <ElButton
                  class="generalButton"
                  @click="startZelApp(scope.row.name)"
                >
                  Start
                </ElButton>
                <ElButton
                  class="generalButton"
                  @click="restartZelApp(scope.row.name)"
                >
                  Restart
                </ElButton>
              </template>
            </el-table-column>
            <el-table-column
              label="Remove"
              prop="remove"
              sortable
            >
              <template slot-scope="scope">
                <ElButton
                  class="generalButton"
                  @click="removeZelApp(scope.row.name)"
                >
                  Remove
                </ElButton>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane
          label="Available"
          name="available"
        >
          <el-table
            :data="availableZelApps.data"
            empty-text="No ZelApp available"
            style="width: 100%"
          >
            <el-table-column
              label="Name"
              prop="name"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.name.substr(3, scope.row.name.length) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Image"
              prop="repotag"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="Owner"
              prop="owner"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="Port"
              prop="port"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="CPU"
              prop="cpu"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveCpu(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="RAM"
              prop="ram"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveRam(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="HDD"
              prop="hdd"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveHdd(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Install"
              prop="install"
              sortable
            >
              <template slot-scope="scope">
                <ElButton
                  class="generalButton"
                  @click="installFoldingAtHome(scope.row.name)"
                >
                  Install
                </ElButton>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
      <br>
      <div class='actionCenter'>
        <el-input
          v-if="output"
          type="textarea"
          autosize
          v-model="stringOutput"
        >
        </el-input>
      </div>
    </div>
    <div v-if="zelAppsSection === 'registerzelapp'">
      <div v-if="!fluxCommunication">
        Warninig: Connected Flux is not communicating properly with Flux network
      </div>
      <div class="zelapps-register">
        <el-form
          :model="zelAppRegistrationSpecification"
          label-width="100px"
        >
          <el-form-item label="Version">
            <el-input
              placeholder="ZelApp Version"
              disabled
              v-model="zelAppRegistrationSpecification.version"
            >
            </el-input>
          </el-form-item>

          <el-form-item label="Type">
            <el-input
              placeholder="ZelApp Type"
              disabled
              v-model="zelAppRegistrationSpecification.type"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Name">
            <el-input
              placeholder="ZelApp name"
              v-model="zelAppRegistrationSpecification.name"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Desc.">
            <el-input
              placeholder="Description"
              type="textarea"
              autosize
              v-model="zelAppRegistrationSpecification.description"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Repo">
            <el-input
              placeholder="Docker Hub namespace/repository:tag"
              v-model="zelAppRegistrationSpecification.repotag"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Owner">
            <el-input
              placeholder="ZelID of application owner"
              v-model="zelAppRegistrationSpecification.owner"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Port">
            <el-input
              placeholder="Port on which application will be available"
              type="number"
              min="30001"
              max="39999"
              v-model="zelAppRegistrationSpecification.port"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Enviroment">
            <el-input
              placeholder="Array of strings of Enviromental Parameters"
              textarea
              v-model="zelAppRegistrationSpecification.enviromentParameters"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Commands">
            <el-input
              placeholder="Array of strings of Commands"
              textarea
              v-model="zelAppRegistrationSpecification.commands"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Cont. Port">
            <el-input
              placeholder="Container Port - port on which your container has"
              nubmer
              min="0"
              max="65535"
              v-model="zelAppRegistrationSpecification.containerPort"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Cont. Data">
            <el-input
              placeholder="Data folder that is shared by application to ZelApp volume"
              textarea
              v-model="zelAppRegistrationSpecification.containerData"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="CPU">
            <el-input
              placeholder="CPU cores to use by default"
              nubmer
              min="0"
              max="7"
              step="0.1"
              v-model="zelAppRegistrationSpecification.cpu"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="RAM">
            <el-input
              placeholder="RAM in MB value to use by default"
              nubmer
              min="0"
              max="28000"
              step="100"
              v-model="zelAppRegistrationSpecification.ram"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="SSD">
            <el-input
              placeholder="SSD in GB value to use by default"
              nubmer
              min="0"
              max="570"
              step="1"
              v-model="zelAppRegistrationSpecification.hdd"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Tiered">
            <el-switch v-model="zelAppRegistrationSpecification.tiered"></el-switch>
          </el-form-item>
          <div v-if="zelAppRegistrationSpecification.tiered">
            <el-form-item label="BASIC CPU">
              <el-input
                placeholder="CPU cores to use by BASIC"
                nubmer
                min="0"
                max="1"
                step="0.1"
                v-model="zelAppRegistrationSpecification.cpubasic"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="BASIC RAM">
              <el-input
                placeholder="RAM in MB value to use by BASIC"
                nubmer
                min="0"
                max="1000"
                step="100"
                v-model="zelAppRegistrationSpecification.rambasic"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="BASIC SSD">
              <el-input
                placeholder="SSD in GB value to use by BASIC"
                nubmer
                min="0"
                max="20"
                step="1"
                v-model="zelAppRegistrationSpecification.hddbasic"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="SUPER CPU">
              <el-input
                placeholder="CPU cores to use by SUPER"
                nubmer
                min="0"
                max="3"
                step="0.1"
                v-model="zelAppRegistrationSpecification.cpusuper"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="SUPER RAM">
              <el-input
                placeholder="RAM in MB value to use by SUPER"
                nubmer
                min="0"
                max="5000"
                step="100"
                v-model="zelAppRegistrationSpecification.ramsuper"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="SUPER SSD">
              <el-input
                placeholder="SSD in GB value to use by SUPER"
                nubmer
                min="0"
                max="120"
                step="1"
                v-model="zelAppRegistrationSpecification.hddsuper"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="BAMF CPU">
              <el-input
                placeholder="CPU cores to use by BAMF"
                nubmer
                min="0"
                max="7"
                step="0.1"
                v-model="zelAppRegistrationSpecification.cpubamf"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="BAMF RAM">
              <el-input
                placeholder="RAM in MB value to use by BAMF"
                nubmer
                min="0"
                max="28000"
                step="100"
                v-model="zelAppRegistrationSpecification.rambamf"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="BAMF SSD">
              <el-input
                placeholder="SSD in GB value to use by BAMF"
                nubmer
                min="0"
                max="570"
                step="1"
                v-model="zelAppRegistrationSpecification.hddbamf"
              >
              </el-input>
            </el-form-item>
          </div>
        </el-form>
        <div>
          <ElButton
            class="generalButton"
            @click="checkFluxSpecificationsAndFormatMessage"
          >
            Compute Registration Message
          </ElButton>
        </div>
        <div v-if="dataToSign">
          <el-form>
            <el-form-item label="Registration Message">
              <el-input
                type="textarea"
                autosize
                disabled
                v-model="dataToSign"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="Signature">
              <el-input
                type="textarea"
                autosize
                v-model="signature"
              >
              </el-input>
            </el-form-item>
          </el-form>
          <div>
            Sign with ZelCore
            <br>
            <a
              @click="initiateSignWS"
              :href="'zel:?action=sign&message=' + dataToSign + '&icon=http%3A%2F%2Fzelid.io%2Fimg%2FzelID.svg&callback=http%3A%2F%2F' + userconfig.externalip + ':' + config.apiPort + '%2Fzelid%2Fprovidesign%2F'"
            >
              <img
                class="zelidLogin"
                src="@/assets/img/zelID.svg"
              />
            </a>
          </div>
          <br><br>
          Price per Month: {{ appPricePerMonth }} ZEL
          <br><br>
          <ElButton
            class="generalButton"
            @click="register"
          >
            Register ZelApp
          </ElButton>
          <br><br>
          <div v-if="registrationHash">
            To finish registration, Please do a transaction of {{ appPricePerMonth }} to address
            {{ zelapps.address }}
            with following message:
            {{ registrationHash }}
            <br><br>
            Transaction must be mined by {{ validTill }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

import ZelCashService from '@/services/ZelCashService';
import ZelAppsService from '@/services/ZelAppsService';

const store = require('store');
const qs = require('qs');

Vue.use(Vuex);

const vue = new Vue();

export default {
  name: 'ZelApps',
  data() {
    return {
      activeName: 'running',
      getRunningZelAppsResponse: {
        status: '',
        data: '',
      },
      getAllZelAppsResponse: {
        status: '',
        data: '',
      },
      installedZelApps: {
        status: '',
        data: '',
      },
      availableZelApps: {
        status: '',
        data: '',
      },
      tier: '',
      output: '',
      fluxCommunication: false,
      zelAppRegistrationSpecificationA: {
        version: 1,
        type: 'register',
        name: '',
        description: '',
        repotag: '',
        owner: '',
        port: null,
        enviromentParameters: '', // []
        commands: '', // []
        containerPort: null,
        containerData: '',
        cpu: null,
        ram: null,
        hdd: null,
        tiered: false,
        cpubasic: null,
        rambasic: null,
        hddbasic: null,
        cpusuper: null,
        ramsuper: null,
        hddsuper: null,
        cpubamf: null,
        rambamf: null,
        hddbamf: null,
      },
      zelAppRegistrationSpecification: {
        version: 1,
        type: 'register',
        name: 'FoldingAtHome',
        description: 'Folding @ Home is cool :)',
        repotag: 'yurinnick/folding-at-home:latest',
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        port: 30001,
        enviromentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // []
        commands: '["--allow","0/0","--web-allow","0/0"]', // []
        containerPort: 7396,
        containerData: '/config',
        cpu: 0.5,
        ram: 500,
        hdd: 5,
        tiered: true,
        cpubasic: 0.5,
        rambasic: 500,
        hddbasic: 5,
        cpusuper: 1,
        ramsuper: 1000,
        hddsuper: 5,
        cpubamf: 2,
        rambamf: 2000,
        hddbamf: 5,
      },
      dataForZelAppRegistration: {},
      dataToSign: '',
      timestamp: '',
      signature: '',
      registrationHash: '',
      fluxSpecifics: {
        cpu: {
          basic: 20, // 10 available for apps
          super: 40, // 30 available for apps
          bamf: 80, // 70 available for apps
        },
        ram: {
          basic: 3000, // 1000 available for apps
          super: 7000, // 5000 available for apps
          bamf: 30000, // available 28000 for apps
        },
        hdd: {
          basic: 50, // 20 for apps
          super: 150, // 120 for apps
          bamf: 600, // 570 for apps
        },
        collateral: {
          basic: 10000,
          super: 25000,
          bamf: 100000,
        },
      },
      lockedSystemResources: {
        cpu: 10, // 1 cpu core
        ram: 2000, // 2000mb
        hdd: 30, // 30gb // this value is likely to rise
      },
      zelapps: {
        // in zel per month
        price: {
          cpu: 3, // per 0.1 cpu core,
          ram: 1, // per 100mb,
          hdd: 0.5, // per 1gb,
        },
        address: 't1...', // apps registration address
        epochstart: 1000000, // zelapps epoch blockheight start
        portMin: 30001, // originally should have been from 30000 but we got temporary folding there
        portMax: 39999,
      },
      websocket: null,
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'zelAppsSection',
    ]),
    stringOutput() {
      let string = '';
      this.output.forEach((output) => {
        string += `${JSON.stringify(output)}\r\n`;
      });
      return string;
    },
    appPricePerMonth() {
      if (this.dataForZelAppRegistration.tiered) {
        const cpuTotalCount = this.dataForZelAppRegistration.cpubasic + this.dataForZelAppRegistration.cpusuper + this.dataForZelAppRegistration.cpubamf;
        const cpuPrice = cpuTotalCount * this.zelapps.price.cpu * 10; // 0.1 core cost cpu price
        const cpuTotal = cpuPrice / 3;
        const ramTotalCount = this.dataForZelAppRegistration.rambasic + this.dataForZelAppRegistration.ramsuper + this.dataForZelAppRegistration.rambamf;
        const ramPrice = (ramTotalCount * this.zelapps.price.ram) / 100;
        const ramTotal = ramPrice / 3;
        const hddTotalCount = this.dataForZelAppRegistration.hddbasic + this.dataForZelAppRegistration.hddsuper + this.dataForZelAppRegistration.hddbamf;
        const hddPrice = hddTotalCount * this.zelapps.price.hdd;
        const hddTotal = hddPrice / 3;
        return Math.ceil(cpuTotal + ramTotal + hddTotal);
      }
      const cpuTotal = this.dataForZelAppRegistration.cpu * this.zelapps.price.cpu * 10;
      const ramTotal = (this.dataForZelAppRegistration.ram * this.zelapps.price.ram) / 100;
      const hddTotal = this.dataForZelAppRegistration.hdd * this.zelapps.price.hdd;
      return Math.ceil(cpuTotal + ramTotal + hddTotal);
    },
    validTill() {
      const expTime = this.timestamp + 60 * 1000 * 1000;
      return expTime;
    },
  },
  watch: {
    zelAppsSection(val, oldVal) {
      console.log(val, oldVal);
      switch (val) {
        case 'localzelapps':
          this.zelappsGetListRunningZelApps();
          // vue.$message.info('ZelApps coming soon!');
          break;
        case 'globalzelapps':
          vue.$message.info('ZelApps coming soon!');
          break;
        case 'registerzelapp':
          this.registrationInformation();
          this.checkFluxCommunication();
          break;
        default:
          console.log('ZelApps Section: Unrecognized method'); // should not be visible if everything works correctly
      }
    },
    activeName(val, oldVal) {
      console.log(val, oldVal);
      this.output = '';
      switch (val) {
        case 'running':
          this.zelappsGetListRunningZelApps();
          break;
        case 'all':
          this.zelappsGetListAllZelApps();
          break;
        case 'installed':
          this.zelappsGetInstalledZelApps();
          break;
        case 'available':
          this.zelappsGetAvailableZelApps();
          break;
        case 'stopped':
          // getting all and checking state?
          break;
        default:
          console.log('ZelApps Section: Unrecognized method'); // should not be visible if everything works correctly
      }
    },
    zelAppRegistrationSpecification: {
      handler(val, oldVal) {
        console.log(val, oldVal);
        this.dataToSign = '';
        this.signature = '';
        this.timestamp = null;
        this.dataForZelAppRegistration = {};
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
    const zelidauth = localStorage.getItem('zelidauth');
    const auth = qs.parse(zelidauth);
    this.zelAppRegistrationSpecification.owner = auth.zelid;
    console.log(auth);
    this.getZelNodeStatus();
    this.zelappsGetInstalledZelApps();
    switch (this.zelAppsSection) {
      case 'localzelapps':
        this.zelappsGetListRunningZelApps();
        // vue.$message.info('ZelApps coming soon!');
        break;
      case 'globalzelapps':
        vue.$message.info('ZelApps coming soon!');
        break;
      case 'registerzelapp':
        this.registrationInformation();
        this.checkFluxCommunication();
        break;
      default:
        console.log('ZelApps Section: Unrecognized method');
    }
  },
  methods: {
    async zelappsGetAvailableZelApps() {
      const response = await ZelAppsService.availableZelApps();
      this.availableZelApps.status = response.data.status;
      this.availableZelApps.data = response.data.data;
    },
    async zelappsGetInstalledZelApps() {
      const response = await ZelAppsService.installedZelApps();
      this.installedZelApps.status = response.data.status;
      this.installedZelApps.data = response.data.data;
    },
    async zelappsGetListRunningZelApps() {
      const response = await ZelAppsService.listRunningZelApps();
      console.log(response);
      this.getRunningZelAppsResponse.status = response.data.status;
      this.getRunningZelAppsResponse.data = response.data.data;
    },
    async zelappsGetListAllZelApps() {
      const response = await ZelAppsService.listAllZelApps();
      console.log(response);
      this.getAllZelAppsResponse.status = response.data.status;
      this.getAllZelAppsResponse.data = response.data.data;
    },
    async stopZelApp(zelapp) {
      this.output = '';
      vue.$message.success('Stopping ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.stopZelApp(zelidauth, zelapp);
      if (response.data.status === 'success') {
        vue.$message.success(response.data.data.messsage || response.data.data);
      } else {
        vue.$message.error(response.data.data.messsage || response.data.data);
      }
      this.zelappsGetListRunningZelApps();
      console.log(response);
    },
    async startZelApp(zelapp) {
      this.output = '';
      vue.$message.success('Starting ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.startZelApp(zelidauth, zelapp);
      if (response.data.status === 'success') {
        vue.$message.success(response.data.data.messsage || response.data.data);
      } else {
        vue.$message.error(response.data.data.messsage || response.data.data);
      }
      console.log(response);
    },
    async restartZelApp(zelapp) {
      this.output = '';
      vue.$message.success('Restarting ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.restartZelApp(zelidauth, zelapp);
      if (response.data.status === 'success') {
        vue.$message.success(response.data.data.messsage || response.data.data);
      } else {
        vue.$message.error(response.data.data.messsage || response.data.data);
      }
      console.log(response);
    },
    async removeZelApp(zelapp) {
      const self = this;
      this.output = '';
      vue.$message.success('Removing ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      // const response = await ZelAppsService.installFoldingAtHome(zelidauth, zelapp);
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.target.response);
          self.output = JSON.parse(`[${progressEvent.target.response.replace(/}{/g, '},{')}]`);
        },
      };
      const response = await ZelAppsService.justAPI().get(`/zelapps/zelappremove/${zelapp}`, axiosConfig);
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data);
      } else {
        this.zelappsGetInstalledZelApps();
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
        if (this.output[this.output.length - 1].status === 'error') {
          vue.$message.error(this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          vue.$message.success(this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        }
      }
    },
    async installFoldingAtHome(zelapp) { // todo rewrite to installZelApp later
      console.log(zelapp);
      const self = this;
      this.output = '';
      vue.$message.success('Installing ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      // const response = await ZelAppsService.installFoldingAtHome(zelidauth, zelapp);
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.target.response);
          self.output = JSON.parse(`[${progressEvent.target.response.replace(/}{/g, '},{')}]`);
        },
      };
      const response = await ZelAppsService.justAPI().get('/zelapps/zelapptemporarylocalregister/foldingathome', axiosConfig);
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data);
      } else {
        console.log(response);
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
        console.log(this.output);
        for (let i = 0; i < this.output.length; i += 1) {
          if (this.output[i] && this.output[i].data && this.output[i].data.message && this.output[i].data.message.includes('Error occured')) {
            // error is defined one line above
            if (this.output[i - 1] && this.output[i - 1].data) {
              vue.$message.error(this.output[i - 1].data.message || this.output[i - 1].data);
              return;
            }
          }
        }
        if (this.output[this.output.length - 1].status === 'error') {
          vue.$message.error(this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          vue.$message.success(this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        }
      }
    },
    installedZelApp(zelappName) {
      return this.installedZelApps.data.find((zelapp) => zelapp.name === zelappName);
    },
    openZelApp(name) {
      const zelappInfo = this.installedZelApp(name);
      if (zelappInfo) {
        const backendURL = store.get('backendURL') || `http://${this.userconfig.externalip}:${this.config.apiPort}`;
        const ip = backendURL.split(':')[1].split('//')[1];
        const url = `http://${ip}:${zelappInfo.port}`;
        this.openSite(url);
      } else {
        vue.$message.error('Unable to open ZelApp :(');
      }
    },
    async getZelNodeStatus() {
      const response = await ZelCashService.getZelNodeStatus();
      if (response.data.status === 'success') {
        this.tier = response.data.tier;
      }
    },
    resolveCpu(zelapp) {
      if (this.tier === 'BASIC') {
        return (`${zelapp.cpubasic || zelapp.cpu} cores`);
      }
      if (this.tier === 'SUPER') {
        return (`${zelapp.cpusuper || zelapp.cpu} cores`);
      }
      if (this.tier === 'BAMF') {
        return (`${zelapp.cpubamf || zelapp.cpu} cores`);
      }
      return (`${zelapp.cpu} cores`);
    },
    resolveRam(zelapp) {
      if (this.tier === 'BASIC') {
        return (`${zelapp.rambasic || zelapp.ram} MB`);
      }
      if (this.tier === 'SUPER') {
        return (`${zelapp.ramsuper || zelapp.ram} MB`);
      }
      if (this.tier === 'BAMF') {
        return (`${zelapp.rambamf || zelapp.ram} MB`);
      }
      return (`${zelapp.ram} MB`);
    },
    resolveHdd(zelapp) {
      if (this.tier === 'BASIC') {
        return (`${zelapp.hddbasic || zelapp.hdd} GB`);
      }
      if (this.tier === 'SUPER') {
        return (`${zelapp.hddsuper || zelapp.hdd} GB`);
      }
      if (this.tier === 'BAMF') {
        return (`${zelapp.hddbamf || zelapp.hdd} GB`);
      }
      return (`${zelapp.hdd} GB`);
    },
    openSite(url) {
      const win = window.open(url, '_blank');
      win.focus();
    },
    checkHWParameters(zelAppSpecs) {
      // check specs parameters. JS precision
      if ((zelAppSpecs.cpu * 10) % 1 !== 0 || (zelAppSpecs.cpu * 10) > (this.fluxSpecifics.cpu.bamf - this.lockedSystemResources.cpu) || zelAppSpecs.cpu < 0.1) {
        return new Error('CPU badly assigned');
      }
      if (zelAppSpecs.ram % 100 !== 0 || zelAppSpecs.ram > (this.fluxSpecifics.ram.bamf - this.lockedSystemResources.ram) || zelAppSpecs.ram < 100) {
        return new Error('RAM badly assigned');
      }
      if (zelAppSpecs.hdd % 1 !== 0 || zelAppSpecs.hdd > (this.fluxSpecifics.hdd.bamf - this.lockedSystemResources.hdd) || zelAppSpecs.hdd < 1) {
        return new Error('SSD badly assigned');
      }
      if (zelAppSpecs.tiered) {
        if ((zelAppSpecs.cpubasic * 10) % 1 !== 0 || (zelAppSpecs.cpubasic * 10) > (this.fluxSpecifics.cpu.basic - this.lockedSystemResources.cpu) || zelAppSpecs.cpubasic < 0.1) {
          return new Error('CPU for BASIC badly assigned');
        }
        if (zelAppSpecs.rambasic % 100 !== 0 || zelAppSpecs.rambasic > (this.fluxSpecifics.ram.basic - this.lockedSystemResources.ram) || zelAppSpecs.rambasic < 100) {
          return new Error('RAM for BASIC badly assigned');
        }
        if (zelAppSpecs.hddbasic % 1 !== 0 || zelAppSpecs.hddbasic > (this.fluxSpecifics.hdd.basic - this.lockedSystemResources.hdd) || zelAppSpecs.hddbasic < 1) {
          return new Error('SSD for BASIC badly assigned');
        }
        if ((zelAppSpecs.cpusuper * 10) % 1 !== 0 || (zelAppSpecs.cpusuper * 10) > (this.fluxSpecifics.cpu.super - this.lockedSystemResources.cpu) || zelAppSpecs.cpusuper < 0.1) {
          return new Error('CPU for SUPER badly assigned');
        }
        if (zelAppSpecs.ramsuper % 100 !== 0 || zelAppSpecs.ramsuper > (this.fluxSpecifics.ram.super - this.lockedSystemResources.ram) || zelAppSpecs.ramsuper < 100) {
          return new Error('RAM for SUPER badly assigned');
        }
        if (zelAppSpecs.hddsuper % 1 !== 0 || zelAppSpecs.hddsuper > (this.fluxSpecifics.hdd.super - this.lockedSystemResources.hdd) || zelAppSpecs.hddsuper < 1) {
          return new Error('SSD for SUPER badly assigned');
        }
        if ((zelAppSpecs.cpubamf * 10) % 1 !== 0 || (zelAppSpecs.cpubamf * 10) > (this.fluxSpecifics.cpu.bamf - this.lockedSystemResources.cpu) || zelAppSpecs.cpubamf < 0.1) {
          return new Error('CPU for BAMF badly assigned');
        }
        if (zelAppSpecs.rambamf % 100 !== 0 || zelAppSpecs.rambamf > (this.fluxSpecifics.ram.bamf - this.lockedSystemResources.ram) || zelAppSpecs.rambamf < 100) {
          return new Error('RAM for BAMF badly assigned');
        }
        if (zelAppSpecs.hddbamf % 1 !== 0 || zelAppSpecs.hddbamf > (this.fluxSpecifics.hdd.bamf - this.lockedSystemResources.hdd) || zelAppSpecs.hddbamf < 1) {
          return new Error('SSD for BAMF badly assigned');
        }
      }
      return true;
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
    async checkFluxSpecificationsAndFormatMessage() {
      try {
        let zelAppSpecification = this.zelAppRegistrationSpecification;
        console.log(zelAppSpecification);
        zelAppSpecification = this.ensureObject(zelAppSpecification);
        let { version } = zelAppSpecification; // shall be 1
        let { type } = zelAppSpecification; // shall be register
        let { name } = zelAppSpecification;
        let { description } = zelAppSpecification;
        let { repotag } = zelAppSpecification;
        let { owner } = zelAppSpecification;
        let { port } = zelAppSpecification;
        let { enviromentParameters } = zelAppSpecification;
        let { commands } = zelAppSpecification;
        let { containerPort } = zelAppSpecification;
        let { containerData } = zelAppSpecification;
        let { cpu } = zelAppSpecification;
        let { ram } = zelAppSpecification;
        let { hdd } = zelAppSpecification;
        const { tiered } = zelAppSpecification;
        // check if signature of received data is correct
        if (!version || !type || !name || !description || !repotag || !owner || !port || !enviromentParameters || !commands || !containerPort || !containerData || !cpu || !ram || !hdd) {
          throw new Error('Missing ZelApp specification parameter');
        }
        version = this.ensureNumber(version);
        type = this.ensureString(type);
        name = this.ensureString(name);
        description = this.ensureString(description);
        repotag = this.ensureString(repotag);
        owner = this.ensureString(owner);
        port = this.ensureNumber(port);
        enviromentParameters = this.ensureObject(enviromentParameters);
        const envParamsCorrected = [];
        if (Array.isArray(enviromentParameters)) {
          enviromentParameters.forEach((parameter) => {
            const param = this.ensureString(parameter);
            envParamsCorrected.push(param);
          });
        } else {
          throw new Error('Enviromental parameters for ZelApp are invalid');
        }
        commands = this.ensureObject(commands);
        const commandsCorrected = [];
        if (Array.isArray(commands)) {
          commands.forEach((command) => {
            const cmm = this.ensureString(command);
            commandsCorrected.push(cmm);
          });
        } else {
          throw new Error('ZelApp commands are invalid');
        }
        containerPort = this.ensureNumber(containerPort);
        containerData = this.ensureString(containerData);
        cpu = this.ensureNumber(cpu);
        ram = this.ensureNumber(ram);
        hdd = this.ensureNumber(hdd);
        if (typeof tiered !== 'boolean') {
          throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
        }

        // finalised parameters that will get stored in global database
        const zelAppSpecFormatted = {
          version, // integer
          type, // string
          name, // string
          description, // string
          repotag, // string
          owner, // zelid string
          port, // integer
          enviromentParameters: envParamsCorrected, // array of strings
          commands: commandsCorrected, // array of strings
          containerPort, // integer
          containerData, // string
          cpu, // float 0.1 step
          ram, // integer 100 step (mb)
          hdd, // integer 1 step
          tiered, // boolean
        };

        if (tiered) {
          let { cpubasic } = zelAppSpecification;
          let { cpusuper } = zelAppSpecification;
          let { cpubamf } = zelAppSpecification;
          let { rambasic } = zelAppSpecification;
          let { ramsuper } = zelAppSpecification;
          let { rambamf } = zelAppSpecification;
          let { hddbasic } = zelAppSpecification;
          let { hddsuper } = zelAppSpecification;
          let { hddbamf } = zelAppSpecification;
          if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
            throw new Error('ZelApp was requested as tiered setup but specifications are missing');
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

          zelAppSpecFormatted.cpubasic = cpubasic;
          zelAppSpecFormatted.cpusuper = cpusuper;
          zelAppSpecFormatted.cpubamf = cpubamf;
          zelAppSpecFormatted.rambasic = rambasic;
          zelAppSpecFormatted.ramsuper = ramsuper;
          zelAppSpecFormatted.rambamf = rambamf;
          zelAppSpecFormatted.hddbasic = hddbasic;
          zelAppSpecFormatted.hddsuper = hddsuper;
          zelAppSpecFormatted.hddbamf = hddbamf;
        }
        // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper port, repotag exists, string lengths, specs are ok
        if (version !== 1) {
          throw new Error('ZelApp message version specification is invalid');
        }
        if (type !== 'register') {
          throw new Error('ZelApp message type specification is invalid');
        }
        if (name.length > 32) {
          throw new Error('ZelApp name is too long');
        }
        // furthermore name cannot contain any special character
        if (!name.match(/^[a-zA-Z0-9]+$/)) {
          throw new Error('ZelApp name contains special characters. Only a-z, A-Z and 0-9 are allowed');
        }
        if (description.length > 256) {
          throw new Error('Description is too long. Maximum of 256 characters is allowed');
        }
        const parameters = this.checkHWParameters(zelAppSpecFormatted);
        if (parameters !== true) {
          const errorMessage = parameters;
          throw new Error(errorMessage);
        }

        // check port is within range
        if (zelAppSpecFormatted.port < this.zelapps.portMin || zelAppSpecFormatted.port > this.zelapps.portMax) {
          throw new Error(`Assigned port is not within ZelApps range ${this.zelapps.portMin}-${this.zelapps.portMax}`);
        }

        // check if containerPort makes sense
        if (zelAppSpecFormatted.containerPort < 0 || zelAppSpecFormatted.containerPort > 65535) {
          throw new Error('Container Port is not within system limits 0-65535');
        }

        // check repotag if available for download
        const splittedRepo = zelAppSpecFormatted.repotag.split(':');
        if (splittedRepo[0] && splittedRepo[1] && !splittedRepo[2]) {
          const zelidauth = localStorage.getItem('zelidauth');
          const data = {
            repotag: zelAppSpecFormatted.repotag,
          };
          const resDocker = await ZelAppsService.chekcDockerExistance(zelidauth, data).catch((error) => {
            vue.$message.error(error.message || error);
          });
          console.log(resDocker);
          if (resDocker.data.status === 'error') {
            throw resDocker.data.data;
          }
        } else {
          throw new Error('Repository is not in valid format namespace/repository:tag');
        }
        this.timestamp = new Date().getTime();
        this.dataForZelAppRegistration = zelAppSpecFormatted;
        this.dataToSign = JSON.stringify(zelAppSpecFormatted) + this.timestamp;
      } catch (error) {
        console.log(error.message);
        vue.$message.error(error.message || error);
      }
    },
    async checkFluxCommunication() {
      const response = await ZelAppsService.checkCommunication();
      if (response.data.status === 'success') {
        this.fluxCommunication = true;
      } else {
        vue.$message.error(response.data.data);
      }
    },
    async registrationInformation() {
      const response = await ZelAppsService.zelappsRegInformation();
      const { data } = response.data;
      if (response.data.status === 'success') {
        this.zelapps.price.cpu = data.price.cpu;
        this.zelapps.price.hdd = data.price.hdd;
        this.zelapps.price.ram = data.price.ram;
        this.zelapps.address = data.address;
        this.zelapps.epochstart = data.epochstart;
        this.zelapps.portMin = data.portMin;
        this.zelapps.portMax = data.portMax;
      } else {
        vue.$message.error(response.data.data);
      }
    },
    async register() {
      const zelidauth = localStorage.getItem('zelidauth');
      const data = {
        zelAppSpecification: this.dataForZelAppRegistration,
        timestamp: this.timestamp,
        signature: this.signature,
      };
      const response = await ZelAppsService.registerZelApp(zelidauth, data).catch((error) => {
        vue.$message.error(error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        this.registrationHash = response.data.data;
        vue.$message.success(response.data.data);
      } else {
        vue.$message.error(response.data.data);
      }
    },
    initiateSignWS() {
      const self = this;
      const signatureMessage = this.zelAppRegistrationSpecification.owner + this.timestamp;
      const wsuri = `ws://${this.userconfig.externalip}:${this.config.apiPort}/ws/zelsign/${signatureMessage}`;
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
  },
};
</script>
