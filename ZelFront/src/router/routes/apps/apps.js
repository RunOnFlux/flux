export default [
  {
    path: '/apps/localapps',
    name: 'apps-localapps',
    component: () => import('@/views/daemon/control/GetInfo.vue'),
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
    component: () => import('@/views/daemon/control/GetInfo.vue'),
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
    component: () => import('@/views/daemon/control/GetInfo.vue'),
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
    path: '/apps/fluxsharestorage',
    name: 'apps-fluxsharestorage',
    component: () => import('@/views/daemon/control/GetInfo.vue'),
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
    },
  },
]
