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
          1 Hour Requests: {{ totalRequests }}
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
        primary-key="origin"
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
      now: Date.now(),
      accessViaIp: false,
      refreshTimer: null,
      socket: null,
      requests: {},
      primaryRows: [],
      secondaryRows: [],
      detailsRow: null,
      primaryFields: [
        { key: 'target' },
        { key: 'count', class: 'small-col', max: 80 },
        { key: 'lastSeen', class: 'small-col', max: 80 },
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
    totalRequests() {
      return Object.values(this.requests).reduce((total, current) => total + current.length, 0);
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
      return Object.values(this.requests).flatMap(
        (group) => group.filter((request) => request.timestamp > timestamp),
      ).length;
    },
    timestampToLastSeen(timestamp) {
      // due to clock differences (and we're only updating every 5sec), this can be negative
      const lastSeenMs = Math.max(this.now - timestamp, 0);
      const lastSeen = new Date(lastSeenMs).toISOString().substring(11, 19);

      return lastSeen;
    },
    generatePrimaryRow(origin) {
      const requests = this.requests[origin];
      const count = requests.length;
      const { timestamp: lastSeen } = this.latestRequest(origin);

      const rowItem = {
        target: origin, lastSeen, count, requests,
      };
      return rowItem;
    },
    historyAddedHandler(event) {
      this.primaryRows.length = 0;
      this.requests = event;

      Object.keys(this.requests).forEach((origin) => {
        this.primaryRows.push(this.generatePrimaryRow(origin));
      });
    },
    requestAddedHandler(event) {
      const { origin, requestData } = event;

      if (!(origin in this.requests)) {
        this.requests[origin] = [];
      }

      this.requests[origin].push(requestData);
      const rowData = this.generatePrimaryRow(origin);

      const existingRow = this.primaryRows.find((r) => r.target === origin);

      if (!existingRow) {
        this.primaryRows.push(rowData);
      } else {
        existingRow.count = rowData.count;
        existingRow.lastSeen = rowData.lastSeen;
        // requests is a reference of the object's requests, so don't need to update
      }
    },
    requestRemovedHandler(event) {
      const { origin, id } = event;

      if (!(origin in this.requests)) return;

      const requests = this.requests[origin];

      const index = requests.findIndex((r) => r.id === id);
      // Do we need to validate this index?
      const primaryIndex = this.primaryRows.findIndex((r) => r.target === origin);

      if (index === -1) {
        console.log('UNKNOWN INDEX, returning');
        return;
      }

      requests.splice(index, 1);
      this.primaryRows[primaryIndex].count -= 1;

      if (!requests.length) {
        delete this.requests[origin];

        this.primaryRows.splice(primaryIndex, 1);
      }
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
      const max = this.requests[target].reduce(
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
