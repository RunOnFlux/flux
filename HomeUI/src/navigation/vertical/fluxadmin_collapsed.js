import benchmarks from './benchmark_collapsed';
import daemon from './daemon_collapsed';
import flux from './flux_collapsed';

export default [
  {
    title: 'Administration',
    icon: 'clipboard-list',
    spacing: true,
    children: [
      {
        title: 'Explorer',
        route: 'explorer',
        icon: 'search',
      },
      ...daemon,
      ...benchmarks,
      ...flux,
      {
        title: 'Local Apps',
        icon: 'upload',
        route: 'apps-localapps',
      },
      {
        title: 'Logged Sessions',
        icon: 'regular/id-badge',
        route: 'fluxadmin-loggedsessions',
        privilege: ['admin', 'fluxteam'],
      },
      {
        title: 'Manage Flux',
        icon: 'dice-d20',
        route: 'fluxadmin-manageflux',
        privilege: ['admin', 'fluxteam'],
      },
      {
        title: 'Manage Daemon',
        icon: 'cog',
        route: 'fluxadmin-managedaemon',
        privilege: ['admin', 'fluxteam'],
      },
      {
        title: 'Manage Benchmark',
        icon: 'microchip',
        route: 'fluxadmin-managebenchmark',
        privilege: ['admin', 'fluxteam'],
      },
      {
        title: 'Manage Users',
        icon: 'fingerprint',
        route: 'fluxadmin-manageusers',
        privilege: ['admin', 'fluxteam'],
      },
      {
        title: 'My FluxShare',
        icon: 'regular/hdd',
        route: 'apps-fluxsharestorage',
        privilege: ['admin'],
      },
    ],
  },
];
