<template>
  <b-overlay
    :show="usersLoading"
    variant="transparent"
    blur="5px"
  >
    <b-card>
      <b-row>
        <b-col
          md="4"
          sm="4"
          class="my-1"
        >
          <b-form-group class="mb-0">
            <label class="d-inline-block text-left mr-50">Per page</label>
            <b-form-select
              id="perPageSelect"
              v-model="perPage"
              size="sm"
              :options="pageOptions"
              class="w-50"
            />
          </b-form-group>
        </b-col>
        <b-col
          md="8"
          class="my-1"
        >
          <b-form-group
            label="Filter"
            label-cols-sm="1"
            label-align-sm="right"
            label-for="filterInput"
            class="mb-0"
          >
            <b-input-group size="sm">
              <b-form-input
                id="filterInput"
                v-model="filter"
                type="search"
                placeholder="Type to Search"
              />
              <b-input-group-append>
                <b-button
                  :disabled="!filter"
                  @click="filter = ''"
                >
                  Clear
                </b-button>
              </b-input-group-append>
            </b-input-group>
          </b-form-group>
        </b-col>

        <b-col cols="12">
          <b-table
            striped
            hover
            responsive
            small
            :per-page="perPage"
            :current-page="currentPage"
            :items="items"
            :fields="fields"
            :sort-by.sync="sortBy"
            :sort-desc.sync="sortDesc"
            :sort-direction="sortDirection"
            :filter="filter"
            :filter-included-fields="filterOn"
            show-empty
            empty-text="No Users"
            @filtered="onFiltered"
          >
            <template #cell(logout)="row">
              <v-icon
                v-b-tooltip.hover.top="'Currently logged and used session by you'"
                name="info-circle"
                class="mr-1"
                :class="row.item.loginPhrase === currentLoginPhrase ? '' : 'hidden'"
              />
              <b-button
                :id="`${row.item.loginPhrase}`"
                size="sm"
                class="mr-0"
                variant="danger"
                @click="logoutPopoverShow[row.item.loginPhrase] = true"
              >
                Log Out
              </b-button>
              <confirm-dialog
                :target="`${row.item.loginPhrase}`"
                confirm-button="Log Out!"
                @confirm="onLogoutOK(row.item)"
              />
            </template>
          </b-table>
        </b-col>

        <b-col cols="12">
          <b-pagination
            v-model="currentPage"
            :total-rows="totalRows"
            :per-page="perPage"
            align="center"
            size="sm"
            class="my-0"
          />
          <span class="table-total">Total: {{ totalRows }}</span>
        </b-col>
      </b-row>
      <div class="text-center">
        <b-button
          id="logout-all"
          size="sm"
          class="mt-2"
          variant="danger"
          @click="logoutAllPopoverShow = true"
        >
          Log Out all Users
        </b-button>
        <confirm-dialog
          target="logout-all"
          confirm-button="Log Out All!"
          @confirm="onLogoutAllOK()"
        />
      </div>
    </b-card>
  </b-overlay>
</template>

<script>
import { computed } from "vue";
import {
  BCard,
  BTable,
  BRow,
  BCol,
  BFormGroup,
  BFormSelect,
  BPagination,
  BInputGroup,
  BFormInput,
  BInputGroupAppend,
  BButton,
  VBTooltip,
  BOverlay,
} from 'bootstrap-vue';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import Ripple from 'vue-ripple-directive';
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';
import IDService from '@/services/IDService';

import qs from 'qs';

export default {
  components: {
    BCard,
    BTable,
    BRow,
    BCol,
    BPagination,
    BFormGroup,
    BFormSelect,
    BInputGroup,
    BFormInput,
    BInputGroupAppend,
    BButton,
    BOverlay,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
    ConfirmDialog,
  },
  directives: {
    'b-tooltip': VBTooltip,
    Ripple,
  },
  data() {
    return {
      perPage: 10,
      pageOptions: [10, 25, 50, 100],
      sortBy: '',
      sortDesc: false,
      sortDirection: 'asc',
      items: [],
      filter: '',
      filterOn: [],
      fields: [
        { key: 'zelid', label: 'ZelID', sortable: true },
        { key: 'loginPhrase', label: 'Login Phrase', sortable: true },
        { key: 'logout', label: '' },
      ],
      totalRows: 1,
      currentPage: 1,
      usersLoading: true,
    };
  },
  setup() {
    const sortOptions = computed(() => {
      // Create an options list from our fields
      return this.fields
        .filter((f) => f.sortable)
        .map((f) => ({ text: f.label, value: f.key }));
    });

    const currentLoginPhrase = computed(() => {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      return auth.loginPhrase;
    });

    return {
      sortOptions,
      currentLoginPhrase
    }
  },
  mounted() {
    this.loggedUsers();
  },
  methods: {
    async loggedUsers() {
      this.usersLoading = true;
      const zelidauth = localStorage.getItem('zelidauth');
      IDService.loggedUsers(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            this.items = response.data.data;
            this.totalRows = this.items.length;
            this.currentPage = 1;
          }
          this.usersLoading = false;
        })
        .catch((e) => {
          console.log(e);
          this.showToast('danger', e.toString());
          this.usersLoading = false;
        });
    },
    onFiltered(filteredItems) {
      // Trigger pagination to update the number of buttons/pages due to filtering
      this.totalRows = filteredItems.length;
      this.currentPage = 1;
    },
    async onLogoutOK(row) {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      IDService.logoutSpecificSession(zelidauth, row.loginPhrase)
        .then((response) => {
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            this.showToast('success', response.data.data.message || response.data.data);
            if (row.loginPhrase === auth.loginPhrase) {
              localStorage.removeItem('zelidauth');
              this.$store.commit('flux/setPrivilege', 'none');
              // Navigate back to the home screen
              this.$router.replace('/');
            } else {
              this.loggedUsers();
            }
          }
        })
        .catch((e) => {
          console.log(e);
          this.showToast('danger', e.toString());
        });
    },
    async onLogoutAllOK() {
      const zelidauth = localStorage.getItem('zelidauth');
      IDService.logoutAllUsers(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            localStorage.removeItem('zelidauth');
            this.$store.commit('flux/setPrivilege', 'none');
            // Navigate back to the home screen
            this.$router.replace('/');
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((e) => {
          console.log(e);
          this.showToast('danger', e.toString());
        });
    },
    showToast(variant, title, icon = 'InfoIcon') {
      this.$bvToast.toast({
        component: ToastificationContent,
        props: {
          title,
          icon,
          variant,
        },
      });
    },
  },
};
</script>

<style>

</style>
