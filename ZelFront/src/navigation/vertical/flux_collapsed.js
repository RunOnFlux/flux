const fluxLogo = require('@/assets/images/logo/logo.png')

export default [
  {
    title: 'Flux',
    image: fluxLogo,
    spacing: true,
    children: [
      {
        title: 'Node Status',
        icon: 'heartbeat',
        route: 'flux-nodestatus',
      },
      {
        title: 'Flux Network',
        icon: 'network-wired',
        route: 'flux-fluxnetwork',
      },
      {
        title: 'Debug',
        icon: 'bug',
        route: 'flux-debug',
        privilege: ['admin', 'fluxteam'],
      },
    ],
  },
]
