export default [
  {
    path: '/daemon/benchmarks/getbenchmarks',
    name: 'daemon-benchmarks-getbenchmarks',
    component: () => import('@/views/daemon/control/GetInfo.vue'),
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
    component: () => import('@/views/daemon/control/Help.vue'),
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
    name: 'daemon-benchmarks-startbenchmark',
    component: () => import('@/views/daemon/control/RescanBlockchain.vue'),
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
    },
  },
  {
    path: '/daemon/benchmarks/stopbenchmark',
    name: 'daemon-benchmarks-stopbenchmark',
    component: () => import('@/views/daemon/control/ReindexBlockchain.vue'),
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
    },
  },
]
