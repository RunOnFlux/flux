import { createApp } from 'vue'
import { createPinia, defineStore } from 'pinia'

// Modules
import App from './app'
import appConfig from './app-config';
import verticalMenu from './vertical-menu';
import flux from './flux';

const app = createApp(App)
const pinia = createPinia()

app.use(pinia) // Create the root store

app.mount('#app')

export default defineStore({
  modules: {
    app,
    appConfig,
    verticalMenu,
    flux,
  },
  strict: process.env.DEV,
});
