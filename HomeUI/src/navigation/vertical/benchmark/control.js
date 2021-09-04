export default [
  {
    title: 'Control',
    icon: 'tools',
    id: 'benchmark-control',
    children: [
      {
        title: 'Help',
        icon: 'question',
        route: 'benchmark-control-help',
      },
      {
        title: 'Start',
        icon: 'play',
        route: 'benchmark-control-start',
        privilege: ['admin', 'fluxteam'],
      },
      {
        title: 'Stop',
        icon: 'power-off',
        route: 'benchmark-control-stop',
        privilege: ['admin'],
      },
      {
        title: 'Restart',
        icon: 'redo',
        route: 'benchmark-control-restart',
        privilege: ['admin', 'fluxteam'],
      },
    ],
  },
];
