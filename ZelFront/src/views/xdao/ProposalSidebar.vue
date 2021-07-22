<template>
  <div class="sidebar-left">
    <div class="sidebar">
      <div class="sidebar-content xdao-sidebar">
        <div class="xdao-app-menu">
          <div class="add-task">
            <b-button
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="primary"
              block
              @click="$emit('close-proposal-view'); $emit('close-left-sidebar'); $emit('open-add-proposal-view')"
            >
              Add Proposal
            </b-button>
          </div>
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
                @click="$emit('close-proposal-view'); $emit('close-left-sidebar')"
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
import VuePerfectScrollbar from 'vue-perfect-scrollbar'
import { BButton, BListGroup, BListGroupItem } from 'bootstrap-vue'
import { isDynamicRouteActive } from '@core/utils/utils'
import Ripple from 'vue-ripple-directive'

export default {
  directives: {
    Ripple,
  },
  components: {
    BButton,
    BListGroup,
    BListGroupItem,
    VuePerfectScrollbar,
  },
  props: {
  },
  setup() {
    const perfectScrollbarSettings = {
      maxScrollbarLength: 60,
    }

    const taskFilters = [
      { title: 'All Proposals', icon: 'MailIcon', route: { name: 'xdao-app' } },
      { title: 'Open', icon: 'StarIcon', route: { name: 'xdao-app-filter', params: { filter: 'open' } } },
      { title: 'Passed', icon: 'CheckIcon', route: { name: 'xdao-app-filter', params: { filter: 'passed' } } },
      { title: 'Unpaid', icon: 'StarIcon', route: { name: 'xdao-app-filter', params: { filter: 'unpaid' } } },
      { title: 'Rejected', icon: 'TrashIcon', route: { name: 'xdao-app-filter', params: { filter: 'rejected' } } },
    ]

    return {
      perfectScrollbarSettings,
      taskFilters,
      isDynamicRouteActive,
    }
  },
}
</script>

<style>

</style>
