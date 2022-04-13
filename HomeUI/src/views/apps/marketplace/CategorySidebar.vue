<template>
  <div class="sidebar-left">
    <div class="sidebar">
      <div class="sidebar-content marketplace-sidebar">
        <div class="marketplace-app-menu">
          <div class="add-task" />
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
                <v-icon
                  :name="filter.icon"
                  scale="1.55"
                  class="mr-75 icon-spacing"
                />

                <span class="line-height-2">{{ filter.title }}</span>
              </b-list-group-item>
            </b-list-group>
            <hr>
            <b-list-group class="list-group-filters">
              <b-list-group-item
                v-for="action in nodeActions"
                :key="action.title + $route.path"
                :to="action.route"
                :active="isDynamicRouteActive(action.route)"
                @click="$emit('close-app-view'); $emit('close-left-sidebar'); $emit(action.event)"
              >
                <v-icon
                  :name="action.icon"
                  scale="1.55"
                  class="mr-75 icon-spacing"
                />

                <span class="line-height-2">{{ action.title }}</span>
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

import {
  ref,
} from '@vue/composition-api';

import { categories } from '../../../libs/marketplaceCategories';

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
    zelid: {
      type: String,
      required: false,
      default: '',
    },
    sharedNodeZelIDs: {
      type: Array,
      required: true,
    },
  },
  setup(props) {
    const perfectScrollbarSettings = {
      maxScrollbarLength: 60,
    };

    const userZelid = ref('');
    userZelid.value = props.zelid;

    const taskFilters = [
      { title: 'All Categories', icon: 'inbox', route: { name: 'apps-marketplace' } },
    ];

    categories.forEach((category) => {
      taskFilters.push({
        title: category.name,
        icon: category.icon,
        route: {
          name: 'apps-marketplace-filter',
          params: {
            filter: category.name.toLowerCase(),
          },
        },
      });
    });

    const canViewSharedNodes = () => props.sharedNodeZelIDs.includes(userZelid.value);

    const nodeActions = canViewSharedNodes() ? [
      /* {
        title: 'Managed Services',
        icon: 'server',
        event: 'open-managed-services',
        route: { name: 'apps-marketplace-managedservices' },
      }, */
      {
        title: 'Shared Nodes',
        icon: 'inbox',
        event: 'open-shared-nodes',
        route: { name: 'apps-marketplace-sharednodes' },
      },
    ] : [];

    return {
      perfectScrollbarSettings,
      taskFilters,
      nodeActions,
      isDynamicRouteActive,
    };
  },
};
</script>

<style>
.icon-spacing {
  vertical-align: middle !important;
  width: 1.25em;
}
.line-height-2 {
  line-height: 2;
}
</style>
