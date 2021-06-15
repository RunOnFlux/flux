export default [
  {
    path: '/daemon/blockchain/getblockchaininfo',
    name: 'daemon-blockchain-getblockchaininfo',
    component: () => import('@/views/daemon/control/GetInfo.vue'),
    meta: {
      pageTitle: 'Get Blockchain Info',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'Blockchain',
        },
        {
          text: 'Get Blockchain Info',
          active: true,
        },
      ],
    },
  },
]
