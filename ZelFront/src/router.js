import MainPage from '@/pages/MainPage';
import Vue from 'vue';
import Router from 'vue-router';

Vue.use(Router);

export default new Router({
  mode : 'history',
  base : process.env.BASE_URL,
  routes : [
    {
      path : '/',
      name : 'MainPage',
      component : MainPage,
    },
    {
      path : '/home',
      name : 'Home',
      // route level code-splitting
      // this generates a separate chunk (home.[hash].js) for this route
      // which is lazy-loaded when the route is visited.
      component : () => import(/* webpackChunkName: "home" */ '@/pages/Home'),
    },
    {
      path : '/dashboard',
      name : 'Dashboard',
      component : MainPage,
    },
    {
      path : '*',
      name : 'MainPage',
      component : MainPage,
    },
  ],
});
