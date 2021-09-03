export default [
  {
    path: '/daemon/control/getinfo',
    name: 'daemon-control-getinfo',
    component: () => import('@/views/daemon/control/GetInfo.vue'),
    meta: {
      pageTitle: 'Get Info',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'Control',
        },
        {
          text: 'Get Info',
          active: true,
        },
      ],
    },
  },
  {
    path: '/daemon/control/help',
    name: 'daemon-control-help',
    component: () => import('@/views/daemon/control/Help.vue'),
    meta: {
      pageTitle: 'Help',
      breadcrumb: [
        {
          text: 'Daemon',
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
    path: '/daemon/control/rescanblockchain',
    name: 'daemon-control-rescanblockchain',
    component: () => import('@/views/daemon/control/RescanBlockchain.vue'),
    meta: {
      pageTitle: 'Rescan Blockchain',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'Control',
        },
        {
          text: 'Rescan Blockchain',
          active: true,
        },
      ],
      privilege: ['admin'],
    },
  },
  {
    path: '/daemon/control/reindexblockchain',
    name: 'daemon-control-reindexblockchain',
    component: () => import('@/views/daemon/control/ReindexBlockchain.vue'),
    meta: {
      pageTitle: 'Reindex Blockchain',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'Control',
        },
        {
          text: 'Reindex Blockchain',
          active: true,
        },
      ],
      privilege: ['admin'],
    },
  },
  {
    path: '/daemon/control/start',
    name: 'daemon-control-start',
    component: () => import('@/views/daemon/control/Start.vue'),
    meta: {
      pageTitle: 'Start',
      breadcrumb: [
        {
          text: 'Daemon',
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
    path: '/daemon/control/stop',
    name: 'daemon-control-stop',
    component: () => import('@/views/daemon/control/Stop.vue'),
    meta: {
      pageTitle: 'Stop',
      breadcrumb: [
        {
          text: 'Daemon',
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
    path: '/daemon/control/restart',
    name: 'daemon-control-restart',
    component: () => import('@/views/daemon/control/Restart.vue'),
    meta: {
      pageTitle: 'Restart',
      breadcrumb: [
        {
          text: 'Daemon',
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
]
