<template>
  <div>
    <b-tabs
      v-if="!managedApplication"
      pills
      @activate-tab="tabChanged()"
    >
      <my-apps-tab :apps="activeApps" :current-block-height="daemonBlockCount" @open-app-management="openAppManagement" />
      <my-apps-tab :apps="expiredApps" :active-apps-tab="false" :current-block-height="daemonBlockCount" />
    </b-tabs>
    <management
      v-if="managedApplication"
      :app-name="managedApplication"
      :global="true"
      :installed-apps="[]"
      @back="clearManagedApplication()"
    />
  </div>
</template>

<script>
import {
  BTabs,
  // BTab,
  // BTable,
  // BCol,
  // BCard,
  // // BCardTitle,
  // BRow,
  // BButton,
  // BOverlay,
  VBTooltip,
} from 'bootstrap-vue';

import Ripple from 'vue-ripple-directive';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
// import ListEntry from f'@/views/components/ListEntry.vue';
import Management from '@/views/apps/Management.vue';
// import ExpiryLabel from '@/views/components/myApps/ExpiryLabel.vue';
import MyAppsTab from '@/views/components/myApps/MyAppsTab.vue';
import AppsService from '@/services/AppsService';
import DaemonService from '@/services/DaemonService';

const qs = require('qs');

export default {
  components: {
    BTabs,
    // BTab,
    // BTable,
    // BCol,
    // BCard,
    // // BCardTitle,
    // BRow,
    // BButton,
    // BOverlay,
    // ListEntry,
    Management,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
    MyAppsTab,
    // ExpiryLabel,
  },
  directives: {
    'b-tooltip': VBTooltip,
    Ripple,
  },
  data() {
    return {
      activeApps: [],
      expiredApps: [],
      managedApplication: '',
      daemonBlockCount: -1,
      loading: {
        active: true,
        expired: true,
      },
      allApps: [],
      allNodesLocations: [],
    };
  },
  created() {
    this.getActiveApps();
    this.getExpiredApps();
    this.getDaemonBlockCount();
  },
  methods: {
    async getDaemonBlockCount() {
      const response = await DaemonService.getBlockCount();
      if (response.data.status === 'success') {
        this.daemonBlockCount = response.data.data;
      }
    },
    openAppManagement(appName) {
      this.managedApplication = appName;
    },
    clearManagedApplication() {
      this.managedApplication = '';
    },
    async getActiveApps() {
      this.loading.active = true;
      const response = await AppsService.globalAppSpecifications().catch(() => ({ data: { data: [] } }));
      this.allApps = response.data.data;

      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);

      if (!auth) return;

      this.activeApps = this.allApps.filter((app) => app.owner === auth.zelid);
      this.loading.active = false;
    },
    async getExpiredApps() {
      try {
        const zelidauth = localStorage.getItem('zelidauth');
        const auth = qs.parse(zelidauth);
        if (!auth.zelid) return;

        const response = await AppsService.permanentMessagesOwner(auth.zelid).catch(() => ({ data: { data: [] } }));
        const adjustedPermMessages = [];

        const { data: { data: appMessages } } = response;
        appMessages.forEach((appMess) => {
          const appExists = adjustedPermMessages.find((existingApp) => existingApp.appSpecifications.name === appMess.appSpecifications.name);
          if (appExists) {
            if (appMess.height > appExists.height) {
              const index = adjustedPermMessages.findIndex((existingApp) => existingApp.appSpecifications.name === appMess.appSpecifications.name);
              if (index > -1) {
                adjustedPermMessages.splice(index, 1);
                adjustedPermMessages.push(appMess);
              }
            }
          } else {
            adjustedPermMessages.push(appMess);
          }
        });

        const expiredApps = [];
        adjustedPermMessages.forEach((appMes) => {
          const appAlreadyDeployed = this.allApps.find((existingApp) => existingApp.name.toLowerCase() === appMes.appSpecifications.name.toLowerCase());
          if (!appAlreadyDeployed) {
            const app = appMes.appSpecifications;
            expiredApps.push(app);
          }
        });

        this.expiredApps = expiredApps;
      } catch (error) {
        console.log(error);
      } finally {
        this.loading.expired = false;
      }
    },
    tabChanged() {
      this.activeApps.forEach((item) => {
        this.$set(item, '_showDetails', false);
      });
      this.expiredApps.forEach((item) => {
        this.$set(item, '_showDetails', false);
      });
    },
  },
};
</script>
