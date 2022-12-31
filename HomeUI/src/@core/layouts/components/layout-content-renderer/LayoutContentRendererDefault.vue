<template>
  <div
    class="app-content content"
    :class="[{'show-overlay': store._state.data.app.shallShowOverlay}, route.meta.contentClass]"
  >
    <div class="content-overlay" />
    <div class="header-navbar-shadow" />
    <div
      class="content-wrapper"
      :class="contentWidth === 'boxed' ? 'container p-0' : null"
    >
      <slot name="breadcrumb">
        <app-breadcrumb />
      </slot>
      <div class="content-body">
        <transition
          :name="routerTransition"
          mode="out-in"
        >
          <slot />
        </transition>
      </div>
    </div>
  </div>
</template>

<script>
import AppBreadcrumb from '@core/layouts/components/AppBreadcrumb.vue';
import useAppConfig from '@core/app-config/useAppConfig';
import { useRoute } from 'vue-router';
import { useStore } from 'vuex';

export default {
  components: {
    AppBreadcrumb,
  },
  setup() {
    const { routerTransition, contentWidth } = useAppConfig();
    const route = useRoute()
    const store = useStore()
    return {
      routerTransition,
      contentWidth,
      route,
      store
    };
  },
};
</script>

<style>

</style>
