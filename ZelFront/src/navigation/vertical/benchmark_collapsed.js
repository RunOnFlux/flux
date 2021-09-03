import control from './benchmark/control'
import zelnode from './benchmark/fluxnode'
import benchmarks from './benchmark/benchmarks'

export default [
  {
    title: 'Benchmark',
    icon: 'wrench',
    spacing: true,
    children: [
      ...control,
      ...zelnode,
      ...benchmarks,
      {
        title: 'Debug',
        icon: 'bug',
        route: 'benchmark-debug',
        id: 'benchmark-debug',
        privilege: ['admin', 'fluxteam'],
      },
    ],
  },
]
