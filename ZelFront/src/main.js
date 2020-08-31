// The Vue build version to load with the `import` command
// (runtime-only or standalone) has been set in webpack.base.conf with an alias.
import Vue from 'vue';
import ElementUI from 'element-ui';
import 'element-ui/lib/theme-chalk/index.css';
import locale from 'element-ui/lib/locale/lang/en';
import App from './App';
import router from './router';
import store from './store';

Vue.config.productionTip = false;

Vue.use(ElementUI, { locale });
const customMessageOptions = {
  offset: 65,
};
Vue.prototype.$customMes = (options) => Vue.prototype.$message({ ...customMessageOptions, ...options });
Vue.prototype.$customMes.success = (mes) => Vue.prototype.$message.success({ ...customMessageOptions, message: mes });
Vue.prototype.$customMes.error = (mes) => Vue.prototype.$message.error({ ...customMessageOptions, message: mes });
Vue.prototype.$customMes.warning = (mes) => Vue.prototype.$message.warning({ ...customMessageOptions, message: mes });
Vue.prototype.$customMes.info = (mes) => Vue.prototype.$message.info({ ...customMessageOptions, message: mes });

new Vue({
  router,
  store,
  render: (h) => h(App),
}).$mount('#app');
