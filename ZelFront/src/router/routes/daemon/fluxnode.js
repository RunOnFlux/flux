export default [
  {
    path: '/daemon/fluxnode/getnodestatus',
    name: 'daemon-fluxnode-getstatus',
    component: () => import('@/views/daemon/fluxnode/GetNodeStatus.vue'),
    meta: {
      pageTitle: 'Node Status',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'FluxNode',
        },
        {
          text: 'Get Node Status',
          active: true,
        },
      ],
    },
  },
  {
    path: '/daemon/fluxnode/listfluxnodes',
    name: 'daemon-fluxnode-listfluxnodes',
    component: () => import('@/views/daemon/fluxnode/ListFluxNodes.vue'),
    meta: {
      pageTitle: 'List FluxNodes',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'FluxNode',
        },
        {
          text: 'List FluxNodes',
          active: true,
        },
      ],
    },
  },
  {
    path: '/daemon/fluxnode/viewfluxnodelist',
    name: 'daemon-fluxnode-viewfluxnodelist',
    component: () => import('@/views/daemon/fluxnode/ViewFluxNodeList.vue'),
    meta: {
      pageTitle: 'View Deterministic FluxNodes',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'FluxNode',
        },
        {
          text: 'View FluxNode List',
          active: true,
        },
      ],
    },
  },
  {
    path: '/daemon/fluxnode/getfluxnodecount',
    name: 'daemon-fluxnode-getfluxnodecount',
    component: () => import('@/views/daemon/fluxnode/GetFluxNodeCount.vue'),
    meta: {
      pageTitle: 'Get FluxNode Count',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'FluxNode',
        },
        {
          text: 'Get FluxNode Count',
          active: true,
        },
      ],
    },
  },
  {
    path: '/daemon/fluxnode/getstartlist',
    name: 'daemon-fluxnode-getstartlist',
    component: () => import('@/views/daemon/fluxnode/GetStartList.vue'),
    meta: {
      pageTitle: 'Get Start List',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'FluxNode',
        },
        {
          text: 'Get Start List',
          active: true,
        },
      ],
    },
  },
  {
    path: '/daemon/fluxnode/getdoslist',
    name: 'daemon-fluxnode-getdoslist',
    component: () => import('@/views/daemon/fluxnode/GetDOSList.vue'),
    meta: {
      pageTitle: 'Get DOS List',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'FluxNode',
        },
        {
          text: 'Get DOS List',
          active: true,
        },
      ],
    },
  },
  {
    path: '/daemon/fluxnode/currentwinner',
    name: 'daemon-fluxnode-currentwinner',
    component: () => import('@/views/daemon/fluxnode/CurrentWinner.vue'),
    meta: {
      pageTitle: 'Current Winner',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'FluxNode',
        },
        {
          text: 'Current Winner',
          active: true,
        },
      ],
    },
  },
]
