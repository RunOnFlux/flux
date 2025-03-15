<template>
  <b-row
    v-if="$route.meta.breadcrumb || $route.meta.pageTitle"
    class="content-header"
  >
    <!-- Content Left -->
    <b-col
      class="content-header-left mb-2"
      cols="12"
      md="9"
    >
      <b-row class="breadcrumbs-top">
        <b-col cols="12">
          <h2 class="content-header-title float-left pr-1 mb-0">
            {{ $route.meta.pageTitle }}
          </h2>
          <div class="breadcrumb-wrapper">
            <b-breadcrumb>
              <b-breadcrumb-item to="/">
                <feather-icon
                  icon="HomeIcon"
                  size="16"
                  class="align-text-top"
                />
              </b-breadcrumb-item>
              <b-breadcrumb-item
                v-for="item in $route.meta.breadcrumb"
                :key="item.text"
                :active="item.active"
                :to="item.to"
              >
                {{ item.text }}
              </b-breadcrumb-item>
              <b-breadcrumb-item v-if="appName" :active="true">
                <span class="app-name-display">{{ appName }}</span>
              </b-breadcrumb-item>
            </b-breadcrumb>
          </div>
        </b-col>
      </b-row>
    </b-col>
  </b-row>
</template>

<script>
import {
  BBreadcrumb, BBreadcrumbItem, BRow, BCol, // BDropdown, BDropdownItem, BButton,
} from 'bootstrap-vue';
import Ripple from 'vue-ripple-directive';

export default {
  directives: {
    Ripple,
  },
  components: {
    BBreadcrumb,
    BBreadcrumbItem,
    BRow,
    BCol,
  },
  computed: {
    appName() {
      return this.$store.state.flux.appSpecification.name;
    },
  },
};
</script>

<style>
.app-name-display {
  color: #6e6b7b;
}

body.dark-layout .app-name-display {
  color: #b4b7bd;
}
</style>
