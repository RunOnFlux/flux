import dashboard from './dashboard';
import daemon from './daemon';
import benchmark from './benchmark';
import flux from './flux';
import apps from './apps';
import fluxadmin from './fluxadmin';
import xdao from './xdao';
import marketplace from './marketplace';

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
  ...dashboard,
  ...daemon,
  ...benchmark,
  ...flux,
  ...apps,
  ...marketplace,
  ...fluxadmin,
  ...xdao,
];
