<template>
  <div class="map">
    <flux-map :nodes="fluxList" class="mb-2 p-0" />
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
import VueApexCharts from 'vue-apexcharts';
import DashboardService from '@/services/DashboardService';
import FluxMap from '@/views/components/FluxMap.vue';

const axios = require('axios');

export default {
  components: {
    BCard,
    BRow,
    BCol,
    VueApexCharts,
    FluxMap,
  },
  data() {
    return {
      fluxList: [],
      fluxNodeCount: 0,
      self: this,
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
        const resLoc = await axios.get('https://stats.runonflux.io/fluxinfo?projection=geolocation,ip,tier');
        this.fluxList = resLoc.data.data;
        const resList = await DashboardService.fluxnodeCount();
        this.fluxNodeCount = resList.data.data.total;
        await this.generateGeographicPie();
        await this.generateProviderPie();
      } catch (error) {
        console.log(error);
      }
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
  .dark-layout span.apexcharts-legend-text {
    color: #d0d2d6 !important;
  }
</style>
