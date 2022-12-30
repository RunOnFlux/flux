<template>
  <div>
    <b-row>
      <b-col
        md="6"
        sm="12"
        lg="3"
      >
        <b-overlay
          :show="fluxListLoading"
          variant="transparent"
          blur="5px"
        >
          <b-card no-body>
            <b-card-body
              class="mr-2"
            >
              <b-avatar
                size="48"
                variant="light-success"
              >
                <feather-icon
                  size="24"
                  icon="CpuIcon"
                />
              </b-avatar>
              <h2 class="mt-1">
                Total Cores: {{ beautifyValue(totalCores, 0) }}
              </h2>
              <vue-apex-charts
                type="bar"
                height="400"
                :options="cpuData.chartOptions"
                :series="cpuData.series"
              />
            </b-card-body>
          </b-card>
        </b-overlay>
      </b-col>
      <b-col
        md="6"
        sm="12"
        lg="3"
      >
        <b-overlay
          :show="fluxListLoading"
          variant="transparent"
          blur="5px"
        >
          <b-card no-body>
            <b-card-body
              class="mr-2"
            >
              <b-avatar
                size="48"
                variant="light-success"
              >
                <feather-icon
                  size="24"
                  icon="DatabaseIcon"
                />
              </b-avatar>
              <h2 class="mt-1">
                Total RAM: {{ beautifyValue(totalRAM / 1024, 2) }} TB
              </h2>
              <vue-apex-charts
                type="bar"
                height="400"
                :options="ramData.chartOptions"
                :series="ramData.series"
              />
            </b-card-body>
          </b-card>
        </b-overlay>
      </b-col>
      <b-col
        md="6"
        sm="12"
        lg="3"
      >
        <b-overlay
          :show="fluxListLoading"
          variant="transparent"
          blur="5px"
        >
          <b-card no-body>
            <b-card-body
              class="mr-2"
            >
              <b-avatar
                size="48"
                variant="light-success"
              >
                <feather-icon
                  size="24"
                  icon="HardDriveIcon"
                />
              </b-avatar>
              <h2 class="mt-1">
                Total SSD: {{ beautifyValue(totalSSD / 1000000, 2) }} PB
              </h2>
              <vue-apex-charts
                type="bar"
                height="400"
                :options="ssdData.chartOptions"
                :series="ssdData.series"
              />
            </b-card-body>
          </b-card>
        </b-overlay>
      </b-col>
      <b-col
        md="6"
        sm="12"
        lg="3"
      >
        <b-overlay
          :show="fluxListLoading"
          variant="transparent"
          blur="5px"
        >
          <b-card no-body>
            <b-card-body
              class="mr-2"
            >
              <b-avatar
                size="48"
                variant="light-success"
              >
                <feather-icon
                  size="24"
                  icon="HardDriveIcon"
                />
              </b-avatar>
              <h2 class="mt-1">
                Total HDD: {{ beautifyValue(totalHDD / 1000, 2) }} TB
              </h2>
              <vue-apex-charts
                type="bar"
                height="400"
                :options="hddData.chartOptions"
                :series="hddData.series"
              />
            </b-card-body>
          </b-card>
        </b-overlay>
      </b-col>
    </b-row>
    <b-row>
      <b-col
        md="12"
        sm="12"
        lg="4"
      >
        <b-overlay
          :show="historyStatsLoading"
          variant="transparent"
          blur="5px"
        >
          <b-card no-body>
            <b-card-body
              class="mr-2"
            >
              <b-avatar
                size="48"
                variant="light-success"
              >
                <feather-icon
                  size="24"
                  icon="CpuIcon"
                />
              </b-avatar>
              <h2 class="mt-1">
                CPU History
              </h2>
            </b-card-body>
            <vue-apex-charts
              type="area"
              height="200"
              width="100%"
              :options="cpuHistoryData.chartOptions"
              :series="cpuHistoryData.series"
            />
          </b-card>
        </b-overlay>
      </b-col>
      <b-col
        md="6"
        sm="12"
        lg="4"
      >
        <b-overlay
          :show="historyStatsLoading"
          variant="transparent"
          blur="5px"
        >
          <b-card no-body>
            <b-card-body
              class="mr-2"
            >
              <b-avatar
                size="48"
                variant="light-success"
              >
                <feather-icon
                  size="24"
                  icon="DatabaseIcon"
                />
              </b-avatar>
              <h2 class="mt-1">
                RAM History
              </h2>
            </b-card-body>
            <vue-apex-charts
              type="area"
              height="200"
              width="100%"
              :options="ramHistoryData.chartOptions"
              :series="ramHistoryData.series"
            />
          </b-card>
        </b-overlay>
      </b-col>
      <b-col
        md="6"
        sm="12"
        lg="4"
      >
        <b-overlay
          :show="historyStatsLoading"
          variant="transparent"
          blur="5px"
        >
          <b-card no-body>
            <b-card-body
              class="mr-2"
            >
              <b-avatar
                size="48"
                variant="light-success"
              >
                <feather-icon
                  size="24"
                  icon="HardDriveIcon"
                />
              </b-avatar>
              <h2 class="mt-1">
                Storage History
              </h2>
            </b-card-body>
            <vue-apex-charts
              type="area"
              height="200"
              width="100%"
              :options="ssdHistoryData.chartOptions"
              :series="ssdHistoryData.series"
            />
          </b-card>
        </b-overlay>
      </b-col>
    </b-row>
  </div>
</template>

<script>
import {
  BOverlay,
  BCard,
  BCardBody,
  BRow,
  BCol,
  BAvatar,
} from 'bootstrap-vue';
import VueApexCharts from 'vue3-apexcharts';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import tierColors from '@/libs/colors';

import axios from 'axios';

export default {
  components: {
    BCard,
    BCardBody,
    BRow,
    BCol,
    BOverlay,
    BAvatar,
    VueApexCharts,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  data() {
    return {
      timeoptions: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
      fluxListLoading: true,
      fluxList: [],
      totalCores: 0,
      totalRAM: 0,
      totalSSD: 0,
      totalHDD: 0,
      cumulusCpuValue: 0,
      nimbusCpuValue: 0,
      stratusCpuValue: 0,
      cumulusRamValue: 0,
      nimbusRamValue: 0,
      stratusRamValue: 0,
      cumulusSSDStorageValue: 0,
      cumulusHDDStorageValue: 0,
      nimbusSSDStorageValue: 0,
      nimbusHDDStorageValue: 0,
      stratusSSDStorageValue: 0,
      stratusHDDStorageValue: 0,
      cpuData: {
        series: [],
        chartOptions: {
          colors: [tierColors.cumulus, tierColors.nimbus, tierColors.stratus],
          plotOptions: {
            bar: {
              columnWidth: '85%',
              distributed: true,
            },
          },
          dataLabels: {
            enabled: false,
          },
          legend: {
            show: false,
          },
          xaxis: {
            labels: {
              categories: ['Cumulus', 'Nimbus', 'Stratus'],
              style: {
                colors: [tierColors.cumulus, tierColors.nimbus, tierColors.stratus],
                fontSize: '14px',
                fontFamily: 'Montserrat',
              },
            },
          },
          yaxis: {
            labels: {
              style: {
                colors: '#888',
                fontSize: '14px',
                fontFamily: 'Montserrat',
              },
              formatter: (value) => this.beautifyValue(value, 0),
            },
          },
          stroke: {
            lineCap: 'round',
          },
          labels: ['Cumulus', 'Nimbus', 'Stratus'],
        },
      },
      cpuHistoryData: {
        series: [],
        chartOptions: {
          colors: [tierColors.cumulus, tierColors.nimbus, tierColors.stratus],
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
              opacityFrom: 0.5,
              opacityTo: 0,
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
            y: {
              formatter: (value) => this.beautifyValue(value, 0),
            },
          },
        },
      },
      ramData: {
        series: [],
        chartOptions: {
          colors: [tierColors.cumulus, tierColors.nimbus, tierColors.stratus],
          plotOptions: {
            bar: {
              columnWidth: '85%',
              distributed: true,
            },
          },
          dataLabels: {
            enabled: false,
          },
          legend: {
            show: false,
          },
          xaxis: {
            labels: {
              categories: ['Cumulus', 'Nimbus', 'Stratus'],
              style: {
                colors: [tierColors.cumulus, tierColors.nimbus, tierColors.stratus],
                fontSize: '14px',
                fontFamily: 'Montserrat',
              },
            },
          },
          yaxis: {
            labels: {
              style: {
                colors: '#888',
                fontSize: '14px',
                fontFamily: 'Montserrat',
              },
              formatter: (value) => `${this.beautifyValue(value / 1024, 0)}`,
            },
          },
          tooltip: {
            y: {
              formatter: (value) => `${this.beautifyValue(value / 1024, 2)} TB`,
            },
          },
          stroke: {
            lineCap: 'round',
          },
          labels: ['Cumulus', 'Nimbus', 'Stratus'],
        },
      },
      ramHistoryData: {
        series: [],
        chartOptions: {
          colors: [tierColors.cumulus, tierColors.nimbus, tierColors.stratus],
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
              opacityFrom: 0.5,
              opacityTo: 0,
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
            y: {
              formatter: (value) => `${this.beautifyValue(value / 1024, 2)} TB`,
            },
          },
        },
      },
      ssdData: {
        series: [],
        chartOptions: {
          colors: [tierColors.cumulus, tierColors.nimbus, tierColors.stratus],
          plotOptions: {
            bar: {
              columnWidth: '85%',
              distributed: true,
            },
          },
          dataLabels: {
            enabled: false,
          },
          legend: {
            show: false,
          },
          xaxis: {
            labels: {
              categories: ['Cumulus', 'Nimbus', 'Stratus'],
              style: {
                colors: [tierColors.cumulus, tierColors.nimbus, tierColors.stratus],
                fontSize: '14px',
                fontFamily: 'Montserrat',
              },
            },
          },
          yaxis: {
            labels: {
              style: {
                colors: '#888',
                fontSize: '14px',
                fontFamily: 'Montserrat',
              },
              formatter: (value) => `${this.beautifyValue(value / 1000, 0)}`,
            },
          },
          tooltip: {
            y: {
              formatter: (value) => `${this.beautifyValue(value / 1000, 2)} TB`,
            },
          },
          stroke: {
            lineCap: 'round',
          },
          labels: ['Cumulus', 'Nimbus', 'Stratus'],
        },
      },
      ssdHistoryData: {
        series: [],
        chartOptions: {
          colors: [tierColors.cumulus, tierColors.nimbus, tierColors.stratus],
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
              opacityFrom: 0.5,
              opacityTo: 0,
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
            y: {
              formatter: (value) => `${this.beautifyValue(value / 1000, 2)} TB`,
            },
          },
        },
      },
      hddData: {
        series: [],
        chartOptions: {
          colors: [tierColors.cumulus, tierColors.nimbus, tierColors.stratus],
          plotOptions: {
            bar: {
              columnWidth: '85%',
              distributed: true,
            },
          },
          dataLabels: {
            enabled: false,
          },
          legend: {
            show: false,
          },
          xaxis: {
            labels: {
              categories: ['Cumulus', 'Nimbus', 'Stratus'],
              style: {
                colors: [tierColors.cumulus, tierColors.nimbus, tierColors.stratus],
                fontSize: '14px',
                fontFamily: 'Montserrat',
              },
            },
          },
          yaxis: {
            labels: {
              style: {
                colors: '#888',
                fontSize: '14px',
                fontFamily: 'Montserrat',
              },
              formatter: (value) => `${this.beautifyValue(value / 1000, 0)}`,
            },
          },
          tooltip: {
            y: {
              formatter: (value) => `${this.beautifyValue(value / 1000, 2)} TB`,
            },
          },
          stroke: {
            lineCap: 'round',
          },
          labels: ['Cumulus', 'Nimbus', 'Stratus'],
        },
      },
      historyStatsLoading: true,
      fluxHistoryStats: [],
    };
  },
  mounted() {
    this.generateResources();
    this.getHistoryStats();
  },
  methods: {
    async generateResources() {
      const fluxTierBench = await axios.get('https://stats.runonflux.io/fluxinfo?projection=tier,benchmark');
      const fluxTierBenchList = fluxTierBench.data.data;
      fluxTierBenchList.forEach((node) => {
        if (node.tier === 'CUMULUS' && node.benchmark && node.benchmark.bench) {
          this.cumulusCpuValue += node.benchmark.bench.cores === 0 ? 4 : node.benchmark.bench.cores;
          this.cumulusRamValue += node.benchmark.bench.ram < 8 ? 8 : Math.round(node.benchmark.bench.ram);
          this.cumulusSSDStorageValue += node.benchmark.bench.ssd;
          this.cumulusHDDStorageValue += node.benchmark.bench.hdd;
        } else if (node.tier === 'CUMULUS') {
          this.cumulusCpuValue += 4;
          this.cumulusRamValue += 8;
          this.cumulusHDDStorageValue += 220;
        } else if (node.tier === 'NIMBUS' && node.benchmark && node.benchmark.bench) {
          this.nimbusCpuValue += node.benchmark.bench.cores === 0 ? 8 : node.benchmark.bench.cores;
          this.nimbusRamValue += node.benchmark.bench.ram < 32 ? 32 : Math.round(node.benchmark.bench.ram);
          this.nimbusSSDStorageValue += node.benchmark.bench.ssd;
          this.nimbusHDDStorageValue += node.benchmark.bench.hdd;
        } else if (node.tier === 'NIMBUS') {
          this.nimbusCpuValue += 8;
          this.nimbusRamValue += 32;
          this.nimbusSSDStorageValue += 440;
        } else if (node.tier === 'STRATUS' && node.benchmark && node.benchmark.bench) {
          this.stratusCpuValue += node.benchmark.bench.cores === 0 ? 16 : node.benchmark.bench.cores;
          this.stratusRamValue += node.benchmark.bench.ram < 64 ? 64 : Math.round(node.benchmark.bench.ram);
          this.stratusSSDStorageValue += node.benchmark.bench.ssd;
          this.stratusHDDStorageValue += node.benchmark.bench.hdd;
        } else if (node.tier === 'STRATUS') {
          this.stratusCpuValue += 16;
          this.stratusRamValue += 64;
          this.stratusSSDStorageValue += 880;
        }
      });

      this.totalCores = this.cumulusCpuValue + this.nimbusCpuValue + this.stratusCpuValue;
      this.cpuData.series = [{ name: 'CPU Cores', data: [this.cumulusCpuValue, this.nimbusCpuValue, this.stratusCpuValue] }];

      this.totalRAM = this.cumulusRamValue + this.nimbusRamValue + this.stratusRamValue;
      this.ramData.series = [{ name: 'RAM', data: [this.cumulusRamValue, this.nimbusRamValue, this.stratusRamValue] }];

      this.totalSSD = this.cumulusSSDStorageValue + this.nimbusSSDStorageValue + this.stratusSSDStorageValue;
      this.ssdData.series = [{ name: 'SSD', data: [this.cumulusSSDStorageValue, this.nimbusSSDStorageValue, this.stratusSSDStorageValue] }];

      this.totalHDD = this.cumulusHDDStorageValue + this.nimbusHDDStorageValue + this.stratusHDDStorageValue;
      this.hddData.series = [{ name: 'HDD', data: [this.cumulusHDDStorageValue, this.nimbusHDDStorageValue, this.stratusHDDStorageValue] }];

      this.fluxListLoading = false;
    },
    async getHistoryStats() {
      try {
        this.historyStatsLoading = true;
        const result = await axios.get('https://stats.runonflux.io/fluxhistorystats');
        if (result.data.data) {
          this.fluxHistoryStats = result.data.data;
          this.generateCPUHistory();
          this.generateRAMHistory();
          this.generateSSDHistory();
          this.historyStatsLoading = false;
        } else {
          this.$toast({
            component: ToastificationContent,
            props: {
              title: 'Unable to fetch history stats',
              icon: 'InfoIcon',
              variant: 'danger',
            },
          });
        }
      } catch (error) {
        console.log(error);
      }
    },
    generateCPUHistory() {
      this.cpuHistoryData.series = this.generateHistory(2, 4, 4, 8, 8, 16);
    },
    generateRAMHistory() {
      this.ramHistoryData.series = this.generateHistory(4, 8, 8, 32, 32, 64);
    },
    generateSSDHistory() {
      this.ssdHistoryData.series = this.generateHistory(40, 220, 150, 440, 600, 880);
    },
    generateHistory(cumulus, halvedCumulus, nimbus, halvedNimbus, stratus, halvedStratus) {
      const cumulusData = [];
      const nimbusData = [];
      const stratusData = [];

      const timePoints = Object.keys(this.fluxHistoryStats);
      timePoints.forEach((time) => {
        if (time < 1647197215000) { // block 1076532
          cumulusData.push([Number(time), (this.fluxHistoryStats[time].cumulus) * cumulus]);
        } else {
          cumulusData.push([Number(time), (this.fluxHistoryStats[time].cumulus) * halvedCumulus]);
        }
        if (time < 1647831196000) { // edit this after block 1081572
          nimbusData.push([Number(time), (this.fluxHistoryStats[time].nimbus) * nimbus]);
        } else {
          nimbusData.push([Number(time), (this.fluxHistoryStats[time].nimbus) * halvedNimbus]);
        }
        if (time < 2000000000000) { // edit this after block 1087332
          stratusData.push([Number(time), (this.fluxHistoryStats[time].stratus) * stratus]);
        } else {
          stratusData.push([Number(time), (this.fluxHistoryStats[time].stratus) * halvedStratus]);
        }
      });
      return [
        {
          name: 'Cumulus',
          data: cumulusData,
        },
        {
          name: 'Nimbus',
          data: nimbusData,
        },
        {
          name: 'Stratus',
          data: stratusData,
        },
      ];
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
