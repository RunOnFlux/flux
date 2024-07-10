<template>
  <b-card>
    <v-map :zoom="map.zoom" :center="map.center">
      <v-tile-layer :url="map.url" />
      <v-marker-cluster
        v-if="nodesLoaded"
        :options="map.clusterOptions"
        @clusterclick="click"
        @ready="ready"
      >
        <v-geo-json :geojson="geoJson" :options="geoJsonOptions" />
      </v-marker-cluster>
      <v-marker
        v-if="nodesLoadedError"
        :lat-lng="[20, -20]"
        :icon="warning.icon"
        :z-index-offset="warning.zIndexOffest"
      />
    </v-map>
  </b-card>
</template>
<script>
import axios from 'axios';

import L, { latLng, Icon, icon } from 'leaflet';

import {
  LMap, LTileLayer, LGeoJson, LMarker,
} from 'vue2-leaflet';

import Vue2LeafletMarkerCluster from 'vue2-leaflet-markercluster';

import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = icon({
  ...Icon.Default.prototype.options,
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
});

L.Marker.prototype.options.icon = DefaultIcon;

export default {
  components: {
    'v-map': LMap,
    'v-tile-layer': LTileLayer,
    'v-marker': LMarker,
    'v-geo-json': LGeoJson,
    'v-marker-cluster': Vue2LeafletMarkerCluster,
  },
  props: {
    showAll: {
      type: Boolean,
      default: true,
    },
    filterNodes: {
      type: Array,
      default() {
        return [];
      },
    },
    nodes: {
      type: Array,
      default() {
        return [];
      },
    },
  },
  data() {
    return {
      warning: {
        icon: L.divIcon({
          className: 'text-labels',
          html: 'Unable to fetch Node data. Try again later.',
        }),
        zIndexOffset: 1000,
      },
      nodesLoadedError: false,
      nodesLoaded: false,
      map: {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        zoom: 2,
        center: latLng(20, 0),
        clusterOptions: { chunkedLoading: true },
      },
      geoJsonOptions: {
        onEachFeature: (feature, layer) => {
          layer.bindPopup(
            `
            IP: ${feature.properties.ip}<br>
            Tier: ${feature.properties.tier}<br>
            ISP: ${feature.properties.org}`,
            { className: 'custom-popup', keepInView: true },
          );
        },
      },
      geoJson: [
        {
          type: 'FeatureCollection',
          crs: {
            type: 'name',
            properties: {
              name: 'urn:ogc:def:crs:OGC:1.3:CRS84',
            },
          },
          features: [],
        },
      ],
    };
  },
  created() {
    this.getNodes();
  },
  methods: {
    click: (e) => console.log('clusterclick', e),
    ready: (e) => console.log('ready', e),
    /**
     * @param {string} endpoint The ip[:port] of the node
     * @param {{urlType?: "home"|"api"}} options The optional parameters
     * @returns {string} The full https node url
     */
    nodeHttpsUrlFromEndpoint(endpoint, options = {}) {
      const scheme = 'https://';
      const domain = 'node.api.runonflux.io';
      const portMap = { api: 0, home: -1 };

      const urlType = options.urlType || 'api';
      const [ip, apiPort] = endpoint.includes(':') ? endpoint.split(':') : [endpoint, '16127'];

      const ipAsName = ip.replace(/\./g, '-');
      const port = +apiPort + portMap[urlType];

      const url = `${scheme}${ipAsName}-${port}.${domain}`;

      return url;
    },
    buildGeoJson(nodes) {
      const { features } = this.geoJson[0];

      nodes.forEach((node) => {
        const feature = {
          type: 'Feature',
          properties: {
            ip: node.ip,
            tier: node.tier,
            org: node.geolocation.org,
          },
          geometry: {
            type: 'Point',
            coordinates: [node.geolocation.lon, node.geolocation.lat],
          },
        };
        features.push(feature);
      });
    },
    async getNodesViaApi() {
      const url = 'https://stats.runonflux.io/fluxinfo?projection=geolocation,ip,tier';

      const res = await axios.get(url).catch(() => {});

      const {
        status: httpStatus,
        data: { status: apiStatus, data: nodes } = {},
      } = res;

      if (httpStatus !== 200 || apiStatus !== 'success') {
        return [];
      }

      return nodes;
    },
    async getNodes() {
      const nodes = this.nodes.length ? this.nodes : await this.getNodesViaApi();

      if (!nodes.length) {
        this.nodesLoadedError = true;
        return;
      }

      const missingTargets = [];

      const filteredNodes = this.showAll
        ? nodes
        : this.filterNodes.map((nodeIp) => {
          const found = nodes.find((n) => n.ip === nodeIp);
          if (!found) {
            const url = this.nodeHttpsUrlFromEndpoint(nodeIp);
            console.log('me url', url);
            missingTargets.push(`${url}/flux/info`);
          }
          return found;
        }).filter((node) => node);

      const promises = missingTargets.map((target) => axios.get(target, { timeout: 3_000 }));
      const settled = await Promise.allSettled(promises);

      settled.forEach((result) => {
        const { status, value } = result;
        if (status !== 'fulfilled') return;

        const { data: apiData, status: fluxApiStatus } = value.data;

        if (fluxApiStatus === 'success') {
          const { node, geolocation } = apiData;
          const formatted = {
            ip: node.status.ip,
            tier: node.status.tier,
            geolocation,
          };
          filteredNodes.push(formatted);
        }
      });

      this.buildGeoJson(filteredNodes);
      this.nodesLoaded = true;
    },
  },
};
</script>

<style lang="scss">
@import '~leaflet.markercluster/dist/MarkerCluster.css';
@import '~leaflet.markercluster/dist/MarkerCluster.Default.css';
@import '~leaflet/dist/leaflet.css';

.vue2leaflet-map {
  &.leaflet-container {
    aspect-ratio: 3/1;
  }
}

.text-labels {
  font-size: 2em;
  font-weight: 700;
  color: white;
  min-width: 300px;
}

.custom-popup .leaflet-popup-content-wrapper {
  font-size: 1.2em;
  font-weight: 700;
}

.dark-layout {
  path,
  .leaflet-layer,
  .leaflet-control-zoom-in,
  .leaflet-control-zoom-out,
  .leaflet-control-attribution,
  .custom-popup .leaflet-popup-content-wrapper,
  .custom-popup .leaflet-popup-tip {
    filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%);
  }

  .marker-cluster-small div span,
  .marker-cluster-medium div span,
  .marker-cluster-large div span {
    filter: invert(100%);
  }
}
</style>
