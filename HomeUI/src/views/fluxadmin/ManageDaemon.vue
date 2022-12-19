<template>
  <div>
    <b-row class="match-height">
      <b-col
        sm="12"
        lg="6"
      >
        <b-card title="Daemon">
          <b-card-text class="mb-3">
            An easy way to update your Flux daemon to the latest version. Flux will be automatically started once update is done.
          </b-card-text>
          <div class="text-center">
            <b-button
              id="update-daemon"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Update Daemon"
            >
              Update Daemon
            </b-button>
            <confirm-dialog
              target="update-daemon"
              confirm-button="Update Daemon"
              @confirm="updateDaemon()"
            />
          </div>
        </b-card>
      </b-col>
      <b-col
        sm="12"
        lg="6"
      >
        <b-card title="Manage Process">
          <b-card-text class="mb-3">
            Here you can manage your Flux daemon process.
          </b-card-text>
          <div class="text-center">
            <b-button
              id="start-daemon"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Start Daemon"
              class="mx-1 mb-1"
            >
              Start Daemon
            </b-button>
            <b-button
              id="stop-daemon"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Stop Daemon"
              class="mx-1 mb-1"
            >
              Stop Daemon
            </b-button>
            <b-button
              id="restart-daemon"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Restart Daemon"
              class="mx-1 mb-1"
            >
              Restart Daemon
            </b-button>
            <confirm-dialog
              target="start-daemon"
              confirm-button="Start Daemon"
              @confirm="startDaemon()"
            />
            <confirm-dialog
              target="stop-daemon"
              confirm-button="Stop Daemon"
              @confirm="stopDaemon()"
            />
            <confirm-dialog
              target="restart-daemon"
              confirm-button="Restart Daemon"
              @confirm="restartDaemon()"
            />
          </div>
        </b-card>
      </b-col>
    </b-row>
    <b-row class="match-height">
      <b-col
        sm="12"
        lg="8"
      >
        <b-card title="Rescan">
          <b-card-text class="mb-2">
            Choose a blockheight to rescan Daemon from and click on Rescan Daemon to begin rescanning.
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
              v-model="rescanDaemonHeight"
              style="width: 250px;"
            />
            <b-button
              id="rescan-daemon"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Rescan Daemon"
              class="mx-1"
              style="width: 250px;"
            >
              Rescan Daemon
            </b-button>
            <confirm-dialog
              target="rescan-daemon"
              confirm-button="Rescan Daemon"
              @confirm="rescanDaemon()"
            />
          </div>
        </b-card>
      </b-col>
      <b-col
        sm="12"
        lg="4"
      >
        <b-card title="Reindex">
          <b-card-text class="mb-2">
            This option reindexes Flux blockchain data. It will take several hours to finish the operation.
          </b-card-text>
          <div class="text-center">
            <b-button
              id="reindex-daemon"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Reindex Daemon"
            >
              Reindex Daemon
            </b-button>
            <confirm-dialog
              target="reindex-daemon"
              confirm-button="Reindex Daemon"
              @confirm="reindexDaemon()"
            />
          </div>
        </b-card>
      </b-col>
    </b-row>
  </div>
</template>

<script>
// import { mapState } from 'vuex'
import {
  BCard,
  BRow,
  BCol,
  BCardText,
  BButton,
  // VBTooltip,
} from 'bootstrap-vue';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import Ripple from 'vue-ripple-directive';
import axios from 'axios';
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';
import InputSpinButton from '@/views/components/InputSpinButton.vue';

import DaemonService from '@/services/DaemonService';
import FluxService from '@/services/FluxService';
// import ExplorerService from '@/services/ExplorerService'
// import AppsService from '@/services/AppsService'

import qs from 'qs';

export default {
  components: {
    BCard,
    BRow,
    BCol,
    BCardText,
    BButton,
    InputSpinButton,
    ConfirmDialog,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    // 'b-tooltip': VBTooltip,
    Ripple,
  },
  data() {
    return {
      rescanDaemonHeight: 0,
    };
  },
  mounted() {
    this.checkDaemonVersion();
  },
  methods: {
    checkDaemonVersion() {
      DaemonService.getInfo()
        .then((daemonResponse) => {
          console.log(daemonResponse);
          const daemonVersion = daemonResponse.data.data.version;
          axios.get('https://raw.githubusercontent.com/runonflux/flux/master/helpers/daemoninfo.json')
            .then((response) => {
              console.log(response);
              if (response.data.version !== daemonVersion) {
                this.showToast('warning', 'Daemon requires an update!');
              } else {
                this.showToast('success', 'Daemon is up to date.');
              }
            })
            .catch((error) => {
              console.log(error);
              this.showToast('danger', 'Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error connecting to Daemon');
        });
    },
    updateDaemon() {
      DaemonService.getInfo()
        .then((daemonResponse) => {
          console.log(daemonResponse);
          const daemonVersion = daemonResponse.data.data.version;
          axios.get('https://raw.githubusercontent.com/runonflux/flux/master/helpers/daemoninfo.json')
            .then((response) => {
              console.log(response);
              if (response.data.version !== daemonVersion) {
                const zelidauth = localStorage.getItem('zelidauth');
                const auth = qs.parse(zelidauth);
                console.log(auth);
                this.showToast('warning', 'Daemon is now updating in the background');
                FluxService.updateDaemon(zelidauth)
                  .then((responseUpdateDaemon) => {
                    console.log(responseUpdateDaemon);
                    if (responseUpdateDaemon.data.status === 'error') {
                      this.showToast('danger', responseUpdateDaemon.data.data.message || responseUpdateDaemon.data.data);
                    }
                  })
                  .catch((e) => {
                    console.log(e);
                    console.log(e.code);
                    this.showToast('danger', e.toString());
                  });
              } else {
                this.showToast('success', 'Daemon is already up to date');
              }
            })
            .catch((error) => {
              console.log(error);
              this.showToast('danger', 'Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error connecting to Daemon');
        });
    },
    startDaemon() {
      this.showToast('warning', 'Daemon will start');
      const zelidauth = localStorage.getItem('zelidauth');
      DaemonService.start(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error while trying to start Daemon');
        });
    },
    stopDaemon() {
      this.showToast('warning', 'Daemon will be stopped');
      const zelidauth = localStorage.getItem('zelidauth');
      DaemonService.stopDaemon(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error while trying to stop Daemon');
        });
    },
    restartDaemon() {
      this.showToast('warning', 'Daemon will now restart');
      const zelidauth = localStorage.getItem('zelidauth');
      DaemonService.restart(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error while trying to restart Daemon');
        });
    },
    rescanDaemon() {
      this.showToast('warning', 'Daemon will now rescan. This will take up to an hour.');
      const zelidauth = localStorage.getItem('zelidauth');
      const blockheight = this.rescanDaemonHeight > 0 ? this.rescanDaemonHeight : 0;
      DaemonService.rescanDaemon(zelidauth, blockheight)
        .then((response) => {
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error while trying to rescan Daemon');
        });
    },
    reindexDaemon() {
      this.showToast('warning', 'Daemon will now reindex. This will take several hours.');
      const zelidauth = localStorage.getItem('zelidauth');
      FluxService.reindexDaemon(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error while trying to reindex Daemon');
        });
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

<style>

</style>
