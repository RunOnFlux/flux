import daemonControl from './control';
import daemonFluxNode from './fluxnode';
import daemonBenchmarks from './benchmarks';
import daemonBlockchain from './blockchain';
import daemonMining from './mining';
import daemonNetwork from './network';
import daemonTransactions from './transactions';
import daemonUtil from './util';
import daemonWallet from './wallet';

export default [
  ...daemonControl,
  ...daemonFluxNode,
  ...daemonBenchmarks,
  ...daemonBlockchain,
  ...daemonMining,
  ...daemonNetwork,
  ...daemonTransactions,
  ...daemonUtil,
  ...daemonWallet,
  {
    path: '/daemon/debug',
    name: 'daemon-debug',
    component: () => import('@/views/daemon/Debug.vue'),
    meta: {
      pageTitle: 'Debug',
      breadcrumb: [
        {
          text: 'Daemon',
        },
        {
          text: 'Debug',
          active: true,
        },
      ],
      privilege: ['admin', 'fluxteam'],
    },
  },
];
