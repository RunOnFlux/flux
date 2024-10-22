<template>
  <div>
    <h3 class="no-wrap align-items-center justify-content-center">
      <kbd class="alert-info d-flex" style="border-radius: 15px; font-family: monospace; padding-right: 100%">
        <b-icon
          scale="1"
          icon="pin-map-fill"
          style="margin-top: 2px; margin-left: 10px;"
        />
        <span style="margin-left: 10px;">Locations</span>
      </kbd>
    </h3>
    <b-row>
      <b-col class="p-0 m-0">
        <div class="map">
          <flux-map
            class="mb-0"
            :show-all="false"
            :nodes="allNodesLocations"
            :filter-nodes="mapLocations"
            @nodes-updated="nodesUpdated"
          />
        </div>
      </b-col>
    </b-row>
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
            v-model="appLocationOptions.perPage"
            size="sm"
            :options="appLocationOptions.pageOptions"
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
              v-model="appLocationOptions.filter"
              type="search"
              placeholder="Type to Search"
            />
            <b-input-group-append>
              <b-button
                :disabled="!appLocationOptions.filter"
                @click="appLocationOptions.filter = ''"
              >
                Clear
              </b-button>
            </b-input-group-append>
          </b-input-group>
        </b-form-group>
      </b-col>

      <b-col cols="12">
        <b-table
          class="locations-table"
          borderless
          :per-page="appLocationOptions.perPage"
          :current-page="appLocationOptions.currentPage"
          :items="appLocations"
          :fields="appLocationFields"
          :filter="appLocationOptions.filter"
          thead-class="d-none"
          show-empty
          sort-icon-left
          empty-text="No instances found..."
        >
          <template #cell(ip)="locationRow">
            <div class="no-wrap">
              <kbd class="alert-info" style="border-radius: 15px;">
                <b-icon
                  scale="1.1"
                  icon="hdd-network-fill"
                /></kbd>
              &nbsp;<kbd class="alert-success no-wrap" style="border-radius: 15px;">
                <b>&nbsp;&nbsp;{{ locationRow.item.ip }}&nbsp;&nbsp;</b>
              </kbd>
            </div>
          </template>
          <template #cell(visit)="locationRow">
            <div class="d-flex justify-content-end">
              <b-button
                v-b-tooltip.hover.top="'Visit App'"
                size="sm"
                class="mr-1"
                pill
                variant="dark"
                @click="openApp(row.item.name, locationRow.item.ip.split(':')[0], getProperPort(row.item))"
              >
                <b-icon
                  scale="1"
                  icon="door-open"
                />
                App
              </b-button>
              <b-button
                v-b-tooltip.hover.top="'Visit FluxNode'"
                size="sm"
                class="mr-0"
                pill
                variant="outline-dark"
                @click="openNodeFluxOS(locationRow.item.ip.split(':')[0], locationRow.item.ip.split(':')[1] ? +locationRow.item.ip.split(':')[1] - 1 : 16126)"
              >
                <b-icon
                  scale="1"
                  icon="house-door-fill"
                />
                FluxNode
              </b-button>&nbsp;&nbsp;
            </div>
          </template>
        </b-table>
      </b-col>
      <b-col cols="12">
        <b-pagination
          v-model="appLocationOptions.currentPage"
          :total-rows="appLocationOptions.totalRows"
          :per-page="appLocationOptions.perPage"
          align="center"
          size="sm"
          class="my-0 mt-1"
        />
      </b-col>
    </b-row>
  </div>
</template>

<script>
import FluxMap from '@/views/components/FluxMap.vue';

export default {
  components: {
    FluxMap,
  },
  props: {
    appLocations: {
      type: Array,
      default() {
        return [];
      },
    },
  },
  data() {
    return {
      allNodesLocations: [],
      appLocationFields: [
        { key: 'ip', label: 'IP Address' },
        { key: 'visit', label: '' },
      ],
      appLocationOptions: {
        perPage: 25,
        pageOptions: [5, 10, 25, 50, 100],
        currentPage: 1,
        totalRows: 1,
        filterOn: [],
        filter: '',
      },
    };
  },
  computed: {
    mapLocations() {
      return this.appLocations.map((l) => l.ip);
    },
  },
  methods: {
    nodesUpdated(nodes) {
      this.$set(this.allNodesLocations, nodes);
    },
    getProperPort(appSpecs) {
      if (appSpecs.port) {
        return appSpecs.port;
      }
      if (appSpecs.ports) {
        return appSpecs.ports[0];
      }
      for (let i = 0; i < appSpecs.compose.length; i += 1) {
        for (let j = 0; j < appSpecs.compose[i].ports.length; j += 1) {
          if (appSpecs.compose[i].ports[j]) return appSpecs.compose[i].ports[j];
        }
      }
      return null;
    },
    openSite(url) {
      const win = window.open(url, '_blank');
      win.focus();
    },
    openApp(name, _ip, _port) {
      console.log(name, _ip, _port);
      if (_port && _ip) {
        const ip = _ip;
        const port = _port;
        const url = `http://${ip}:${port}`;
        this.openSite(url);
      } else {
        this.showToast('danger', 'Unable to open App :(, App does not have a port.');
      }
    },
    openNodeFluxOS(_ip, _port) {
      console.log(_ip, _port);
      if ((_port && _ip)) {
        const ip = _ip;
        const port = _port;
        const url = `http://${ip}:${port}`;
        this.opensSite(url);
      } else {
        this.showToast('danger', 'Unable to open FluxOS :(');
      }
    },
  },
};
</script>

<style lang="scss">

</style>
