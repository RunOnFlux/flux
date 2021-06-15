export default [
  {
    title: 'Benchmarks',
    icon: 'GridIcon',
    children: [
      {
        title: 'Get Status',
        route: 'benchmark-benchmarks-getstatus',
      },
      {
        title: 'Restart Benchmarks',
        route: 'benchmark-benchmarks-restartbenchmarks',
        privilege: ['admin', 'fluxteam'],
      },
      {
        title: 'Sign Transaction',
        route: 'benchmark-benchmarks-signtransaction',
        privilege: ['admin'],
      },
    ],
  },
]
