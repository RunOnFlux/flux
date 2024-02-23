import collapsedDashboard from './dashboard_collapsed';
import collapsedApps from './apps_collapsed';
import collapsedMarketplace from './marketplace_collapsed';
import collapsedFluxadmin from './fluxadmin_collapsed';
import collapsedXdao from './xdao_collapsed';

export default [
  {
    title: 'Home',
    route: 'home',
    icon: 'home',
  },
  ...collapsedDashboard,
  ...collapsedApps,
  ...collapsedMarketplace,
  ...collapsedFluxadmin,
  ...collapsedXdao,
];
