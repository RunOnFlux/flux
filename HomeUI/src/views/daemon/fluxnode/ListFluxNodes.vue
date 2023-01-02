<template>
  <b-overlay
    :show="fluxListLoading"
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
            class="fluxnode-table"
            striped
            hover
            responsive
            :per-page="perPage"
            :current-page="currentPage"
            :items="items"
            :fields="fields"
            :sort-by="sortBy"
            :sort-desc="sortDesc"
            :sort-direction="sortDirection"
            :filter="filter"
            :filter-included-fields="filterOn"
            @filtered="onFiltered"
          >
            <template #cell(show_details)="row">
              <a @click="row.toggleDetails">
                <v-icon
                  v-if="!row.detailsShowing"
                  name="chevron-down"
                />
                <v-icon
                  v-if="row.detailsShowing"
                  name="chevron-up"
                />
              </a>
            </template>
            <template #cell(payment_address)="row">
              {{ row.item.payment_address || 'Node Expired' }}
            </template>
            <template #row-details="row">
              <b-card class="mx-2">
                <list-entry
                  v-if="row.item.collateral"
                  title="Collateral"
                  :data="row.item.collateral"
                />
                <list-entry
                  v-if="row.item.lastpaid"
                  title="Last Paid"
                  :data="new Date(row.item.lastpaid * 1000).toLocaleString('en-GB', timeoptions.shortDate)"
                />
                <list-entry
                  v-if="row.item.activesince"
                  title="Active Since"
                  :data="new Date(row.item.activesince * 1000).toLocaleString('en-GB', timeoptions.shortDate)"
                />
                <list-entry
                  v-if="row.item.last_paid_height"
                  title="Last Paid Height"
                  :data="row.item.last_paid_height.toFixed(0)"
                />
                <list-entry
                  v-if="row.item.confirmed_height"
                  title="Confirmed Height"
                  :data="row.item.confirmed_height.toFixed(0)"
                />
                <list-entry
                  v-if="row.item.last_confirmed_height"
                  title="Last Confirmed Height"
                  :data="row.item.last_confirmed_height.toFixed(0)"
                />
                <list-entry
                  v-if="row.item.rank >= 0"
                  title="Rank"
                  :data="row.item.rank.toFixed(0)"
                />
              </b-card>
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
  BOverlay,
} from 'bootstrap-vue';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ListEntry from '@/views/components/ListEntry.vue';
import DaemonService from '@/services/DaemonService.js';

const timeoptions = require('@/libs/dateFormat.js');

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
    ListEntry,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  data() {
    return {
      timeoptions,
      callResponse: {
        status: '',
        data: '',
      },
      perPage: 10,
      pageOptions: [10, 25, 50, 100],
      sortBy: '',
      sortDesc: false,
      sortDirection: 'asc',
      items: [],
      filter: '',
      filterOn: [],
      fields: [
        { key: 'show_details', label: '' },
        { key: 'payment_address', label: 'Address', sortable: true },
        { key: 'ip', label: 'IP', sortable: true },
        { key: 'tier', label: 'Tier', sortable: true },
        { key: 'added_height', label: 'Added Height', sortable: true },
      ],
      totalRows: 1,
      currentPage: 1,
      fluxListLoading: true,
    };
  },
  setup() {
    const sortOptions = computed(() => {
      // Create an options list from our fields
      return this.fields
        .filter((f) => f.sortable)
        .map((f) => ({ text: f.label, value: f.key }));
    });

    return {
      sortOptions
    }
  },
  mounted() {
    this.daemonListZelNodes();
  },
  methods: {
    async daemonListZelNodes() {
      const response = await DaemonService.listZelNodes();
      if (response.data.status === 'error') {
        this.$bvToast.toast({
          component: ToastificationContent,
          props: {
            title: response.data.data.message || response.data.data,
            icon: 'InfoIcon',
            variant: 'danger',
          },
        });
      } else {
        const self = this;
        response.data.data.forEach((item) => {
          self.items.push(item);
        });
        this.totalRows = this.items.length;
        this.currentPage = 1;
      }
      this.fluxListLoading = false;
    },
    onFiltered(filteredItems) {
      // Trigger pagination to update the number of buttons/pages due to filtering
      this.totalRows = filteredItems.length;
      this.currentPage = 1;
    },
  },
};
</script>

<style>
.fluxnode-table td:nth-child(1) {
  padding: 0 0 0 5px;
}
.fluxnode-table th:nth-child(1) {
  padding: 0 0 0 5px;
}
</style>
