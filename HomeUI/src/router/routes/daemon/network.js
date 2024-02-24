export default [
  {
    path: '/daemon/network/getnetworkinfo',
    name: 'daemon-network-getnetworkinfo',
    component: () => import('@/views/daemon/GetNetworkInfo.vue'),
    meta: {
      pageTitle: 'Get Network Info',
      breadcrumb: [
        {
          text: 'Administration',
        },
        {
          text: 'Daemon',
        },
        {
          text: 'Get Network Info',
          active: true,
        },
      ],
    },
  },
];
