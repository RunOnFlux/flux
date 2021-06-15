export default [
  {
    title: 'Benchmarks',
    icon: 'GridIcon',
    id: 'daemon-benchmarks',
    children: [
      {
        title: 'Get Benchmarks',
        route: 'daemon-benchmarks-getbenchmarks',
      },
      {
        title: 'Get Bench Status',
        route: 'daemon-benchmarks-getstatus',
      },
      {
        title: 'Start Benchmark',
        route: 'daemon-benchmarks-startbenchmark',
        privilege: ['admin', 'fluxteam'],
      },
      {
        title: 'Stop Benchmark',
        route: 'daemon-benchmarks-stopbenchmark',
        privilege: ['admin', 'fluxteam'],
      },
    ],
  },
]
