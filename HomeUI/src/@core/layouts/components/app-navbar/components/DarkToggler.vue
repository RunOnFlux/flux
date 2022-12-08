<template>
  <b-nav-item
    v-b-tooltip.hover
    title="Toggle Dark Mode"
    @click="skin = isDark ? 'light' : 'dark'"
  >
    <feather-icon
      size="21"
      :icon="`${isDark ? 'Sun' : 'Moon'}Icon`"
    />
  </b-nav-item>
</template>

<script>
import useAppConfig from '@core/app-config/useAppConfig';
import {
  BNavItem,
  VBTooltip,
} from 'bootstrap-vue';

export default {
  components: {
    BNavItem,
  },
  directives: {
    'b-tooltip': VBTooltip,
  },
  setup() {
    const { skin } = useAppConfig();

    const isDark = computed(() => skin.value === 'dark');

    return { skin, isDark };
  },
};
</script>
