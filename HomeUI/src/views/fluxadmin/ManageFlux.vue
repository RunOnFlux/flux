<template>
  <div>
    <b-row class="match-height">
      <b-col class="d-lg-flex d-none">
        <b-row>
          <b-col lg="12">
            <b-card title="Flux">
              <b-card-text>
                Update your Flux to the latest version. Every Flux has to run the newest version to stay on par with the network.
              </b-card-text>
              <div class="text-center">
                <b-button
                  id="update-flux-a"
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="success"
                  aria-label="Update Flux"
                >
                  Update Flux
                </b-button>
                <confirm-dialog
                  target="update-flux-a"
                  confirm-button="Update Flux"
                  @confirm="updateFlux()"
                />
                <b-modal
                  v-model="updateDialogVisible"
                  hide-footer
                  centered
                  hide-header-close
                  no-close-on-backdrop
                  no-close-on-esc
                  size="lg"
                  title="Flux Update Progress"
                  title-tag="h4"
                >
                  <div class="d-block text-center mx-2 my-2">
                    <b-progress
                      :value="updateProgress"
                      variant="primary"
                      class="progress-bar-primary"
                      animated
                    />
                  </div>
                </b-modal>
              </div>
            </b-card>
          </b-col>
          <b-col lg="12">
            <b-card title="Flux UI">
              <b-card-text>
                Forcefully update Flux. Only use this option when something is not working correctly!
              </b-card-text>
              <div class="text-center">
                <b-button
                  id="update-hardway-a"
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="success"
                  aria-label="Forcefully Update"
                >
                  Forcefully Update
                </b-button>
                <confirm-dialog
                  target="update-hardway-a"
                  confirm-button="Update Flux Forcefully"
                  @confirm="rebuildHome()"
                />
              </div>
            </b-card>
          </b-col>
        </b-row>
      </b-col>
      <b-col
        sm="12"
        lg="8"
      >
        <b-card title="Kadena">
          <b-card-text class="mb-3">
            Running a Kadena node makes you eligible for Kadena Rewards. Adjust your Kadena Account and Chain ID to ensure the reward distribution.
          </b-card-text>
          <div class="text-center">
            <b-form-input
              v-model="kadenaAccountInput"
              placeholder="Kadena Account"
              class="mb-2"
            />
            <div
              style="display: flex; justify-content: center; align-items: center;"
              class="mb-2"
            >
              <b-card-text class="mr-1 mb-0">
                Chain ID
              </b-card-text>
              <b-form-spinbutton
                id="sb-vertical"
                v-model="kadenaChainIDInput"
                min="0"
                max="19"
                style="width: 150px;"
              />
            </div>
            <b-button
              id="update-kadena"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Update Kadena Account"
            >
              Update Kadena Account
            </b-button>
            <confirm-dialog
              target="update-kadena"
              confirm-button="Update Kadena"
              @confirm="adjustKadena()"
            />
          </div>
        </b-card>
      </b-col>
    </b-row>
    <b-row class="d-lg-none match-height">
      <b-col
        sm="6"
        xs="12"
      >
        <b-card title="Flux">
          <b-card-text>
            Update your Flux to the latest version. Every Flux has to run the newest version to stay on par with the network.
          </b-card-text>
          <div class="text-center">
            <b-button
              id="update-flux-b"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Update Flux"
            >
              Update Flux
            </b-button>
            <confirm-dialog
              target="update-flux-b"
              confirm-button="Update Flux"
              @confirm="updateFlux()"
            />
            <b-modal
              v-model="updateDialogVisible"
              hide-footer
              centered
              hide-header-close
              no-close-on-backdrop
              no-close-on-esc
              size="lg"
              title="Flux Update Progress"
              title-tag="h4"
            >
              <div class="d-block text-center mx-2 my-2">
                <b-progress
                  :value="updateProgress"
                  variant="primary"
                  class="progress-bar-primary"
                  animated
                />
              </div>
            </b-modal>
          </div>
        </b-card>
      </b-col>
      <b-col
        sm="6"
        xs="12"
      >
        <b-card title="Flux UI">
          <b-card-text>
            Forcefully update Flux. Only use this option when something is not working correctly!
          </b-card-text>
          <div class="text-center">
            <b-button
              id="update-hardway-b"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Forcefully Update"
            >
              Forcefully Update
            </b-button>
            <confirm-dialog
              target="update-hardway-b"
              confirm-button="Forcefully Update"
              @confirm="updateHardWay()"
            />
          </div>
        </b-card>
      </b-col>
    </b-row>
    <b-row class="match-height">
      <b-col
        lg="4"
        md="6"
        sm="12"
      >
        <b-card title="Reindexing">
          <b-card-text class="mb-1">
            Options to reindex Flux databases and so rebuild them from scratch. Reindexing may take several hours and should only be used when an unrecoverable error is present in databases.
          </b-card-text>
          <div class="text-center">
            <b-button
              id="reindex-flux-databases"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Reindex Flux Databases"
              class="mx-1 mt-1"
              style="width: 250px;"
            >
              Reindex Flux Databases
            </b-button>
            <confirm-dialog
              target="reindex-flux-databases"
              confirm-button="Reindex Flux DB"
              @confirm="reindexFlux()"
            />
            <b-button
              id="reindex-explorer-databases"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Reindex Explorer Databases"
              class="mx-1 mt-1"
              style="width: 250px;"
            >
              Reindex Explorer Databases
            </b-button>
            <confirm-dialog
              target="reindex-explorer-databases"
              confirm-button="Reindex Explorer"
              @confirm="reindexExplorer()"
            />
          </div>
        </b-card>
      </b-col>
      <b-col
        lg="8"
        md="6"
        sm="12"
      >
        <b-card title="Rescanning">
          <b-card-text class="mb-2">
            Options to rescan Flux databases from a given blockheight and rebuild them since. Rescanning may take several hours and shall be used only when an unrecoverable error is present in databases with a known blockheight.
            Rescanning Flux databases is a deeper option than just explorer databases and so while rescanning entire Flux databases, explorer parts will be rescanned as well.
          </b-card-text>
          <div
            style="display: flex; justify-content: center; align-items: center;"
            class="mb-1"
          >
            <b-card-text class="mr-1 mb-0">
              Block Height
            </b-card-text>
            <input-spin-button
              id="sb-vertical"
              v-model="rescanFluxHeight"
              style="width: 250px;"
            />
            <b-button
              id="rescan-flux-db"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Rescan Flux Databases"
              class="mx-1"
              style="width: 250px;"
            >
              Rescan Flux Databases
            </b-button>
            <confirm-dialog
              target="rescan-flux-db"
              confirm-button="Rescan Flux DB"
              @confirm="rescanFlux()"
            />
          </div>
          <div
            style="display: flex; justify-content: center; align-items: center;"
          >
            <b-card-text class="mr-1 mb-0">
              Block Height
            </b-card-text>
            <input-spin-button
              id="sb-vertical"
              v-model="rescanExplorerHeight"
              style="width: 250px;"
            />
            <b-button
              id="rescan-explorer-db"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Rescan Explorer Databases"
              class="mx-1"
              style="width: 250px;"
            >
              Rescan Explorer Databases
            </b-button>
            <confirm-dialog
              target="rescan-explorer-db"
              confirm-button="Rescan Explorer"
              @confirm="rescanExplorer()"
            />
          </div>
        </b-card>
      </b-col>
    </b-row>
    <b-row class="match-height">
      <b-col
        xs="12"
      >
        <b-card title="Rescanning Global Apps">
          <b-card-text class="mb-1">
            Options to rescan Flux Global Application Database from a given blockheight and rebuild them since. Rescanning may take several hours and shall be used only when an unrecoverable error is present in databases with a known blockheight.
            If remove Last Information is wished. The current specifics will be dropped instead making it more deep option.
          </b-card-text>
          <div
            style="display: flex; justify-content: center; align-items: center;"
          >
            <b-card-text class="mr-1 mb-0">
              Block Height
            </b-card-text>
            <input-spin-button
              id="sb-vertical"
              v-model="rescanGlobalAppsHeight"
              style="width: 250px;"
            />
            <b-form-checkbox
              v-model="removeLastInformation"
              v-b-tooltip.hover:bottom="removeLastInformation ? 'Remove last app information' : 'Do NOT remove last app information'"
              class="custom-control-success ml-1"
              name="check-button"
              switch
            />
            <b-button
              id="rescan-global-apps"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Rescan Global Apps Information"
              class="mx-1"
            >
              Rescan Global Apps Information
            </b-button>
            <confirm-dialog
              target="rescan-global-apps"
              confirm-button="Rescan Apps"
              @confirm="rescanGlobalApps()"
            />
          </div>
        </b-card>
      </b-col>
    </b-row>
    <b-row class="match-height">
      <b-col
        xs="12"
        md="6"
        lg="4"
      >
        <b-card title="Global App Information">
          <b-card-text>
            Reindexes Flux Global Application Database and rebuilds them entirely from stored permanent messages. Reindexing may take a few hours and shall be used only when an unrecoverable error is present.
          </b-card-text>
          <div class="text-center">
            <b-button
              id="reindex-global-apps"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Reindex Global Apps Information"
              class="mt-2"
            >
              Reindex Global Apps Information
            </b-button>
            <confirm-dialog
              target="reindex-global-apps"
              confirm-button="Reindex Apps"
              @confirm="reindexGlobalApps()"
            />
          </div>
        </b-card>
      </b-col>
      <b-col
        xs="12"
        md="6"
        lg="4"
      >
        <b-card title="Global App Locations">
          <b-card-text>
            Reindexes Flux Global Application Locations and rebuilds them from newly incoming messages. Shall be used only when index has inconsistencies.
          </b-card-text>
          <div class="text-center">
            <b-button
              id="reindex-global-apps-locations"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Reindex Global Apps Locations"
              class="mt-2"
            >
              Reindex Global Apps Locations
            </b-button>
            <confirm-dialog
              target="reindex-global-apps-locations"
              confirm-button="Reindex Locations"
              @confirm="reindexLocations()"
            />
          </div>
        </b-card>
      </b-col>
      <b-col
        xs="12"
        lg="4"
      >
        <b-card title="Block Processing">
          <b-card-text>
            These options manage Flux block processing which is a crucial process for Explorer and Apps functionality. Useful when Block Processing encounters an error and is stuck. Use with caution!
          </b-card-text>
          <div class="text-center">
            <b-button
              id="restart-block-processing"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Restart Block Processing"
              class="mx-1 my-1"
              style="width: 250px;"
            >
              Restart Block Processing
            </b-button>
            <confirm-dialog
              target="restart-block-processing"
              confirm-button="Restart Processing"
              @confirm="restartBlockProcessing()"
            />
            <b-button
              id="stop-block-processing"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Stop Block Processing"
              class="mx-1 my-1"
              style="width: 250px;"
            >
              Stop Block Processing
            </b-button>
            <confirm-dialog
              target="stop-block-processing"
              confirm-button="Stop Processing"
              @confirm="stopBlockProcessing()"
            />
          </div>
        </b-card>
      </b-col>
      <b-col
        xs="12"
        lg="4"
      >
        <b-card title="Application Monitoring">
          <b-card-text>
            Application on Flux are monitoring it's usage statistics to provide application owner data about application performance.
          </b-card-text>
          <div class="text-center">
            <b-button
              id="start-app-monitoring"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Start Applications Monitoring"
              class="mx-1 my-1"
              style="width: 250px;"
            >
              Start Applications Monitoring
            </b-button>
            <confirm-dialog
              target="rstart-app-monitoring"
              confirm-button="Start Applications Monitoring"
              @confirm="startApplicationsMonitoring()"
            />
            <b-button
              id="stop-app-monitoring"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Stop Applications Monitoring"
              class="mx-1 my-1"
              style="width: 250px;"
            >
              Stop Applications Monitoring
            </b-button>
            <confirm-dialog
              target="stop-app-monitoring"
              confirm-button="Stop Applications Monitoring"
              @confirm="stopApplicationsMonitoring(false)"
            />
            <b-button
              id="stop-app-monitoring-delete"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Stop Applications Monitoring and Delete Monitored Data"
              class="mx-1 my-1"
              style="width: 250px;"
            >
              Stop Applications Monitoring and Delete Monitored Data
            </b-button>
            <confirm-dialog
              target="stop-app-monitoring-delete"
              confirm-button="Stop Applications Monitoring and Delete Monitored Data"
              @confirm="stopApplicationsMonitoring(true)"
            />
          </div>
        </b-card>
      </b-col>
    </b-row>
  </div>
</template>

<script>
import { computed } from 'vue';
import { mapState } from 'vuex';
import {
  BCard,
  BRow,
  BCol,
  BCardText,
  BButton,
  BFormCheckbox,
  BFormInput,
  BFormSpinbutton,
  VBTooltip,
  BModal,
  BProgress,
} from 'bootstrap-vue';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import Ripple from 'vue-ripple-directive';
import axios from 'axios';
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';
import InputSpinButton from '@/views/components/InputSpinButton.vue';

import FluxService from '@/services/FluxService.js';
import ExplorerService from '@/services/ExplorerService.js';
import AppsService from '@/services/AppsService.js';

import qs from 'qs';

export default {
  components: {
    BCard,
    BRow,
    BCol,
    BCardText,
    BButton,
    BFormCheckbox,
    BFormInput,
    BFormSpinbutton,
    BModal,
    BProgress,
    ConfirmDialog,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
    InputSpinButton,
  },
  directives: {
    'b-tooltip': VBTooltip,
    Ripple,
  },
  data() {
    return {
      rescanFluxHeight: 0,
      rescanExplorerHeight: 0,
      rescanGlobalAppsHeight: 0,
      kadenaAccountInput: '',
      kadenaChainIDInput: 0,
      removeLastInformation: false,
      updateDialogVisible: false,
      updateProgress: 0,
    };
  },
  setup() {
    const { ...mapState } = computed(() => {
      ('flux', [
        'fluxVersion',
      ]);
    });

    const currentLoginPhrase = computed(() => {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      return auth.loginPhrase;
    });

    return {
      mapState,
      currentLoginPhrase
    }
  },
  mounted() {
    this.getKadenaAccount();
    this.getLatestFluxVersion();
  },
  methods: {
    async getKadenaAccount() {
      const response = await FluxService.getKadenaAccount();
      if (response.data.status === 'success' && response.data.data) {
        const acc = response.data.data.split('?chainid=');
        const chainID = acc.pop();
        const account = acc.join('?chainid=').slice(7);
        this.kadenaAccountInput = account;
        this.kadenaChainIDInput = Number(chainID);
      }
    },
    getLatestFluxVersion() {
      const self = this;
      axios.get('https://raw.githubusercontent.com/runonflux/flux/master/package.json')
        .then((response) => {
          console.log(response);
          if (response.data.version !== self.fluxVersion) {
            this.showToast('warning', 'Flux requires an update!');
          } else {
            this.showToast('success', 'Flux is up to date');
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error verifying recent version');
        });
    },
    async adjustKadena() {
      const account = this.kadenaAccountInput;
      const chainid = this.kadenaChainIDInput;
      const zelidauth = localStorage.getItem('zelidauth');
      try {
        const cruxIDResponse = await FluxService.adjustKadena(zelidauth, account, chainid);
        if (cruxIDResponse.data.status === 'error') {
          this.showToast('danger', cruxIDResponse.data.data.message || cruxIDResponse.data.data);
        } else {
          this.showToast('success', cruxIDResponse.data.data.message || cruxIDResponse.data.data);
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    updateHardWay() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      this.showToast('warning', 'Flux is now being forcefully updated in the background');
      FluxService.hardUpdateFlux(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          this.showToast('danger', e.toString());
        });
    },
    rescanExplorer() {
      this.showToast('warning', 'Explorer will now rescan');
      const zelidauth = localStorage.getItem('zelidauth');
      const blockheight = this.rescanExplorerHeight > 0 ? this.rescanExplorerHeight : 0;
      ExplorerService.rescanExplorer(zelidauth, blockheight)
        .then((response) => {
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error while trying to rescan Explorer');
        });
    },
    rescanFlux() {
      this.showToast('warning', 'Flux will now rescan');
      const zelidauth = localStorage.getItem('zelidauth');
      const blockheight = this.rescanFluxHeight > 0 ? this.rescanFluxHeight : 0;
      ExplorerService.rescanFlux(zelidauth, blockheight)
        .then((response) => {
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error while trying to rescan Flux');
        });
    },
    reindexExplorer() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      this.showToast('warning', 'Explorer databases will begin to reindex soon');
      ExplorerService.reindexExplorer(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          this.showToast('danger', e.toString());
        });
    },
    reindexFlux() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      this.showToast('warning', 'Flux databases will begin to reindex soon');
      ExplorerService.reindexFlux(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          this.showToast('danger', e.toString());
        });
    },
    reindexGlobalApps() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      this.showToast('warning', 'Global Applications information will reindex soon');
      AppsService.reindexGlobalApps(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            this.showToast('succeess', response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          this.showToast('danger', e.toString());
        });
    },
    reindexLocations() {
      const zelidauth = localStorage.getItem('zelidauth');
      this.showToast('warning', 'Global Applications location will reindex soon');
      AppsService.reindexLocations(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          this.showToast('danger', e.toString());
        });
    },
    rescanGlobalApps() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      this.showToast('warning', 'Global Applications information will be rescanned soon');
      const blockheight = this.rescanExplorerHeight > 0 ? this.rescanExplorerHeight : 0;
      AppsService.rescanGlobalApps(zelidauth, blockheight, this.removeLastInformation)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          this.showToast('danger', e.toString());
        });
    },
    restartBlockProcessing() {
      const zelidauth = localStorage.getItem('zelidauth');
      this.showToast('warning', 'Restarting block processing');
      ExplorerService.restartBlockProcessing(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          this.showToast('danger', e.toString());
        });
    },
    stopBlockProcessing() {
      const zelidauth = localStorage.getItem('zelidauth');
      this.showToast('warning', 'Stopping block processing');
      ExplorerService.stopBlockProcessing(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          }
          if (response.data.status === 'success') {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          this.showToast('danger', e.toString());
        });
    },
    updateFlux() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      const self = this;
      axios.get('https://raw.githubusercontent.com/runonflux/flux/master/package.json')
        .then((response) => {
          console.log(response);
          if (response.data.version !== self.fluxVersion) {
            this.showToast('warning', 'Flux is now updating in the background');
            self.updateDialogVisible = true;
            self.updateProgress = 5;
            const interval = setInterval(() => {
              if (self.updateProgress === 99) {
                self.updateProgress += 1;
              } else {
                self.updateProgress += 2;
              }
              if (self.updateProgress >= 100) {
                clearInterval(interval);
                this.showToast('success', 'Update completed. Flux will now reload');
                setTimeout(() => {
                  if (self.updateDialogVisible) {
                    window.location.reload(true);
                  }
                }, 5000);
              }
              if (!self.updateDialogVisible) {
                clearInterval(interval);
                self.updateProgress = 0;
              }
            }, 1000);
            FluxService.softUpdateInstallFlux(zelidauth)
              .then((responseB) => {
                console.log(responseB);
                if (responseB.data.status === 'error') {
                  this.showToast('danger', responseB.data.data.message || responseB.data.data);
                }
                if (responseB.data.data.code === 401) {
                  self.updateDialogVisible = false;
                  self.updateProgress = 0;
                }
              })
              .catch((e) => {
                console.log(e);
                console.log(e.code);
                if (e.toString() === 'Error: Network Error') {
                  self.updateProgress = 50;
                } else {
                  self.updateDialogVisible = false;
                  self.updateProgress = 0;
                  this.showToast('danger', e.toString());
                }
              });
          } else {
            this.showToast('success', 'Flux is already up to date.');
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error verifying recent version');
        });
    },
    async stopMonitoring(deleteData = false) {
      this.output = '';
      this.showToast('warning', 'Stopping Applications Monitoring');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.stopAppMonitoring(zelidauth, null, deleteData);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      console.log(response);
    },
    async startMonitoring() {
      this.output = '';
      this.showToast('warning', 'Starting Applications Monitoring');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.startAppMonitoring(zelidauth);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      console.log(response);
    },
    showToast(variant, title, icon = 'InfoIcon') {
      this.$bvToast.toast({
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

<style>
</style>
