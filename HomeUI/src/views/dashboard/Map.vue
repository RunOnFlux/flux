<template>
  <div>
    <b-card>
      <l-map
        :zoom="mapData.zoom"
        :center="mapData.center"
      >
        <l-tile-layer :url="mapData.url" />
        <l-marker
          v-for="marker in mapData.markers"
          :key="marker.id"
          :lat-lng="marker.data"
        >
          <l-popup>{{ marker.label }}</l-popup>
        </l-marker>
      </l-map>
    </b-card>
    <b-row>
      <b-col
        md="6"
        sm="12"
        xs="12"
      >
        <b-card>
          <h4>Geographic Locations ({{ getLocationCount() }})</h4>
          <vue-apex-charts
            type="donut"
            height="650"
            width="100%"
            :options="geographicData.chartOptions"
            :series="geographicData.series"
          />
        </b-card>
      </b-col>
      <b-col
        md="6"
        sm="12"
        xs="12"
      >
        <b-card>
          <h4>Providers ({{ getProviderCount() }})</h4>
          <vue-apex-charts
            type="donut"
            height="650"
            width="100%"
            :options="providerData.chartOptions"
            :series="providerData.series"
          />
        </b-card>
      </b-col>
    </b-row>
  </div>
</template>

<script>
import {
  BCard,
  BRow,
  BCol,
} from 'bootstrap-vue';
import { Icon } from 'leaflet';
import {
  LMap, LTileLayer, LMarker, LPopup,
} from '@vue-leaflet/vue-leaflet';
import VueApexCharts from 'vue-apexcharts';
import DashboardService from '@/services/DashboardService';
import 'leaflet/dist/leaflet.css';

/* eslint-disable global-require */
// eslint-disable-next-line no-underscore-dangle
delete Icon.Default.prototype._getIconUrl;
Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});
/* eslint-enable global-require */

const axios = require('axios');

export default {
  components: {
    BCard,
    BRow,
    BCol,
    LMap,
    LTileLayer,
    LMarker,
    LPopup,
    VueApexCharts,
  },
  data() {
    return {
      fluxListLoading: true,
      fluxList: [],
      fluxNodeCount: 0,
      self: this,
      mapData: {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        zoom: 2,
        center: [20, 0],
        markers: [{
          id: 0,
          label: 'Hello!',
          data: [47.313220, -1.319482, { draggable: 'false' }],
        }],
      },
      providerData: {
        series: [],
        chartOptions: {
          chart: {
            toolbar: {
              show: false,
            },
          },
          dataLabels: {
            enabled: true,
          },
          legend: {
            show: true,
            height: 100,
          },
          stroke: { width: 0 },
          plotOptions: { pie: { donut: { size: '40%' } } },
        },
      },
      geographicData: {
        series: [],
        chartOptions: {
          chart: {
            toolbar: {
              show: false,
            },
          },
          dataLabels: {
            enabled: true,
          },
          legend: {
            show: true,
            height: 100,
          },
          stroke: { width: 0 },
          plotOptions: { pie: { donut: { size: '40%' } } },
        },
      },
    };
  },
  mounted() {
    this.getFluxList();
  },
  methods: {
    async getFluxList() {
      try {
        this.fluxListLoading = true;
        const resLoc = await axios.get('https://stats.runonflux.io/fluxinfo?projection=geolocation,ip,tier');
        this.fluxList = resLoc.data.data;
        const resList = await DashboardService.zelnodeCount();
        this.fluxNodeCount = resList.data.data.total;
        this.fluxListLoading = false;
        await this.generateMap();
        await this.generateGeographicPie();
        await this.generateProviderPie();
      } catch (error) {
        console.log(error);
      }
    },
    async generateMap() {
      const nodeData = [];
      this.fluxList.forEach((flux) => {
        const existingPoint = nodeData.find((node) => (node.latitude === flux.geolocation.lat && node.longitude === flux.geolocation.lon));
        if (existingPoint) {
          if (existingPoint.title.split(['-']).length % 6) {
            existingPoint.title += `   ${flux.ip} - ${flux.tier}   `;
          } else {
            existingPoint.title += `   ${flux.ip} - ${flux.tier}   \n`;
          }
        } else {
          const point = {
            latitude: flux.geolocation.lat,
            longitude: flux.geolocation.lon,
            title: `   ${flux.ip} - ${flux.tier}   `,
          };
          nodeData.push(point);
        }
      });
      this.mapData.markers = [];
      nodeData.forEach((node, index) => {
        this.mapData.markers.push({
          id: index,
          label: node.title,
          data: [node.latitude, node.longitude, { draggable: 'false' }],
        });
      });
    },
    async generateGeographicPie() {
      const labels = [];
      const data = [];
      const nodeData = [];
      this.fluxList.forEach((flux) => {
        if (flux.geolocation && flux.geolocation.country) {
          const existingPoint = nodeData.find((node) => (node.country === flux.geolocation.country));
          if (existingPoint) {
            existingPoint.amount += 1;
          } else {
            const point = {
              country: flux.geolocation.country || 'Unknown',
              amount: 1,
            };
            nodeData.push(point);
          }
        } else {
          const existingPoint = nodeData.find((node) => (node.country === 'Unknown'));
          if (existingPoint) {
            existingPoint.amount += 1;
          } else {
            const point = {
              country: 'Unknown',
              amount: 1,
            };
            nodeData.push(point);
          }
        }
      });

      for (let i = 0; i < this.fluxNodeCount - this.fluxList.length; i += 1) {
        const existingPoint = nodeData.find((node) => (node.country === 'Unknown'));
        if (existingPoint) {
          existingPoint.amount += 1;
        } else {
          const point = {
            country: 'Unknown',
            amount: 1,
          };
          nodeData.push(point);
        }
      }

      nodeData.sort((a, b) => b.amount - a.amount);
      this.geographicData.series = [];
      nodeData.forEach((node) => {
        labels.push(`${node.country} (${node.amount})`);
        data.push(node.amount);
      });
      this.geographicData.chartOptions = {
        labels,
        legend: {
          show: true,
          position: 'bottom',
          height: 100,
        },
      };
      this.geographicData.series = data;
    },
    getLocationCount() {
      if (this.geographicData.series && this.geographicData.series.length > 1) {
        return this.geographicData.series.length;
      }
      return 0;
    },
    async generateProviderPie() {
      const labels = [];
      const data = [];
      const nodeData = [];
      this.fluxList.forEach((flux) => {
        if (flux.geolocation && flux.geolocation.org) {
          const existingPoint = nodeData.find((node) => (node.org === flux.geolocation.org));
          if (existingPoint) {
            existingPoint.amount += 1;
          } else if (flux.geolocation.org) {
            const point = {
              org: flux.geolocation.org,
              amount: 1,
            };
            nodeData.push(point);
          } else {
            const existingPoint2 = nodeData.find((node) => (node.org === 'Unknown'));
            if (existingPoint2) {
              existingPoint2.amount += 1;
            } else {
              const point = {
                org: 'Unknown',
                amount: 1,
              };
              nodeData.push(point);
            }
          }
        } else {
          const existingPoint = nodeData.find((node) => (node.org === 'Unknown'));
          if (existingPoint) {
            existingPoint.amount += 1;
          } else {
            const point = {
              org: 'Unknown',
              amount: 1,
            };
            nodeData.push(point);
          }
        }
      });

      for (let i = 0; i < this.fluxNodeCount - this.fluxList.length; i += 1) {
        const existingPoint = nodeData.find((node) => (node.org === 'Unknown'));
        if (existingPoint) {
          existingPoint.amount += 1;
        } else {
          const point = {
            org: 'Unknown',
            amount: 1,
          };
          nodeData.push(point);
        }
      }

      nodeData.sort((a, b) => b.amount - a.amount);
      this.providerData.series = [];
      nodeData.forEach((node) => {
        labels.push(`${node.org} (${node.amount})`);
        data.push(node.amount);
      });
      this.providerData.chartOptions = {
        labels,
        legend: {
          show: true,
          position: 'bottom',
          height: 100,
        },
      };
      this.providerData.series = data;
    },
    getProviderCount() {
      if (this.providerData.series && this.providerData.series.length > 1) {
        return this.providerData.series.length;
      }
      return 0;
    },
    beautifyValue(value, places = 2) {
      const fixedValue = value.toFixed(places);
      return fixedValue.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
    },

  },
};
</script>

<style lang="scss">
.vue2leaflet-map{
  &.leaflet-container{
    height: 450px;
  }
}
</style>
