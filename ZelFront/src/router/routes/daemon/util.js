export default [
  {
    path: '/daemon/validateaddress',
    name: 'daemon-util-validateaddress',
    component: () => import('@/views/daemon/ValidateAddress.vue'),
    meta: {
      pageTitle: 'Validate Address',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'Validate Address',
          active: true,
        },
      ],
    },
  },
]
