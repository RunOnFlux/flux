export default [
  {
    path: '/dashboard/overview',
    name: 'dashboard-overview',
    component: () => import('@/views/dashboard/Overview.vue'),
    meta: {
      pageTitle: 'Overview',
      breadcrumb: [
        {
          text: 'Dashboard',
        },
        {
          text: 'Overview',
          active: true,
        },
      ],
    },
  },
  {
    path: '/dashboard/resources',
    name: 'dashboard-resources',
    component: () => import('@/views/dashboard/Resources.vue'),
    meta: {
      pageTitle: 'Resources',
      breadcrumb: [
        {
          text: 'Dashboard',
        },
        {
          text: 'Resources',
          active: true,
        },
      ],
    },
  },
  {
    path: '/dashboard/map',
    name: 'dashboard-map',
    component: () => import('@/views/dashboard/Map.vue'),
    meta: {
      pageTitle: 'Map',
      breadcrumb: [
        {
          text: 'Dashboard',
        },
        {
          text: 'Map',
          active: true,
        },
      ],
    },
  },
  {
    path: '/dashboard/economics',
    name: 'dashboard-economics',
    component: () => import('@/views/dashboard/Economics.vue'),
    meta: {
      pageTitle: 'Economics',
      breadcrumb: [
        {
          text: 'Dashboard',
        },
        {
          text: 'Economics',
          active: true,
        },
      ],
    },
  },
  {
    path: '/dashboard/list',
    name: 'dashboard-list',
    component: () => import('@/views/dashboard/List.vue'),
    meta: {
      pageTitle: 'List',
      breadcrumb: [
        {
          text: 'Dashboard',
        },
        {
          text: 'List',
          active: true,
        },
      ],
    },
  },
];
