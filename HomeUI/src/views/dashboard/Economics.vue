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
        <b-card
          title="Cumulus Rewards"
        >
          <b-card-text>10,000 FLUX Collateral</b-card-text>
          <app-timeline class="mt-2">
            <app-timeline-item>
              <div class="d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0">
                <div>
                  <h6 class="mb-0">
                    {{ beautifyValue(cumulusWeek / 7 ) }} FLUX
                  </h6>
                  <small class="mt-0">(${{ beautifyValue(cumulusUSDRewardWeek / 7) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(cumulusWeek * 0.1 * 3 / 7 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(cumulusUSDRewardWeek * 0.1 * 3 / 7) }} USD)</small>
                  <h6 class="mb-0 mt-1 invisible">
                    0 KDA
                  </h6>
                  <small class="mt-0 invisible">(0 USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((cumulusUSDRewardWeek * 0.1 * 3 / 7 ) + (cumulusUSDRewardWeek / 7)) }} USD
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
                    {{ beautifyValue(cumulusWeek * 0.1 * 3 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(cumulusUSDRewardWeek * 0.1 * 3) }} USD)</small>
                  <h6 class="mb-0 mt-1 invisible">
                    0 KDA
                  </h6>
                  <small class="mt-0 invisible">(0 USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((cumulusUSDRewardWeek * 0.1 * 3 ) + cumulusUSDRewardWeek) }} USD
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
                    {{ beautifyValue(cumulusWeek * weeksInAMonth * 0.1 * 3 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(cumulusUSDRewardWeek * weeksInAMonth * 0.1 * 3) }} USD)</small>
                  <h6 class="mb-0 mt-1 invisible">
                    0 KDA
                  </h6>
                  <small class="mt-0 invisible">(0 USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((cumulusUSDRewardWeek * weeksInAMonth * 0.1 * 3) + (cumulusUSDRewardWeek * weeksInAMonth)) }} USD
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
                Node only: ${{ beautifyValue((cumulusUSDRewardWeek * weeksInAMonth * 0.1 * 3) + (cumulusUSDRewardWeek * weeksInAMonth) - cumulusHostingCost) }} USD
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
        <b-card
          title="Nimbus Rewards"
        >
          <b-card-text>25,000 FLUX Collateral</b-card-text>
          <app-timeline class="mt-2">
            <app-timeline-item variant="warning">
              <div class="d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0">
                <div>
                  <h6 class="mb-0">
                    {{ beautifyValue(nimbusWeek / 7 ) }} FLUX
                  </h6>
                  <small class="mt-0">(${{ beautifyValue((nimbusUSDRewardWeek / 7)) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(nimbusWeek * 0.1 * 3 / 7 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(nimbusUSDRewardWeek * 0.1 * 3 / 7) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(kdaNimbusWeek / 7) }} KDA
                  </h6>
                  <small class="mt-0">(${{ beautifyValue((nimbusUSDKDARewardWeek / 7)) }} USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((nimbusUSDRewardWeek * 0.1 * 3 / 7 ) + (nimbusUSDRewardWeek / 7) + (nimbusUSDKDARewardWeek / 7)) }} USD
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
                    {{ beautifyValue(nimbusWeek * 0.1 * 3 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(nimbusUSDRewardWeek * 0.1 * 3) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(kdaNimbusWeek) }} KDA
                  </h6>
                  <small class="mt-0">(${{ beautifyValue((nimbusUSDKDARewardWeek)) }} USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((nimbusUSDRewardWeek * 0.1 * 3 ) +(nimbusUSDRewardWeek) + (nimbusUSDKDARewardWeek)) }} USD
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
                    {{ beautifyValue(nimbusWeek * weeksInAMonth * 0.1 * 3 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(nimbusUSDRewardWeek * weeksInAMonth * 0.1 * 3) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(kdaNimbusWeek * weeksInAMonth) }} KDA
                  </h6>
                  <small class="mt-0">(${{ beautifyValue((nimbusUSDKDARewardWeek * weeksInAMonth)) }} USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((nimbusUSDRewardWeek * weeksInAMonth * 0.1 * 3) + (nimbusUSDRewardWeek * weeksInAMonth) + (nimbusUSDKDARewardWeek * weeksInAMonth)) }} USD
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
                Node only: ${{ beautifyValue((nimbusUSDRewardWeek * weeksInAMonth * 0.1 * 3) + (nimbusUSDRewardWeek * weeksInAMonth) - nimbusHostingCost) }} USD
              </h4>
              <h4 class="font-weight-bolder mb-50">
                With KDA: ${{ beautifyValue((nimbusUSDRewardWeek * weeksInAMonth * 0.1 * 3) +(nimbusUSDRewardWeek * weeksInAMonth) + (nimbusUSDKDARewardWeek * weeksInAMonth) - nimbusHostingCost) }} USD
              </h4>
            </b-col>
          </b-row>
        </b-card>
      </b-col>
      <b-col
        sm="12"
        md="12"
        lg="4"
      >
        <b-card
          title="Stratus Rewards"
        >
          <b-card-text>100,000 FLUX Collateral</b-card-text>
          <app-timeline class="mt-2">
            <app-timeline-item variant="danger">
              <div class="d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0">
                <div>
                  <h6 class="mb-0">
                    {{ beautifyValue(stratusWeek / 7 ) }} FLUX
                  </h6>
                  <small class="mt-0">(${{ beautifyValue((stratusUSDRewardWeek / 7)) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(stratusWeek * 0.1 * 3 / 7 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(stratusUSDRewardWeek * 0.1 * 3 / 7) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(kdaStratusWeek / 7) }} KDA
                  </h6>
                  <small class="mt-0">(${{ beautifyValue((stratusUSDKDARewardWeek / 7)) }} USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((stratusUSDRewardWeek * 0.1 * 3 / 7) + (stratusUSDRewardWeek / 7) + (stratusUSDKDARewardWeek / 7)) }} USD
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
                    {{ beautifyValue(stratusWeek * 0.1 * 3 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(stratusUSDRewardWeek * 0.1 * 3) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(kdaStratusWeek) }} KDA
                  </h6>
                  <small class="mt-0">(${{ beautifyValue((stratusUSDKDARewardWeek)) }} USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((stratusUSDRewardWeek * 0.1 * 3) + (stratusUSDRewardWeek) + (stratusUSDKDARewardWeek)) }} USD
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
                    {{ beautifyValue(stratusWeek * weeksInAMonth * 0.1 * 3 ) }} FLUX Tokens
                  </h6>
                  <small class="mt-0 mt-1">(${{ beautifyValue(stratusUSDRewardWeek * weeksInAMonth * 0.1 * 3) }} USD)</small>
                  <h6 class="mb-0 mt-1">
                    {{ beautifyValue(kdaStratusWeek * weeksInAMonth) }} KDA
                  </h6>
                  <small class="mt-0">(${{ beautifyValue((stratusUSDKDARewardWeek * weeksInAMonth)) }} USD)</small>
                  <h6 class="mt-0 mt-1">
                    ~ ${{ beautifyValue((stratusUSDRewardWeek * weeksInAMonth * 0.1 * 3) + (stratusUSDRewardWeek * weeksInAMonth) + (stratusUSDKDARewardWeek * weeksInAMonth)) }} USD
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
                Node only: ${{ beautifyValue((stratusUSDRewardWeek * weeksInAMonth * 0.1 * 3) + (stratusUSDRewardWeek * weeksInAMonth) - stratusHostingCost) }} USD
              </h4>
              <h4 class="font-weight-bolder mb-50">
                With KDA: ${{ beautifyValue((stratusUSDRewardWeek * weeksInAMonth * 0.1 * 3) + (stratusUSDRewardWeek * weeksInAMonth) + (stratusUSDKDARewardWeek * weeksInAMonth) - stratusHostingCost) }} USD
              </h4>
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
import Ripple from 'vue-ripple-directive';
import VueApexCharts from 'vue-apexcharts';

import { $themeColors } from '@themeConfig';

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
      nimbusUSDKDARewardWeek: 0,
      stratusUSDKDARewardWeek: 0,
      kdaNimbusWeek: 0,
      kdaStratusWeek: 0,
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
      this.getRates();
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
      axios.get('https://api.runonflux.io/daemon/getzelnodecount', this.retryOptions)
        .then((result) => {
          const fluxNodesData = result.data.data;
          const counts = {};
          counts['stratus-enabled'] = fluxNodesData['stratus-enabled'];
          counts['bamf-enabled'] = fluxNodesData['stratus-enabled'];
          counts['nimbus-enabled'] = fluxNodesData['cumulus-enabled']; // flipped until new fluxd release
          counts['super-enabled'] = fluxNodesData['cumulus-enabled'];
          counts['cumulus-enabled'] = fluxNodesData['nimbus-enabled'];
          counts['basic-enabled'] = fluxNodesData['nimbus-enabled'];
          this.generateEconomics(counts);
        });
    },
    async generateEconomics(zelnodecounts) {
      const stratuses = zelnodecounts['stratus-enabled'];
      const nimbuses = zelnodecounts['nimbus-enabled'];
      const cumuluses = zelnodecounts['cumulus-enabled'];
      axios.get('https://stats.runonflux.io/kadena/eligiblestats/7', this.retryOptions)
        .then((resKDAEligible) => {
          const kdaData = resKDAEligible.data.data;
          const kdaCoins = 1000;
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
        });
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
