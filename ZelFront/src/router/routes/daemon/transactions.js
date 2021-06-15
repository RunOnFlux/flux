export default [
  {
    path: '/daemon/transaction/getrawtransaction',
    name: 'daemon-transaction-getrawtransaction',
    component: () => import('@/views/daemon/control/GetInfo.vue'),
    meta: {
      pageTitle: 'Get Raw Transaction',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'Transaction',
        },
        {
          text: 'Get Raw Transaction',
          active: true,
        },
      ],
    },
  },
]
