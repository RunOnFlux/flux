<template>
  <b-nav-item
    v-b-tooltip.hover title="Toggle Menu Style"
    @click="isNavMenuCollapsed = isCollapsed ? false : true"
    class="menu-toggler"
  >
    <v-icon
      size="21"
      :name="`${isCollapsed ? 'bars' : 'align-left'}`"
    />
  </b-nav-item>
</template>

<script>
import useAppConfig from '@core/app-config/useAppConfig'
import { computed } from '@vue/composition-api'
import {
  BNavItem,
  VBTooltip,
} from 'bootstrap-vue'

export default {
  components: {
    BNavItem,
  },
  directives: {
    'b-tooltip': VBTooltip,
  },
  setup() {
    const { isNavMenuCollapsed } = useAppConfig()

    const isCollapsed = computed(() => isNavMenuCollapsed.value === true)

    return { isNavMenuCollapsed, isCollapsed }
  },
}
</script>

<style scoped>
.menu-toggler {
  width: 21px;
  height: 21px;
  margin-top: 3px;
  margin-right: 10px;
}
</style>
