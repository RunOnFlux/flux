<template>
  <div>
    <b-card>
      <b-row>
        <b-col align="center">
          1 Min Requests: {{ oneMinuteRequests }}
        </b-col>
        <b-col align="center">
          5 Min Minute Requests: {{ fiveMinuteRequests }}
        </b-col>
        <b-col align="center">
          15 min Requests: {{ fifteenMinuteRequests }}
        </b-col>
      </b-row>
    </b-card>
    <b-container fluid class="p-0 wrapper">
      <b-table
        ref="primaryTable"
        v-model="currentItems"
        caption="Outbound Requests"
        caption-top
        table-variant="secondary"
        class="primary-table"
        :items="primaryRows"
        :fields="primaryFields"
        bordered
        responsive
        sticky-header="500px"
        primary-key="origin"
        no-border-collapse
        show-empty
      >
        <template #cell(lastSeen)="row">
          {{ timestampToLastSeen(row.item.lastSeen) }}
        </template>
        <template #cell(action)="{ detailsShowing, item }">
          <b-btn
            class="action-button"
            variant="link"
            @click="toggleDetails(item)"
          >
            <b-icon :icon="detailsShowing ? 'eye-slash' : 'eye'" />
            {{ detailsShowing ? 'Hide' : 'Show' }}
          </b-btn>
        </template>
        <template #row-details="{ item }">
          <b-table
            :ref="`requestsTable_${item.target}`"
            :items="item.requests"
            :fields="secondaryFields"
            bordered
            hover
            fixed
            sticky-header
            primary-key="id"
            no-border-collapse
            @scroll.native="onScroll($event, item.target)"
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
      refreshTimer: null,
      autoScroll: {},
      socket: null,
      requests: {},
      primaryRows: [],
      secondaryRows: [],
      currentItems: [],
      primaryFields: [
        { key: 'target' },
        { key: 'count' },
        { key: 'lastSeen' },
        { key: 'action', class: 'action-col' },
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
      const timestamp = Date.now() - 60_000;
      return this.requestsSinceTimestamp(timestamp);
    },
    fiveMinuteRequests() {
      const timestamp = Date.now() - 60_000 * 5;
      return this.requestsSinceTimestamp(timestamp);
    },
    fifteenMinuteRequests() {
      const timestamp = Date.now() - 60_000 * 15;
      return this.requestsSinceTimestamp(timestamp);
    },
  },
  mounted() {
    if (!this.socket) this.connectSocket();
    this.refreshTimer = setInterval(() => {
      this.$refs.primaryTable.refresh();
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
      const lastSeenSeconds = (Date.now() - timestamp) / 1000;
      const lastSeen = new Date(lastSeenSeconds * 1000).toISOString().substring(11, 19);
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
      console.log('ADD ID', requestData.id);

      if (!(origin in this.requests)) {
        // not required for reacivity anymore
        this.$set(this.requests, origin, []);
      }

      this.requests[origin].push(requestData);
      const rowData = this.generatePrimaryRow(origin);

      if (this.autoScroll[origin]) {
        // add only scroll if not in view
        this.$nextTick(() => { this.scrollToRow(origin, this.requests[origin].length - 1); });
      }

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

      console.log('REMOVE ID', id);

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
        console.log('NO MORE ROWS');
        delete this.requests[origin];

        console.log('PRIMARY INDEX', primaryIndex);
        this.primaryRows.splice(primaryIndex, 1);
      }
    },
    connectSocket() {
      const { protocol, hostname, port } = window.location;
      // fix this
      const apiPort = +port + 1;
      const url = `${protocol}//${hostname}:${apiPort}/debug`;
      // const url = 'http://127.0.0.1:3333/debug';

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
    requestsByTarget(target) {
      return this.requests[target].map((t) => {
        const { timestamp: unix, method: verb, ...rest } = t;
        const fullDate = new Date(unix);
        const timestamp = fullDate.toUTCString();
        return { timestamp, ...rest };
      });
    },
    latestRequest(target) {
      const max = this.requests[target].reduce(
        (prev, current) => (prev && prev.timestamp > current.timestamp ? prev : current),
      );
      return max;
    },
    toggleDetails(row) {
      Object.keys(this.autoScroll).forEach((k) => { this.autoScroll[k] = false; });

      // eslint-disable-next-line
      if (row._showDetails) {
        this.$set(row, '_showDetails', false);
      } else {
        this.currentItems.forEach((item) => {
          this.$set(item, '_showDetails', false);
        });

        this.$nextTick(() => {
          this.$set(row, '_showDetails', true);
        });
      }
    },
    onScroll(event, origin) {
      const { target: { scrollTop, clientHeight, scrollHeight } } = event;

      // why does scrollTop have an extra 0.5???
      this.autoScroll[origin] = scrollTop + clientHeight + 1 >= scrollHeight;
    },
    scrollToRow(origin, index) {
      const ref = `requestsTable_${origin}`;
      const tbody = this.$refs[ref].$el.querySelector('tbody');
      const row = tbody.querySelectorAll('tr')[index];
      row.scrollIntoView();
    },
  },
};
</script>

<style>
.action-col {
  width: 30px;
}
.action-button {
  height: 30px;
  padding: 0;
}
</style>
