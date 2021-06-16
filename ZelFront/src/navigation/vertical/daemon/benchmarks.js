export default [
  {
    title: 'Benchmarks',
    icon: 'microchip',
    id: 'daemon-benchmarks',
    children: [
      {
        title: 'Get Benchmarks',
        icon: 'calculator',
        route: 'daemon-benchmarks-getbenchmarks',
      },
      {
        title: 'Get Bench Status',
        icon: 'tachometer-alt',
        route: 'daemon-benchmarks-getstatus',
      },
      {
        title: 'Start Benchmark',
        icon: 'play',
        route: 'daemon-benchmarks-startbenchmark',
        privilege: ['admin', 'fluxteam'],
      },
      {
        title: 'Stop Benchmark',
        icon: 'power-off',
        route: 'daemon-benchmarks-stopbenchmark',
        privilege: ['admin', 'fluxteam'],
      },
    ],
  },
]
