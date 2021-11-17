<template>
  <div class="sidebar-left">
    <div class="sidebar">
      <div class="sidebar-content marketplace-sidebar">
        <div class="marketplace-app-menu">
          <div class="add-task"/>
          <vue-perfect-scrollbar
            :settings="perfectScrollbarSettings"
            class="sidebar-menu-list scroll-area"
          >
            <!-- Filters -->
            <b-list-group class="list-group-filters">
              <b-list-group-item
                v-for="filter in taskFilters"
                :key="filter.title + $route.path"
                :to="filter.route"
                :active="isDynamicRouteActive(filter.route)"
                @click="$emit('close-app-view'); $emit('close-left-sidebar')"
              >
                <feather-icon
                  :icon="filter.icon"
                  size="18"
                  class="mr-75"
                />
                <span class="align-text-bottom line-height-1">{{ filter.title }}</span>
              </b-list-group-item>
            </b-list-group>
          </vue-perfect-scrollbar>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import VuePerfectScrollbar from 'vue-perfect-scrollbar';
import { BListGroup, BListGroupItem } from 'bootstrap-vue';
import { isDynamicRouteActive } from '@core/utils/utils';
import Ripple from 'vue-ripple-directive';

export default {
  directives: {
    Ripple,
  },
  components: {
    BListGroup,
    BListGroupItem,
    VuePerfectScrollbar,
  },
  props: {
  },
  setup() {
    const perfectScrollbarSettings = {
      maxScrollbarLength: 60,
    };

    const taskFilters = [
      { title: 'All Categories', icon: 'MailIcon', route: { name: 'apps-marketplace' } },
      { title: 'Games', icon: 'StarIcon', route: { name: 'apps-marketplace-filter', params: { filter: 'games' } } },
      { title: 'Productivity', icon: 'CheckIcon', route: { name: 'apps-marketplace-filter', params: { filter: 'productivity' } } },
    ];

    return {
      perfectScrollbarSettings,
      taskFilters,
      isDynamicRouteActive,
    };
  },
};
</script>

<style>

</style>
