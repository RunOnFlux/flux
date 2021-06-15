export default [
  {
    path: '/benchmark/fluxnode/getbenchmarks',
    name: 'benchmark-fluxnode-getbenchmarks',
    component: () => import('@/views/daemon/control/GetInfo.vue'),
    meta: {
      pageTitle: 'Get Benchmarks',
      breadcrumb: [
        {
          text: 'Benchmark',
        },
        {
          text: 'FluxNode',
        },
        {
          text: 'Get Benchmarks',
          active: true,
        },
      ],
    },
  },
  {
    path: '/benchmark/fluxnode/getinfo',
    name: 'benchmark-fluxnode-getinfo',
    component: () => import('@/views/daemon/control/GetInfo.vue'),
    meta: {
      pageTitle: 'Get Info',
      breadcrumb: [
        {
          text: 'Benchmark',
        },
        {
          text: 'FluxNode',
        },
        {
          text: 'Get Info',
          active: true,
        },
      ],
    },
  },
]
