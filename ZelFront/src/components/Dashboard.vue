<template>
  <div>
    <div v-if="dashboardSection === 'dashboard'">
      <el-tabs v-model="activeName">
        <el-tab-pane
          label="Overview"
          name="overview"
        >
          <div v-if="historyStatsLoading === true">
            loading...
          </div>
          <div class="gridTwo">
            <div id="currentNodesChart" />
            <div id="fluxhistory" />
          </div>
          <div class="gridThree">
          </div>
        </el-tab-pane>
        <el-tab-pane
          label="List"
          name="nodes"
        >
          <el-table
            :data="fluxList"
            empty-text="Flux Nodes are loading..."
            style="width: 100%"
            height="680"
            v-loading="fluxListLoading"
            lazy
          >
            <el-table-column
              fixed
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
              fixed="right"
              label="Visit"
              width="120"
            >
              <template slot-scope="scope">
                <el-button @click="openFlux(scope.row.ip)">
                  Visit
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane
          label="Resources"
          name="resources"
        >
          <div v-if="historyStatsLoading === true">
            loading...
          </div>
          <div class="gridThree">
            <div id="cpucurrent" />
            <div id="ramcurrent" />
            <div id="ssdcurrent" />
          </div>
          <div class="gridThree">
            <div id="cpuhistory" />
            <div id="ramhistory" />
            <div id="ssdhistory" />
          </div>
        </el-tab-pane>
        <el-tab-pane
          label="Map"
          name="map"
        >
          <div v-if="fluxListLoading === true">
            loading...
          </div>
          <div id="mapchart">
          </div>
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

const axios = require('axios');

Vue.use(Vuex);

// const vue = new Vue();

export default {
  name: 'Dashboard',
  components: {
  },
  data() {
    return {
      circulatingSupply: 0, // number
      rates: [],
      fluxList: [],
      fluxHistoryStats: [],
      ratesLoading: true,
      circSupplyLoading: true,
      historyStatsLoading: true,
      fluxListLoading: true,
      activeName: 'resources',
      timeoptions: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
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
      this.getRates();
      this.getFluxList();
      this.getCircSupply();
    },
    async getCircSupply() {
      this.circSupplyLoading = true;
      const result = await axios.get('https://explorer.zel.network/api/supply');
      this.circulatingSupply = result.data;
      this.circSupplyLoading = false;
    },
    async getRates() {
      this.ratesLoading = true;
      const result = await axios.get('https://vipdrates.zelcore.io/rates');
      this.rates = result.data;
      this.ratesLoading = false;
    },
    async getHistoryStats() {
      try {
        this.historyStatsLoading = true;
        const result = await axios.get('https://api.flux.zel.network/fluxhistorystats');
        this.fluxHistoryStats = result.data.data;
        this.historyStatsLoading = false;
        this.generateCPUHistory();
        this.generateRAMHistory();
        this.generateSSDHistory();
        this.generateFluxPieChart();
        this.generateFluxHistory();
      } catch (error) {
        console.log(error);
      }
    },
    async getFluxList() {
      try {
        this.fluxListLoading = true;
        const resLoc = await axios.get('https://api.flux.zel.network/fluxlocations');
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
      circle.stroke = am4core.color('#FFFFFF');
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
      // Create chart instance
      const chart = am4core.create('cpucurrent', am4charts.XYChart);

      const basics = this.fluxList.filter((nodes) => nodes.tier === 'BASIC');
      const supers = this.fluxList.filter((nodes) => nodes.tier === 'SUPER');
      const bamfs = this.fluxList.filter((nodes) => nodes.tier === 'BAMF');

      const basicValue = basics.length * 2;
      const superValue = supers.length * 4;
      const bamfValue = bamfs.length * 8;

      // Add data
      chart.data = [
        {
          category: 'Basic',
          value: basicValue,
        },
        {
          category: 'Super',
          value: superValue,
        },
        {
          category: 'Bamf',
          value: bamfValue,
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
    },
    generateRAM() {
      // Create chart instance
      const chart = am4core.create('ramcurrent', am4charts.XYChart);

      const basics = this.fluxList.filter((nodes) => nodes.tier === 'BASIC');
      const supers = this.fluxList.filter((nodes) => nodes.tier === 'SUPER');
      const bamfs = this.fluxList.filter((nodes) => nodes.tier === 'BAMF');

      const basicValue = basics.length * 4;
      const superValue = supers.length * 8;
      const bamfValue = bamfs.length * 30;

      // Add data
      chart.data = [
        {
          category: 'Basic',
          value: basicValue,
        },
        {
          category: 'Super',
          value: superValue,
        },
        {
          category: 'Bamf',
          value: bamfValue,
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
    },
    generateSSD() {
      // Create chart instance
      const chart = am4core.create('ssdcurrent', am4charts.XYChart);

      const basics = this.fluxList.filter((nodes) => nodes.tier === 'BASIC');
      const supers = this.fluxList.filter((nodes) => nodes.tier === 'SUPER');
      const bamfs = this.fluxList.filter((nodes) => nodes.tier === 'BAMF');

      const basicValue = basics.length * 40;
      const superValue = supers.length * 150;
      const bamfValue = bamfs.length * 600;

      // Add data
      chart.data = [
        {
          category: 'Basic',
          value: basicValue,
        },
        {
          category: 'Super',
          value: superValue,
        },
        {
          category: 'Bamf',
          value: bamfValue,
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
    },
    generateCPUHistory() {
      console.log('HERE');
      const chart = am4core.create('cpuhistory', am4charts.XYChart);

      const cpuData = [];

      const timePoints = Object.keys(this.fluxHistoryStats);
      timePoints.forEach((time) => {
        cpuData.push({
          time: new Date(Number(time)),
          bamf: this.fluxHistoryStats[time].bamf * 8,
          super: this.fluxHistoryStats[time].super * 4,
          basic: this.fluxHistoryStats[time].basic * 2,
        });
      });

      chart.data = cpuData;
      console.log(cpuData);

      const dateAxis = chart.xAxes.push(new am4charts.DateAxis());

      const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());
      valueAxis.tooltip.disabled = true;

      const series = chart.series.push(new am4charts.LineSeries());
      series.name = 'Bamf';
      series.dataFields.dateX = 'time';
      series.dataFields.valueY = 'bamf';
      series.tooltipText = 'Bamf [bold]{valueY.value}[/]';
      series.tooltip.background.fill = am4core.color('#FFF');
      series.tooltip.getStrokeFromObject = true;
      series.tooltip.background.strokeWidth = 3;
      series.tooltip.getFillFromObject = false;
      series.fillOpacity = 0.6;
      series.strokeWidth = 2;
      series.stacked = true;

      const series2 = chart.series.push(new am4charts.LineSeries());
      series2.name = 'Super';
      series2.dataFields.dateX = 'time';
      series2.dataFields.valueY = 'super';
      series2.tooltipText = 'Super [bold]{valueY.value}[/]';
      series2.tooltip.background.fill = am4core.color('#FFF');
      series2.tooltip.getFillFromObject = false;
      series2.tooltip.getStrokeFromObject = true;
      series2.tooltip.background.strokeWidth = 3;
      series2.sequencedInterpolation = true;
      series2.fillOpacity = 0.6;
      series2.stacked = true;
      series2.strokeWidth = 2;

      const series3 = chart.series.push(new am4charts.LineSeries());
      series3.name = 'Basic';
      series3.dataFields.dateX = 'time';
      series3.dataFields.valueY = 'basic';
      series3.tooltipText = 'Basic [bold]{valueY.value}[/]';
      series3.tooltip.background.fill = am4core.color('#FFF');
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
    },
    generateRAMHistory() {
      const chart = am4core.create('ramhistory', am4charts.XYChart);

      const ramData = [];

      const timePoints = Object.keys(this.fluxHistoryStats);
      timePoints.forEach((time) => {
        ramData.push({
          time: new Date(Number(time)),
          bamf: this.fluxHistoryStats[time].bamf * 30,
          super: this.fluxHistoryStats[time].super * 8,
          basic: this.fluxHistoryStats[time].basic * 4,
        });
      });

      chart.data = ramData;

      const dateAxis = chart.xAxes.push(new am4charts.DateAxis());

      const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());
      valueAxis.tooltip.disabled = true;

      const series = chart.series.push(new am4charts.LineSeries());
      series.name = 'Bamf';
      series.dataFields.dateX = 'time';
      series.dataFields.valueY = 'bamf';
      series.tooltipText = 'Bamf [bold]{valueY.value}[/]';
      series.tooltip.background.fill = am4core.color('#FFF');
      series.tooltip.getStrokeFromObject = true;
      series.tooltip.background.strokeWidth = 3;
      series.tooltip.getFillFromObject = false;
      series.fillOpacity = 0.6;
      series.strokeWidth = 2;
      series.stacked = true;

      const series2 = chart.series.push(new am4charts.LineSeries());
      series2.name = 'Super';
      series2.dataFields.dateX = 'time';
      series2.dataFields.valueY = 'super';
      series2.tooltipText = 'Super [bold]{valueY.value}[/]';
      series2.tooltip.background.fill = am4core.color('#FFF');
      series2.tooltip.getFillFromObject = false;
      series2.tooltip.getStrokeFromObject = true;
      series2.tooltip.background.strokeWidth = 3;
      series2.sequencedInterpolation = true;
      series2.fillOpacity = 0.6;
      series2.stacked = true;
      series2.strokeWidth = 2;

      const series3 = chart.series.push(new am4charts.LineSeries());
      series3.name = 'Basic';
      series3.dataFields.dateX = 'time';
      series3.dataFields.valueY = 'basic';
      series3.tooltipText = 'Basic [bold]{valueY.value}[/]';
      series3.tooltip.background.fill = am4core.color('#FFF');
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
    },
    generateSSDHistory() {
      const chart = am4core.create('ssdhistory', am4charts.XYChart);

      const ssdData = [];

      const timePoints = Object.keys(this.fluxHistoryStats);
      timePoints.forEach((time) => {
        ssdData.push({
          time: new Date(Number(time)),
          bamf: this.fluxHistoryStats[time].bamf * 600,
          super: this.fluxHistoryStats[time].super * 150,
          basic: this.fluxHistoryStats[time].basic * 40,
        });
      });

      chart.data = ssdData;

      const dateAxis = chart.xAxes.push(new am4charts.DateAxis());

      const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());
      valueAxis.tooltip.disabled = true;

      const series = chart.series.push(new am4charts.LineSeries());
      series.name = 'Bamf';
      series.dataFields.dateX = 'time';
      series.dataFields.valueY = 'bamf';
      series.tooltipText = 'Bamf [bold]{valueY.value}[/]';
      series.tooltip.background.fill = am4core.color('#FFF');
      series.tooltip.getStrokeFromObject = true;
      series.tooltip.background.strokeWidth = 3;
      series.tooltip.getFillFromObject = false;
      series.fillOpacity = 0.6;
      series.strokeWidth = 2;
      series.stacked = true;

      const series2 = chart.series.push(new am4charts.LineSeries());
      series2.name = 'Super';
      series2.dataFields.dateX = 'time';
      series2.dataFields.valueY = 'super';
      series2.tooltipText = 'Super [bold]{valueY.value}[/]';
      series2.tooltip.background.fill = am4core.color('#FFF');
      series2.tooltip.getFillFromObject = false;
      series2.tooltip.getStrokeFromObject = true;
      series2.tooltip.background.strokeWidth = 3;
      series2.sequencedInterpolation = true;
      series2.fillOpacity = 0.6;
      series2.stacked = true;
      series2.strokeWidth = 2;

      const series3 = chart.series.push(new am4charts.LineSeries());
      series3.name = 'Basic';
      series3.dataFields.dateX = 'time';
      series3.dataFields.valueY = 'basic';
      series3.tooltipText = 'Basic [bold]{valueY.value}[/]';
      series3.tooltip.background.fill = am4core.color('#FFF');
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
    },
    generateFluxHistory() {
      const chart = am4core.create('fluxhistory', am4charts.XYChart);

      const fluxData = [];

      const timePoints = Object.keys(this.fluxHistoryStats);
      timePoints.forEach((time) => {
        fluxData.push({
          time: new Date(Number(time)),
          bamf: this.fluxHistoryStats[time].bamf,
          super: this.fluxHistoryStats[time].super,
          basic: this.fluxHistoryStats[time].basic,
        });
      });

      chart.data = fluxData;

      const dateAxis = chart.xAxes.push(new am4charts.DateAxis());

      const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());
      valueAxis.tooltip.disabled = true;

      const series = chart.series.push(new am4charts.LineSeries());
      series.name = 'Bamf';
      series.dataFields.dateX = 'time';
      series.dataFields.valueY = 'bamf';
      series.tooltipText = 'Bamf [bold]{valueY.value}[/]';
      series.tooltip.background.fill = am4core.color('#FFF');
      series.tooltip.getStrokeFromObject = true;
      series.tooltip.background.strokeWidth = 3;
      series.tooltip.getFillFromObject = false;
      series.fillOpacity = 0.6;
      series.strokeWidth = 2;
      series.stacked = true;

      const series2 = chart.series.push(new am4charts.LineSeries());
      series2.name = 'Super';
      series2.dataFields.dateX = 'time';
      series2.dataFields.valueY = 'super';
      series2.tooltipText = 'Super [bold]{valueY.value}[/]';
      series2.tooltip.background.fill = am4core.color('#FFF');
      series2.tooltip.getFillFromObject = false;
      series2.tooltip.getStrokeFromObject = true;
      series2.tooltip.background.strokeWidth = 3;
      series2.sequencedInterpolation = true;
      series2.fillOpacity = 0.6;
      series2.stacked = true;
      series2.strokeWidth = 2;

      const series3 = chart.series.push(new am4charts.LineSeries());
      series3.name = 'Basic';
      series3.dataFields.dateX = 'time';
      series3.dataFields.valueY = 'basic';
      series3.tooltipText = 'Basic [bold]{valueY.value}[/]';
      series3.tooltip.background.fill = am4core.color('#FFF');
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
    },
    generateFluxPieChart() {
      // Create chart instance
      const chart = am4core.create('currentNodesChart', am4charts.PieChart);

      const timePoints = Object.keys(this.fluxHistoryStats);
      const max = Math.max(...timePoints);

      // Add data
      chart.data = [
        {
          type: 'Bamf',
          value: this.fluxHistoryStats[max].bamf,
        },
        {
          type: 'Super',
          value: this.fluxHistoryStats[max].super,
        },
        {
          type: 'Basic',
          value: this.fluxHistoryStats[max].basic,
        },
      ];

      // Add and configure Series
      const pieSeries = chart.series.push(new am4charts.PieSeries());
      pieSeries.dataFields.value = 'value';
      pieSeries.dataFields.category = 'type';
      pieSeries.slices.template.stroke = am4core.color('#fff');
      pieSeries.slices.template.strokeWidth = 2;
      pieSeries.slices.template.strokeOpacity = 1;

      // This creates initial animation
      pieSeries.hiddenState.properties.opacity = 1;
      pieSeries.hiddenState.properties.endAngle = -90;
      pieSeries.hiddenState.properties.startAngle = -90;
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
  width: 100%;
  height: 70vh;
}

#cpucurrent,
#ramcurrent,
#ssdcurrent,
#cpuhistory,
#ramhistory,
#ssdhistory,
#fluxhistory,
#currentNodesChart {
  width: 100%;
  height: 300px;
}
</style>
