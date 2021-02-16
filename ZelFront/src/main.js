// The Vue build version to load with the `import` command
// (runtime-only or standalone) has been set in webpack.base.conf with an alias.
import Vue from 'vue';
import {
  Dialog,
  Input,
  Select,
  Option,
  OptionGroup,
  Button,
  Table,
  TableColumn,
  Popover,
  Form,
  FormItem,
  Tabs,
  TabPane,
  Message,
  Notification,
  Popconfirm,
  Loading,
  Link,
  Menu,
  MenuItem,
  Submenu,
  Progress,
} from 'element-ui';
import 'element-ui/lib/theme-chalk/index.css';
import lang from 'element-ui/lib/locale/lang/en';
import locale from 'element-ui/lib/locale';
import App from './App';
import router from './router';
import store from './store';

Vue.config.productionTip = false;

Vue.use(Dialog);
Vue.use(Input);
Vue.use(Select);
Vue.use(Option);
Vue.use(OptionGroup);
Vue.use(Button);
Vue.use(Table);
Vue.use(TableColumn);
Vue.use(Popover);
Vue.use(Form);
Vue.use(FormItem);
Vue.use(Tabs);
Vue.use(TabPane);
Vue.use(Popconfirm);
Vue.use(Link);
Vue.use(Menu);
Vue.use(MenuItem);
Vue.use(Submenu);
Vue.use(Progress);
Vue.use(Loading.directive);

Vue.prototype.$notify = Notification;
Vue.prototype.$message = Message;

// configure language
locale.use(lang);

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
