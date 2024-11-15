export default [
  {
    path: '/daemon/getwalletinfo',
    name: 'daemon-wallet-getwalletinfo',
    component: () => import('@/views/daemon/GetWalletInfo.vue'),
    meta: {
      pageTitle: 'Get Wallet Info',
      breadcrumb: [
        {
          text: 'Administration',
        },
        {
          text: 'Daemon',
        },
        {
          text: 'Get Wallet Info',
          active: true,
        },
      ],
      privilege: ['user', 'admin', 'fluxteam'],
    },
  },
];
