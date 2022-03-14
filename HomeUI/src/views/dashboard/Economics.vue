<template>
  <div>
    <b-overlay
      :show="loadingPrice"
      variant="transparent"
      blur="5px"
    >
      <b-card no-body>
        <b-card-body>
          <h4>
            Price Information: ${{ beautifyValue(latestPrice, 2) }} USD
          </h4>
        </b-card-body>
        <vue-apex-charts
          type="area"
          height="250"
          width="100%"
          :options="lineChart.chartOptions"
          :series="lineChart.series"
        />
      </b-card>
    </b-overlay>
    <b-row class="text-center">
      <b-col
        sm="12"
        md="6"
        lg="4"
      >
        <b-card title="Cumulus Rewards">
          <b-card-text>{{ cumulusCollateral.toLocaleString() }} FLUX Collateral</b-card-text>
          <app-timeline class="mt-2">
            <app-timeline-item>
              <div class="d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0">
                <div>
                  <h6 class="mb-0">
                    {{ beautifyValue(cumulusWeek / 7 ) }} FLUX
                  </h6>
                  <small class="mt-0">(${{ beautifyValue(cumulusUSDRewardWeek / 7) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(cumulusWeek * 0.1 * 5 / 7 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(cumulusUSDRewardWeek * 0.1 * 5 / 7) }} USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((cumulusUSDRewardWeek * 0.1 * 5 / 7 ) + (cumulusUSDRewardWeek / 7)) }} USD
                  </h6>
                </div>
                <small class="text-muted">Per Day</small>
              </div>
            </app-timeline-item>
            <app-timeline-item>
              <div class="d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0">
                <div>
                  <h6 class="mb-0">
                    {{ beautifyValue(cumulusWeek ) }} FLUX
                  </h6>
                  <small class="mt-0">(${{ beautifyValue(cumulusUSDRewardWeek) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(cumulusWeek * 0.1 * 5 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(cumulusUSDRewardWeek * 0.1 * 5) }} USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((cumulusUSDRewardWeek * 0.1 * 5 ) + cumulusUSDRewardWeek) }} USD
                  </h6>
                </div>
                <small class="text-muted">Per Week</small>
              </div>
            </app-timeline-item>
            <app-timeline-item>
              <div class="d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0">
                <div>
                  <h6 class="mb-0">
                    {{ beautifyValue(cumulusWeek * weeksInAMonth ) }} FLUX
                  </h6>
                  <small class="mt-0">(${{ beautifyValue(cumulusUSDRewardWeek * weeksInAMonth) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(cumulusWeek * weeksInAMonth * 0.1 * 5 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(cumulusUSDRewardWeek * weeksInAMonth * 0.1 * 5) }} USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((cumulusUSDRewardWeek * weeksInAMonth * 0.1 * 5) + (cumulusUSDRewardWeek * weeksInAMonth)) }} USD
                  </h6>
                  <h6 class="mb-0 mt-1">
                    VPS Cost ~ 7 USD
                  </h6>
                </div>
                <small class="text-muted">Per Month</small>
              </div>
            </app-timeline-item>
          </app-timeline>
          <b-row>
            <b-col class="border-top mt-2">
              <b-card-text class="text-muted mt-1">
                Profitability per month
              </b-card-text>
              <h4 class="font-weight-bolder mb-50">
                ${{ beautifyValue((cumulusUSDRewardWeek * weeksInAMonth * 0.1 * 5) + (cumulusUSDRewardWeek * weeksInAMonth) - cumulusHostingCost) }} USD
              </h4>
              <h4 class="font-weight-bolder mb-50 invisible">
                With KDA: 0 USD
              </h4>
            </b-col>
          </b-row>
        </b-card>
      </b-col>
      <b-col
        sm="12"
        md="6"
        lg="4"
      >
        <b-card title="Nimbus Rewards">
          <b-card-text>{{ nimbusCollateral.toLocaleString() }} FLUX Collateral</b-card-text>
          <app-timeline class="mt-2">
            <app-timeline-item variant="warning">
              <div class="d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0">
                <div>
                  <h6 class="mb-0">
                    {{ beautifyValue(nimbusWeek / 7 ) }} FLUX
                  </h6>
                  <small class="mt-0">(${{ beautifyValue((nimbusUSDRewardWeek / 7)) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(nimbusWeek * 0.1 * 5 / 7 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(nimbusUSDRewardWeek * 0.1 * 5 / 7) }} USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((nimbusUSDRewardWeek * 0.1 * 5 / 7 ) + (nimbusUSDRewardWeek / 7)) }} USD
                  </h6>
                </div>
                <small class="text-muted">Per Day</small>
              </div>
            </app-timeline-item>
            <app-timeline-item variant="warning">
              <div class="d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0">
                <div>
                  <h6 class="mb-0">
                    {{ beautifyValue(nimbusWeek) }} FLUX
                  </h6>
                  <small class="mt-0">(${{ beautifyValue((nimbusUSDRewardWeek)) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(nimbusWeek * 0.1 * 5 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(nimbusUSDRewardWeek * 0.1 * 5) }} USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((nimbusUSDRewardWeek * 0.1 * 5 ) +(nimbusUSDRewardWeek)) }} USD
                  </h6>
                </div>
                <small class="text-muted">Per Week</small>
              </div>
            </app-timeline-item>
            <app-timeline-item variant="warning">
              <div class="d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0">
                <div>
                  <h6 class="mb-0">
                    {{ beautifyValue(nimbusWeek * weeksInAMonth) }} FLUX
                  </h6>
                  <small class="mt-0">(${{ beautifyValue((nimbusUSDRewardWeek * weeksInAMonth)) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(nimbusWeek * weeksInAMonth * 0.1 * 5 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(nimbusUSDRewardWeek * weeksInAMonth * 0.1 * 5) }} USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((nimbusUSDRewardWeek * weeksInAMonth * 0.1 * 5) + (nimbusUSDRewardWeek * weeksInAMonth)) }} USD
                  </h6>
                  <h6 class="mb-0 mt-1">
                    VPS Cost ~ 13 USD
                  </h6>
                </div>
                <small class="text-muted">Per Month</small>
              </div>
            </app-timeline-item>
          </app-timeline>
          <b-row>
            <b-col class="border-top mt-2">
              <b-card-text class="text-muted mt-1">
                Profitability per month
              </b-card-text>
              <h4 class="font-weight-bolder mb-50">
                ${{ beautifyValue((nimbusUSDRewardWeek * weeksInAMonth * 0.1 * 5) + (nimbusUSDRewardWeek * weeksInAMonth) - nimbusHostingCost) }} USD
              </h4>
              <b-card-text class="text-muted mt-1">
                Plus KDA rewards
              </b-card-text>
            </b-col>
          </b-row>
        </b-card>
      </b-col>
      <b-col
        sm="12"
        md="12"
        lg="4"
      >
        <b-card title="Stratus Rewards">
          <b-card-text>{{ stratusCollateral.toLocaleString() }} FLUX Collateral</b-card-text>
          <app-timeline class="mt-2">
            <app-timeline-item variant="danger">
              <div class="d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0">
                <div>
                  <h6 class="mb-0">
                    {{ beautifyValue(stratusWeek / 7 ) }} FLUX
                  </h6>
                  <small class="mt-0">(${{ beautifyValue((stratusUSDRewardWeek / 7)) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(stratusWeek * 0.1 * 5 / 7 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(stratusUSDRewardWeek * 0.1 * 5 / 7) }} USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((stratusUSDRewardWeek * 0.1 * 5 / 7) + (stratusUSDRewardWeek / 7)) }} USD
                  </h6>
                </div>
                <small class="text-muted">Per Day</small>
              </div>
            </app-timeline-item>
            <app-timeline-item variant="danger">
              <div class="d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0">
                <div>
                  <h6 class="mb-0">
                    {{ beautifyValue(stratusWeek) }} FLUX
                  </h6>
                  <small class="mt-0">(${{ beautifyValue((stratusUSDRewardWeek)) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(stratusWeek * 0.1 * 5 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(stratusUSDRewardWeek * 0.1 * 5) }} USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((stratusUSDRewardWeek * 0.1 * 5) + (stratusUSDRewardWeek)) }} USD
                  </h6>
                </div>
                <small class="text-muted">Per Week</small>
              </div>
            </app-timeline-item>
            <app-timeline-item variant="danger">
              <div class="d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0">
                <div>
                  <h6 class="mb-0">
                    {{ beautifyValue(stratusWeek * weeksInAMonth) }} FLUX
                  </h6>
                  <small class="mt-0">(${{ beautifyValue((stratusUSDRewardWeek * weeksInAMonth)) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(stratusWeek * weeksInAMonth * 0.1 * 5 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(stratusUSDRewardWeek * weeksInAMonth * 0.1 * 5) }} USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((stratusUSDRewardWeek * weeksInAMonth * 0.1 * 5) + (stratusUSDRewardWeek * weeksInAMonth)) }} USD
                  </h6>
                  <h6 class="mb-0 mt-1">
                    VPS Cost ~ 25 USD
                  </h6>
                </div>
                <small class="text-muted">Per Month</small>
              </div>
            </app-timeline-item>
          </app-timeline>
          <b-row>
            <b-col class="border-top mt-2">
              <b-card-text class="text-muted mt-1">
                Profitability per month
              </b-card-text>
              <h4 class="font-weight-bolder mb-50">
                ${{ beautifyValue((stratusUSDRewardWeek * weeksInAMonth * 0.1 * 5) + (stratusUSDRewardWeek * weeksInAMonth) - stratusHostingCost) }} USD
              </h4>
              <b-card-text class="text-muted mt-1">
                Plus KDA Rewards
              </b-card-text>
            </b-col>
          </b-row>
        </b-card>
      </b-col>
    </b-row>
  </div>
</template>

<script>
import {
  BCard,
  BCardText,
  BCardBody,
  BRow,
  BCol,
  BOverlay,
} from 'bootstrap-vue';
import AppTimeline from '@core/components/app-timeline/AppTimeline.vue';
import AppTimelineItem from '@core/components/app-timeline/AppTimelineItem.vue';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import Ripple from 'vue-ripple-directive';
import VueApexCharts from 'vue-apexcharts';

import { $themeColors } from '@themeConfig';

import DashboardService from '@/services/DashboardService';
import ExplorerService from '@/services/ExplorerService';

const rax = require('retry-axios');
const axios = require('axios');

export default {
  components: {
    BCard,
    BCardText,
    BCardBody,
    BRow,
    BCol,
    BOverlay,
    AppTimeline,
    AppTimelineItem,
    VueApexCharts,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    Ripple,
  },
  data() {
    return {
      interceptorID: 0,
      cumulusHostingCost: 7,
      nimbusHostingCost: 13,
      stratusHostingCost: 25,
      weeksInAMonth: 4.34812141,
      loadingPrice: true,
      historicalPrices: [],
      cumulusWeek: 0,
      nimbusWeek: 0,
      stratusWeek: 0,
      cumulusUSDRewardWeek: 0,
      nimbusUSDRewardWeek: 0,
      stratusUSDRewardWeek: 0,
      cumulusCollateral: 0,
      nimbusCollateral: 0,
      stratusCollateral: 0,
      latestPrice: 0,
      lineChart: {
        series: [],
        chartOptions: {
          colors: [$themeColors.primary],
          labels: ['Price'],
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
              opacityTo: 0.0,
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
              formatter: (value) => `$${this.beautifyValue(value, 2)} USD`,
            },
          },
        },
      },
      retryOptions: {
        raxConfig: {
          onRetryAttempt: (err) => {
            const cfg = rax.getConfig(err);
            console.log(`Retry attempt #${cfg.currentRetryAttempt}`);
          },
        },
      },
    };
  },
  mounted() {
    this.interceptorID = rax.attach();
    this.getData();
    // Refresh the data every 10 minutes
    setInterval(() => {
      this.getData();
    }, 1000 * 60 * 10);
  },
  unmounted() {
    rax.detach(this.interceptorID);
  },
  methods: {
    async getData() {
      ExplorerService.getScannedHeight().then((result) => {
        if (result.data.status === 'success') {
          const blockHeight = result.data.data.generalScannedHeight;
          this.cumulusCollateral = blockHeight < 1076532 ? 10000 : 1000;
          this.nimbusCollateral = blockHeight < 1081572 ? 25000 : 12500;
          this.stratusCollateral = blockHeight < 1087332 ? 100000 : 40000;
        }
        this.getRates();
      });
      this.getPriceData();
    },
    async getRates() {
      axios.get('https://vipdrates.zelcore.io/rates', this.retryOptions)
        .then((resultB) => {
          this.rates = resultB.data;
          this.getZelNodeCount();
        });
    },
    async getPriceData() {
      const self = this;
      this.loadingPrice = true;
      axios.get('https://api.coingecko.com/api/v3/coins/zelcash/market_chart?vs_currency=USD&days=30', this.retryOptions)
        .then((res2) => {
          self.historicalPrices = res2.data.prices.filter((a) => a[0] > 1483232400000); // min date from  January 1, 2017 1:00:00 AM
          const priceData = [];
          for (let i = 0; i < self.historicalPrices.length; i += 3) {
            const element = self.historicalPrices[i];
            priceData.push(element);
            this.latestPrice = element[1];
          }
          self.lineChart.series = [{ name: 'Price', data: priceData }];
          this.loadingPrice = false;
        });
    },
    async getZelNodeCount() {
      const response = await DashboardService.zelnodeCount();
      if (response.data.status === 'error') {
        this.$toast({
          component: ToastificationContent,
          props: {
            title: response.data.data.message || response.data.data,
            icon: 'InfoIcon',
            variant: 'danger',
          },
        });
      } else {
        const fluxNodesData = response.data.data;
        const counts = {};
        counts['stratus-enabled'] = fluxNodesData['stratus-enabled'];
        counts['bamf-enabled'] = fluxNodesData['stratus-enabled'];
        if (fluxNodesData['cumulus-enabled'] > fluxNodesData['nimbus-enabled']) {
          counts['nimbus-enabled'] = fluxNodesData['nimbus-enabled'];
          counts['super-enabled'] = fluxNodesData['nimbus-enabled'];
          counts['cumulus-enabled'] = fluxNodesData['cumulus-enabled'];
          counts['basic-enabled'] = fluxNodesData['cumulus-enabled'];
        } else { // flipped until new fluxd release
          counts['nimbus-enabled'] = fluxNodesData['cumulus-enabled'];
          counts['super-enabled'] = fluxNodesData['cumulus-enabled'];
          counts['cumulus-enabled'] = fluxNodesData['nimbus-enabled'];
          counts['basic-enabled'] = fluxNodesData['nimbus-enabled'];
        }
        this.generateEconomics(counts);
      }
    },
    async generateEconomics(fluxnodecounts) {
      const stratuses = fluxnodecounts['stratus-enabled'];
      const nimbuses = fluxnodecounts['nimbus-enabled'];
      const cumuluses = fluxnodecounts['cumulus-enabled'];
      const perCumulusNode = 5.625;
      const perNimbusNode = 9.375;
      const perStratusNode = 22.5;
      // eslint-disable-next-line no-mixed-operators
      const cumulusWeek = perCumulusNode * 720 * 7 / cumuluses;
      // eslint-disable-next-line no-mixed-operators
      const nimbusWeek = perNimbusNode * 720 * 7 / nimbuses;
      // eslint-disable-next-line no-mixed-operators
      const stratusWeek = perStratusNode * 720 * 7 / stratuses;
      const cumulusUSDReward = this.getFiatRate('FLUX') * perCumulusNode; // per one go
      const nimbusUSDReward = this.getFiatRate('FLUX') * perNimbusNode; // per one go
      const stratusUSDReward = this.getFiatRate('FLUX') * perStratusNode; // per one go
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

<style>
</style>
