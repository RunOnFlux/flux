export default [
  {
    title: 'Control',
    icon: 'GridIcon',
    children: [
      {
        title: 'Get Info',
        route: 'daemon-control-getinfo',
      },
      {
        title: 'Help',
        route: 'daemon-control-help',
      },
      {
        title: 'Rescan Blockchain',
        route: 'daemon-control-rescanblockchain',
        privilege: ['admin'],
      },
      {
        title: 'Reindex Blockchain',
        route: 'daemon-control-reindexblockchain',
        privilege: ['admin'],
      },
      {
        title: 'Start',
        route: 'daemon-control-start',
        privilege: ['admin', 'fluxteam'],
      },
      {
        title: 'Stop',
        route: 'daemon-control-stop',
        privilege: ['admin'],
      },
      {
        title: 'Restart',
        route: 'daemon-control-restart',
        privilege: ['admin', 'fluxteam'],
      },
    ],
  },
]
