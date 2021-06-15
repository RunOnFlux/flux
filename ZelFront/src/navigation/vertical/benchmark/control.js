export default [
  {
    title: 'Control',
    icon: 'GridIcon',
    id: 'benchmark-control',
    children: [
      {
        title: 'Help',
        route: 'benchmark-control-help',
      },
      {
        title: 'Start',
        route: 'benchmark-control-start',
        privilege: ['admin', 'fluxteam'],
      },
      {
        title: 'Stop',
        route: 'benchmark-control-stop',
        privilege: ['admin'],
      },
      {
        title: 'Restart',
        route: 'benchmark-control-restart',
        privilege: ['admin', 'fluxteam'],
      },
    ],
  },
]
