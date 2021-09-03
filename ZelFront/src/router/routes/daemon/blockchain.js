export default [
  {
    path: '/daemon/blockchain/getblockchaininfo',
    name: 'daemon-blockchain-getchaininfo',
    component: () => import('@/views/daemon/GetBlockchainInfo.vue'),
    meta: {
      pageTitle: 'Get Blockchain Info',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'Get Blockchain Info',
          active: true,
        },
      ],
    },
  },
]
