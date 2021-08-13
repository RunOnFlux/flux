<template>
  <div>
    <b-row>
      <b-col
        md="12"
        sm="12"
        lg="4"
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
        lg="4"
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
        lg="4"
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
                Total SSD: {{ beautifyValue(totalSSD / 1000, 2) }} TB
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
                SSD History
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
} from 'bootstrap-vue'
import VueApexCharts from 'vue-apexcharts'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'
import tierColors from '@/libs/colors'

const axios = require('axios')

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
      cumulusCpuValue: 0,
      nimbusCpuValue: 0,
      stratusCpuValue: 0,
      cumulusRamValue: 0,
      nimbusRamValue: 0,
      stratusRamValue: 0,
      cumulusStorageValue: 0,
      nimbusStorageValue: 0,
      stratusStorageValue: 0,
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
              formatter: value => this.beautifyValue(value, 0),
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
              formatter: value => new Date(value).toLocaleString('en-GB', this.timeoptions),
            },
            y: {
              formatter: value => this.beautifyValue(value, 0),
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
              formatter: value => `${this.beautifyValue(value / 1024, 0)}`,
            },
          },
          tooltip: {
            y: {
              formatter: value => `${this.beautifyValue(value / 1024, 2)} TB`,
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
              formatter: value => new Date(value).toLocaleString('en-GB', this.timeoptions),
            },
            y: {
              formatter: value => `${this.beautifyValue(value / 1024, 2)} TB`,
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
              formatter: value => `${this.beautifyValue(value / 1000, 0)}`,
            },
          },
          tooltip: {
            y: {
              formatter: value => `${this.beautifyValue(value / 1000, 2)} TB`,
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
              formatter: value => new Date(value).toLocaleString('en-GB', this.timeoptions),
            },
            y: {
              formatter: value => `${this.beautifyValue(value / 1000, 2)} TB`,
            },
          },
        },
      },
      historyStatsLoading: true,
      fluxHistoryStats: [],
    }
  },
  mounted() {
    this.generateResources()
    this.getHistoryStats()
  },
  methods: {
    async generateResources() {
      const fluxTierBench = await axios.get('https://stats.runonflux.io/fluxinfo?projection=tier,benchmark')
      const fluxTierBenchList = fluxTierBench.data.data
      fluxTierBenchList.forEach(node => {
        if (node.tier === 'CUMULUS' && node.benchmark && node.benchmark.bench) {
          this.cumulusCpuValue += node.benchmark.bench.cores === 0 ? 2 : node.benchmark.bench.cores
          this.cumulusRamValue += node.benchmark.bench.ram < 4 ? 4 : Math.round(node.benchmark.bench.ram)
          this.cumulusStorageValue += node.benchmark.bench.ssd + node.benchmark.bench.hdd < 50 ? 50 : node.benchmark.bench.ssd + node.benchmark.bench.hdd
        } else if (node.tier === 'CUMULUS') {
          this.cumulusCpuValue += 2
          this.cumulusRamValue += 4
          this.cumulusStorageValue += 50
        } else if (node.tier === 'NIMBUS' && node.benchmark && node.benchmark.bench) {
          this.nimbusCpuValue += node.benchmark.bench.cores === 0 ? 4 : node.benchmark.bench.cores
          this.nimbusRamValue += node.benchmark.bench.ram < 8 ? 8 : Math.round(node.benchmark.bench.ram)
          this.nimbusStorageValue += node.benchmark.bench.ssd + node.benchmark.bench.hdd < 150 ? 150 : node.benchmark.bench.ssd + node.benchmark.bench.hdd
        } else if (node.tier === 'NIMBUS') {
          this.nimbusCpuValue += 4
          this.nimbusRamValue += 8
          this.nimbusStorageValue += 150
        } else if (node.tier === 'STRATUS' && node.benchmark && node.benchmark.bench) {
          this.stratusCpuValue += node.benchmark.bench.cores === 0 ? 8 : node.benchmark.bench.cores
          this.stratusRamValue += node.benchmark.bench.ram < 32 ? 32 : Math.round(node.benchmark.bench.ram)
          this.stratusStorageValue += node.benchmark.bench.ssd + node.benchmark.bench.hdd < 600 ? 600 : node.benchmark.bench.ssd + node.benchmark.bench.hdd
        } else if (node.tier === 'STRATUS') {
          this.stratusCpuValue += 8
          this.stratusRamValue += 32
          this.stratusStorageValue += 600
        }
      })

      this.totalCores = this.cumulusCpuValue + this.nimbusCpuValue + this.stratusCpuValue
      this.cpuData.series = [{ name: 'CPU Cores', data: [this.cumulusCpuValue, this.nimbusCpuValue, this.stratusCpuValue] }]

      this.totalRAM = this.cumulusRamValue + this.nimbusRamValue + this.stratusRamValue
      this.ramData.series = [{ name: 'RAM', data: [this.cumulusRamValue, this.nimbusRamValue, this.stratusRamValue] }]

      this.totalSSD = this.cumulusStorageValue + this.nimbusStorageValue + this.stratusStorageValue
      this.ssdData.series = [{ name: 'SSD', data: [this.cumulusStorageValue, this.nimbusStorageValue, this.stratusStorageValue] }]

      this.fluxListLoading = false
    },
    async getHistoryStats() {
      try {
        this.historyStatsLoading = true
        const result = await axios.get('https://stats.runonflux.io/fluxhistorystats')
        if (result.data.data) {
          this.fluxHistoryStats = result.data.data
          this.generateCPUHistory()
          this.generateRAMHistory()
          this.generateSSDHistory()
          this.historyStatsLoading = false
        } else {
          this.$toast({
            component: ToastificationContent,
            props: {
              title: 'Unable to fetch history stats',
              icon: 'InfoIcon',
              variant: 'danger',
            },
          })
        }
      } catch (error) {
        console.log(error)
      }
    },
    generateCPUHistory() {
      this.cpuHistoryData.series = this.generateHistory(2, 4, 8)
    },
    generateRAMHistory() {
      this.ramHistoryData.series = this.generateHistory(4, 8, 32)
    },
    generateSSDHistory() {
      this.ssdHistoryData.series = this.generateHistory(40, 150, 600)
    },
    generateHistory(cumulus, nimbus, stratus) {
      const cumulusData = []
      const nimbusData = []
      const stratusData = []

      const timePoints = Object.keys(this.fluxHistoryStats)
      timePoints.forEach(time => {
        cumulusData.push([Number(time), (this.fluxHistoryStats[time].cumulus) * cumulus])
        nimbusData.push([Number(time), (this.fluxHistoryStats[time].nimbus) * nimbus])
        stratusData.push([Number(time), (this.fluxHistoryStats[time].stratus) * stratus])
      })
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
      ]
    },
    beautifyValue(value, places = 2) {
      const fixedValue = value.toFixed(places)
      return fixedValue.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,')
    },
  },
}
</script>

<style>

</style>
