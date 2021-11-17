<template>
  <div style="height: inherit">
    <div
      class="body-content-overlay"
      :class="{'show': showDetailSidebar}"
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
            <b-dropdown-item :to="{ name: $route.name, query: { ...$route.query, sort: 'ssd' } }">
              Sort by SSD
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
        <ul
          class="marketplace-media-list"
        >
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
                    <span class="app-title"><h4>{{ singleApp.name }}</h4></span>
                  </div>
                </div>
                <div class="app-item-action">
                  <div class="badge-wrapper mr-1">
                    <b-badge
                      v-if="singleApp.extraDetail.category"
                      pill
                      :variant="`light-${resolveTagVariant(singleApp.extraDetail)}`"
                      class="text-capitalize"
                    >
                      {{ singleApp.extraDetail.category }}
                    </b-badge>
                  </div>
                  <!-- <small class="text-nowrap text-muted mr-1">{{ formatDate(task.dueDate, { month: 'short', day: 'numeric'}) }}</small> -->
                  <div>
                    <b-avatar
                      v-if="singleApp.extraDetail"
                      size="48"
                      :variant="`light-${resolveAvatarVariant(singleApp.extraDetail)}`"
                    >
                      <v-icon
                        scale="2"
                        :name="`${resolveAvatarIcon(singleApp.extraDetail)}`"
                      />
                    </b-avatar>
                  </div>
                </div>
              </div>
              <div class="app-title-area">
                <div class="title-wrapper">
                  <h6 class="text-nowrap text-muted mr-1 app-description">
                    {{ singleApp.description }}
                  </h6>
                </div>
              </div>
            </b-media-body>
          </b-media>
        </ul>
        <div
          class="no-results"
          :class="{'show': filteredApps.length === 0}"
        >
          <h5>No Proposals Found</h5>
        </div>
      </vue-perfect-scrollbar>
    </div>

    <!-- Proposal View/Detail -->
    <app-view
      :class="{'show': isAppViewActive}"
      :app-data="app"
      :zelid="zelid"
      :has-next-proposal="true"
      :has-previous-proposal="true"
      @close-app-view="isAppViewActive = false"
    />

    <!-- Sidebar -->
    <portal to="content-renderer-sidebar-left">
      <category-sidebar
        :class="{'show': showDetailSidebar}"
        @close-left-sidebar="showDetailSidebar = false"
        @close-app-view="isAppViewActive = false"
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
  ref, computed, watch, onBeforeMount,
} from '@vue/composition-api';

import { avatarText } from '@core/utils/filter';
import { useRouter } from '@core/utils/utils';
import { useResponsiveAppLeftSidebarVisibility } from '@core/comp-functions/ui/app';
import Ripple from 'vue-ripple-directive';
import { useToast } from 'vue-toastification/composition';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import VuePerfectScrollbar from 'vue-perfect-scrollbar';

import AppView from './AppView.vue';
import CategorySidebar from './CategorySidebar.vue';

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

    // Use toast
    const toast = useToast();

    onBeforeMount(() => {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      zelid.value = auth.zelid;
    });

    const { showDetailSidebar } = useResponsiveAppLeftSidebarVisibility();
    // eslint-disable-next-line no-unused-vars
    const { route, router } = useRouter();
    // eslint-disable-next-line no-unused-vars
    const routeSortBy = computed(() => route.value.query.sort);
    // eslint-disable-next-line no-unused-vars
    const routeQuery = computed(() => route.value.query.q);
    // eslint-disable-next-line no-unused-vars
    const routeParams = computed(() => route.value.params);
    watch(routeParams, () => {
      // eslint-disable-next-line no-use-before-define
      fetchApps();
    });

    const filteredApps = ref([]);

    const sortOptions = [
      'latest',
      'title-asc',
      'title-desc',
      'end-date',
    ];

    const sortBy = ref(routeSortBy.value);
    watch(routeSortBy, (val) => {
      if (sortOptions.includes(val)) sortBy.value = val;
      else sortBy.value = val;
    });

    const resetSortAndNavigate = () => {
      const currentRouteQuery = JSON.parse(JSON.stringify(route.value.query));

      delete currentRouteQuery.sort;

      router.replace({ name: route.name, query: currentRouteQuery }).catch(() => {});
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

    const categories = [
      { category: 'Games', variant: 'success', icon: 'gamepad' },
      { category: 'Productivity', variant: 'danger', icon: 'gamepad' },
    ];

    const resolveTagVariant = (extraDetail) => {
      const filteredCategories = categories.filter((cat) => cat.category === extraDetail.category);
      if (filteredCategories.length === 0) {
        return 'primary';
      }
      return filteredCategories[0].variant;
    };

    const resolveAvatarVariant = (extraDetail) => {
      const filteredCategories = categories.filter((cat) => cat.category === extraDetail.category);
      if (filteredCategories.length === 0) {
        return 'primary';
      }
      return filteredCategories[0].variant;
    };

    const resolveAvatarIcon = (extraDetail) => {
      const filteredCategories = categories.filter((cat) => cat.category === extraDetail.category);
      if (filteredCategories.length === 0) {
        return '';
      }
      return filteredCategories[0].icon;
    };

    // Search Query
    const searchQuery = ref(routeQuery.value);
    watch(routeQuery, (val) => {
      searchQuery.value = val;
    });
    // eslint-disable-next-line no-use-before-define
    watch([searchQuery, sortBy], () => fetchApps());
    const updateRouteQuery = (val) => {
      const currentRouteQuery = JSON.parse(JSON.stringify(route.value.query));

      if (val) currentRouteQuery.q = val;
      else delete currentRouteQuery.q;

      router.replace({ name: route.name, query: currentRouteQuery });
    };

    const fetchApps = async () => {
      const response = await axios.get('https://api.runonflux.io/apps/globalappsspecifications');
      // console.log(response)
      if (response.data.status === 'success') {
        filteredApps.value = response.data.data;
        filteredApps.value.forEach((appData) => {
          // eslint-disable-next-line no-param-reassign
          appData.extraDetail = categories[Math.floor(Math.random() * categories.length)];
        });
        console.log(filteredApps.value);
        if (router.currentRoute.params.filter) {
          // Filter
          if (router.currentRoute.params.filter === 'games') {
            filteredApps.value = filteredApps.value.filter((appData) => appData.extraDetail.category === 'Games');
          }
          if (router.currentRoute.params.filter === 'productivity') {
            filteredApps.value = filteredApps.value.filter((appData) => appData.extraDetail.category === 'Productivity');
          }
        }
        if (searchQuery.value) {
          filteredApps.value = filteredApps.value.filter((appData) => {
            if (appData.name.toLowerCase().includes(searchQuery.value)) return true;
            if (appData.description.toLowerCase().includes(searchQuery.value)) return true;
            if (appData.repotag.toLowerCase().includes(searchQuery.value)) return true;
            if (appData.domains.join(',').toLowerCase().includes(searchQuery.value)) return true;
            if (appData.environmentParameters.join(',').toLowerCase().includes(searchQuery.value)) return true;
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
              return a.cpu - b.cpu;
            }
            if (sortBy.value === 'ram') {
              return a.ram - b.ram;
            }
            if (sortBy.value === 'ssd') {
              return a.ssd - b.ssd;
            }
            return 0;
          });
        }
      } else {
        showToast('danger', response.data.data.message || response.data.data);
      }
    };

    fetchApps();

    const isAppViewActive = ref(false);

    const handleAppClick = (appData) => {
      app.value = appData;
      isAppViewActive.value = true;
    };

    const perfectScrollbarSettings = {
      maxScrollbarLength: 150,
    };

    return {
      // route,
      // router,
      zelid,
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
      showDetailSidebar,
    };
  },
};
</script>

<style lang="scss">
@import "app-marketplace.scss";
</style>
