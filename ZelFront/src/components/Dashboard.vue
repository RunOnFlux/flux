<template>
  <div>
    <div v-if="dashboardSection === 'dashboard'">
      <el-tabs v-model="activeName">
        <el-tab-pane
          label="Overview"
          name="overview"
        >
          <div class="gridTwo">
            <div
              v-show="!currentNodesChartLoading"
              id="currentNodesChart"
            />
            <div v-show="currentNodesChartLoading">
              loading...
            </div>
            <div
              v-show="!fluxHistoryLoading"
              id="fluxhistory"
            />
            <div v-show="fluxHistoryLoading">
              loading...
            </div>
          </div>
          <br><br>
          <div class="gridThree">
            <div
              v-show="!supplyLoading"
              id="lockedSupplyPercChart"
            />
            <div v-show="supplyLoading">
              loading...
            </div>
            <div
              v-show="!supplyLoading"
              class="supplyProgress"
            >
              <br><br><br>
              <h3>Current Supply Released</h3>
              <el-progress
                :text-inside="true"
                :stroke-width="26"
                :percentage="circulatingSupplyPerc"
              ></el-progress>
              <br><br><br>
              <h3>Flux Locked Supply</h3>
              <el-progress
                :text-inside="true"
                :stroke-width="26"
                :percentage="lockedSupplyPerc"
              ></el-progress>
              <br><br><br>
            </div>
            <div v-show="supplyLoading">
              loading...
            </div>
            <div
              v-show="!supplyLoading"
              class="supplyStats"
            >
              <h3>Total Supply</h3>
              <h4>{{ beautifyValue(440000000) }} FLUX</h4>
              <br>
              <h3>Circulating Supply</h3>
              <h4>{{ beautifyValue(this.circulatingSupply) }} FLUX</h4>
              <br>
              <h3>Flux Locked Supply</h3>
              <h4>{{ beautifyValue(this.lockedSupply) }} FLUX</h4>
            </div>
            <div v-show="supplyLoading">
              loading...
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane
          label="Resources"
          name="resources"
        >
          <div class="gridThree">
            <div
              v-show="!cpuLoading"
              id="cpucurrent"
            />
            <div v-show="cpuLoading">
              loading...
            </div>
            <div
              v-show="!ramLoading"
              id="ramcurrent"
            />
            <div v-show="ramLoading">
              loading...
            </div>
            <div
              v-show="!ssdLoading"
              id="ssdcurrent"
            />
            <div v-show="ssdLoading">
              loading...
            </div>
          </div>
          <br><br>
          <div class="gridThree">
            <div
              v-show="!cpuHistoryLoading"
              id="cpuhistory"
            />
            <div v-show="cpuHistoryLoading">
              loading...
            </div>
            <div
              v-show="!ramHistoryLoading"
              id="ramhistory"
            />
            <div v-show="ramHistoryLoading">
              loading...
            </div>
            <div
              v-show="!ssdHistoryLoading"
              id="ssdhistory"
            />
            <div v-show="ssdHistoryLoading">
              loading...
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane
          label="Map"
          name="map"
        >
          <div id="mapchart" />
          <br><br>
          <div id="geolocationPie" />
          <br><br>
          <div id="providerPie" />
        </el-tab-pane>
        <el-tab-pane
          label="Economics"
          name="economics"
        >
          <div id="priceChart" />
          <br><br>
          <div class="gridThree">
            <div>
              <h2>Cumulus Rewards</h2>
              <br><br>
              <h3>per day</h3>
              <h4>{{ beautifyValue(cumulusWeek / 7 ) }} FLUX</h4>
              <h4>{{ beautifyValue(cumulusUSDRewardWeek / 7) }} USD</h4>
              <h4 style="visibility: hidden">No KDA available</h4>
              <br><br>
              <h3>per week</h3>
              <h4>{{ beautifyValue(cumulusWeek) }} FLUX</h4>
              <h4>{{ beautifyValue(cumulusUSDRewardWeek) }} USD</h4>
              <h4 style="visibility: hidden">No KDA available</h4>
              <br><br>
              <h3>per month</h3>
              <h4>{{ beautifyValue(cumulusWeek * 4.34812141) }} FLUX</h4>
              <h4>{{ beautifyValue(cumulusUSDRewardWeek * 4.34812141) }} USD</h4>
              <h4 style="visibility: hidden">No KDA available</h4>
              <br><br>
              <h3>Profitability per month - Node Cost 4.70 USD</h3>
              <h4>Node only: {{ beautifyValue(cumulusUSDRewardWeek * 4.34812141 - 4.70) }} USD</h4>
              <h4 style="visibility: hidden">No KDA available</h4>
              <br>
            </div>
            <div>
              <h2>Nimbus Rewards</h2>
              <br><br>
              <h3>per day</h3>
              <h4>{{ beautifyValue(nimbusWeek / 7) }} FLUX ~ {{ beautifyValue(nimbusUSDRewardWeek / 7) }} USD</h4>
              <h4>{{ beautifyValue(kdaNimbusWeek / 7) }} KDA ~ {{ beautifyValue(nimbusUSDKDARewardWeek / 7) }} USD</h4>
              <h4>{{ beautifyValue((nimbusUSDRewardWeek / 7) + (nimbusUSDKDARewardWeek / 7)) }} USD</h4>
              <br><br>
              <h3>per week</h3>
              <h4>{{ beautifyValue(nimbusWeek) }} FLUX ~ {{ beautifyValue(nimbusUSDRewardWeek) }} USD</h4>
              <h4>{{ beautifyValue(kdaNimbusWeek) }} KDA ~ {{ beautifyValue(nimbusUSDKDARewardWeek) }} USD</h4>
              <h4>{{ beautifyValue((nimbusUSDRewardWeek) + (nimbusUSDKDARewardWeek)) }} USD</h4>
              <br><br>
              <h3>per month</h3>
              <h4>{{ beautifyValue(nimbusWeek * 4.34812141) }} FLUX ~ {{ beautifyValue(nimbusUSDRewardWeek * 4.34812141) }} USD</h4>
              <h4>{{ beautifyValue(kdaNimbusWeek * 4.34812141) }} KDA ~ {{ beautifyValue(nimbusUSDKDARewardWeek * 4.34812141) }} USD</h4>
              <h4>{{ beautifyValue((nimbusUSDRewardWeek * 4.34812141) + (nimbusUSDKDARewardWeek * 4.34812141)) }} USD</h4>
              <br><br>
              <h3>Profitability per month - Node Cost 6 USD</h3>
              <h4>Node only: {{ beautifyValue(nimbusUSDRewardWeek * 4.34812141 - 6) }} USD</h4>
              <h4>With KDA: {{ beautifyValue((nimbusUSDRewardWeek * 4.34812141) + (nimbusUSDKDARewardWeek * 4.34812141) - 6) }} USD</h4>
              <br>
            </div>
            <div>
              <h2>Stratus Rewards</h2>
              <br><br>
              <h3>per day</h3>
              <h4>{{ beautifyValue(stratusWeek / 7 ) }} FLUX ~ {{ beautifyValue(stratusUSDRewardWeek / 7) }} USD</h4>
              <h4>{{ beautifyValue(kdaStratusWeek / 7 ) }} KDA ~ {{ beautifyValue(stratusUSDKDARewardWeek / 7) }} USD</h4>
              <h4>{{ beautifyValue((stratusUSDRewardWeek / 7) + (stratusUSDKDARewardWeek / 7)) }} USD</h4>
              <br><br>
              <h3>per week</h3>
              <h4>{{ beautifyValue(stratusWeek) }} FLUX ~ {{ beautifyValue(stratusUSDRewardWeek) }} USD</h4>
              <h4>{{ beautifyValue(kdaStratusWeek ) }} KDA ~ {{ beautifyValue(stratusUSDKDARewardWeek) }} USD</h4>
              <h4>{{ beautifyValue((stratusUSDRewardWeek) + (stratusUSDKDARewardWeek)) }} USD</h4>
              <br><br>
              <h3>per month</h3>
              <h4>{{ beautifyValue(stratusWeek * 4.34812141) }} FLUX ~ {{ beautifyValue(stratusUSDRewardWeek * 4.34812141) }} USD</h4>
              <h4>{{ beautifyValue(kdaStratusWeek * 4.34812141) }} KDA ~ {{ beautifyValue(stratusUSDKDARewardWeek * 4.34812141) }} USD</h4>
              <h4>{{ beautifyValue((stratusUSDRewardWeek * 4.34812141) + (stratusUSDKDARewardWeek * 4.34812141)) }} USD</h4>
              <br><br>
              <h3>Profitability per month - Node Cost 32 USD</h3>
              <h4>Node only: {{ beautifyValue(stratusUSDRewardWeek * 4.34812141 - 32) }} USD</h4>
              <h4>With KDA: {{ beautifyValue((stratusUSDRewardWeek * 4.34812141) + (stratusUSDKDARewardWeek * 4.34812141) - 18.1) }} USD</h4>
              <br>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane
          label="List"
          name="nodes"
        >
          <el-table
            :data="fluxList.filter(data => !fluxFilter || data.ip.toLowerCase().includes(fluxFilter.toLowerCase()) || data.payment_address.toLowerCase().includes(fluxFilter.toLowerCase()) || data.tier.toLowerCase().includes(fluxFilter.toLowerCase())
             || (data.location ? data.location.country.toLowerCase().includes(fluxFilter.toLowerCase()) : false) || (data.location ? data.location.org.toLowerCase().includes(fluxFilter.toLowerCase()) : false))"
            empty-text="Flux Nodes are loading..."
            style="width: 100%"
            height="680"
            v-loading="fluxListLoading"
            lazy
          >
            <el-table-column
              label="IP Address"
              prop="ip"
              sortable
              width="150"
            >
              <template slot-scope="scope">
                {{ scope.row.ip }}
              </template>
            </el-table-column>
            <el-table-column
              label="Address"
              prop="payment_address"
              width="350"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.payment_address }}
              </template>
            </el-table-column>
            <el-table-column
              label="Country"
              prop="country"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.location ? scope.row.location.country : 'Unknown' }}
              </template>
            </el-table-column>
            <el-table-column
              label="Provider"
              prop="org"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.location ? scope.row.location.org : 'Unknown' }}
              </template>
            </el-table-column>
            <el-table-column
              label="Last Paid"
              prop="lastpaid"
              sortable
            >
              <template slot-scope="scope">
                {{ new Date(Number(scope.row.lastpaid) * 1000).toLocaleString("en-GB", timeoptions) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Tier"
              prop="tier"
              width="100"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.tier }}
              </template>
            </el-table-column>
            <el-table-column
              align="right"
              label="Visit"
              width="120"
            >
              <template
                slot="header"
                slot-scope="scope"
              >
                <el-input
                  v-if="scope"
                  v-model="fluxFilter"
                  size="mini"
                  placeholder="Search"
                />
              </template>
              <template slot-scope="scope">
                <el-button @click="openFlux(scope.row.ip)">
                  Visit
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

import DashboardService from '@/services/DashboardService';

import * as am4charts from '@amcharts/amcharts4/charts';
import * as am4core from '@amcharts/amcharts4/core';
import * as am4maps from '@amcharts/amcharts4/maps';
// eslint-disable-next-line camelcase
import am4geodata_worldLow from '@amcharts/amcharts4-geodata/worldLow';
// eslint-disable-next-line camelcase
import am4themes_dark from '@amcharts/amcharts4/themes/dark';

const axios = require('axios');

Vue.use(Vuex);

// eslint-disable-next-line camelcase
function am4themes_myTheme(target) {
  if (target instanceof am4core.ColorSet) {
    // eslint-disable-next-line no-param-reassign
    target.list = [
      am4core.color('#63ace5'),
      am4core.color('#adcbe3'),
      am4core.color('#e7eff6'),
    ];
  }
}

export default {
  name: 'Dashboard',
  components: {
  },
  data() {
    return {
      fluxFilter: '',
      circulatingSupply: 0, // number
      rates: [],
      fluxList: [],
      fluxHistoryStats: [],
      ratesLoading: true,
      circSupplyLoading: true,
      historyStatsLoading: true,
      fluxListLoading: true,
      activeName: 'overview',
      timeoptions: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
      circulatingSupplyPerc: 0,
      lockedSupply: 0,
      lockedSupplyPerc: 0,
      currentNodesChartLoading: true,
      fluxHistoryLoading: true,
      supplyLoading: true,
      ssdLoading: true,
      ramLoading: true,
      cpuLoading: true,
      ssdHistoryLoading: true,
      ramHistoryLoading: true,
      cpuHistoryLoading: true,
      historicalPrices: [],
      cumulusWeek: 0,
      nimbusWeek: 0,
      stratusWeek: 0,
      cumulusUSDRewardWeek: 0,
      nimbusUSDRewardWeek: 0,
      stratusUSDRewardWeek: 0,
      nimbusUSDKDARewardWeek: 0,
      stratusUSDKDARewardWeek: 0,
      kdaNimbusWeek: 0,
      kdaStratusWeek: 0,
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'dashboardSection',
      'privilage',
    ]),
  },
  watch: {
    dashboardSection(val, oldVal) {
      console.log(val, oldVal);
      this.switcher(val);
    },
  },
  mounted() {
    this.switcher(this.dashboardSection);
  },
  methods: {
    openFlux(ip) {
      const url = `http://${ip}:16126`;
      const win = window.open(url, '_blank');
      win.focus();
    },
    switcher(value) {
      switch (value) {
        case 'dashboard':
          this.obtainData();
          break;
        default:
          console.log('Apps Section: Unrecognized method');
      }
    },
    async obtainData() {
      this.getHistoryStats();
      this.getFluxList();
      this.getCircSupply();
    },
    async getCircSupply() {
      this.circSupplyLoading = true;
      const result = await axios.get('https://explorer.runonflux.io/api/statistics/circulating-supply'); // we want just one chain
      this.circulatingSupply = result.data;
      this.circSupplyLoading = false;
      this.circulatingSupplyPerc = Number(((this.circulatingSupply / 440000000) * 100).toFixed(2));
      this.ratesLoading = true;
      const resultB = await axios.get('https://vipdrates.zelcore.io/rates');
      this.rates = resultB.data;
      this.ratesLoading = false;
      this.getZelNodeCount();
    },
    async getHistoryStats() {
      try {
        this.historyStatsLoading = true;
        const result = await axios.get('https://stats.runonflux.io/fluxhistorystats');
        this.fluxHistoryStats = result.data.data;
        this.historyStatsLoading = false;
        this.generateCPUHistory();
        this.generateRAMHistory();
        this.generateSSDHistory();
        this.generateFluxPieChart();
        this.generateFluxHistory();
        this.generatelockedSupplyPercList();
      } catch (error) {
        console.log(error);
      }
    },
    async getZelNodeCount() {
      try {
        const resCount = await DashboardService.zelnodeCount();
        const counts = resCount.data.data;
        const stratuses = counts['stratus-enabled'];
        const nimbuses = counts['nimbus-enabled'];
        const cumuluses = counts['cumulus-enabled'];
        console.log(resCount);
        const supply = stratuses * 100000 + nimbuses * 25000 + cumuluses * 10000;
        this.lockedSupply = supply;
        this.lockedSupplyPerc = Number(((supply / this.circulatingSupply) * 100).toFixed(2));
        this.generateEconomics(counts);
      } catch (error) {
        console.log(error);
      }
    },
    async generateEconomics(zelnodecounts) {
      try {
        console.log(this.rates);
        const stratuses = zelnodecounts['stratus-enabled'];
        const nimbuses = zelnodecounts['nimbus-enabled'];
        const cumuluses = zelnodecounts['cumulus-enabled'];
        const resKDAEligible = await axios.get('https://stats.runonflux.io/kadena/eligiblestats/7');
        const kdaData = resKDAEligible.data.data;
        const kdaCoins = 5749.77;
        const totalNimbuss = kdaData.nimbus;
        const totalStratuss = kdaData.stratus;
        const overallTotal = totalNimbuss + (4 * totalStratuss);
        const perNimbusWeek = Number((kdaCoins / overallTotal).toFixed(4)); // KDA
        const perStratusWeek = Number(((kdaCoins / overallTotal) * 4).toFixed(4)); // KDA
        const perCumulusNode = 5.625;
        const perNimbusNode = 9.375;
        const perStratusNode = 22.5;
        // eslint-disable-next-line no-mixed-operators
        const cumulusWeek = perCumulusNode * 720 * 7 / cumuluses;
        // eslint-disable-next-line no-mixed-operators
        const nimbusWeek = perNimbusNode * 720 * 7 / nimbuses;
        // eslint-disable-next-line no-mixed-operators
        const stratusWeek = perStratusNode * 720 * 7 / stratuses;
        const cumulusUSDReward = this.getFiatRate('ZEL') * perCumulusNode; // per one go
        const nimbusUSDReward = this.getFiatRate('ZEL') * perNimbusNode; // per one go
        const stratusUSDReward = this.getFiatRate('ZEL') * perStratusNode; // per one go
        const nimbusUSDKDARewardWeek = this.getFiatRate('KDA') * perNimbusWeek; // per week
        const stratusUSDKDARewardWeek = this.getFiatRate('KDA') * perStratusWeek; // per week
        // 720 blocks per day.
        // eslint-disable-next-line no-mixed-operators
        const cumulusUSDRewardWeek = 7 * 720 * cumulusUSDReward / cumuluses;
        // eslint-disable-next-line no-mixed-operators
        const nimbusUSDRewardWeek = 7 * 720 * nimbusUSDReward / nimbuses;
        // eslint-disable-next-line no-mixed-operators
        const stratusUSDRewardWeek = 7 * 720 * stratusUSDReward / stratuses;
        this.cumulusWeek = cumulusWeek;
        this.nimbusWeek = nimbusWeek;
        this.stratusWeek = stratusWeek;
        this.cumulusUSDRewardWeek = cumulusUSDRewardWeek;
        this.nimbusUSDRewardWeek = nimbusUSDRewardWeek;
        this.stratusUSDRewardWeek = stratusUSDRewardWeek;
        this.nimbusUSDKDARewardWeek = nimbusUSDKDARewardWeek;
        this.stratusUSDKDARewardWeek = stratusUSDKDARewardWeek;
        this.kdaNimbusWeek = perNimbusWeek;
        this.kdaStratusWeek = perStratusWeek;
        const self = this;
        axios.get('https://api.coingecko.com/api/v3/coins/zelcash/market_chart?vs_currency=USD&days=30').then((res2) => {
          self.historicalPrices = res2.data.prices.filter((a) => a[0] > 1483232400000); // min date from  January 1, 2017 1:00:00 AM
          self.fillChartData();
        });
      } catch (error) {
        console.log(error);
      }
    },
    async getFluxList() {
      try {
        this.fluxListLoading = true;
        const resLoc = await axios.get('https://stats.runonflux.io/fluxlocations');
        const locations = resLoc.data.data;
        const resList = await DashboardService.listZelNodes();
        const fluxList = resList.data.data;
        const adjustedFluxList = [];
        console.log('fetched');
        fluxList.forEach((node) => {
          const adjustedNode = node;
          adjustedNode.location = locations.find((location) => location.ip === adjustedNode.ip);
          adjustedFluxList.push(adjustedNode);
        });
        this.fluxList = adjustedFluxList.filter((node) => node.ip);
        this.fluxListLoading = false;
        console.log(this.fluxList);
        this.generateMap();
        this.generateResources();
        this.generateGeographicPie();
        this.generateProviderPie();
      } catch (error) {
        console.log(error);
      }
    },
    generateMap() {
      // Create map instance
      // Create map instance
      const chart = am4core.create('mapchart', am4maps.MapChart);

      // Set map definition
      // eslint-disable-next-line camelcase
      chart.geodata = am4geodata_worldLow;

      // Set projection
      chart.projection = new am4maps.projections.Miller();

      // Create map polygon series
      const polygonSeries = chart.series.push(new am4maps.MapPolygonSeries());

      // Make map load polygon (like country names) data from GeoJSON
      polygonSeries.useGeodata = true;

      // Configure series
      const polygonTemplate = polygonSeries.mapPolygons.template;
      polygonTemplate.tooltipText = '{name}';
      polygonTemplate.fill = am4core.color('#74B266');

      // Create hover state and set alternative fill color
      const hs = polygonTemplate.states.create('hover');
      hs.properties.fill = am4core.color('#367B25');

      // Remove Antarctica
      polygonSeries.exclude = ['AQ'];

      // Bind "fill" property to "fill" key in data
      polygonTemplate.propertyFields.fill = 'fill';

      // Create image series
      const imageSeries = chart.series.push(new am4maps.MapImageSeries());

      // Create a circle image in image series template so it gets replicated to all new images
      const imageSeriesTemplate = imageSeries.mapImages.template;
      const circle = imageSeriesTemplate.createChild(am4core.Circle);
      circle.radius = 4;
      circle.fill = am4core.color('#B27799');
      circle.nonScaling = false;
      circle.stroke = am4core.color('#000FFF');
      circle.strokeWidth = 1;
      circle.nonScaling = true;
      circle.tooltipText = '{title}';

      // Set property fields
      imageSeriesTemplate.propertyFields.latitude = 'latitude';
      imageSeriesTemplate.propertyFields.longitude = 'longitude';

      // Add nodes
      const nodeData = [];
      this.fluxList.forEach((flux) => {
        if (flux.location) {
          const existingPoint = nodeData.find((node) => (node.latitude === flux.location.lat && node.longitude === flux.location.lon));
          if (existingPoint) {
            if (existingPoint.title.split(['-']).length % 6) {
              existingPoint.title += `   ${flux.ip} - ${flux.tier}   `;
            } else {
              existingPoint.title += `   ${flux.ip} - ${flux.tier}   \n`;
            }
          } else {
            const point = {
              latitude: flux.location.lat,
              longitude: flux.location.lon,
              title: `   ${flux.ip} - ${flux.tier}   `,
            };
            nodeData.push(point);
          }
        }
      });
      imageSeries.data = nodeData;
    },
    generateResources() {
      this.generateCPU();
      this.generateRAM();
      this.generateSSD();
    },
    generateCPU() {
      am4core.useTheme(am4themes_dark);
      am4core.useTheme(am4themes_myTheme);
      // Create chart instance
      const chart = am4core.create('cpucurrent', am4charts.XYChart);

      const cumuluses = this.fluxList.filter((node) => (node.tier === 'CUMULUS'));
      const nimbuses = this.fluxList.filter((node) => (node.tier === 'NIMBUS'));
      const stratuses = this.fluxList.filter((node) => (node.tier === 'STRATUS'));

      const cumulusValue = cumuluses.length * 2;
      const nimbusValue = nimbuses.length * 4;
      const stratusValus = stratuses.length * 8;

      const total = stratusValus + nimbusValue + cumulusValue;

      // Add data
      chart.data = [
        {
          category: 'Cumulus',
          value: cumulusValue,
        },
        {
          category: 'Nimbus',
          value: nimbusValue,
        },
        {
          category: 'Stratus',
          value: stratusValus,
        },
      ];

      // Create axes
      const categoryAxis = chart.xAxes.push(new am4charts.CategoryAxis());
      categoryAxis.dataFields.category = 'category';
      categoryAxis.renderer.grid.template.location = 0;
      categoryAxis.renderer.minGridDistance = 30;

      const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());

      valueAxis.title.text = 'Cores';

      // Create series
      const series = chart.series.push(new am4charts.ColumnSeries());
      series.dataFields.valueY = 'value';
      series.dataFields.categoryX = 'category';
      series.tooltipText = '{category}: [bold]{value}[/]';
      // Add cursor
      chart.cursor = new am4charts.XYCursor();
      const title = chart.titles.create();
      title.text = `Total Cores: ${this.beautifyValue(total)}`;
      title.fontSize = 20;
      title.marginBottom = 15;
      const self = this;
      setTimeout(() => {
        self.cpuLoading = false;
      }, 1000);
    },
    generateRAM() {
      am4core.useTheme(am4themes_dark);
      am4core.useTheme(am4themes_myTheme);
      // Create chart instance
      const chart = am4core.create('ramcurrent', am4charts.XYChart);

      const cumuluses = this.fluxList.filter((node) => (node.tier === 'CUMULUS'));
      const nimbuses = this.fluxList.filter((node) => (node.tier === 'NIMBUS'));
      const stratuses = this.fluxList.filter((node) => (node.tier === 'STRATUS'));

      const cumulusValue = cumuluses.length * 4;
      const nimbusValue = nimbuses.length * 8;
      const stratusValus = stratuses.length * 30;

      const total = stratusValus + nimbusValue + cumulusValue;

      // Add data
      chart.data = [
        {
          category: 'Cumulus',
          value: cumulusValue,
        },
        {
          category: 'Nimbus',
          value: nimbusValue,
        },
        {
          category: 'Stratus',
          value: stratusValus,
        },
      ];

      // Create axes
      const categoryAxis = chart.xAxes.push(new am4charts.CategoryAxis());
      categoryAxis.dataFields.category = 'category';
      categoryAxis.renderer.grid.template.location = 0;
      categoryAxis.renderer.minGridDistance = 30;

      const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());

      valueAxis.title.text = 'RAM (GB)';

      // Create series
      const series = chart.series.push(new am4charts.ColumnSeries());
      series.dataFields.valueY = 'value';
      series.dataFields.categoryX = 'category';
      series.tooltipText = '{category}: [bold]{value}[/]';
      // Add cursor
      chart.cursor = new am4charts.XYCursor();
      const title = chart.titles.create();
      title.text = `Total RAM: ${this.beautifyValue(total / 1000)} TB`;
      title.fontSize = 20;
      title.marginBottom = 15;
      const self = this;
      setTimeout(() => {
        self.ramLoading = false;
      }, 1000);
    },
    generateSSD() {
      am4core.useTheme(am4themes_dark);
      am4core.useTheme(am4themes_myTheme);
      // Create chart instance
      const chart = am4core.create('ssdcurrent', am4charts.XYChart);

      const cumuluses = this.fluxList.filter((node) => (node.tier === 'CUMULUS'));
      const nimbuses = this.fluxList.filter((node) => (node.tier === 'NIMBUS'));
      const stratuses = this.fluxList.filter((node) => (node.tier === 'STRATUS'));

      const cumulusValue = cumuluses.length * 40;
      const nimbusValue = nimbuses.length * 150;
      const stratusValus = stratuses.length * 600;

      const total = stratusValus + nimbusValue + cumulusValue;

      // Add data
      chart.data = [
        {
          category: 'Cumulus',
          value: cumulusValue,
        },
        {
          category: 'Nimbus',
          value: nimbusValue,
        },
        {
          category: 'Stratus',
          value: stratusValus,
        },
      ];

      // Create axes
      const categoryAxis = chart.xAxes.push(new am4charts.CategoryAxis());
      categoryAxis.dataFields.category = 'category';
      categoryAxis.renderer.grid.template.location = 0;
      categoryAxis.renderer.minGridDistance = 30;

      const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());

      valueAxis.title.text = 'SSD (GB)';

      // Create series
      const series = chart.series.push(new am4charts.ColumnSeries());
      series.dataFields.valueY = 'value';
      series.dataFields.categoryX = 'category';
      series.tooltipText = '{category}: [bold]{value}[/]';
      // Add cursor
      chart.cursor = new am4charts.XYCursor();
      const title = chart.titles.create();
      title.text = `Total SSD: ${this.beautifyValue(total / 1000)} TB`;
      title.fontSize = 20;
      title.marginBottom = 15;
      const self = this;
      setTimeout(() => {
        self.ssdLoading = false;
      }, 1000);
    },
    generateCPUHistory() {
      am4core.useTheme(am4themes_dark);
      am4core.useTheme(am4themes_myTheme);
      const chart = am4core.create('cpuhistory', am4charts.XYChart);

      const cpuData = [];

      const timePoints = Object.keys(this.fluxHistoryStats);
      timePoints.forEach((time) => {
        cpuData.push({
          time: new Date(Number(time)),
          stratus: (this.fluxHistoryStats[time].stratus) * 8,
          nimbus: (this.fluxHistoryStats[time].nimbus) * 4,
          cumulus: (this.fluxHistoryStats[time].cumulus) * 2,
        });
      });

      chart.data = cpuData;
      console.log(cpuData);

      const dateAxis = chart.xAxes.push(new am4charts.DateAxis());

      const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());
      valueAxis.tooltip.disabled = true;

      const series = chart.series.push(new am4charts.LineSeries());
      series.name = 'Stratus';
      series.dataFields.dateX = 'time';
      series.dataFields.valueY = 'stratus';
      series.tooltipText = 'Stratus [bold]{valueY.value}[/]';
      series.tooltip.background.fill = am4core.color('#000');
      series.tooltip.getStrokeFromObject = true;
      series.tooltip.background.strokeWidth = 3;
      series.tooltip.getFillFromObject = false;
      series.fillOpacity = 0.6;
      series.strokeWidth = 2;
      series.stacked = true;

      const series2 = chart.series.push(new am4charts.LineSeries());
      series2.name = 'Nimbus';
      series2.dataFields.dateX = 'time';
      series2.dataFields.valueY = 'nimbus';
      series2.tooltipText = 'Nimbus [bold]{valueY.value}[/]';
      series2.tooltip.background.fill = am4core.color('#000');
      series2.tooltip.getFillFromObject = false;
      series2.tooltip.getStrokeFromObject = true;
      series2.tooltip.background.strokeWidth = 3;
      series2.sequencedInterpolation = true;
      series2.fillOpacity = 0.6;
      series2.stacked = true;
      series2.strokeWidth = 2;

      const series3 = chart.series.push(new am4charts.LineSeries());
      series3.name = 'Cumulus';
      series3.dataFields.dateX = 'time';
      series3.dataFields.valueY = 'cumulus';
      series3.tooltipText = 'Cumulus [bold]{valueY.value}[/]';
      series3.tooltip.background.fill = am4core.color('#000');
      series3.tooltip.getFillFromObject = false;
      series3.tooltip.getStrokeFromObject = true;
      series3.tooltip.background.strokeWidth = 3;
      series3.sequencedInterpolation = true;
      series3.fillOpacity = 0.6;
      series3.defaultState.transitionDuration = 1000;
      series3.stacked = true;
      series3.strokeWidth = 2;

      chart.cursor = new am4charts.XYCursor();
      chart.cursor.xAxis = dateAxis;

      // Add a legend
      chart.legend = new am4charts.Legend();
      chart.legend.position = 'top';
      const title = chart.titles.create();
      title.text = 'CPU History';
      title.fontSize = 20;
      title.marginBottom = 15;
      const self = this;
      setTimeout(() => {
        self.cpuHistoryLoading = false;
      }, 1000);
    },
    generateRAMHistory() {
      am4core.useTheme(am4themes_dark);
      am4core.useTheme(am4themes_myTheme);
      const chart = am4core.create('ramhistory', am4charts.XYChart);

      const ramData = [];

      const timePoints = Object.keys(this.fluxHistoryStats);
      timePoints.forEach((time) => {
        ramData.push({
          time: new Date(Number(time)),
          stratus: (this.fluxHistoryStats[time].stratus) * 32,
          nimbus: (this.fluxHistoryStats[time].nimbus) * 8,
          cumulus: (this.fluxHistoryStats[time].cumulus) * 4,
        });
      });

      chart.data = ramData;

      const dateAxis = chart.xAxes.push(new am4charts.DateAxis());

      const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());
      valueAxis.tooltip.disabled = true;

      const series = chart.series.push(new am4charts.LineSeries());
      series.name = 'Stratus';
      series.dataFields.dateX = 'time';
      series.dataFields.valueY = 'stratus';
      series.tooltipText = 'Stratus [bold]{valueY.value}[/]';
      series.tooltip.background.fill = am4core.color('#000');
      series.tooltip.getStrokeFromObject = true;
      series.tooltip.background.strokeWidth = 3;
      series.tooltip.getFillFromObject = false;
      series.fillOpacity = 0.6;
      series.strokeWidth = 2;
      series.stacked = true;

      const series2 = chart.series.push(new am4charts.LineSeries());
      series2.name = 'Nimbus';
      series2.dataFields.dateX = 'time';
      series2.dataFields.valueY = 'nimbus';
      series2.tooltipText = 'Nimbus [bold]{valueY.value}[/]';
      series2.tooltip.background.fill = am4core.color('#000');
      series2.tooltip.getFillFromObject = false;
      series2.tooltip.getStrokeFromObject = true;
      series2.tooltip.background.strokeWidth = 3;
      series2.sequencedInterpolation = true;
      series2.fillOpacity = 0.6;
      series2.stacked = true;
      series2.strokeWidth = 2;

      const series3 = chart.series.push(new am4charts.LineSeries());
      series3.name = 'Cumulus';
      series3.dataFields.dateX = 'time';
      series3.dataFields.valueY = 'cumulus';
      series3.tooltipText = 'Cumulus [bold]{valueY.value}[/]';
      series3.tooltip.background.fill = am4core.color('#000');
      series3.tooltip.getFillFromObject = false;
      series3.tooltip.getStrokeFromObject = true;
      series3.tooltip.background.strokeWidth = 3;
      series3.sequencedInterpolation = true;
      series3.fillOpacity = 0.6;
      series3.defaultState.transitionDuration = 1000;
      series3.stacked = true;
      series3.strokeWidth = 2;

      chart.cursor = new am4charts.XYCursor();
      chart.cursor.xAxis = dateAxis;

      // Add a legend
      chart.legend = new am4charts.Legend();
      chart.legend.position = 'top';
      const title = chart.titles.create();
      title.text = 'RAM History';
      title.fontSize = 20;
      title.marginBottom = 15;
      const self = this;
      setTimeout(() => {
        self.ramHistoryLoading = false;
      }, 1000);
    },
    generateSSDHistory() {
      am4core.useTheme(am4themes_dark);
      am4core.useTheme(am4themes_myTheme);
      const chart = am4core.create('ssdhistory', am4charts.XYChart);

      const ssdData = [];

      const timePoints = Object.keys(this.fluxHistoryStats);
      timePoints.forEach((time) => {
        ssdData.push({
          time: new Date(Number(time)),
          stratus: (this.fluxHistoryStats[time].stratus) * 600,
          nimbus: (this.fluxHistoryStats[time].nimbus) * 150,
          cumulus: (this.fluxHistoryStats[time].cumulus) * 40,
        });
      });

      chart.data = ssdData;

      const dateAxis = chart.xAxes.push(new am4charts.DateAxis());

      const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());
      valueAxis.tooltip.disabled = true;

      const series = chart.series.push(new am4charts.LineSeries());
      series.name = 'Stratus';
      series.dataFields.dateX = 'time';
      series.dataFields.valueY = 'stratus';
      series.tooltipText = 'Stratus [bold]{valueY.value}[/]';
      series.tooltip.background.fill = am4core.color('#000');
      series.tooltip.getStrokeFromObject = true;
      series.tooltip.background.strokeWidth = 3;
      series.tooltip.getFillFromObject = false;
      series.fillOpacity = 0.6;
      series.strokeWidth = 2;
      series.stacked = true;

      const series2 = chart.series.push(new am4charts.LineSeries());
      series2.name = 'Nimbus';
      series2.dataFields.dateX = 'time';
      series2.dataFields.valueY = 'nimbus';
      series2.tooltipText = 'Nimbus [bold]{valueY.value}[/]';
      series2.tooltip.background.fill = am4core.color('#000');
      series2.tooltip.getFillFromObject = false;
      series2.tooltip.getStrokeFromObject = true;
      series2.tooltip.background.strokeWidth = 3;
      series2.sequencedInterpolation = true;
      series2.fillOpacity = 0.6;
      series2.stacked = true;
      series2.strokeWidth = 2;

      const series3 = chart.series.push(new am4charts.LineSeries());
      series3.name = 'Cumulus';
      series3.dataFields.dateX = 'time';
      series3.dataFields.valueY = 'cumulus';
      series3.tooltipText = 'Cumulus [bold]{valueY.value}[/]';
      series3.tooltip.background.fill = am4core.color('#000');
      series3.tooltip.getFillFromObject = false;
      series3.tooltip.getStrokeFromObject = true;
      series3.tooltip.background.strokeWidth = 3;
      series3.sequencedInterpolation = true;
      series3.fillOpacity = 0.6;
      series3.defaultState.transitionDuration = 1000;
      series3.stacked = true;
      series3.strokeWidth = 2;

      chart.cursor = new am4charts.XYCursor();
      chart.cursor.xAxis = dateAxis;

      // Add a legend
      chart.legend = new am4charts.Legend();
      chart.legend.position = 'top';
      const title = chart.titles.create();
      title.text = 'SSD History';
      title.fontSize = 20;
      title.marginBottom = 15;
      const self = this;
      setTimeout(() => {
        self.ssdHistoryLoading = false;
      }, 1000);
    },
    generateFluxHistory() {
      am4core.useTheme(am4themes_dark);
      am4core.useTheme(am4themes_myTheme);
      const chart = am4core.create('fluxhistory', am4charts.XYChart);

      const fluxData = [];

      const timePoints = Object.keys(this.fluxHistoryStats);
      timePoints.forEach((time) => {
        fluxData.push({
          time: new Date(Number(time)),
          stratus: this.fluxHistoryStats[time].stratus,
          nimbus: this.fluxHistoryStats[time].nimbus,
          cumulus: this.fluxHistoryStats[time].cumulus,
        });
      });

      chart.data = fluxData;

      const dateAxis = chart.xAxes.push(new am4charts.DateAxis());

      const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());
      valueAxis.tooltip.disabled = true;

      const series = chart.series.push(new am4charts.LineSeries());
      series.name = 'Stratus';
      series.dataFields.dateX = 'time';
      series.dataFields.valueY = 'stratus';
      series.tooltipText = 'Stratus [bold]{valueY.value}[/]';
      series.tooltip.background.fill = am4core.color('#000');
      series.tooltip.getStrokeFromObject = true;
      series.tooltip.background.strokeWidth = 3;
      series.tooltip.getFillFromObject = false;
      series.fillOpacity = 0.6;
      series.strokeWidth = 2;
      series.stacked = true;

      const series2 = chart.series.push(new am4charts.LineSeries());
      series2.name = 'Nimbus';
      series2.dataFields.dateX = 'time';
      series2.dataFields.valueY = 'nimbus';
      series2.tooltipText = 'Nimbus [bold]{valueY.value}[/]';
      series2.tooltip.background.fill = am4core.color('#000');
      series2.tooltip.getFillFromObject = false;
      series2.tooltip.getStrokeFromObject = true;
      series2.tooltip.background.strokeWidth = 3;
      series2.sequencedInterpolation = true;
      series2.fillOpacity = 0.6;
      series2.stacked = true;
      series2.strokeWidth = 2;

      const series3 = chart.series.push(new am4charts.LineSeries());
      series3.name = 'Cumulus';
      series3.dataFields.dateX = 'time';
      series3.dataFields.valueY = 'cumulus';
      series3.tooltipText = 'Cumulus [bold]{valueY.value}[/]';
      series3.tooltip.background.fill = am4core.color('#000');
      series3.tooltip.getFillFromObject = false;
      series3.tooltip.getStrokeFromObject = true;
      series3.tooltip.background.strokeWidth = 3;
      series3.sequencedInterpolation = true;
      series3.fillOpacity = 0.6;
      series3.defaultState.transitionDuration = 1000;
      series3.stacked = true;
      series3.strokeWidth = 2;

      chart.cursor = new am4charts.XYCursor();
      chart.cursor.xAxis = dateAxis;

      // Add a legend
      chart.legend = new am4charts.Legend();
      chart.legend.position = 'top';
      const self = this;
      setTimeout(() => {
        self.fluxHistoryLoading = false;
      }, 1000);
    },
    generateFluxPieChart() {
      am4core.useTheme(am4themes_dark);
      am4core.useTheme(am4themes_myTheme);
      // Create chart instance
      const chart = am4core.create('currentNodesChart', am4charts.PieChart);

      const timePoints = Object.keys(this.fluxHistoryStats);
      const max = Math.max(...timePoints);

      const total = (this.fluxHistoryStats[max].stratus + this.fluxHistoryStats[max].nimbus + this.fluxHistoryStats[max].cumulus);

      // Add data
      chart.data = [
        {
          type: 'Stratus',
          value: this.fluxHistoryStats[max].stratus,
        },
        {
          type: 'Nimbus',
          value: this.fluxHistoryStats[max].nimbus,
        },
        {
          type: 'Cumulus',
          value: this.fluxHistoryStats[max].cumulus,
        },
      ];

      // Add and configure Series
      const pieSeries = chart.series.push(new am4charts.PieSeries());
      // Let's cut a hole in our Pie chart the size of 30% the radius
      chart.innerRadius = am4core.percent(30);

      // Put a thick white border around each Slice
      pieSeries.slices.template.stroke = am4core.color('#fff');
      pieSeries.slices.template.strokeWidth = 2;
      pieSeries.slices.template.strokeOpacity = 1;

      // pieSeries.alignLabels = false;
      // pieSeries.labels.template.bent = false;
      // pieSeries.labels.template.radius = 3;
      // pieSeries.labels.template.padding(0, 0, 0, 0);
      pieSeries.ticks.template.disabled = true;
      pieSeries.labels.template.disabled = true;

      pieSeries.ticks.template.disabled = true;

      // Create a base filter effect (as if it's not there) for the hover to return to
      const shadow = pieSeries.slices.template.filters.push(new am4core.DropShadowFilter());
      shadow.opacity = 0;

      // Create hover state
      const hoverState = pieSeries.slices.template.states.getKey('hover'); // normally we have to create the hover state, in this case it already exists

      // Slightly shift the shadow and make it more prominent on hover
      const hoverShadow = hoverState.filters.push(new am4core.DropShadowFilter());
      hoverShadow.opacity = 0.7;
      hoverShadow.blur = 5;

      // Add a legend
      chart.legend = new am4charts.Legend();

      pieSeries.dataFields.value = 'value';
      pieSeries.dataFields.category = 'type';

      // This creates initial animation
      pieSeries.hiddenState.properties.opacity = 1;
      pieSeries.hiddenState.properties.endAngle = -90;
      pieSeries.hiddenState.properties.startAngle = -90;
      const title = chart.titles.create();
      title.text = `Flux Nodes: ${total}`;
      title.fontSize = 20;
      title.marginBottom = 15;
      const self = this;
      setTimeout(() => {
        self.currentNodesChartLoading = false;
      }, 1000);
    },
    generatelockedSupplyPercList() {
      am4core.useTheme(am4themes_dark);
      am4core.useTheme(am4themes_myTheme);
      // Create chart instance
      const chart = am4core.create('lockedSupplyPercChart', am4charts.PieChart);

      const timePoints = Object.keys(this.fluxHistoryStats);
      const max = Math.max(...timePoints);
      const cumulusS = (this.fluxHistoryStats[max].cumulus) * 10000;
      const nimbusS = (this.fluxHistoryStats[max].nimbus) * 25000;
      const stratusS = (this.fluxHistoryStats[max].stratus) * 100000;

      const total = cumulusS + nimbusS + stratusS;

      // Add data
      chart.data = [
        {
          type: 'Stratus ',
          value: stratusS,
        },
        {
          type: 'Nimbus',
          value: nimbusS,
        },
        {
          type: 'Cumulus',
          value: cumulusS,
        },
      ];

      // Add and configure Series
      const pieSeries = chart.series.push(new am4charts.PieSeries());
      // Let's cut a hole in our Pie chart the size of 30% the radius
      chart.innerRadius = am4core.percent(30);

      // Put a thick white border around each Slice
      pieSeries.slices.template.stroke = am4core.color('#fff');
      pieSeries.slices.template.strokeWidth = 2;
      pieSeries.slices.template.strokeOpacity = 1;

      // pieSeries.alignLabels = false;
      // pieSeries.labels.template.bent = false;
      // pieSeries.labels.template.radius = 3;
      // pieSeries.labels.template.padding(0, 0, 0, 0);
      pieSeries.ticks.template.disabled = true;
      pieSeries.labels.template.disabled = true;

      pieSeries.ticks.template.disabled = true;

      // Create a base filter effect (as if it's not there) for the hover to return to
      const shadow = pieSeries.slices.template.filters.push(new am4core.DropShadowFilter());
      shadow.opacity = 0;

      // Create hover state
      const hoverState = pieSeries.slices.template.states.getKey('hover'); // normally we have to create the hover state, in this case it already exists

      // Slightly shift the shadow and make it more prominent on hover
      const hoverShadow = hoverState.filters.push(new am4core.DropShadowFilter());
      hoverShadow.opacity = 0.7;
      hoverShadow.blur = 5;

      // Add a legend
      chart.legend = new am4charts.Legend();

      pieSeries.dataFields.value = 'value';
      pieSeries.dataFields.category = 'type';

      // This creates initial animation
      pieSeries.hiddenState.properties.opacity = 1;
      pieSeries.hiddenState.properties.endAngle = -90;
      pieSeries.hiddenState.properties.startAngle = -90;
      const title = chart.titles.create();
      title.text = `Locked Supply: ${this.beautifyValue(total)}`;
      title.fontSize = 20;
      title.marginBottom = 15;
      const self = this;
      setTimeout(() => {
        self.supplyLoading = false;
      }, 1000);
    },
    generateGeographicPie() {
      am4core.useTheme(am4themes_dark);
      // Create chart instance
      const chart = am4core.create('geolocationPie', am4charts.PieChart);

      const nodeData = [];

      this.fluxList.forEach((flux) => {
        if (flux.location) {
          const existingPoint = nodeData.find((node) => (node.country === flux.location.country));
          if (existingPoint) {
            existingPoint.amount += 1;
          } else {
            const point = {
              country: flux.location.country || 'Unknown',
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
      // Add data
      chart.data = nodeData;

      // Add and configure Series
      const pieSeries = chart.series.push(new am4charts.PieSeries());
      // Let's cut a hole in our Pie chart the size of 30% the radius
      chart.innerRadius = am4core.percent(30);

      // Put a thick white border around each Slice
      pieSeries.slices.template.stroke = am4core.color('#fff');
      pieSeries.slices.template.strokeWidth = 2;
      pieSeries.slices.template.strokeOpacity = 1;

      pieSeries.ticks.template.disabled = true;
      pieSeries.labels.template.disabled = true;

      pieSeries.ticks.template.disabled = true;

      // Create a base filter effect (as if it's not there) for the hover to return to
      const shadow = pieSeries.slices.template.filters.push(new am4core.DropShadowFilter());
      shadow.opacity = 0;

      // Create hover state
      const hoverState = pieSeries.slices.template.states.getKey('hover'); // normally we have to create the hover state, in this case it already exists

      // Slightly shift the shadow and make it more prominent on hover
      const hoverShadow = hoverState.filters.push(new am4core.DropShadowFilter());
      hoverShadow.opacity = 0.7;
      hoverShadow.blur = 5;

      // Add a legend
      chart.legend = new am4charts.Legend();
      chart.legend.scrollable = true;
      chart.legend.maxHeight = 200;

      pieSeries.dataFields.value = 'amount';
      pieSeries.dataFields.category = 'country';

      // This creates initial animation
      pieSeries.hiddenState.properties.opacity = 1;
      pieSeries.hiddenState.properties.endAngle = -90;
      pieSeries.hiddenState.properties.startAngle = -90;
      const title = chart.titles.create();
      title.text = 'Geographic Locations';
      title.fontSize = 20;
      const self = this;
      setTimeout(() => {
        self.currentNodesChartLoading = false;
      }, 1000);
    },
    generateProviderPie() {
      am4core.useTheme(am4themes_dark);
      // Create chart instance
      const chart = am4core.create('providerPie', am4charts.PieChart);

      const nodeData = [];

      this.fluxList.forEach((flux) => {
        if (flux.location) {
          const existingPoint = nodeData.find((node) => (node.org === flux.location.org));
          if (existingPoint) {
            existingPoint.amount += 1;
          } else {
            const point = {
              org: flux.location.org || 'Unknown',
              amount: 1,
            };
            nodeData.push(point);
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
      // Add data
      chart.data = nodeData;

      // Add and configure Series
      const pieSeries = chart.series.push(new am4charts.PieSeries());
      // Let's cut a hole in our Pie chart the size of 30% the radius
      chart.innerRadius = am4core.percent(30);

      // Put a thick white border around each Slice
      pieSeries.slices.template.stroke = am4core.color('#fff');
      pieSeries.slices.template.strokeWidth = 2;
      pieSeries.slices.template.strokeOpacity = 1;

      pieSeries.ticks.template.disabled = true;
      pieSeries.labels.template.disabled = true;

      pieSeries.ticks.template.disabled = true;

      // Create a base filter effect (as if it's not there) for the hover to return to
      const shadow = pieSeries.slices.template.filters.push(new am4core.DropShadowFilter());
      shadow.opacity = 0;

      // Create hover state
      const hoverState = pieSeries.slices.template.states.getKey('hover'); // normally we have to create the hover state, in this case it already exists

      // Slightly shift the shadow and make it more prominent on hover
      const hoverShadow = hoverState.filters.push(new am4core.DropShadowFilter());
      hoverShadow.opacity = 0.7;
      hoverShadow.blur = 5;

      // Add a legend
      chart.legend = new am4charts.Legend();
      chart.legend.scrollable = true;
      chart.legend.maxHeight = 200;

      pieSeries.dataFields.value = 'amount';
      pieSeries.dataFields.category = 'org';

      // This creates initial animation
      pieSeries.hiddenState.properties.opacity = 1;
      pieSeries.hiddenState.properties.endAngle = -90;
      pieSeries.hiddenState.properties.startAngle = -90;
      const title = chart.titles.create();
      title.text = 'Providers';
      title.fontSize = 20;
      const self = this;
      setTimeout(() => {
        self.currentNodesChartLoading = false;
      }, 1000);
    },
    processData() {
      const data = [];
      for (let i = 0; i < this.historicalPrices.length; i += 1) {
        const element = this.historicalPrices[i];
        data.push({
          date: element[0],
          priceFiat: element[1],
        });
      }
      return data;
    },
    fillChartData() {
      const fiatCode = 'USD';

      am4core.useTheme(am4themes_dark);
      const colorFiat = '#183c87';
      // Themes end

      // Create chart instance
      const chart = am4core.create('priceChart', am4charts.XYChart);

      // Create axes
      const dateAxis = chart.xAxes.push(new am4charts.DateAxis());
      this.dateAxis = dateAxis;
      dateAxis.dataFields.category = 'category';
      dateAxis.renderer.grid.template.location = 0;
      dateAxis.dateFormatter.dateFormat = 'MM-dd-yyyy';
      dateAxis.tooltipDateFormat = 'dd MMM yyyy,  HH:mm';

      // Data
      const data = this.processData();
      chart.data = data;

      // y Axes
      const valueAxisFiat = chart.yAxes.push(new am4charts.ValueAxis());

      //  PRICE IN FIAT
      const series1 = chart.series.push(new am4charts.LineSeries());
      series1.dataFields.valueY = 'priceFiat';
      series1.dataFields.categoryX = 'date';
      series1.name = `Price (${fiatCode})`;
      series1.strokeWidth = 4;
      series1.tensionX = 0.9;
      series1.tensionY = 0.9;
      series1.stroke = am4core.color('#ffffff');
      series1.yAxis = valueAxisFiat;
      series1.dataFields.dateX = 'date';
      series1.sequencedInterpolation = false;
      series1.defaultState.transitionDuration = 1000;
      series1.hiddenState.transitionDuration = 1000;

      const series2 = chart.series.push(new am4charts.LineSeries());
      series2.dataFields.valueY = 'priceFiat';
      series2.dataFields.categoryX = 'date';
      series2.name = `Price (${fiatCode})`;
      series2.strokeWidth = 2;
      series2.tensionX = 0.9;
      series2.tensionY = 0.9;
      series2.stroke = am4core.color(colorFiat);
      series2.tooltipText = `Price: [bold]{valueY}[/] ${fiatCode}`;
      series2.tooltip.autoTextColor = false;
      series2.tooltip.label.fill = am4core.color('#FFFFFF');
      series2.tooltip.getFillFromObject = false;
      series2.tooltip.background.fill = am4core.color(colorFiat);
      series2.tooltip.background.fillOpacity = 0.75;
      series2.tooltip.animationDuration = 500;
      series2.yAxis = valueAxisFiat;
      series2.dataFields.dateX = 'date';
      series2.sequencedInterpolation = true;
      series2.defaultState.transitionDuration = 500;
      series2.hiddenState.transitionDuration = 500;

      // Price at side of Chart
      valueAxisFiat.title.text = `Price  (${fiatCode})`;
      valueAxisFiat.renderer.line.strokeOpacity = 0.8;
      valueAxisFiat.renderer.line.strokeWidth = 1;
      valueAxisFiat.renderer.grid.template.disabled = true;
      valueAxisFiat.renderer.opposite = true;
      valueAxisFiat.min = valueAxisFiat.minZoomed;
      valueAxisFiat.max = valueAxisFiat.maxZoomed;

      chart.cursor = new am4charts.XYCursor();
      chart.cursor.behavior = 'zoomX';
    },
    getFiatRate(coin) {
      const coinRateToUse = 'USD';
      let rateObj = this.rates[0].find((rate) => rate.code === coinRateToUse);
      if (rateObj === undefined) {
        rateObj = { rate: 0 };
      }
      let btcRateforCoin = this.rates[1][coin];
      if (btcRateforCoin === undefined) {
        btcRateforCoin = 0;
      }
      const fiatRate = rateObj.rate * btcRateforCoin;
      return fiatRate;
    },
    beautifyValue(value) {
      const fixedValue = value.toFixed(2);
      return fixedValue.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
    },
  },
};
</script>

<style scoped>
.gridTwo {
  text-align: center;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto;
  justify-items: center;
  align-items: center;
}

.gridThree {
  text-align: center;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr;
  justify-items: center;
  align-items: center;
}

@media (max-width: 699px) {
  .gridTwo {
    text-align: center;
    display: grid;
    grid-template-columns: auto;
    grid-template-rows: auto auto;
    justify-items: center;
    align-items: center;
  }

  .gridThree {
    text-align: center;
    display: grid;
    grid-template-columns: auto;
    grid-template-rows: auto auto auto;
    justify-items: center;
    align-items: center;
  }
}

#mapchart {
  width: 90%;
  height: 60vh;
}

#priceChart {
  width: 100%;
  height: 60vh;
}

#cpucurrent,
#ramcurrent,
#ssdcurrent,
#cpuhistory,
#ramhistory,
#ssdhistory,
#fluxhistory,
#currentNodesChart,
#lockedSupplyPercChart {
  width: 100%;
  height: 300px;
}

#geolocationPie,
#providerPie {
  width: 100%;
  height: 800px;
}
</style>
