export default [
  {
    title: 'Control',
    icon: 'tools',
    children: [
      {
        title: 'Get Info',
        icon: 'info',
        route: 'daemon-control-getinfo',
      },
      {
        title: 'Help',
        icon: 'question',
        route: 'daemon-control-help',
      },
      {
        title: 'Rescan Blockchain',
        icon: 'search-plus',
        route: 'daemon-control-rescanblockchain',
        privilege: ['admin'],
      },
      {
        title: 'Reindex Blockchain',
        icon: 'address-book',
        route: 'daemon-control-reindexblockchain',
        privilege: ['admin'],
      },
      {
        title: 'Start',
        icon: 'play',
        route: 'daemon-control-start',
        privilege: ['admin', 'fluxteam'],
      },
      {
        title: 'Stop',
        icon: 'power-off',
        route: 'daemon-control-stop',
        privilege: ['admin'],
      },
      {
        title: 'Restart',
        icon: 'redo',
        route: 'daemon-control-restart',
        privilege: ['admin', 'fluxteam'],
      },
    ],
  },
];
