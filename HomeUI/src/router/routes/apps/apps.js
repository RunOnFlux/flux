import { categories } from '../../../libs/marketplaceCategories';

export default [
  {
    path: '/apps/myapps',
    name: 'apps-myapps',
    component: () => import('@/views/apps/MyApps.vue'),
    meta: {
      pageTitle: 'Applications',
      breadcrumb: [
        {
          text: 'Applications',
        },
        {
          text: 'Management',
          active: true,
        },
      ],
    },
  },
  {
    path: '/apps/globalapps',
    name: 'apps-globalapps',
    component: () => import('@/views/apps/GlobalApps.vue'),
    meta: {
      pageTitle: 'Applications',
      breadcrumb: [
        {
          text: 'Applications',
        },
        {
          text: 'Global Apps',
          active: true,
        },
      ],
    },
  },
  {
    path: '/apps/registerapp/:appspecs?',
    name: 'apps-registerapp',
    component: () => import('@/views/apps/RegisterFluxApp.vue'),
    meta: {
      pageTitle: 'Register New App',
      breadcrumb: [
        {
          text: 'Applications',
        },
        {
          text: 'Register New App',
          active: true,
        },
      ],
    },
  },
  {
    path: '/apps/marketplace',
    name: 'apps-marketplace',
    component: () => import('@/views/apps/marketplace/Marketplace.vue'),
    meta: {
      contentRenderer: 'sidebar-left',
      contentClass: 'marketplace-application',
    },
  },
  {
    path: '/apps/marketplace/:filter',
    name: 'apps-marketplace-filter',
    component: () => import('@/views/apps/marketplace/Marketplace.vue'),
    meta: {
      contentRenderer: 'sidebar-left',
      contentClass: 'marketplace-application',
      navActiveLink: 'apps-marketplace',
    },
    beforeEnter(to, _, next) {
      const filterCategories = categories.map((category) => category.name.toLowerCase());
      if (filterCategories.includes(to.params.filter)) next();
      else next({ name: 'error-404' });
    },
  },
  {
    path: 'https://titan.runonflux.io',
    name: 'apps-marketplace-sharednodes',
    component: () => import('@/views/apps/marketplace/Marketplace.vue'),
    meta: {
      contentRenderer: 'sidebar-left',
      contentClass: 'marketplace-application',
      navActiveLink: 'apps-marketplace',
    },
  },
];
