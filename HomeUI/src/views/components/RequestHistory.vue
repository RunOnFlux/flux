<template>
  <div>
    <b-card>
      <b-row>
        <b-col align="center">
          1 Min Requests: {{ oneMinuteRequests }}
        </b-col>
        <b-col align="center">
          5 Min Requests: {{ fiveMinuteRequests }}
        </b-col>
        <b-col align="center">
          15 Min Requests: {{ fifteenMinuteRequests }}
        </b-col>
        <b-col align="center">
          Total Requests: {{ totalRequests }}
        </b-col>
      </b-row>
    </b-card>
    <b-container fluid class="p-0 wrapper">
      <b-table
        ref="primaryTable"
        caption="Outbound Requests"
        caption-top
        table-variant="secondary"
        class="primary-table"
        :items="primaryRows"
        :fields="primaryFields"
        bordered
        responsive
        sticky-header="100%"
        primary-key="target"
        hover
        fixed
        no-border-collapse
        show-empty
        @row-clicked="onRowClicked"
      >
        <template #cell(lastSeen)="row">
          {{ timestampToLastSeen(row.item.lastSeen) }}
        </template>
        <template #row-details="{ item }">
          <b-table
            :ref="`requestsTable_${item.target}`"
            :items="item.requests"
            :fields="secondaryFields"
            no-border-collapse
            fixed
            small
            sticky-header="400px"
            primary-key="id"
          >
            <template #cell(timestamp)="row">
              {{ new Date(row.item.timestamp).toISOString() }}
            </template>
          </b-table>
        </template>
      </b-table>
    </b-container>
  </div>
</template>

<script>
import {} from 'bootstrap-vue';
import io from 'socket.io-client';

export default {
  components: {},
  data() {
    return {
      accessViaIp: false,
      refreshTimer: null,
      socket: null,
      now: Date.now(),
      totalRequests: 0,
      targets: {},
      primaryRows: [],
      secondaryRows: [],
      detailsRow: null,
      primaryFields: [
        { key: 'target' },
        { key: 'count', class: 'small-col' },
        { key: 'lastSeen', class: 'small-col' },
      ],
      secondaryFields: [
        { key: 'verb' },
        { key: 'params' },
        { key: 'timeout' },
        { key: 'timestamp' },
      ],
    };
  },
  computed: {
    oneMinuteRequests() {
      const timestamp = this.now - 60_000;
      return this.requestsSinceTimestamp(timestamp);
    },
    fiveMinuteRequests() {
      const timestamp = this.now - 60_000 * 5;
      return this.requestsSinceTimestamp(timestamp);
    },
    fifteenMinuteRequests() {
      const timestamp = this.now - 60_000 * 15;
      return this.requestsSinceTimestamp(timestamp);
    },
  },
  beforeMount() {
    // we only want to connect via node direct, as debug is specific to a node
    // i.e. you need to have the debug flag turned on
    const { hostname } = window.location;
    this.accessViaIp = !/[a-z]/i.test(hostname);
  },
  mounted() {
    if (!this.socket && this.accessViaIp) this.connectSocket();
    this.refreshTimer = setInterval(() => {
      this.now = Date.now();
    }, 5_000);
  },
  unmounted() {
    if (this.socket) this.socket.disconnect();
    clearInterval(this.refreshTimer);
  },
  methods: {
    requestsSinceTimestamp(timestamp) {
      return Object.values(this.targets).flatMap(
        (group) => group.filter((request) => request.timestamp > timestamp),
      ).length;
    },
    timestampToLastSeen(timestamp) {
      // due to clock differences (and we're only updating every 5sec), this can be negative
      const lastSeenMs = Math.max(this.now - timestamp, 0);
      const lastSeen = new Date(lastSeenMs).toISOString().substring(11, 19);

      return lastSeen;
    },
    generatePrimaryRow(target) {
      const requests = this.targets[target];
      const count = requests.length;
      const { timestamp: lastSeen } = this.latestRequest(target);

      const rowItem = {
        target, lastSeen, count, requests,
      };
      return rowItem;
    },
    historyAddedHandler(event) {
      this.primaryRows.length = 0;
      this.targets = event;

      Object.keys(this.targets).forEach((target) => {
        this.primaryRows.push(this.generatePrimaryRow(target));
      });

      this.totalRequests = Object.values(this.targets).reduce((total, current) => total + current.length, 0);
    },
    requestAddedHandler(event) {
      const { target, requestData } = event;

      if (!(target in this.targets)) {
        this.targets[target] = [];
      }

      this.targets[target].push(requestData);
      const rowData = this.generatePrimaryRow(target);

      const existingRow = this.primaryRows.find((r) => r.target === target);

      if (!existingRow) {
        this.primaryRows.push(rowData);
      } else {
        existingRow.count = rowData.count;
        existingRow.lastSeen = rowData.lastSeen;
        // requests is a reference of the object's requests, so don't need to update
      }
      this.totalRequests += 1;
    },
    requestRemovedHandler(event) {
      const { target, id } = event;

      if (!(target in this.targets)) return;

      const requests = this.targets[target];

      const index = requests.findIndex((r) => r.id === id);
      // Do we need to validate this index?
      const primaryIndex = this.primaryRows.findIndex((r) => r.target === target);

      if (index === -1) {
        console.log('Unknown request, skipping');
        return;
      }

      requests.splice(index, 1);
      this.primaryRows[primaryIndex].count -= 1;

      if (!requests.length) {
        delete this.targets[target];

        this.primaryRows.splice(primaryIndex, 1);
      }

      this.totalRequests -= 1;
    },
    connectSocket() {
      const { protocol, hostname, port } = window.location;
      // Use this for testing
      const apiPort = hostname === '127.0.0.1' ? 3333 : +port + 1;
      const url = `${protocol}//${hostname}:${apiPort}/debug`;

      const fluxAuthString = localStorage.getItem('zelidauth');

      if (!fluxAuthString) return;

      this.socket = io(url, {
        query: {
          roomName: 'outboundHttp',
          authDetails: fluxAuthString,
        },
        autoConnect: false,
      });
      this.socket.on('connect', () => {
        console.log('connected');
      });

      this.socket.on('addHistory', (history) => this.historyAddedHandler(history));
      this.socket.on('addRequest', (request) => this.requestAddedHandler(request));
      this.socket.on('removeRequest', (request) => this.requestRemovedHandler(request));

      // this.socket.onAny((event, ...args) => {
      //   console.log(`got ${event}`, ...args);
      // });

      this.socket.connect();
    },
    latestRequest(target) {
      const max = this.targets[target].reduce(
        (prev, current) => (prev && prev.timestamp > current.timestamp ? prev : current),
      );
      return max;
    },
    onRowClicked(item) {
      const { detailsRow } = this;
      if (detailsRow && detailsRow !== item) {
        // eslint-disable-next-line no-underscore-dangle
        detailsRow._showDetails = false;
      }

      // eslint-disable-next-line no-underscore-dangle
      this.$set(item, '_showDetails', !item._showDetails);
      this.detailsRow = item;
    },
  },
};
</script>

<style>
.small-col {
  width: 20%;
}
</style>
