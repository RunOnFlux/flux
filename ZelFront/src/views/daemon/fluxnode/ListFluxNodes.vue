<template>
  <b-card>
    <b-row>
      <b-col md="4" sm="4" class="my-1">
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
      <b-col md="8" class="my-1">
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
</template>

<script>
import {
  BCard, BTable, BRow, BCol, BFormGroup, BFormSelect, BPagination, BInputGroup, BFormInput, BInputGroupAppend, BButton,
} from 'bootstrap-vue'
import DaemonService from '@/services/DaemonService'

export default {
  data() {
    return {
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
        { key: 'payment_address', label: 'Address', sortable: true },
        { key: 'ip', label: 'IP', sortable: true },
        { key: 'tier', label: 'Tier', sortable: true },
        { key: 'added_height', label: 'Added Height', sortable: true },
      ],
      totalRows: 1,
      currentPage: 1,
    }
  },
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
    this.daemonListZelNodes()
  },
  methods: {
    async daemonListZelNodes() {
      const response = await DaemonService.listZelNodes()
      if (response.data.status === 'error') {
        // vue.$customMes.error(response.data.data.message || response.data.data)
        console.error(response)
      } else {
        const self = this
        response.data.data.forEach(item => {
          if (item.status === 'expired') {
            console.log(item)
          } else {
            self.items.push(item)
          }
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

</style>
