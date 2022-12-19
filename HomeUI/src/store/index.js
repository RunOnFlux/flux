import { createApp } from 'vue'
import Vuex from 'vuex';

// Modules
import App from './app'
import appConfig from './app-config';
import verticalMenu from './vertical-menu';
import flux from './flux';

const app = createApp(App)

app.mount('#app')

app.use(Vuex);

export default new Vuex.Store({
  modules: {
    app,
    appConfig,
    verticalMenu,
    flux,
  },
  strict: process.env.DEV,
});
