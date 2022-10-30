export default [
  {
    title: 'Dashboard',
    icon: 'desktop',
    spacing: true,
    children: [
      {
        title: 'Overview',
        icon: 'chart-pie',
        route: 'dashboard-overview',
      },
      {
        title: 'Resources',
        icon: 'server',
        route: 'dashboard-resources',
      },
      {
        title: 'Map',
        icon: 'map-marker-alt',
        route: 'dashboard-map',
      },
      {
        title: 'Rewards',
        icon: 'coins',
        route: 'dashboard-rewards',
      },
      {
        title: 'List',
        icon: 'list-ul',
        route: 'dashboard-list',
      },
    ],
  },
];
