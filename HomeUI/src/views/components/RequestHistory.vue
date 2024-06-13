<template>
  <div>
    <b-container fluid class="p-0 wrapper">
      <b-table
        v-model="currentItems"
        caption="Outbound Requests"
        caption-top
        table-variant="secondary"
        class="primary-table"
        :items="rowItems"
        :fields="primaryFields"
        bordered
        responsive
        sticky-header="500px"
        show-empty
      >
        <template #cell(action)="{ detailsShowing, item }">
          <b-btn
            variant="link"
            @click="toggleDetails(item)"
          >
            <b-icon :icon="detailsShowing ? 'eye-slash' : 'eye'" />
            {{ detailsShowing ? 'Hide' : 'Show' }}
          </b-btn>
        </template>
        <template #row-details="{ item }">
          <b-table
            :items="requestsByTarget(item.target)"
            :fields="secondaryFields"
            bordered
            hover
            fixed
            sticky-header
          />
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
    // const now = Date.now();
    return {
      socket: null,
      requests: {
        // 'http://weiner.com': [
        //   {
        //     id: 1,
        //     params: 26,
        //     verb: 'GET',
        //     timeout: 20_000,
        //     timestamp: now - 1_730_000,
        //   },
        //   {
        //     id: 4,
        //     params: 27,
        //     verb: 'GET',
        //     timeout: 20_000,
        //     timestamp: now - 1_630_000,
        //   },
        //   {
        //     id: 77,
        //     params: 28,
        //     verb: 'GET',
        //     timeout: 20_000,
        //     timestamp: now - 1_530_000,
        //   },
        //   {
        //     id: 21,
        //     params: 29,
        //     verb: 'GET',
        //     timeout: 20_000,
        //     timestamp: now - 1_430_000,
        //   },
        //   {
        //     id: 41,
        //     params: 31,
        //     verb: 'GET',
        //     timeout: 20_000,
        //     timestamp: now - 1_340_000,
        //   },
        // ],
        // 'https://chav.gravy.superlongurlhere:43533': [
        //   {
        //     id: 3,
        //     params: 9,
        //     verb: 'POST',
        //     timeout: 20_000,
        //     timestamp: now - 1_800_000,
        //   },
        // ],
        // 'https://beaver.com': [
        //   {
        //     id: 3,
        //     params: 71,
        //     verb: 'GET',
        //     timeout: 6_000,
        //     timestamp: now - 1_740_000,
        //   },
        //   {
        //     id: 3,
        //     params: 71,
        //     verb: 'GET',
        //     timeout: 6_000,
        //     timestamp: now - 1_620_000,
        //   },
        //   {
        //     id: 3,
        //     params: 71,
        //     verb: 'GET',
        //     timeout: 6_000,
        //     timestamp: now - 1_300_000,
        //   },
        //   {
        //     id: 3,
        //     params: 71,
        //     verb: 'GET',
        //     timeout: 6_000,
        //     timestamp: now - 1_101_000,
        //   },
        //   {
        //     id: 3,
        //     params: 71,
        //     verb: 'GET',
        //     timeout: 6_000,
        //     timestamp: now - 880_000,
        //   },
        //   {
        //     id: 3,
        //     params: 71,
        //     verb: 'GET',
        //     timeout: 6_000,
        //     timestamp: now - 710_000,
        //   },
        //   {
        //     id: 3,
        //     params: 71,
        //     verb: 'GET',
        //     timeout: 6_000,
        //     timestamp: now - 660_000,
        //   },
        //   {
        //     id: 3,
        //     params: 71,
        //     verb: 'GET',
        //     timeout: 6_000,
        //     timestamp: now - 122_000,
        //   },
        // ],
      },
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
    rowItems() {
      const targets = Object.keys(this.requests);
      return targets.map((target) => {
        const count = this.requests[target].length;
        const { timestamp } = this.latestRequest(target);
        const lastSeenSeconds = Date.now() - timestamp;
        const lastSeen = new Date(lastSeenSeconds * 1000).toISOString().substring(11, 19);
        const rowItem = { target, lastSeen, count };
        return rowItem;
      });
    },
  },
  mounted() {
    if (!this.socket) this.connectSocket();
  },
  unmounted() {
    if (this.socket) this.socket.disconnect();
  },
  methods: {
    requestAddedHandler(event) {
      const { origin, requestData } = event;
      if (!(origin in this.requests)) this.requests[origin] = [];
      this.requests[origin].push(requestData);
    },
    requestRemovedHandler(event) {
      const { origin, id } = event;

      this.requests[origin] = this.requests[origin].filter((r) => r.id !== id);
      if (!this.requests[origin].length) delete this.requests[origin];
    },
    connectSocket() {
      const { protocol, hostname, port } = window.location;
      // fix this
      const apiPort = port + 1;
      const url = `${protocol}//${hostname}:${apiPort}/debug`;

      console.log('URL', url);

      this.socket = io(url, {
        query: {
          roomName: 'outboundHttp',
        },
        autoConnect: false,
      });
      this.socket.on('connect', () => {
        console.log('connected');
      });

      this.socket.on('requestAdded', (request) => this.requestAddedHandler(request));
      this.socket.on('requestRemoved', (request) => this.requestRemovedHandler(request));

      this.socket.onAny((event, ...args) => {
        console.log(`got ${event}`, ...args);
      });

      this.socket.connect();
    },
    requestsByTarget(target) {
      return this.requests[target].map((t) => {
        const { timestamp: unix, ...rest } = t;
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
    // otherRequests(target) {
    //   const latest = this.latestRequest(target);
    //   const requests = this.requests[target];
    //   const others = requests.filter((t) => t.id !== latest.id);
    //   return others;
    // },
    // otherRequestCount(target) {
    //   console.log('ME TARGO', target);
    //   return this.exceptLatestRequest(target).length;
    // },
    // hasOtherRequests(row) {
    //   return Boolean(this.otherRequestCount(row.target));
    // },
    toggleDetails(row) {
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
  },
};
</script>

<style>
.action-col {
  width: 30px;
}
td {
  height: 60px;
}
/* .wrapper {
 min-height: 400px;
} */
</style>
