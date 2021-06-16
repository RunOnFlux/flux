import dashboard from './dashboard'
import daemon from './daemon'
import benchmark from './benchmark'
import flux from './flux'
import apps from './apps'
import fluxadmin from './fluxadmin'

export default [
  {
    title: 'Home',
    route: 'home',
    icon: 'home',
  },
  ...dashboard,
  ...daemon,
  ...benchmark,
  ...flux,
  ...apps,
  ...fluxadmin,
]
