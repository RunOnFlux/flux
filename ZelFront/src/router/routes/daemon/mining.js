export default [
  {
    path: '/daemon/mining/getmininginfo',
    name: 'daemon-mining-getmininginfo',
    component: () => import('@/views/daemon/control/GetInfo.vue'),
    meta: {
      pageTitle: 'Get Mining Info',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'Benchmarks',
        },
        {
          text: 'Get Mining Info',
          active: true,
        },
      ],
    },
  },
]
