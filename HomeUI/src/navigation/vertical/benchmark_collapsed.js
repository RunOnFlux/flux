import control from './benchmark/control';
import fluxnode from './benchmark/fluxnode';
import benchmarks from './benchmark/benchmarks';

export default [
  {
    title: 'Benchmark',
    icon: 'wrench',
    spacing: true,
    children: [
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
    ],
  },
];
