<template>
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
          :sort-by.sync="sortBy"
          :sort-desc.sync="sortDesc"
          :sort-direction="sortDirection"
          :filter="filter"
          :filter-included-fields="filterOn"
          show-empty
          empty-text="No FluxNodes in DOS state"
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
          <template #row-details="row">
            <b-card class="mx-2">
              <list-entry
                v-if="row.item.collateral"
                title="Collateral"
                :data="row.item.collateral"
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
</template>

<script>
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
} from 'bootstrap-vue'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'
import ListEntry from '@/views/components/ListEntry.vue'
import DaemonService from '@/services/DaemonService'

const timeoptions = require('@/libs/dateFormat')

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
        { key: 'added_height', label: 'Added Height', sortable: true },
        { key: 'eligible_in', label: 'Eligible In Blocks', sortable: true },
      ],
      totalRows: 1,
      currentPage: 1,
    }
  },
  computed: {
    sortOptions() {
      // Create an options list from our fields
      return this.fields
        .filter(f => f.sortable)
        .map(f => ({ text: f.label, value: f.key }))
    },
  },
  mounted() {
    this.daemonGetDOSList()
  },
  methods: {
    async daemonGetDOSList() {
      const response = await DaemonService.getDOSList()
      if (response.data.status === 'error') {
        this.$toast({
          component: ToastificationContent,
          props: {
            title: response.data.data.message || response.data.data,
            icon: 'InfoIcon',
            variant: 'danger',
          },
        })
      } else {
        const self = this
        response.data.data.forEach(item => {
          self.items.push(item)
        })
        this.totalRows = this.items.length
        this.currentPage = 1
      }
    },
    onFiltered(filteredItems) {
      // Trigger pagination to update the number of buttons/pages due to filtering
      this.totalRows = filteredItems.length
      this.currentPage = 1
    },
  },
}
</script>

<style>
.fluxnode-table td:nth-child(1) {
  padding: 0 0 0 5px;
}
.fluxnode-table th:nth-child(1) {
  padding: 0 0 0 5px;
}
</style>
