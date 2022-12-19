<template>
  <div>
    <b-row class="match-height">
      <b-col
        sm="12"
        lg="6"
        xl="4"
      >
        <b-card title="Benchmark">
          <b-card-text class="mb-3">
            An easy way to update your Benchmark daemon to the latest version. Benchmark will be automatically started once update is done.
          </b-card-text>
          <div class="text-center">
            <b-button
              id="update-benchmark"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Update Benchmark"
            >
              Update Benchmark
            </b-button>
            <confirm-dialog
              target="update-benchmark"
              confirm-button="Update Benchmark"
              @confirm="updateBenchmark()"
            />
          </div>
        </b-card>
      </b-col>
      <b-col
        sm="12"
        lg="6"
        xl="4"
      >
        <b-card title="Manage Process">
          <b-card-text class="mb-3">
            Here you can manage your Benchmark daemon process.
          </b-card-text>
          <div class="text-center">
            <b-button
              id="start-benchmark"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Start Benchmark"
              class="mx-1 mb-1"
            >
              Start Benchmark
            </b-button>
            <b-button
              id="stop-benchmark"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Stop Benchmark"
              class="mx-1 mb-1"
            >
              Stop Benchmark
            </b-button>
            <b-button
              id="restart-benchmark"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Restart Benchmakr"
              class="mx-1 mb-1"
            >
              Restart Benchmark
            </b-button>
            <confirm-dialog
              target="start-benchmark"
              confirm-button="Start Benchmark"
              @confirm="startBenchmark()"
            />
            <confirm-dialog
              target="stop-benchmark"
              confirm-button="Stop Benchmark"
              @confirm="stopBenchmark()"
            />
            <confirm-dialog
              target="restart-benchmark"
              confirm-button="Restart Benchmark"
              @confirm="restartBenchmark()"
            />
          </div>
        </b-card>
      </b-col>
      <b-col
        sm="12"
        xl="4"
      >
        <b-card title="Restart">
          <b-card-text class="mb-2">
            Option to trigger a complete new run of node benchmarking. Useful when your node falls down in category or fails benchmarking tests.
          </b-card-text>
          <div class="text-center">
            <b-button
              id="restart-benchmarks"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Restart Benchmarks"
            >
              Restart Benchmarks
            </b-button>
            <confirm-dialog
              target="restart-benchmarks"
              confirm-button="Restart Benchmarks"
              @confirm="restartBenchmarks()"
            />
          </div>
        </b-card>
      </b-col>
    </b-row>
  </div>
</template>

<script>
// import { mapState } from 'vuex'
import {
  BCard,
  BRow,
  BCol,
  BCardText,
  BButton,
} from 'bootstrap-vue';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import Ripple from 'vue-ripple-directive';
import axios from 'axios';
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';

import FluxService from '@/services/FluxService';
import BenchmarkService from '@/services/BenchmarkService';

import qs from 'qs';

export default {
  components: {
    BCard,
    BRow,
    BCol,
    BCardText,
    BButton,
    ConfirmDialog,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    Ripple,
  },
  mounted() {
    this.checkBenchmarkVersion();
  },
  methods: {
    checkBenchmarkVersion() {
      BenchmarkService.getInfo()
        .then((benchmarkResponse) => {
          console.log(benchmarkResponse);
          const benchmarkVersion = benchmarkResponse.data.data.version;
          axios.get('https://raw.githubusercontent.com/runonflux/flux/master/helpers/benchmarkinfo.json')
            .then((response) => {
              console.log(response);
              if (response.data.version !== benchmarkVersion) {
                this.showToast('warning', 'Benchmark requires an update!');
              } else {
                this.showToast('success', 'Benchmark is up to date');
              }
            })
            .catch((error) => {
              console.log(error);
              this.showToast('danger', 'Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error connecting to benchmark');
        });
    },
    updateBenchmark() {
      BenchmarkService.getInfo()
        .then((benchmarkResponse) => {
          console.log(benchmarkResponse);
          const benchmarkVersion = benchmarkResponse.data.data.version;
          axios.get('https://raw.githubusercontent.com/runonflux/flux/master/helpers/benchmarkinfo.json')
            .then((response) => {
              console.log(response);
              if (response.data.version !== benchmarkVersion) {
                const zelidauth = localStorage.getItem('zelidauth');
                const auth = qs.parse(zelidauth);
                console.log(auth);
                this.showToast('success', 'Benchmark is now updating in the background');
                FluxService.updateBenchmark(zelidauth)
                  .then((responseUpdateBenchmark) => {
                    console.log(responseUpdateBenchmark);
                    if (responseUpdateBenchmark.data.status === 'error') {
                      this.showToast('danger', responseUpdateBenchmark.data.data.message || responseUpdateBenchmark.data.data);
                    }
                  })
                  .catch((e) => {
                    console.log(e);
                    console.log(e.code);
                    this.showToast('danger', e.toString());
                  });
              } else {
                this.showToast('success', 'Benchmark is already up to date');
              }
            })
            .catch((error) => {
              console.log(error);
              this.showToast('danger', 'Error verifying recent version');
            });
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error connecting to benchmark');
        });
    },
    startBenchmark() {
      this.showToast('warning', 'Benchmark will start');
      const zelidauth = localStorage.getItem('zelidauth');
      BenchmarkService.start(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error while trying to start benchmark');
        });
    },
    stopBenchmark() {
      this.showToast('warning', 'Benchmark will be stopped');
      const zelidauth = localStorage.getItem('zelidauth');
      BenchmarkService.stop(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error while trying to stop benchmark');
        });
    },
    restartBenchmark() {
      this.showToast('warning', 'Benchmark will now restart');
      const zelidauth = localStorage.getItem('zelidauth');
      BenchmarkService.restart(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error while trying to restart benchmark');
        });
    },
    restartBenchmarks() {
      this.showToast('warning', 'Initiating new benchmarks');
      const zelidauth = localStorage.getItem('zelidauth');
      BenchmarkService.restartNodeBenchmarks(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            this.showToast('success', response.data.data.message || response.data.data);
          }
        })
        .catch((error) => {
          console.log(error);
          this.showToast('danger', 'Error while trying to run new benchmarks');
        });
    },
    showToast(variant, title, icon = 'InfoIcon') {
      this.$toast({
        component: ToastificationContent,
        props: {
          title,
          icon,
          variant,
        },
      });
    },
  },
};
</script>

<style>

</style>
