<template>
  <div class="d-flex no-wrap">
    <b-button
      :id="`manage-installed-app-${row.item.name}`"
      v-b-tooltip.hover.top="'Manage Installed App'"
      size="sm"
      class="mr-0"
      variant="outline-dark"
    >
      <b-icon
        scale="1"
        icon="gear"
      />
      Manage
    </b-button>
    <b-button
      v-b-tooltip.hover.top="'Visit App'"
      size="sm"
      class="mr-0 no-wrap hover-underline"
      variant="link"
      @click="openGlobalApp(row.item.name)"
    >
      <b-icon
        scale="1"
        icon="front"
      />
      Visit
    </b-button>
    <confirm-dialog
      :target="`manage-installed-app-${row.item.name}`"
      confirm-button="Manage App"
      @confirm="openAppManagement(row.item.name)"
    />
  </div>
</template>

<script>
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';
import AppsService from '@/services/AppsService';

export default {
  components: {
    ConfirmDialog,
  },
  props: {
    row: {
      type: Object,
      required: true,
    },
  },
  methods: {
    openAppManagement(appName) {
      this.$emit('open-app-management', appName);
    },
    async openGlobalApp(appName) { // open through FDM
      const response = await AppsService.getAppLocation(appName).catch((error) => {
        this.showToast('danger', error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        const appLocations = response.data.data;
        const location = appLocations[0];
        if (!location) {
          this.showToast('danger', 'Application is awaiting launching...');
        } else {
          const url = `https://${appName}.app.runonflux.io`;
          this.openSite(url);
        }
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
    },
    openSite(url) {
      const win = window.open(url, '_blank');
      win.focus();
    },
  },
};
</script>

<style lang="scss">

</style>
