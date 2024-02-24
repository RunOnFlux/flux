export default [
  {
    path: '/fluxadmin/loggedsessions',
    name: 'fluxadmin-loggedsessions',
    component: () => import('@/views/fluxadmin/LoggedSessions.vue'),
    meta: {
      pageTitle: 'Logged Sessions',
      breadcrumb: [
        {
          text: 'Administration',
        },
        {
          text: 'Logged Sessions',
          active: true,
        },
      ],
      privilege: ['admin', 'fluxteam'],
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
          text: 'Administration',
        },
        {
          text: 'Manage Flux',
          active: true,
        },
      ],
      privilege: ['admin', 'fluxteam'],
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
          text: 'Administration',
        },
        {
          text: 'Manage Daemon',
          active: true,
        },
      ],
      privilege: ['admin', 'fluxteam'],
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
          text: 'Administration',
        },
        {
          text: 'Manage Benchmark',
          active: true,
        },
      ],
      privilege: ['admin', 'fluxteam'],
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
          text: 'Administration',
        },
        {
          text: 'Manage Users',
          active: true,
        },
      ],
      privilege: ['admin', 'fluxteam'],
    },
  },
];
