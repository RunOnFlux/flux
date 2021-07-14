import Vue from 'vue'
import VueRouter from 'vue-router'
import dashboard from './routes/dashboard'
import daemon from './routes/daemon/daemon'
import benchmark from './routes/benchmark/benchmark'
import flux from './routes/flux/flux'
import apps from './routes/apps/apps'
import fluxadmin from './routes/fluxadmin/fluxadmin'
import xdao from './routes/xdao/xdao'

Vue.use(VueRouter)

const router = new VueRouter({
  mode: 'history',
  base: process.env.BASE_URL,
  scrollBehavior() {
    return { x: 0, y: 0 }
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
      path: '*',
      redirect: 'error-404',
    },
  ],
})

// ? For splash screen
// Remove afterEach hook if you are not using splash screen
router.afterEach(() => {
  // Remove initial loading
  const appLoading = document.getElementById('loading-bg')
  if (appLoading) {
    appLoading.style.display = 'none'
  }
})

export default router
