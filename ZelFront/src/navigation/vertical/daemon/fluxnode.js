export default [
  {
    title: 'FluxNode',
    icon: 'dice-d20',
    children: [
      {
        title: 'Get FluxNode Status',
        icon: 'info',
        route: 'daemon-fluxnode-getstatus',
      },
      {
        title: 'List FluxNodes',
        icon: 'list-ul',
        route: 'daemon-fluxnode-listfluxnodes',
      },
      {
        title: 'View FluxNode List',
        icon: 'regular/list-alt',
        route: 'daemon-fluxnode-viewfluxnodelist',
      },
      {
        title: 'Get FluxNode Count',
        icon: 'layer-group',
        route: 'daemon-fluxnode-getfluxnodecount',
      },
      {
        title: 'Get Start List',
        icon: 'play',
        route: 'daemon-fluxnode-getstartlist',
      },
      {
        title: 'Get DOS List',
        icon: 'hammer',
        route: 'daemon-fluxnode-getdoslist',
      },
      {
        title: 'Current Winner',
        icon: 'trophy',
        route: 'daemon-fluxnode-currentwinner',
      },
    ],
  },
]
