export default [
  {
    header: 'Flux Admin',
    privilege: ['user', 'admin', 'fluxteam'],
  },
  {
    title: 'Logged Sessions',
    route: 'fluxadmin-loggedsessions',
    privilege: ['admin', 'fluxteam'],
  },
  {
    title: 'Manage Flux',
    route: 'fluxadmin-manageflux',
    privilege: ['admin', 'fluxteam'],
  },
  {
    title: 'Manage Daemon',
    route: 'fluxadmin-managedaemon',
    privilege: ['admin', 'fluxteam'],
  },
  {
    title: 'Manage Benchmark',
    route: 'fluxadmin-managebenchmark',
    privilege: ['admin', 'fluxteam'],
  },
  {
    title: 'Manage Users',
    route: 'fluxadmin-manageusers',
    privilege: ['admin', 'fluxteam'],
  },
]
