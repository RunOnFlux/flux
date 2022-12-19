import Vue from 'vue';
import * as VueRouter from 'vue-router';
import store from '@/store';
import { createPinia, defineStore } from 'vuex'

import IDService from '@/services/IDService';

import dashboard from './routes/dashboard';
import daemon from './routes/daemon/daemon';
import benchmark from './routes/benchmark/benchmark';
import flux from './routes/flux/flux';
import apps from './routes/apps/apps';
import fluxadmin from './routes/fluxadmin/fluxadmin';
import xdao from './routes/xdao/xdao';

import qs from 'qs';

const router = VueRouter.createRouter({
  history: VueRouter.createWebHashHistory(),
  base: import.meta.env.BASE_URL,
  scrollBehavior() {
    return { x: 0, y: 0 };
  },
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/Home.vue'),
      meta: {
        pageTitle: 'Home',
        breadcrumb: [
          {
            text: 'Home',
            active: true,
          },
        ],
      },
    },
    {
      path: '/explorer',
      name: 'explorer',
      component: () => import('@/views/explorer/Explorer.vue'),
      meta: {
        pageTitle: 'Explorer',
        breadcrumb: [
          {
            text: 'Explorer',
            active: true,
          },
        ],
      },
    },
    ...dashboard,
    ...daemon,
    ...benchmark,
    ...flux,
    ...apps,
    ...fluxadmin,
    ...xdao,
    {
      path: '/error-404',
      name: 'error-404',
      component: () => import('@/views/error/Error404.vue'),
      meta: {
        layout: 'full',
      },
    },
    {
      path: '/',
      redirect: 'error-404',
    },
  ],
});

router.beforeEach(async (to, from, next) => {
  const zelidauth = localStorage.getItem('zelidauth');
  const auth = qs.parse(zelidauth);
  store.commit('flux/setPrivilege', 'none');
  if (auth && auth.zelid && auth.signature && auth.loginPhrase) {
    try {
      const response = await IDService.checkUserLogged(auth.zelid, auth.signature, auth.loginPhrase);
      const privilege = response.data.data.message;
      store.commit('flux/setPrivilege', privilege);
      if (privilege === 'none') {
        localStorage.removeItem('zelidauth');
      }
    } catch (error) {
      console.log(error);
    }
  }

  if (to.meta && to.meta.privilege) {
    if (to.meta.privilege.some((value) => value === store.state.flux.privilege)) {
      next();
    } else {
      next('/');
    }
  } else {
    next();
  }
});

// ? For splash screen
// Remove afterEach hook if you are not using splash screen
router.afterEach(() => {
  // Remove initial loading
  const appLoading = document.getElementById('loading-bg');
  if (appLoading) {
    appLoading.style.display = 'none';
  }
});

const app = Vue.createApp({})
app.use(router)
app.mount('#app')

export default router;
