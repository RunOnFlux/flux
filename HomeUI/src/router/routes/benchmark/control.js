export default [
  {
    path: '/benchmark/control/help',
    name: 'benchmark-control-help',
    component: () => import('@/views/benchmark/control/Help.vue'),
    meta: {
      pageTitle: 'Help',
      breadcrumb: [
        {
          text: 'Administration',
        },
        {
          text: 'Benchmark',
        },
        {
          text: 'Control',
        },
        {
          text: 'Help',
          active: true,
        },
      ],
    },
  },
  {
    path: '/benchmark/control/start',
    name: 'benchmark-control-start',
    component: () => import('@/views/benchmark/control/Start.vue'),
    meta: {
      pageTitle: 'Start',
      breadcrumb: [
        {
          text: 'Administration',
        },
        {
          text: 'Benchmark',
        },
        {
          text: 'Control',
        },
        {
          text: 'Start',
          active: true,
        },
      ],
      privilege: ['admin', 'fluxteam'],
    },
  },
  {
    path: '/benchmark/control/stop',
    name: 'benchmark-control-stop',
    component: () => import('@/views/benchmark/control/Stop.vue'),
    meta: {
      pageTitle: 'Stop',
      breadcrumb: [
        {
          text: 'Administration',
        },
        {
          text: 'Benchmark',
        },
        {
          text: 'Control',
        },
        {
          text: 'Stop',
          active: true,
        },
      ],
      privilege: ['admin'],
    },
  },
  {
    path: '/benchmark/control/restart',
    name: 'benchmark-control-restart',
    component: () => import('@/views/benchmark/control/Restart.vue'),
    meta: {
      pageTitle: 'Restart',
      breadcrumb: [
        {
          text: 'Administration',
        },
        {
          text: 'Benchmark',
        },
        {
          text: 'Control',
        },
        {
          text: 'Restart',
          active: true,
        },
      ],
      privilege: ['admin', 'fluxteam'],
    },
  },
];
