import './utils/webcrypto-polyfill';
import Vue from 'vue';
import {
  BVConfigPlugin,
  LayoutPlugin,
  ToastPlugin,
  ModalPlugin,
  BootstrapVue,
  IconsPlugin,
} from 'bootstrap-vue';

import DOMPurify from 'dompurify';
import router from './router';
import store from './store';
import App from './App.vue';

// Global Components
import './global-components';

// 3rd party plugins
import '@axios';
import '@/libs/portal-vue';
import '@/libs/toastification';
import 'bootstrap-icons/font/bootstrap-icons.css';

import ListEntry from '@/views/components/ListEntry.vue';
import SmartIcon from '@/views/components/SmartIcon.vue';

// eslint-disable-next-line vue/component-definition-name-casing
Vue.component('list-entry', ListEntry);
// eslint-disable-next-line vue/component-definition-name-casing
Vue.component('smart-icon', SmartIcon);

// BSV Plugin Registration
// Supply complete config to the BVConfig helper plugin
Vue.use(BVConfigPlugin, {
  breakpoints: ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'],
});
Vue.use(LayoutPlugin);
Vue.use(ToastPlugin);
Vue.use(ModalPlugin);
Vue.use(BootstrapVue);
Vue.use(IconsPlugin);

Vue.directive('sane-html', (el, binding) => {
  // eslint-disable-next-line no-param-reassign
  el.innerHTML = DOMPurify.sanitize(binding.value);
});

// import core styles
require('@core/scss/core.scss');

// import assets styles
require('@/assets/scss/style.scss');

Vue.config.productionTip = false;

new Vue({
  router,
  store,
  render: (h) => h(App),
}).$mount('#app');
