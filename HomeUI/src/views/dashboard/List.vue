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
            striped
            hover
            responsive
            :per-page="perPage"
            :current-page="currentPage"
            :items="items"
            :fields="fields"
            :sort-by.sync="sortBy"
            :sort-desc.sync="sortDesc"
            :sort-direction="sortDirection"
            :filter="filter"
            :filter-included-fields="filterOn"
            @filtered="onFiltered"
          >
            <template #cell(lastpaid)="data">
              {{ new Date(Number(data.item.lastpaid) * 1000).toLocaleString("en-GB", timeoptions) }}
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
        </b-col>
      </b-row>
    </b-card>
  </b-overlay>
</template>

<script>
import {
  BCard, BTable, BRow, BCol, BFormGroup, BFormSelect, BPagination, BInputGroup, BFormInput, BInputGroupAppend, BButton,
  BOverlay,
} from 'bootstrap-vue';
import DashboardService from '@/services/DashboardService';

const axios = require('axios');

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
  },
  data() {
    return {
      timeoptions: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
      fluxListLoading: true,
      perPage: 10,
      pageOptions: [10, 25, 50, 100, 1000],
      sortBy: '',
      sortDesc: false,
      sortDirection: 'asc',
      items: [],
      filter: '',
      filterOn: [],
      fields: [
        { key: 'ip', label: 'IP Address', sortable: true },
        { key: 'payment_address', label: 'Address', sortable: true },
        {
          key: 'location.country',
          label: 'Country',
          sortable: true,
          formatter: this.formatTableEntry,
        },
        {
          key: 'location.org',
          label: 'Provider',
          sortable: true,
          formatter: this.formatTableEntry,
        },
        { key: 'lastpaid', label: 'Last Paid', sortable: true },
        { key: 'tier', label: 'Tier', sortable: true },
      ],
      totalRows: 1,
      currentPage: 1,
    };
  },
  computed: {
    sortOptions() {
      // Create an options list from our fields
      return this.fields
        .filter((f) => f.sortable)
        .map((f) => ({ text: f.label, value: f.key }));
    },
  },
  mounted() {
    this.getFluxList();
  },
  methods: {
    formatTableEntry(value) {
      if (!value) {
        return 'Unknown';
      }
      return value;
    },
    async getFluxList() {
      try {
        this.fluxListLoading = true;
        const resLoc = await axios.get('https://stats.runonflux.io/fluxlocations');
        const locations = resLoc.data.data;
        const resList = await DashboardService.listZelNodes();
        const fluxList = resList.data.data;
        const adjustedFluxList = [];
        fluxList.forEach((node) => {
          const adjustedNode = node;
          adjustedNode.location = locations.find((location) => location.ip === adjustedNode.ipadjustedNode.ip.split(':')[0]);
          adjustedFluxList.push(adjustedNode);
        });
        this.items = adjustedFluxList.filter((node) => node.ip);
        this.totalRows = this.items.length;
        this.currentPage = 1;
        this.fluxListLoading = false;
        console.log(this.items);
      } catch (error) {
        console.log(error);
      }
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

</style>
