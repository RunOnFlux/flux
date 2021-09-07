export default [
  {
    path: '/daemon/benchmarks/getbenchmarks',
    name: 'daemon-benchmarks-getbenchmarks',
    component: () => import('@/views/daemon/benchmarks/GetBenchmarks.vue'),
    meta: {
      pageTitle: 'Get Benchmarks',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'Benchmarks',
        },
        {
          text: 'Get Benchmarks',
          active: true,
        },
      ],
    },
  },
  {
    path: '/daemon/benchmarks/getstatus',
    name: 'daemon-benchmarks-getstatus',
    component: () => import('@/views/daemon/benchmarks/GetBenchStatus.vue'),
    meta: {
      pageTitle: 'Get Bench Status',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'Benchmarks',
        },
        {
          text: 'Get Status',
          active: true,
        },
      ],
    },
  },
  {
    path: '/daemon/benchmarks/startbenchmark',
    name: 'daemon-benchmarks-start',
    component: () => import('@/views/daemon/benchmarks/StartBenchmark.vue'),
    meta: {
      pageTitle: 'Start Benchmark',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'Benchmarks',
        },
        {
          text: 'Start Benchmark',
          active: true,
        },
      ],
      privilege: ['admin', 'fluxteam'],
    },
  },
  {
    path: '/daemon/benchmarks/stopbenchmark',
    name: 'daemon-benchmarks-stop',
    component: () => import('@/views/daemon/benchmarks/StopBenchmark.vue'),
    meta: {
      pageTitle: 'Stop Benchmark',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'Benchmarks',
        },
        {
          text: 'Stop Benchmark',
          active: true,
        },
      ],
      privilege: ['admin', 'fluxteam'],
    },
  },
];
