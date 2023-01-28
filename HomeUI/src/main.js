import { createApp } from 'vue';
import {
  BVConfigPlugin,
  LayoutPlugin,
  ToastPlugin,
  ModalPlugin,
} from 'bootstrap-vue';

import router from './router';
import { store } from './store';
import App from './App.vue';

// Global Components
import './global-components';

// 3rd party plugins
import '@axios';
import '@/libs/portal-vue.js';
import '@/libs/toastification.js';

const app = createApp(App)

// BSV Plugin Registration
// Supply complete config to the BVConfig helper plugin
app.use(BVConfigPlugin, {
  breakpoints: ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'],
})
app.use(LayoutPlugin)
app.use(ToastPlugin)
app.use(ModalPlugin)

// import core styles
import '@core/scss/core.scss';

// import assets styles
import '@/assets/scss/style.scss';

app.config.productionTip = false
app.config.globalProperties.$localstore = store

app.use(router)
app.use(store)

app.mount('#app')
