import control from './benchmark/control';
import fluxnode from './benchmark/fluxnode';
import benchmarks from './benchmark/benchmarks';

export default [
  {
    header: 'Benchmark',
  },
  ...control,
  ...fluxnode,
  ...benchmarks,
  {
    title: 'Debug',
    icon: 'bug',
    route: 'benchmark-debug',
    id: 'benchmark-debug',
    privilege: ['admin', 'fluxteam'],
  },
];
