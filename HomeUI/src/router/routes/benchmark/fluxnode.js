export default [
  {
    path: '/benchmark/fluxnode/getbenchmarks',
    name: 'benchmark-fluxnode-getbenchmarks',
    component: () => import('@/views/benchmark/fluxnode/GetBenchmarks.vue'),
    meta: {
      pageTitle: 'Get Benchmarks',
      breadcrumb: [
        {
          text: 'Administration',
        },
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
    component: () => import('@/views/benchmark/fluxnode/GetInfo.vue'),
    meta: {
      pageTitle: 'Get Info',
      breadcrumb: [
        {
          text: 'Administration',
        },
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
];
