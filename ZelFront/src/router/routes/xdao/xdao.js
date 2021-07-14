export default [
  {
    path: '/xdao/listproposals',
    name: 'xdao-listproposals',
    component: () => import('@/views/xdao/ListProposals.vue'),
    meta: {
      pageTitle: 'List Proposals',
      breadcrumb: [
        {
          text: 'XDAO',
        },
        {
          text: 'List Proposals',
          active: true,
        },
      ],
    },
  },
  {
    path: '/xdao/submitproposal',
    name: 'xdao-submitproposal',
    component: () => import('@/views/xdao/SubmitProposal.vue'),
    meta: {
      pageTitle: 'Submit Proposal',
      breadcrumb: [
        {
          text: 'XDAO',
        },
        {
          text: 'Submit Proposal',
          active: true,
        },
      ],
    },
  },
]
