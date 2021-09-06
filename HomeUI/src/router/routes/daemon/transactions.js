export default [
  {
    path: '/daemon/transaction/getrawtransaction',
    name: 'daemon-transaction-getrawtransaction',
    component: () => import('@/views/daemon/GetRawTransaction.vue'),
    meta: {
      pageTitle: 'Get Raw Transaction',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'Get Raw Transaction',
          active: true,
        },
      ],
    },
  },
];
