<template>
  <b-tabs>
    <b-tab
      active
      title="Outgoing"
    >
      <b-overlay
        :show="config.outgoing.loading"
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
                :sort-by="config.outgoing.sortBy"
                :sort-desc="config.outgoing.sortDesc"
                :sort-direction="config.outgoing.sortDirection"
                :filter="config.outgoing.filter"
                :filter-included-fields="config.outgoing.filterOn"
                show-empty
                empty-text="No Connected Nodes"
                @filtered="onFilteredOutgoing"
              >
                <template
                  v-if="privilege === 'admin' || privilege === 'fluxteam'"
                  #cell(disconnect)="row"
                >
                  <b-button
                    :id="`disconnect-peer-${row.item.ip}`"
                    size="sm"
                    class="mr-0"
                    variant="danger"
                  >
                    Disconnect
                  </b-button>
                  <confirm-dialog
                    :target="`disconnect-peer-${row.item.ip}`"
                    confirm-button="Disconnect Peer"
                    @confirm="disconnectPeer(row)"
                  />
                </template>
                <template #cell(lastPingTime)="data">
                  {{ new Date(data.item.lastPingTime).toLocaleString('en-GB', timeoptions) }}
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
              <span class="table-total">Total: {{ config.outgoing.totalRows }}</span>
            </b-col>
          </b-row>
        </b-card>
      </b-overlay>
      <b-card>
        <h4>Add Peer</h4>
        <div class="mt-1">
          IP address:
        </div>
        <b-form-input
          id="ip"
          v-model="addPeerIP"
          class="mb-2"
          placeholder="Enter IP address"
          type="text"
        />
        <div>
          <b-button
            variant="success"
            aria-label="Initiate connection"
            class="mb-2"
            @click="addPeer"
          >
            Initiate connection
          </b-button>
        </div>
      </b-card>
    </b-tab>
    <b-tab title="Incoming">
      <b-overlay
        :show="config.incoming.loading"
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
                :sort-by="config.incoming.sortBy"
                :sort-desc="config.incoming.sortDesc"
                :sort-direction="config.incoming.sortDirection"
                :filter="config.incoming.filter"
                :filter-included-fields="config.incoming.filterOn"
                show-empty
                empty-text="No Incoming Connections"
                @filtered="onFilteredIncoming"
              >
                <template
                  v-if="privilege === 'admin' || privilege === 'fluxteam'"
                  #cell(disconnect)="row"
                >
                  <b-button
                    :id="`disconnect-incoming-${row.item.ip}`"
                    size="sm"
                    class="mr-0"
                    variant="danger"
                  >
                    Disconnect
                  </b-button>
                  <confirm-dialog
                    :target="`disconnect-incoming-${row.item.ip}`"
                    confirm-button="Disconnect Incoming"
                    @confirm="disconnectIncoming(row)"
                  />
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
              <span class="table-total">Total: {{ config.incoming.totalRows }}</span>
            </b-col>
          </b-row>
        </b-card>
      </b-overlay>
    </b-tab>
  </b-tabs>
</template>

<script>
import { computed } from 'vue';
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
} from 'bootstrap-vue';
// import { mapState } from 'vuex';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';
import FluxService from '@/services/FluxService.js';

import timeoptions from '@/libs/dateFormat.js';

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
    ConfirmDialog,
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
          loading: true,
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
          loading: true,
        },
      },
      addPeerIP: '',
    };
  },
  setup() {
    const { ...mapState } = computed(() => {
      ('flux', [
        'privilege',
      ]);
    });

    return {
      mapState
    }
  },
  mounted() {
    this.fluxConnectedPeersInfo();
    this.fluxIncomingConnectionsInfo();
  },
  methods: {
    async fluxConnectedPeersInfo() {
      this.config.outgoing.loading = true;
      const response = await FluxService.connectedPeersInfo();
      console.log(response);
      if (response.data.status === 'success') {
        this.config.outgoing.connectedPeers = response.data.data;
        this.config.outgoing.totalRows = this.config.outgoing.connectedPeers.length;
        this.config.outgoing.currentPage = 1;
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      this.config.outgoing.loading = false;
    },
    async fluxIncomingConnectionsInfo() {
      this.config.incoming.loading = true;
      const response = await FluxService.incomingConnectionsInfo();
      if (response.data.status === 'success') {
        this.config.incoming.incomingConnections = response.data.data;
        this.config.incoming.totalRows = this.config.incoming.incomingConnections.length;
        this.config.incoming.currentPage = 1;
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      this.config.incoming.loading = false;
    },
    async disconnectPeer(row) {
      const self = this;
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await FluxService.removePeer(zelidauth, row.item.ip).catch((error) => {
        this.showToast('danger', error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        this.showToast(response.data.status, response.data.data.message || response.data.data);
        this.config.outgoing.loading = true;
        setTimeout(() => {
          self.fluxConnectedPeersInfo();
        }, 2500);
      } else {
        this.fluxConnectedPeersInfo();
      }
    },
    async disconnectIncoming(row) {
      const self = this;
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await FluxService.removeIncomingPeer(zelidauth, row.item.ip).catch((error) => {
        this.showToast('danger', error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        this.showToast(response.data.status, response.data.data.message || response.data.data);
        this.config.incoming.loading = true;
        setTimeout(() => {
          self.fluxIncomingConnectionsInfo();
        }, 2500);
      } else {
        self.fluxIncomingConnectionsInfo();
      }
    },
    async addPeer() {
      const self = this;
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await FluxService.addPeer(zelidauth, this.addPeerIP).catch((error) => {
        this.showToast('danger', error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        this.showToast(response.data.status, response.data.data.message || response.data.data);
        this.config.incoming.loading = true;
        setTimeout(() => {
          self.fluxConnectedPeersInfo();
        }, 2500);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
        self.fluxConnectedPeersInfo();
      }
    },
    onFilteredOutgoing(filteredItems) {
      // Trigger pagination to update the number of buttons/pages due to filtering
      this.config.outgoing.totalRows = filteredItems.length;
      this.config.outgoing.currentPage = 1;
    },
    onFilteredIncoming(filteredItems) {
      // Trigger pagination to update the number of buttons/pages due to filtering
      this.config.incoming.totalRows = filteredItems.length;
      this.config.incoming.currentPage = 1;
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
.fluxnetwork-outgoing-table th:nth-child(4) {
  width: 115px;
}
.fluxnetwork-incoming-table th:nth-child(2) {
  width: 115px;
}
</style>
