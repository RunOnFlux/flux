import { createApp } from 'vue';
import { createStore } from 'vuex'

// Modules
import App from './app'
import appConfig from './app-config';
import verticalMenu from './vertical-menu';
import flux from './flux';

// Create a new store instance.
const store = createStore({
  modules: {
    app: App,
    appConfig: appConfig,
    verticalMenu: verticalMenu,
    flux: flux,
  },
  strict: process.env.DEV,
  state () {
    return {
      count: 1
    }
  },
})

const app = createApp(App)

app.use(store)

app.mount('#app')

export {
  store
}
