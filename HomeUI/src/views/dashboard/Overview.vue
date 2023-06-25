<template>
  <div>
    <b-overlay
      :show="historyStatsLoading"
      variant="transparent"
      blur="5px"
    >
      <b-row class="match-height">
        <b-col
          md="12"
          lg="6"
          xxl="4"
        >
          <b-card no-body>
            <b-card-body class="d-flex justify-content-between align-items-center">
              <div>
                <h2 class="mt-0 truncate">
                  Total Nodes: {{ totalNodes }}
                </h2>
              </div>
              <b-avatar
                size="48"
                variant="light-success"
              >
                <feather-icon
                  size="24"
                  icon="ServerIcon"
                />
              </b-avatar>
            </b-card-body>
            <vue-apex-charts
              type="donut"
              height="400"
              width="100%"
              :options="nodeData.chartOptions"
              :series="nodeData.series"
            />
          </b-card>
        </b-col>
        <b-col
          md="12"
          lg="6"
          xxl="8"
        >
          <b-card no-body>
            <b-card-body class="d-flex justify-content-between align-items-center">
              <div>
                <h2 class="mt-0 truncate">
                  Node History
                </h2>
              </div>
            </b-card-body>
            <div class="mt-auto">
              <vue-apex-charts
                type="area"
                height="400"
                width="100%"
                :options="nodeHistoryData.chartOptions"
                :series="nodeHistoryData.series"
              />
            </div>
          </b-card>
        </b-col>
      </b-row>
    </b-overlay>
    <b-overlay
      :show="supplyLoading"
      variant="transparent"
      blur="5px"
    >
      <b-row class="match-height">
        <b-col
          md="12"
          lg="6"
          xxl="4"
        >
          <b-card no-body>
            <b-card-body class="d-flex justify-content-between align-items-center">
              <div>
                <h2 class="mt-0 truncate">
                  Locked Supply: {{ beautifyValue(lockedSupply, 0) }}
                </h2>
              </div>
              <b-avatar
                size="48"
                variant="light-success"
              >
                <feather-icon
                  size="24"
                  icon="LockIcon"
                />
              </b-avatar>
            </b-card-body>
            <vue-apex-charts
              type="donut"
              height="300"
              :options="lockedSupplyData.chartOptions"
              :series="lockedSupplyData.series"
            />
          </b-card>
        </b-col>
        <b-col
          md="12"
          lg="6"
          xxl="8"
        >
          <b-card no-body>
            <b-card-body>
              <div>
                <h2 class="mt-0 truncate">
                  FLUX Supply
                </h2>
              </div>
              <div>
                <b-card-text class="mt-2">
                  Max Supply
                </b-card-text>
                <h3>
                  {{ beautifyValue(maxSupply, 0) }} FLUX
                </h3>
              </div>
              <hr>
              <div>
                <b-card-text>Circulating Supply</b-card-text>
                <b-row>
                  <b-col
                    xl="4"
                    md="6"
                    sm="12"
                  >
                    <h3>
                      {{ beautifyValue(circulatingSupply, 0) }} FLUX
                    </h3>
                  </b-col>
                  <b-col
                    xl="8"
                    md="6"
                    sm="12"
                  >
                    <b-progress
                      :value="circulatingSupply"
                      :max="maxSupply"
                      variant="success"
                      height="10px"
                      class="mt-25"
                    />
                  </b-col>
                </b-row>
              </div>
              <hr>
              <div>
                <b-card-text>Locked Supply</b-card-text>
                <b-row>
                  <b-col
                    xl="4"
                    md="6"
                    sm="12"
                  >
                    <h3>
                      {{ beautifyValue(lockedSupply, 0) }} FLUX
                    </h3>
                  </b-col>
                  <b-col
                    xl="8"
                    md="6"
                    sm="12"
                  >
                    <b-progress
                      :value="lockedSupply"
                      :max="circulatingSupply"
                      variant="success"
                      height="10px"
                      class="mt-25"
                    />
                  </b-col>
                </b-row>
              </div>
            </b-card-body>
          </b-card>
        </b-col>
      </b-row>
    </b-overlay>
  </div>
</template>

<script>
import {
  BOverlay,
  BCard,
  BCardBody,
  BCardText,
  BRow,
  BCol,
  BAvatar,
  BProgress,
} from 'bootstrap-vue';
import VueApexCharts from 'vue-apexcharts';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import tierColors from '@/libs/colors';
import DashboardService from '@/services/DashboardService';

const axios = require('axios');

export default {
  components: {
    BOverlay,
    BCard,
    BCardBody,
    BCardText,
    BRow,
    BCol,
    BAvatar,
    BProgress,
    VueApexCharts,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  data() {
    return {
      historyStatsLoading: true,
      supplyLoading: true,
      totalNodes: 0,
      nodeData: {
        chartOptions: {
          chart: {
            toolbar: {
              show: false,
            },
          },
          dataLabels: {
            enabled: true,
          },
          labels: ['Cumulus', 'Nimbus', 'Stratus'],
          legend: { show: false },
          stroke: { width: 0 },
          colors: [tierColors.cumulus, tierColors.nimbus, tierColors.stratus],
          tooltip: {
            y: {
              formatter: (value) => this.beautifyValue(value, 0),
            },
          },
        },
        series: [],
      },
      nodeHistoryData: {
        chartOptions: {
          colors: [tierColors.cumulus, tierColors.nimbus, tierColors.stratus],
          labels: ['Cumulus', 'Nimbus', 'Stratus'],
          grid: {
            show: false,
            padding: {
              left: 0,
              right: 0,
            },
          },
          chart: {
            toolbar: {
              show: false,
            },
            sparkline: {
              enabled: true,
            },
            stacked: true,
          },
          dataLabels: {
            enabled: false,
          },
          stroke: {
            curve: 'smooth',
            width: 2.5,
          },
          fill: {
            type: 'gradient',
            gradient: {
              shadeIntensity: 0.9,
              opacityFrom: 0.7,
              opacityTo: 0.2,
              stops: [0, 80, 100],
            },
          },
          xaxis: {
            type: 'numeric',
            lines: {
              show: false,
            },
            axisBorder: {
              show: false,
            },
            labels: { show: false },
          },
          yaxis: [
            {
              y: 0,
              offsetX: 0,
              offsetY: 0,
              padding: {
                left: 0,
                right: 0,
              },
            },
          ],
          tooltip: {
            x: {
              formatter: (value) => new Date(value).toLocaleString('en-GB', this.timeoptions),
            },
          },
        },
        series: [],
      },
      lockedSupplyData: {
        chartOptions: {
          chart: {
            toolbar: {
              show: false,
            },
          },
          dataLabels: {
            enabled: true,
          },
          labels: ['Cumulus', 'Nimbus', 'Stratus'],
          legend: { show: false },
          stroke: { width: 0 },
          colors: [tierColors.cumulus, tierColors.nimbus, tierColors.stratus],
          tooltip: {
            y: {
              formatter: (value) => this.beautifyValue(value, 0),
            },
          },
        },
        series: [],
      },
      maxSupply: 440000000,
      lockedSupply: 0,
      lockedSupplyPerc: 0,
      circulatingSupply: 0,
      circulatingSupplyPerc: 0,
    };
  },
  mounted() {
    this.getHistoryStats();
    this.getCircSupply();
  },
  methods: {
    async getCircSupply() {
      this.supplyLoading = true;
      const result = await axios.get('https://explorer.runonflux.io/api/statistics/circulating-supply'); // we want just one chain
      this.circulatingSupply = result.data;
      this.circulatingSupplyPerc = Number(((this.circulatingSupply / 440000000) * 100).toFixed(2));
      await this.getFluxNodeCount();
      this.supplyLoading = false;
    },
    async getHistoryStats() {
      try {
        this.historyStatsLoading = true;
        const result = await axios.get('https://stats.runonflux.io/fluxhistorystats');
        this.fluxHistoryStats = result.data.data;
        this.historyStatsLoading = false;
        // this.generateFluxPieChart()
        // this.generateFluxHistory()
        // this.generateLockedSupplyPercList()
        const timePoints = Object.keys(this.fluxHistoryStats);

        const cumulusHistory = [];
        const nimbusHistory = [];
        const stratusHistory = [];
        timePoints.forEach((time) => {
          cumulusHistory.push([Number(time), this.fluxHistoryStats[time].cumulus]);
          nimbusHistory.push([Number(time), this.fluxHistoryStats[time].nimbus]);
          stratusHistory.push([Number(time), this.fluxHistoryStats[time].stratus]);
        });

        this.nodeHistoryData.series = [
          {
            name: 'Cumulus',
            data: cumulusHistory,
          },
          {
            name: 'Nimbus',
            data: nimbusHistory,
          },
          {
            name: 'Stratus',
            data: stratusHistory,
          },
        ];
      } catch (error) {
        console.log(error);
        this.$toast({
          component: ToastificationContent,
          props: {
            title: 'Unable to fetch history stats',
            icon: 'InfoIcon',
            variant: 'danger',
          },
        });
      }
    },
    async getFluxNodeCount() {
      try {
        const resCount = await DashboardService.fluxnodeCount();
        const counts = resCount.data.data;
        const stratuses = counts['stratus-enabled'];
        let nimbuses = counts['nimbus-enabled'];
        let cumuluses = counts['cumulus-enabled'];
        if (counts['cumulus-enabled'] < counts['nimbus-enabled']) { // bug in daemon
          nimbuses = counts['cumulus-enabled'];
          cumuluses = counts['nimbus-enabled'];
        }
        const supply = stratuses * 40000 + nimbuses * 12500 + cumuluses * 1000;
        this.lockedSupplyData.series = [cumuluses * 1000, nimbuses * 12500, stratuses * 40000];
        this.lockedSupply = supply;
        this.lockedSupplyPerc = Number(((supply / this.circulatingSupply) * 100).toFixed(2));
        this.totalNodes = cumuluses + nimbuses + stratuses;
        this.nodeData.series = [cumuluses, nimbuses, stratuses];
      } catch (error) {
        console.log(error);
      }
    },
    beautifyValue(value, places = 2) {
      const fixedValue = value.toFixed(places);
      return fixedValue.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
    },
  },
};
</script>

<style>
</style>
