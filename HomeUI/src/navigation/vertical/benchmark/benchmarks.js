export default [
  {
    title: 'Benchmarks',
    icon: 'microchip',
    children: [
      {
        title: 'Get Status',
        icon: 'tachometer-alt',
        route: 'benchmark-benchmarks-getstatus',
      },
      {
        title: 'Restart Benchmarks',
        icon: 'redo',
        route: 'benchmark-benchmarks-restartbenchmarks',
        privilege: ['admin', 'fluxteam'],
      },
      {
        title: 'Sign Transaction',
        icon: 'bolt',
        route: 'benchmark-benchmarks-signtransaction',
        privilege: ['admin'],
      },
    ],
  },
];
