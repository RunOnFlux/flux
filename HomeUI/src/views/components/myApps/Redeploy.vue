<template>
  <div>
    <b-button
      :id="`redeploy-installed-app-${row.item.name}`"
      v-b-tooltip.hover.top="'Redeploy App'"
      size="sm"
      class="mr-0 no-wrap"
      variant="outline-dark"
      pill
    >
      <b-icon
        scale="1"
        icon="building"
      />
      Redeploy
    </b-button>
    <confirm-dialog
      :target="`redeploy-installed-app-${row.item.name}`"
      confirm-button="Redeploy App"
      @confirm="redeployApp(row.item)"
    />
  </div>
</template>

<script>
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';

const qs = require('qs');

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
    redeployApp(appSpecs, isFromActive = false) {
      const specs = appSpecs;
      if (isFromActive) {
        specs.name += 'XXX';
        specs.name += Date.now().toString().slice(-5);
      }
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      if (auth) {
        specs.owner = auth.zelid;
      } else if (isFromActive) {
        specs.owner = '';
      }
      this.$router.replace({ name: 'apps-registerapp', params: { appspecs: JSON.stringify(appSpecs) } });
    },
  },
};
</script>

<style lang="scss">

</style>
