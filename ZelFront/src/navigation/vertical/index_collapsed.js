import collapsedDashboard from './dashboard_collapsed'
import collapsedDaemon from './daemon_collapsed'
import collapsedBenchmark from './benchmark_collapsed'
import collapsedFlux from './flux_collapsed'
import collapsedApps from './apps_collapsed'
import collapsedFluxadmin from './fluxadmin_collapsed'
import collapsedXdao from './xdao_collapsed'

export default [
  {
    title: 'Home',
    route: 'home',
    icon: 'home',
  },
  {
    title: 'Explorer',
    route: 'explorer',
    icon: 'search',
  },
  ...collapsedDashboard,
  ...collapsedDaemon,
  ...collapsedBenchmark,
  ...collapsedFlux,
  ...collapsedApps,
  ...collapsedFluxadmin,
  ...collapsedXdao,
]
