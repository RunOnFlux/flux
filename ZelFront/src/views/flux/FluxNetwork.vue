<template>
  <b-tabs>
    <b-tab
      active
      title="Outgoing"
    >
      <b-overlay
        :show="config.outgoing.connectedPeers.length === 0"
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
                  v-model="config.outgoing.perPage"
                  size="sm"
                  :options="config.outgoing.pageOptions"
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
                    v-model="config.outgoing.filter"
                    type="search"
                    placeholder="Type to Search"
                  />
                  <b-input-group-append>
                    <b-button
                      :disabled="!config.outgoing.filter"
                      @click="config.outgoing.filter = ''"
                    >
                      Clear
                    </b-button>
                  </b-input-group-append>
                </b-input-group>
              </b-form-group>
            </b-col>

            <b-col cols="12">
              <b-table
                class="fluxnetwork-outgoing-table"
                striped
                hover
                responsive
                :per-page="config.outgoing.perPage"
                :current-page="config.outgoing.currentPage"
                :items="config.outgoing.connectedPeers"
                :fields="config.outgoing.fields"
                :sort-by.sync="config.outgoing.sortBy"
                :sort-desc.sync="config.outgoing.sortDesc"
                :sort-direction="config.outgoing.sortDirection"
                :filter="config.outgoing.filter"
                :filter-included-fields="config.outgoing.filterOn"
                show-empty
                empty-text="No Connected Nodes"
                @filtered="onFilteredOutgoing"
              >
                <template #cell(disconnect)="row">
                  <b-button
                    size="sm"
                    class="mr-0"
                    variant="danger"
                    @click="disconnectPeer(row)"
                  >
                    Disconnect
                  </b-button>
                </template>
              </b-table>
            </b-col>

            <b-col cols="12">
              <b-pagination
                v-model="config.outgoing.currentPage"
                :total-rows="config.outgoing.totalRows"
                :per-page="config.outgoing.perPage"
                align="center"
                size="sm"
                class="my-0"
              />
            </b-col>
          </b-row>
        </b-card>
      </b-overlay>
    </b-tab>
    <b-tab title="Incoming">
      <b-overlay
        :show="config.incoming.incomingConnections.length === 0"
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
                  v-model="config.incoming.perPage"
                  size="sm"
                  :options="config.incoming.pageOptions"
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
                    v-model="config.incoming.filter"
                    type="search"
                    placeholder="Type to Search"
                  />
                  <b-input-group-append>
                    <b-button
                      :disabled="!config.incoming.filter"
                      @click="config.incoming.filter = ''"
                    >
                      Clear
                    </b-button>
                  </b-input-group-append>
                </b-input-group>
              </b-form-group>
            </b-col>

            <b-col cols="12">
              <b-table
                class="fluxnetwork-incoming-table"
                striped
                hover
                responsive
                :per-page="config.incoming.perPage"
                :current-page="config.incoming.currentPage"
                :items="config.incoming.incomingConnections"
                :fields="config.incoming.fields"
                :sort-by.sync="config.incoming.sortBy"
                :sort-desc.sync="config.incoming.sortDesc"
                :sort-direction="config.incoming.sortDirection"
                :filter="config.incoming.filter"
                :filter-included-fields="config.incoming.filterOn"
                show-empty
                empty-text="No Incoming Connections"
                @filtered="onFilteredIncoming"
              >
                <template #cell(disconnect)="row">
                  <b-button
                    size="sm"
                    class="mr-0"
                    variant="danger"
                    @click="disconnectIncoming(row)"
                  >
                    Disconnect
                  </b-button>
                </template>
              </b-table>
            </b-col>

            <b-col cols="12">
              <b-pagination
                v-model="config.incoming.currentPage"
                :total-rows="config.incoming.totalRows"
                :per-page="config.incoming.perPage"
                align="center"
                size="sm"
                class="my-0"
              />
            </b-col>
          </b-row>
        </b-card>
      </b-overlay>
    </b-tab>
  </b-tabs>
</template>

<script>
import {
  BTabs,
  BTab,
  BTable,
  BCol,
  BCard,
  BRow,
  BFormGroup,
  BFormInput,
  BFormSelect,
  BInputGroup,
  BInputGroupAppend,
  BButton,
  BPagination,
  BOverlay,
} from 'bootstrap-vue'
import FluxService from '@/services/FluxService'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'

const timeoptions = require('@/libs/dateFormat')

export default {
  components: {
    BTabs,
    BTab,
    BTable,
    BCol,
    BCard,
    BRow,
    BFormGroup,
    BFormInput,
    BFormSelect,
    BInputGroup,
    BInputGroupAppend,
    BButton,
    BPagination,
    BOverlay,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  data() {
    return {
      timeoptions,
      config: {
        outgoing: {
          perPage: 10,
          pageOptions: [10, 25, 50, 100],
          sortBy: '',
          sortDesc: false,
          sortDirection: 'asc',
          connectedPeers: [],
          filter: '',
          filterOn: [],
          fields: [
            { key: 'ip', label: 'IP Address', sortable: true },
            { key: 'latency', label: 'Latency', sortable: true },
            { key: 'lastPingTime', label: 'Last Ping', sortable: true },
            { key: 'disconnect', label: '' },
          ],
          totalRows: 1,
          currentPage: 1,
        },
        incoming: {
          perPage: 10,
          pageOptions: [10, 25, 50, 100],
          sortBy: '',
          sortDesc: false,
          sortDirection: 'asc',
          incomingConnections: [],
          filter: '',
          filterOn: [],
          fields: [
            { key: 'ip', label: 'IP Address', sortable: true },
            { key: 'disconnect', label: '' },
          ],
          totalRows: 1,
          currentPage: 1,
        },
      },
    }
  },
  mounted() {
    this.fluxConnectedPeersInfo()
    this.fluxIncomingConnectionsInfo()
  },
  methods: {
    async fluxConnectedPeersInfo() {
      const response = await FluxService.connectedPeersInfo()
      if (response.data.status === 'success') {
        const self = this
        response.data.data.forEach(item => {
          self.config.outgoing.connectedPeers.push(item)
        })
        this.config.outgoing.totalRows = this.config.outgoing.connectedPeers.length
        this.config.outgoing.currentPage = 1
      } else {
        this.$toast({
          component: ToastificationContent,
          props: {
            title: response.data.data.message || response.data.data,
            icon: 'InfoIcon',
            variant: 'danger',
          },
        })
      }
    },
    async fluxIncomingConnectionsInfo() {
      const response = await FluxService.incomingConnectionsInfo()
      if (response.data.status === 'success') {
        const self = this
        response.data.data.forEach(item => {
          self.config.incoming.incomingConnections.push(item)
        })
        this.config.incoming.totalRows = this.config.incoming.incomingConnections.length
        this.config.incoming.currentPage = 1
      } else {
        this.$toast({
          component: ToastificationContent,
          props: {
            title: response.data.data.message || response.data.data,
            icon: 'InfoIcon',
            variant: 'danger',
          },
        })
      }
    },
    disconnectPeer(row) {
      const self = this
      const zelidauth = localStorage.getItem('zelidauth')
      FluxService.removePeer(zelidauth, row.item.ip)
        .then(response => {
          console.log(response)
          this.$toast({
            component: ToastificationContent,
            props: {
              title: response.data.data.message || response.data.data,
              icon: 'InfoIcon',
              variant: response.data.status,
            },
          })
          setTimeout(() => {
            self.fluxConnectedPeersInfo()
          }, 2000)
        })
        .catch(e => {
          console.log(e)
          this.$toast({
            component: ToastificationContent,
            props: {
              title: e.toString(),
              icon: 'InfoIcon',
              variant: 'danger',
            },
          })
        })
    },
    disconnectIncoming(row) {
      const self = this
      const zelidauth = localStorage.getItem('zelidauth')
      FluxService.removeIncomingPeer(zelidauth, row.item.ip)
        .then(response => {
          this.$toast({
            component: ToastificationContent,
            props: {
              title: response.data.data.message || response.data.data,
              icon: 'InfoIcon',
              variant: response.data.status,
            },
          })
          setTimeout(() => {
            self.fluxIncomingConnectionsInfo()
          }, 2000)
        })
        .catch(e => {
          console.log(e)
          this.$toast({
            component: ToastificationContent,
            props: {
              title: e.toString(),
              icon: 'InfoIcon',
              variant: 'danger',
            },
          })
        })
    },
    onFilteredOutgoing(filteredItems) {
      // Trigger pagination to update the number of buttons/pages due to filtering
      this.config.outgoing.totalRows = filteredItems.length
      this.config.outgoing.currentPage = 1
    },
    onFilteredIncoming(filteredItems) {
      // Trigger pagination to update the number of buttons/pages due to filtering
      this.config.incoming.totalRows = filteredItems.length
      this.config.incoming.currentPage = 1
    },
  },
}
</script>

<style>
.fluxnetwork-outgoing-table th:nth-child(4) {
  width: 115px;
}
.fluxnetwork-incoming-table th:nth-child(2) {
  width: 115px;
}
</style>
