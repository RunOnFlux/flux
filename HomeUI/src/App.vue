<template>
  <div
    id="app"
    class="h-100"
    :class="[skinClasses]"
  >
    <component :is="layout">
      <router-view />
    </component>

    <scroll-to-top v-if="enableScrollToTop" />
  </div>
</template>

<script>
import ScrollToTop from '@core/components/scroll-to-top/ScrollToTop.vue';

// This will be populated in `beforeCreate` hook
import { $themeColors, $themeBreakpoints, $themeConfig } from '@themeConfig';
import { provideToast } from 'vue-toastification/composition';
import { watch } from '@vue/composition-api';
import useAppConfig from '@core/app-config/useAppConfig';

import { useWindowSize, useCssVar } from '@vueuse/core';

import store from '@/store';

import IDService from '@/services/IDService';

const qs = require('qs');

const LayoutVertical = () => import('@/layouts/vertical/LayoutVertical.vue');
const LayoutFull = () => import('@/layouts/full/LayoutFull.vue');

export default {
  components: {

    // Layouts
    LayoutVertical,
    LayoutFull,

    ScrollToTop,
  },
  setup() {
    const { skin, skinClasses } = useAppConfig();
    const { enableScrollToTop } = $themeConfig.layout;

    // If skin is dark when initialized => Add class to body
    if (skin.value === 'dark') document.body.classList.add('dark-layout');

    // Provide toast for Composition API usage
    // This for those apps/components which uses composition API
    // Demos will still use Options API for ease
    provideToast({
      hideProgressBar: true,
      closeOnClick: false,
      closeButton: false,
      icon: false,
      timeout: 3000,
      transition: 'Vue-Toastification__fade',
    });

    // Set Window Width in store
    store.commit('app/UPDATE_WINDOW_WIDTH', window.innerWidth);
    const { width: windowWidth } = useWindowSize();
    watch(windowWidth, (val) => {
      store.commit('app/UPDATE_WINDOW_WIDTH', val);
    });

    return {
      skinClasses,
      enableScrollToTop,
    };
  },
  // ! We can move this computed: layout & contentLayoutType once we get to use Vue 3
  // Currently, router.currentRoute is not reactive and doesn't trigger any change
  computed: {
    layout() {
      if (this.$route.meta.layout === 'full') return 'layout-full';
      return `layout-${this.contentLayoutType}`;
    },
    contentLayoutType() {
      return this.$store.state.appConfig.layout.type;
    },
  },
  beforeCreate() {
    // Set colors in theme
    const colors = ['primary', 'secondary', 'success', 'info', 'warning', 'danger', 'light', 'dark'];

    // eslint-disable-next-line no-plusplus
    for (let i = 0, len = colors.length; i < len; i++) {
      $themeColors[colors[i]] = useCssVar(`--${colors[i]}`, document.documentElement).value.trim();
    }

    // Set Theme Breakpoints
    const breakpoints = ['xs', 'sm', 'md', 'lg', 'xl'];

    // eslint-disable-next-line no-plusplus
    for (let i = 0, len = breakpoints.length; i < len; i++) {
      $themeBreakpoints[breakpoints[i]] = Number(useCssVar(`--breakpoint-${breakpoints[i]}`, document.documentElement).value.slice(0, -2));
    }

    // Set RTL
    const { isRTL } = $themeConfig.layout;
    document.documentElement.setAttribute('dir', isRTL ? 'rtl' : 'ltr');
  },
  created() {
    this.adjustHostnameAndPort();
    this.getZelIdLoginPhrase();
  },
  methods: {
    adjustHostnameAndPort() {
      const { hostname, port } = window.location;
      const regex = /[A-Za-z]/g;
      if (!hostname.match(regex)) {
        if (typeof hostname === 'string') {
          this.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          this.$store.commit('flux/setFluxPort', apiPort);
        }
      }
    },
    getZelIdLoginPhrase() {
      IDService.loginPhrase()
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            if (response.data.data.name === 'MongoNetworkError') {
              this.errorMessage = 'Failed to connect to MongoDB.';
            } else if (JSON.stringify(response.data.data).includes('CONN')) {
              // we can fix daemon, benchmark problems. But cannot fix mongo, docker issues (docker may be possible to fix in the future, mongo not)...
              this.getEmergencyLoginPhrase();
            } else {
              this.errorMessage = response.data.data.message;
            }
          } else {
            this.loginPhrase = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          // vue.$customMes.error(error)
          this.errorMessage = 'Error connecting to Flux Backend';
        });
    },
    getEmergencyLoginPhrase() {
      IDService.emergencyLoginPhrase()
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            this.errorMessage = response.data.data.message;
          } else {
            this.loginPhrase = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          // vue.$customMes.error(error)
          this.errorMessage = 'Error connecting to Flux Backend';
        });
    },
    activeLoginPhrases() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      IDService.activeLoginPhrases(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            // vue.$customMes.error(response.data.data.message)
          }
        })
        .catch((e) => {
          console.log(e);
          console.log(e.code);
          // vue.$customMes.error(e.toString())
        });
    },
  },
};
</script>
