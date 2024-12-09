<template>
  <div>
    <b-tabs v-if="!managedApplication" pills @activate-tab="tabChanged">
      <my-apps-tab
        ref="activeApps"
        :apps="activeApps"
        :loading="loading.active"
        :logged-in="loggedIn"
        :current-block-height="daemonBlockCount"
        @open-app-management="openAppManagement"
      />
      <my-apps-tab
        ref="expiredApps"
        :apps="expiredApps"
        :loading="loading.expired"
        :logged-in="loggedIn"
        :current-block-height="daemonBlockCount"
        :active-apps-tab="false"
      />
    </b-tabs>
    <management
      v-if="managedApplication"
      :app-name="managedApplication"
      :global="true"
      :installed-apps="[]"
      @back="clearManagedApplication"
    />
  </div>
</template>

<script>
import Management from '@/views/apps/Management.vue';
import MyAppsTab from '@/views/components/myApps/MyAppsTab.vue';
import AppsService from '@/services/AppsService';
import DaemonService from '@/services/DaemonService';

const qs = require('qs');

export default {
  components: {
    Management,
    MyAppsTab,
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
      loggedIn: false,
    };
  },
  created() {
    this.setLoginStatus();
    this.getApps();
    this.getDaemonBlockCount();
  },
  methods: {
    async getDaemonBlockCount() {
      const response = await DaemonService.getBlockCount().catch(
        () => ({ data: { status: 'fail' } }),
      );
      if (response.data.status === 'success') {
        this.daemonBlockCount = response.data.data;
      }
    },
    openAppManagement(appName) {
      this.managedApplication = appName;
    },
    clearManagedApplication() {
      this.managedApplication = '';
      this.$nextTick(() => {
        this.tabChanged();
      });
    },
    async getActiveApps() {
      this.loading.active = true;
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);

      if (!auth) {
        this.$set(this.activeApps, []);
        return;
      }
      const response = await AppsService.myGlobalAppSpecifications(auth.zelid).catch(
        () => ({ data: { data: [] } }),
      );
      this.activeApps = response.data.data;
      this.loading.active = false;
    },
    async getExpiredApps() {
      try {
        const zelidauth = localStorage.getItem('zelidauth');
        const auth = qs.parse(zelidauth);
        if (!auth.zelid) {
          this.$set(this.expiredApps, []);
          return;
        }

        const response = await AppsService.permanentMessagesOwner(
          auth.zelid,
        ).catch(() => ({ data: { data: [] } }));
        const adjustedPermMessages = [];

        const {
          data: { data: appMessages },
        } = response;
        appMessages.forEach((msg) => {
          const appExists = adjustedPermMessages.find(
            (existingApp) => existingApp.appSpecifications.name
              === msg.appSpecifications.name,
          );
          if (appExists) {
            if (msg.height > appExists.height) {
              const index = adjustedPermMessages.findIndex(
                (existingApp) => existingApp.appSpecifications.name
                  === msg.appSpecifications.name,
              );
              if (index > -1) {
                adjustedPermMessages.splice(index, 1);
                adjustedPermMessages.push(msg);
              }
            }
          } else {
            adjustedPermMessages.push(msg);
          }
        });

        const expiredApps = [];
        adjustedPermMessages.forEach((msg) => {
          const appAlreadyDeployed = this.activeApps.find(
            (existingApp) => existingApp.name.toLowerCase()
              === msg.appSpecifications.name.toLowerCase(),
          );
          if (!appAlreadyDeployed) {
            const app = msg.appSpecifications;
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
    async getApps() {
      await this.getActiveApps();
      await this.getExpiredApps();
    },
    tabChanged() {
      this.$refs.activeApps.hideTabs();
      this.$refs.expiredApps.hideTabs();
      this.setLoginStatus();
    },
    setLoginStatus() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      // this should check time too
      this.loggedIn = Boolean(auth.zelid);
    },
  },
};
</script>
