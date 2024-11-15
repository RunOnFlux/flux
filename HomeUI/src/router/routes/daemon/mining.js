export default [
  {
    path: '/daemon/mining/getmininginfo',
    name: 'daemon-mining-getmininginfo',
    component: () => import('@/views/daemon/GetMiningInfo.vue'),
    meta: {
      pageTitle: 'Get Mining Info',
      breadcrumb: [
        {
          text: 'Administration',
        },
        {
          text: 'Daemon',
        },
        {
          text: 'Get Mining Info',
          active: true,
        },
      ],
    },
  },
];
