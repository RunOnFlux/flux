import dashboard from './dashboard';
import apps from './apps';
import fluxadmin from './fluxadmin';
import xdao from './xdao';

export default [
  {
    title: 'Home',
    route: 'home',
    icon: 'home',
  },
  ...dashboard,
  ...apps,
  ...xdao,
  ...fluxadmin,
];
