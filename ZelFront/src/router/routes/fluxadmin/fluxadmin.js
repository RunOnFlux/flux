export default [
  {
    path: '/fluxadmin/loggedsessions',
    name: 'fluxadmin-loggedsessions',
    component: () => import('@/views/fluxadmin/LoggedSessions.vue'),
    meta: {
      pageTitle: 'Logged Sessions',
      breadcrumb: [
        {
          text: 'Flux Admin',
        },
        {
          text: 'Logged Sessions',
          active: true,
        },
      ],
    },
  },
  {
    path: '/fluxadmin/manageflux',
    name: 'fluxadmin-manageflux',
    component: () => import('@/views/fluxadmin/ManageFlux.vue'),
    meta: {
      pageTitle: 'Manage Flux',
      breadcrumb: [
        {
          text: 'Flux Admin',
        },
        {
          text: 'Manage Flux',
          active: true,
        },
      ],
    },
  },
  {
    path: '/fluxadmin/managedaemon',
    name: 'fluxadmin-managedaemon',
    component: () => import('@/views/fluxadmin/ManageDaemon.vue'),
    meta: {
      pageTitle: 'Manage Daemon',
      breadcrumb: [
        {
          text: 'Flux Admin',
        },
        {
          text: 'Manage Daemon',
          active: true,
        },
      ],
    },
  },
  {
    path: '/fluxadmin/managebenchmark',
    name: 'fluxadmin-managebenchmark',
    component: () => import('@/views/fluxadmin/ManageBenchmark.vue'),
    meta: {
      pageTitle: 'Manage Benchmark',
      breadcrumb: [
        {
          text: 'Flux Admin',
        },
        {
          text: 'Manage Benchmark',
          active: true,
        },
      ],
    },
  },
  {
    path: '/fluxadmin/manageusers',
    name: 'fluxadmin-manageusers',
    component: () => import('@/views/fluxadmin/ManageUsers.vue'),
    meta: {
      pageTitle: 'Manage Users',
      breadcrumb: [
        {
          text: 'Flux Admin',
        },
        {
          text: 'Manage Users',
          active: true,
        },
      ],
    },
  },
]
