export default [
  {
    path: '/xdao-app',
    name: 'xdao-app',
    component: () => import('@/views/xdao/XDAOApp.vue'),
    meta: {
      contentRenderer: 'sidebar-left',
      contentClass: 'xdao-application',
    },
  },
  {
    path: '/xdao-app/:filter',
    name: 'xdao-app-filter',
    component: () => import('@/views/xdao/XDAOApp.vue'),
    meta: {
      contentRenderer: 'sidebar-left',
      contentClass: 'xdao-application',
      navActiveLink: 'xdao-app',
    },
    beforeEnter(to, _, next) {
      if (['open', 'passed', 'unpaid', 'rejected'].includes(to.params.filter)) next();
      else next({ name: 'error-404' });
    },
  },
  {
    path: '/xdao-app/tag/:tag',
    name: 'xdao-app-tag',
    component: () => import('@/views/xdao/XDAOApp.vue'),
    meta: {
      contentRenderer: 'sidebar-left',
      contentClass: 'xdao-application',
      navActiveLink: 'xdao-app',
    },
    beforeEnter(to, _, next) {
      if (['team', 'low', 'medium', 'high', 'update'].includes(to.params.tag)) next();
      else next({ name: 'error-404' });
    },
  },
];
