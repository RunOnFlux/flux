export default [
  {
    path: '/flux/nodestatus',
    name: 'flux-nodestatus',
    component: () => import('@/views/flux/NodeStatus.vue'),
    meta: {
      pageTitle: 'Node Status',
      breadcrumb: [
        {
          text: 'Flux',
        },
        {
          text: 'Node Status',
          active: true,
        },
      ],
    },
  },
  {
    path: '/flux/fluxnetwork',
    name: 'flux-fluxnetwork',
    component: () => import('@/views/flux/FluxNetwork.vue'),
    meta: {
      pageTitle: 'Flux Network',
      breadcrumb: [
        {
          text: 'Flux',
        },
        {
          text: 'Flux Network',
          active: true,
        },
      ],
    },
  },
  {
    path: '/flux/debug',
    name: 'flux-debug',
    component: () => import('@/views/flux/Debug.vue'),
    meta: {
      pageTitle: 'Debug',
      breadcrumb: [
        {
          text: 'Flux',
        },
        {
          text: 'Debug',
          active: true,
        },
      ],
    },
  },
]
