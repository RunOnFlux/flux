export default [
  {
    path: '/apps/localapps',
    name: 'apps-localapps',
    component: () => import('@/views/apps/LocalApps.vue'),
    meta: {
      pageTitle: 'Local Apps',
      breadcrumb: [
        {
          text: 'Apps',
        },
        {
          text: 'Local Apps',
          active: true,
        },
      ],
    },
  },
  {
    path: '/apps/globalapps',
    name: 'apps-globalapps',
    component: () => import('@/views/apps/GlobalApps.vue'),
    meta: {
      pageTitle: 'Global Apps',
      breadcrumb: [
        {
          text: 'Apps',
        },
        {
          text: 'Global Apps',
          active: true,
        },
      ],
    },
  },
  {
    path: '/apps/registerapp',
    name: 'apps-registerapp',
    component: () => import('@/views/apps/RegisterFluxApp.vue'),
    meta: {
      pageTitle: 'Register Flux App',
      breadcrumb: [
        {
          text: 'Apps',
        },
        {
          text: 'Register Flux App',
          active: true,
        },
      ],
    },
  },
  {
    path: '/apps/marketplace',
    name: 'apps-marketplace',
    component: () => import('@/views/apps/marketplace/Marketplace.vue'),
    meta: {
      contentRenderer: 'sidebar-left',
      contentClass: 'marketplace-application',
      privilege: ['admin'],
    },
  },
  {
    path: '/apps/marketplace/:filter',
    name: 'apps-marketplace-filter',
    component: () => import('@/views/apps/marketplace/Marketplace.vue'),
    meta: {
      contentRenderer: 'sidebar-left',
      contentClass: 'marketplace-application',
      navActiveLink: 'apps-marketplace',
      privilege: ['admin'],
    },
    beforeEnter(to, _, next) {
      if (['games', 'productivity'].includes(to.params.filter)) next();
      else next({ name: 'error-404' });
    },
  },
  {
    path: '/apps/marketplace/:tag',
    name: 'apps-marketplace-tag',
    component: () => import('@/views/apps/marketplace/Marketplace.vue'),
    meta: {
      contentRenderer: 'sidebar-left',
      contentClass: 'marketplace-application',
      navActiveLink: 'apps-marketplace',
      privilege: ['admin'],
    },
    beforeEnter(to, _, next) {
      if (['games', 'productivity'].includes(to.params.tag)) next();
      else next({ name: 'error-404' });
    },
  },
  {
    path: '/apps/fluxsharestorage',
    name: 'apps-fluxsharestorage',
    component: () => import('@/views/apps/MyFluxShare.vue'),
    meta: {
      pageTitle: 'My FluxShare Storage',
      breadcrumb: [
        {
          text: 'Apps',
        },
        {
          text: 'My FluxShare Storage',
          active: true,
        },
      ],
      privilege: ['admin'],
    },
  },
];
