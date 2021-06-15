import control from './control'
import fluxnode from './fluxnode'
import benchmarks from './benchmarks'

export default [
  ...control,
  ...fluxnode,
  ...benchmarks,
  {
    path: '/benchmark/debug',
    name: 'benchmark-debug',
    component: () => import('@/views/daemon/control/GetInfo.vue'),
    meta: {
      pageTitle: 'Debug',
      breadcrumb: [
        {
          text: 'Benchmark',
        },
        {
          text: 'Debug',
          active: true,
        },
      ],
    },
  },
]
