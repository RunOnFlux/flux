<template>
  <div style="height: inherit">
    <div
      class="body-content-overlay"
      :class="{ show: showDetailSidebar }"
      @click="showDetailSidebar = false"
    />
    <div class="marketplace-app-list">
      <div class="app-fixed-search d-flex align-items-center">
        <div class="sidebar-toggle d-block d-lg-none ml-1">
          <feather-icon
            icon="MenuIcon"
            size="21"
            class="cursor-pointer"
            @click="showDetailSidebar = true"
          />
        </div>

        <div class="d-flex align-content-center justify-content-between w-100">
          <b-input-group class="input-group-merge">
            <b-input-group-prepend is-text>
              <feather-icon
                icon="SearchIcon"
                class="text-muted"
              />
            </b-input-group-prepend>
            <b-form-input
              :value="searchQuery"
              placeholder="Search Marketplace Apps"
              @input="updateRouteQuery"
            />
          </b-input-group>
        </div>

        <div class="dropdown">
          <b-dropdown
            variant="link"
            no-caret
            toggle-class="p-0 mr-1"
            right
          >
            <template #button-content>
              <feather-icon
                icon="MoreVerticalIcon"
                size="16"
                class="align-middle text-body"
              />
            </template>
            <b-dropdown-item @click="resetSortAndNavigate">
              Reset Sort
            </b-dropdown-item>
            <b-dropdown-item :to="{ name: $route.name, query: { ...$route.query, sort: 'title-asc' } }">
              Sort A-Z
            </b-dropdown-item>
            <b-dropdown-item :to="{ name: $route.name, query: { ...$route.query, sort: 'title-desc' } }">
              Sort Z-A
            </b-dropdown-item>
            <b-dropdown-item :to="{ name: $route.name, query: { ...$route.query, sort: 'cpu' } }">
              Sort by CPU
            </b-dropdown-item>
            <b-dropdown-item :to="{ name: $route.name, query: { ...$route.query, sort: 'ram' } }">
              Sort by RAM
            </b-dropdown-item>
            <b-dropdown-item :to="{ name: $route.name, query: { ...$route.query, sort: 'hdd' } }">
              Sort by HDD
            </b-dropdown-item>
            <b-dropdown-item :to="{ name: $route.name, query: { ...$route.query, sort: 'price' } }">
              Sort by price
            </b-dropdown-item>
          </b-dropdown>
        </div>
      </div>

      <vue-perfect-scrollbar
        ref="appListRef"
        :settings="perfectScrollbarSettings"
        class="marketplace-app-list scroll-area"
      >
        <ul class="marketplace-media-list">
          <b-media
            v-for="singleApp in filteredApps"
            :key="singleApp.hash"
            tag="li"
            no-body
            @click="handleAppClick(singleApp)"
          >
            <b-media-body class="app-media-body">
              <div class="app-title-wrapper">
                <div class="app-title-area">
                  <div class="title-wrapper">
                    <span class="app-title">
                      <kbd class="alert-info no-wrap" style="border-radius: 15px; font-size: 16px; font-weight: 700 !important;"> <b-icon scale="1.2" icon="app-indicator" />&nbsp;&nbsp;{{ singleApp.name }}&nbsp; </kbd>
                    </span>
                  </div>
                </div>
                <div class="app-item-action">
                  <div class="badge-wrapper mr-1">
                    <b-badge
                      v-if="singleApp.extraDetail.name"
                      pill
                      :variant="`light-${resolveTagVariant(singleApp.extraDetail)}`"
                      class="text-capitalize"
                    >
                      {{ singleApp.extraDetail.name }}
                    </b-badge>
                  </div>
                  <div>
                    <b-avatar
                      v-if="singleApp.extraDetail"
                      size="48"
                      :variant="`light-${resolveAvatarVariant(singleApp.extraDetail)}`"
                    >
                      <v-icon
                        scale="1.75"
                        :name="`${resolveAvatarIcon(singleApp.extraDetail)}`"
                      />
                    </b-avatar>
                  </div>
                </div>
              </div>
              <div class="app-title-area">
                <div class="title-wrapper">
                  <h6 class="text-nowrap text-muted mr-1 mb-1 app-description" style="width: 900px">
                    {{ singleApp.description }}
                  </h6>
                </div>
              </div>
              <div class="app-title-area">
                <div class="title-wrapper">
                  <h6 class="text-nowrap text-muted mr-1 app-description">
                    &nbsp;<b-icon scale="1.4" icon="speedometer2" />&nbsp;&nbsp;<kbd class="alert-success" style="border-radius: 15px;">&nbsp;<b>{{ resolveCpu(singleApp) }} </b>&nbsp;</kbd>&nbsp;
                    &nbsp;<b-icon scale="1.4" icon="cpu" />&nbsp;&nbsp;<kbd class="alert-success" style="border-radius: 15px;">&nbsp;<b>{{ resolveRam(singleApp) }}</b>&nbsp;</kbd>&nbsp;
                    &nbsp;<b-icon scale="1.4" icon="hdd" />&nbsp;&nbsp;<kbd class="alert-success" style="border-radius: 15px;">&nbsp;<b>{{ resolveHdd(singleApp) }} GB</b>&nbsp;</kbd>&nbsp;
                  </h6>
                </div>
              </div>
              <div
                v-if="singleApp.priceUSD"
                class="app-title-area"
              >
                <div class="title-wrapper">
                  <h5 class="text-nowrap mr-1 app-description">
                    &nbsp;<b-icon class="mr-1" scale="1.3" icon="cash" />{{ singleApp.priceUSD }} USD, &nbsp;<b-icon class="mr-1" scale="1.1" icon="clock" />{{ adjustPeriod(singleApp) }}
                  </h5>
                </div>
              </div>
              <div
                v-else
                class="app-title-area"
              >
                <div class="title-wrapper">
                  <h5 class="text-nowrap mr-1 app-description">
                    Price: {{ singleApp.price }} Flux / {{ adjustPeriod(singleApp) }}
                  </h5>
                </div>
              </div>
            </b-media-body>
          </b-media>
        </ul>
        <div
          class="no-results"
          :class="{ show: filteredApps.length === 0 }"
        >
          <h5>No Marketplace Apps Found</h5>
        </div>
      </vue-perfect-scrollbar>
    </div>

    <!-- Proposal View/Detail -->
    <app-view
      ref="appViewRef"
      :class="{ show: isAppViewActive }"
      :app-data="app"
      :zelid="zelid"
      :tier="tier"
      :is-active="isAppViewActive"
      @close-app-view="isAppViewActive = false"
    />

    <shared-nodes-view
      :class="{ show: isSharedNodesViewActive }"
      :app-data="app"
      :zelid="zelid"
      :tier="tier"
      @close-sharednode-view="isSharedNodesViewActive = false"
    />

    <!-- Sidebar -->
    <portal to="content-renderer-sidebar-left">
      <category-sidebar
        :class="{ show: showDetailSidebar }"
        :zelid="zelid"
        @close-left-sidebar="showDetailSidebar = false"
        @close-app-view="isAppViewActive = false; isSharedNodesViewActive = false;"
        @scroll-app-view="scrollAppViewToTop"
      />
    </portal>
  </div>
</template>

<script>
import {
  BFormInput,
  BInputGroup,
  BInputGroupPrepend,
  BDropdown,
  BDropdownItem,
  BBadge,
  BAvatar,
  BMedia,
  BMediaBody,
} from 'bootstrap-vue';

import {
  ref, computed, watch, onBeforeMount, nextTick,
} from 'vue';

// eslint-disable-next-line import/no-cycle
import { avatarText } from '@core/utils/filter';
// eslint-disable-next-line import/no-cycle
import { useRouter } from '@core/utils/utils';
import { useResponsiveAppLeftSidebarVisibility } from '@core/comp-functions/ui/app';
import Ripple from 'vue-ripple-directive';
import { useToast } from 'vue-toastification/composition';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import VuePerfectScrollbar from 'vue-perfect-scrollbar';
import DaemonService from '@/services/DaemonService';
import FluxService from '@/services/FluxService';

import AppView from './AppView.vue';
import SharedNodesView from './SharedNodesView.vue';
import CategorySidebar from './CategorySidebar.vue';
import { categories, defaultCategory } from '../../../libs/marketplaceCategories';

const qs = require('qs');
const axios = require('axios');
const timeoptions = require('@/libs/dateFormat');

export default {
  components: {
    BFormInput,
    BInputGroup,
    BInputGroupPrepend,
    BDropdown,
    BDropdownItem,
    BMedia,
    BMediaBody,
    BBadge,
    BAvatar,
    AppView,
    SharedNodesView,
    CategorySidebar,
    VuePerfectScrollbar,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    Ripple,
  },
  setup() {
    const appListRef = ref(null);
    const zelid = ref(null);
    const tier = ref('');
    const appViewRef = ref(null);
    const scrollAppViewToTop = async () => {
      await nextTick();
      await new Promise((resolve) => { setTimeout(resolve, 100); });
      if (appListRef.value) {
        const psInstance = appListRef.value.ps;
        if (psInstance) {
          psInstance.update();
          appListRef.value.$el.scrollTop = 0;
          setTimeout(() => {
          }, 300);
        } else {
          const scrollbarContainer = appListRef.value.$el;
          if (scrollbarContainer) {
            scrollbarContainer.scrollTo({
              top: 0,
              behavior: 'smooth',
            });
            setTimeout(() => {
              console.log('Final scrollTop (native):', scrollbarContainer.scrollTop);
            }, 300);
          } else {
            console.warn('Cannot find scrollbar container');
          }
        }
      } else {
        console.warn('appListRef is NULL. Skipping scroll.');
      }
    };

    const { route, router } = useRouter();
    const isAppViewActive = ref(false);
    const isSharedNodesViewActive = ref(false);

    // Use toast
    const toast = useToast();

    onBeforeMount(() => {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      zelid.value = auth.zelid;
      isSharedNodesViewActive.value = route.value.path === '/apps/shared-nodes';
    });

    const resolveCpu = (app) => app.compose.reduce((total, component) => total + component.cpu, 0);

    const resolveRam = (app) => app.compose.reduce((total, component) => total + component.ram, 0);

    const resolveHdd = (app) => app.compose.reduce((total, component) => total + component.hdd, 0);

    const adjustPeriod = (app) => {
      // Handle old values (before block 2020000)
      if (app.expire === 264000) {
        return '1 year';
      } if (app.expire === 66000) {
        return '3 months';
      } if (app.expire === 132000) {
        return '6 months';
      }
      // Handle new 4x multiplied values (after block 2020000 when chain works 4x faster)
      if (app.expire === 1056000) { // 264000 * 4
        return '1 year';
      } if (app.expire === 528000) { // 132000 * 4
        return '6 months';
      } if (app.expire === 88000) { // 22000 * 4
        return '1 month';
      }
      return '1 month';
    };

    const { showDetailSidebar } = useResponsiveAppLeftSidebarVisibility();
    const routeSortBy = computed(() => route.value.query.sort);
    const routeQuery = computed(() => route.value.query.q);
    const routeParams = computed(() => route.value.params);

    const filteredApps = ref([]);

    const sortOptions = [
      'latest',
      'title-asc',
      'title-desc',
      'end-date',
      'cpu',
      'ram',
      'hdd',
    ];

    const sortBy = ref(routeSortBy.value);
    watch(routeSortBy, (val) => {
      if (sortOptions.includes(val)) sortBy.value = val;
      else sortBy.value = val;
    });

    const resetSortAndNavigate = () => {
      const currentRouteQuery = JSON.parse(JSON.stringify(route.value.query));

      delete currentRouteQuery.sort;

      router.replace({ name: route.name, query: currentRouteQuery }).catch(() => { });
    };

    const app = ref({});

    const showToast = (variant, title, icon = 'InfoIcon') => {
      toast({
        component: ToastificationContent,
        props: {
          title,
          icon,
          variant,
        },
      });
    };

    const resolveTagVariant = (extraDetail) => {
      const filteredCategories = categories.filter((cat) => cat.name === extraDetail.name);
      if (filteredCategories.length === 0) {
        return defaultCategory.variant;
      }
      return filteredCategories[0].variant;
    };

    const resolveAvatarVariant = (extraDetail) => {
      const filteredCategories = categories.filter((cat) => cat.name === extraDetail.name);
      if (filteredCategories.length === 0) {
        return defaultCategory.variant;
      }
      return filteredCategories[0].variant;
    };

    const resolveAvatarIcon = (extraDetail) => {
      const filteredCategories = categories.filter((cat) => cat.name === extraDetail.name);
      if (filteredCategories.length === 0) {
        return defaultCategory.icon;
      }
      return filteredCategories[0].icon;
    };

    // Search Query
    const searchQuery = ref(routeQuery.value);
    watch(routeQuery, (val) => {
      searchQuery.value = val;
    });

    const debounce = (fn, delay = 300) => {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
      };
    };

    const updateRouteQuery = debounce((val) => {
      const currentRouteQuery = { ...route.value.query };
      if (val) {
        currentRouteQuery.q = val;
      } else {
        delete currentRouteQuery.q;
      }
      router.replace({ name: route.name, query: currentRouteQuery }).catch(() => {});
    }, 300);

    const getCategory = (categoryToFind) => {
      const foundCategory = categories.find((category) => category.name === categoryToFind);
      if (!foundCategory) return defaultCategory;
      return foundCategory;
    };

    const fetchApps = async () => {
      const responseDevFlag = await FluxService.getMarketPlaceURL();
      if (responseDevFlag.data.status === 'success' && responseDevFlag.data.data) {
        const response = await axios.get(responseDevFlag.data.data);
        console.log(response);
        if (response.data.status === 'success') {
          filteredApps.value = response.data.data.filter((val) => val.visible);
          filteredApps.value.forEach((appData) => {
          // eslint-disable-next-line no-param-reassign
            appData.extraDetail = getCategory(appData.category);
          });
          if (router.currentRoute.params.filter) {
          // Filter
            filteredApps.value = filteredApps.value.filter((appData) => appData.extraDetail.name.toLowerCase() === router.currentRoute.params.filter.toLowerCase());
          }
          if (searchQuery.value) {
            const normalizedSearchQuery = searchQuery.value.toLowerCase();
            filteredApps.value = filteredApps.value.filter((appData) => {
              if (appData.name.toLowerCase().includes(normalizedSearchQuery)) return true;
              if (appData.description.toLowerCase().includes(normalizedSearchQuery)) return true;
              return false;
            });
          }
          if (sortBy.value) {
            filteredApps.value.sort((a, b) => {
              if (sortBy.value === 'title-asc') {
                return a.name.localeCompare(b.name);
              }
              if (sortBy.value === 'title-desc') {
                return b.name.localeCompare(a.name);
              }
              if (sortBy.value === 'cpu') {
                return resolveCpu(a) - resolveCpu(b);
              }
              if (sortBy.value === 'ram') {
                return resolveRam(a) - resolveRam(b);
              }
              if (sortBy.value === 'hdd') {
                return resolveHdd(a) - resolveHdd(b);
              }
              if (sortBy.value === 'price') {
                return a.priceUSD - b.priceUSD;
              }
              return 0;
            });
          }
        } else {
          showToast('danger', response.data.data.message || response.data.data);
        }
      } else {
        showToast('danger', responseDevFlag.data.data.message || responseDevFlag.data.data);
      }
    };

    watch([searchQuery, sortBy], () => fetchApps());
    watch(routeParams, () => {
      fetchApps();
    });

    const getFluxNodeStatus = async () => {
      const response = await DaemonService.getFluxNodeStatus();
      if (response.data.status === 'success') {
        tier.value = response.data.data.tier;
      }
      fetchApps();
    };
    getFluxNodeStatus();

    const handleAppClick = async (appData) => {
      app.value = appData;
      isAppViewActive.value = true;
      await nextTick();
      window.scrollTo({
        top: 0,
      });
    };

    const perfectScrollbarSettings = {
      maxScrollbarLength: 150,
    };

    return {
      zelid,
      tier,
      appListRef,
      timeoptions,
      app,
      handleAppClick,
      updateRouteQuery,
      searchQuery,
      filteredApps,
      sortOptions,
      resetSortAndNavigate,
      perfectScrollbarSettings,
      resolveTagVariant,
      resolveAvatarVariant,
      resolveAvatarIcon,
      avatarText,
      isAppViewActive,
      isSharedNodesViewActive,
      showDetailSidebar,
      resolveHdd,
      resolveCpu,
      resolveRam,
      adjustPeriod,
      appViewRef,
      scrollAppViewToTop,
    };
  },
};
</script>

<style lang="scss">
@import "app-marketplace.scss";
</style>
