import control from './benchmark/control'
import zelnode from './benchmark/fluxnode'
import benchmarks from './benchmark/benchmarks'

export default [
  {
    header: 'Benchmark',
  },
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
]
