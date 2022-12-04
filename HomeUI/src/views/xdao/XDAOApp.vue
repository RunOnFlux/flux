<template>
  <div style="height: inherit">
    <div
      class="body-content-overlay"
      :class="{ show: showDetailSidebar }"
      @click="showDetailSidebar = false"
    />
    <div class="xdao-proposal-list">
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
              placeholder="Search proposals"
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
            <b-dropdown-item :to="{ name: $route.name, query: { ...$route.query, sort: 'end-date' } }">
              Sort End Date
            </b-dropdown-item>
          </b-dropdown>
        </div>
      </div>

      <vue-perfect-scrollbar
        ref="proposalListRef"
        :settings="perfectScrollbarSettings"
        class="xdao-proposal-list scroll-area"
      >
        <ul
          class="xdao-media-list"
        >
          <b-media
            v-for="singleProposal in filteredProposals"
            :key="singleProposal.hash"
            tag="li"
            no-body
            class="proposal-item"
            @click="handleProposalClick(singleProposal)"
          >
            <!-- <feather-icon
              icon="MoreVerticalIcon"
              class="draggable-task-handle d-inline"
            /> -->
            <b-media-body>
              <div class="proposal-title-wrapper">
                <div class="proposal-title-area">
                  <div class="title-wrapper">
                    <span class="proposal-title"><h4>{{ singleProposal.topic }}</h4></span>
                  </div>
                </div>
                <div class="proposal-item-action">
                  <div class="badge-wrapper mr-1">
                    <b-badge
                      pill
                      :variant="`light-${resolveTagVariant(singleProposal.status)}`"
                      class="text-capitalize"
                    >
                      {{ singleProposal.status }}
                    </b-badge>
                  </div>
                  <!-- <small class="text-nowrap text-muted mr-1">{{ formatDate(task.dueDate, { month: 'short', day: 'numeric'}) }}</small> -->
                  <b-avatar
                    v-if="singleProposal.nickName"
                    size="32"
                    :variant="`light-${resolveAvatarVariant(singleProposal.status)}`"
                    :text="avatarText(singleProposal.nickName)"
                  />
                  <b-avatar
                    v-else
                    size="32"
                    variant="light-secondary"
                  >
                    <feather-icon
                      icon="UserIcon"
                      size="16"
                    />
                  </b-avatar>
                </div>
              </div>
              <div class="proposal-title-area">
                <div class="title-wrapper">
                  <h6 class="text-nowrap text-muted mr-1">
                    Submitted: {{ new Date(singleProposal.submitDate).toLocaleString('en-GB', timeoptions.shortDate) }}
                  </h6>
                  <h6 class="text-nowrap text-muted mr-1">
                    End Date: {{ new Date(singleProposal.voteEndDate).toLocaleString('en-GB', timeoptions.shortDate) }}
                  </h6>
                </div>
              </div>
              <div class="proposal-progress-area">
                <h6 class="text-nowrap text-muted mr-1">
                  Required Votes: {{ Number(singleProposal.votesRequired).toLocaleString() }}
                </h6>
                <b-progress
                  :max="singleProposal.votesRequired"
                  striped
                  animated
                  class="proposal-progress"
                >
                  <b-progress-bar
                    :id="`progressbar-no-${singleProposal.hash}`"
                    variant="danger"
                    :value="singleProposal.votesNo"
                    show-progress
                  >
                    No: {{ Number(singleProposal.votesNo).toLocaleString() }}
                  </b-progress-bar>
                  <b-tooltip
                    ref="tooltip"
                    :target="`progressbar-no-${singleProposal.hash}`"
                    :disabled="singleProposal.votesNo / singleProposal.votesRequired > 0.25"
                  >
                    <span>No: {{ Number(singleProposal.votesNo).toLocaleString() }}</span>
                  </b-tooltip>
                  <b-progress-bar
                    :id="`progressbar-yes-${singleProposal.hash}`"
                    variant="success"
                    :value="singleProposal.votesYes"
                    show-progress
                  >
                    Yes: {{ Number(singleProposal.votesYes).toLocaleString() }}
                  </b-progress-bar>
                  <b-tooltip
                    ref="tooltip"
                    :target="`progressbar-yes-${singleProposal.hash}`"
                    :disabled="singleProposal.votesYes / singleProposal.votesRequired > 0.25"
                  >
                    <span>Yes: {{ Number(singleProposal.votesYes).toLocaleString() }}</span>
                  </b-tooltip>
                </b-progress>
              </div>
            </b-media-body>
          </b-media>
        </ul>
        <div
          class="no-results"
          :class="{ show: filteredProposals.length === 0 }"
        >
          <h5>No Proposals Found</h5>
        </div>
      </vue-perfect-scrollbar>
    </div>

    <!-- Add Proposal View -->
    <add-proposal-view
      :class="{ show: isAddProposalViewActive }"
      :zelid="zelid"
      @close-add-proposal-view="isAddProposalViewActive = false"
    />

    <!-- Proposal View/Detail -->
    <proposal-view
      :class="{ show: isProposalViewActive }"
      :proposal-view-data="proposal"
      :zelid="zelid"
      :has-next-proposal="true"
      :has-previous-proposal="true"
      @close-proposal-view="isProposalViewActive = false"
    />

    <!-- Sidebar -->
    <portal to="content-renderer-sidebar-left">
      <proposal-sidebar
        :class="{ show: showDetailSidebar }"
        @close-left-sidebar="showDetailSidebar = false"
        @close-proposal-view="isProposalViewActive = false; isAddProposalViewActive = false"
        @open-add-proposal-view="isAddProposalViewActive = true"
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
  BProgress,
  BProgressBar,
  BMedia,
  BMediaBody,
  BTooltip,
} from 'bootstrap-vue';

// eslint-disable-next-line import/no-cycle
import { avatarText } from '@core/utils/filter';
// eslint-disable-next-line import/no-cycle
import { useRouter } from '@core/utils/utils';
import { useResponsiveAppLeftSidebarVisibility } from '@core/comp-functions/ui/app';
import Ripple from 'vue-ripple-directive';
import { useToast } from 'vue-toastification';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import VuePerfectScrollbar from 'vue-perfect-scrollbar';

import AddProposalView from './AddProposalView.vue';
import ProposalView from './ProposalView.vue';
import ProposalSidebar from './ProposalSidebar.vue';

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
    BProgress,
    BProgressBar,
    BTooltip,

    AddProposalView,
    ProposalView,
    ProposalSidebar,

    VuePerfectScrollbar,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    Ripple,
  },
  setup() {
    const proposalListRef = ref(null);
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
      fetchProposals();
    });

    const filteredProposals = ref([]);

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

    const proposal = ref({});

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

    const resolveTagVariant = (status) => {
      if (status === 'Open') return 'warning';
      if (status === 'Passed') return 'success';
      if (status === 'Unpaid') return 'info';
      if (status.startsWith('Rejected')) return 'danger';
      return 'primary';
    };

    const resolveAvatarVariant = (status) => {
      if (status === 'Open') return 'warning';
      if (status === 'Passed') return 'success';
      if (status === 'Unpaid') return 'info';
      if (status.startsWith('Rejected')) return 'danger';
      return 'primary';
    };

    // Search Query
    const searchQuery = ref(routeQuery.value);
    watch(routeQuery, (val) => {
      searchQuery.value = val;
    });
    // eslint-disable-next-line no-use-before-define
    watch([searchQuery, sortBy], () => fetchProposals());
    const updateRouteQuery = (val) => {
      const currentRouteQuery = JSON.parse(JSON.stringify(route.value.query));

      if (val) currentRouteQuery.q = val;
      else delete currentRouteQuery.q;

      router.replace({ name: route.name, query: currentRouteQuery });
    };

    const fetchProposals = async () => {
      const response = await axios.get('https://stats.runonflux.io/proposals/listProposals');
      // console.log(response)
      if (response.data.status === 'success') {
        /* console.log(response.data.data)
        console.log(router.currentRoute.params.filter)
        console.log(searchQuery.value)
        console.log(sortBy.value) */
        filteredProposals.value = response.data.data;
        if (router.currentRoute.params.filter) {
          // Filter
          if (router.currentRoute.params.filter === 'open') {
            filteredProposals.value = filteredProposals.value.filter((proposalData) => proposalData.status === 'Open');
          }
          if (router.currentRoute.params.filter === 'passed') {
            filteredProposals.value = filteredProposals.value.filter((proposalData) => proposalData.status === 'Passed');
          }
          if (router.currentRoute.params.filter === 'unpaid') {
            filteredProposals.value = filteredProposals.value.filter((proposalData) => proposalData.status === 'Unpaid');
          }
          if (router.currentRoute.params.filter === 'rejected') {
            filteredProposals.value = filteredProposals.value.filter((proposalData) => (proposalData.status === 'Rejected' || proposalData.status === 'Rejected Unpaid' || proposalData.status === 'Rejected Not Enough Votes'));
          }
        }
        if (searchQuery.value) {
          filteredProposals.value = filteredProposals.value.filter((proposalData) => {
            if (proposalData.topic.toLowerCase().includes(searchQuery.value)) return true;
            if (proposalData.description.toLowerCase().includes(searchQuery.value)) return true;
            if (proposalData.nickName.toLowerCase().includes(searchQuery.value)) return true;
            return false;
          });
        }
        if (sortBy.value) {
          filteredProposals.value.sort((a, b) => {
            if (sortBy.value === 'title-asc') {
              return a.topic.localeCompare(b.topic);
            }
            if (sortBy.value === 'title-desc') {
              return b.topic.localeCompare(a.topic);
            }
            if (sortBy.value === 'end-date') {
              return a.voteEndDate - b.voteEndDate;
            }
            return 0;
          });
        }
      } else {
        showToast('danger', response.data.data.message || response.data.data);
      }
    };

    fetchProposals();

    const isProposalViewActive = ref(false);
    const isAddProposalViewActive = ref(false);

    const handleProposalClick = (proposalData) => {
      proposal.value = proposalData;
      isProposalViewActive.value = true;
    };

    const perfectScrollbarSettings = {
      maxScrollbarLength: 150,
    };

    return {
      // route,
      // router,
      zelid,
      proposalListRef,
      timeoptions,
      proposal,
      handleProposalClick,
      updateRouteQuery,
      searchQuery,
      filteredProposals,
      sortOptions,
      resetSortAndNavigate,
      perfectScrollbarSettings,
      resolveTagVariant,
      resolveAvatarVariant,
      avatarText,
      isProposalViewActive,
      isAddProposalViewActive,
      showDetailSidebar,
    };
  },
};
</script>

<style lang="scss">
@import "app-xdao.scss";
</style>
