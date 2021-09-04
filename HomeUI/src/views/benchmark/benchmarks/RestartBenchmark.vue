<template>
  <b-card>
    <div>
      <b-button
        id="restart-benchmarks"
        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
        variant="outline-primary"
        size="md"
        class="ml-1"
      >
        Restart Benchmarks
      </b-button>
      <confirm-dialog
        target="restart-benchmarks"
        confirm-button="Restart Benchmarks"
        @confirm="onOk"
      />
      <b-modal
        id="modal-center"
        v-model="modalShow"
        centered
        title="Benchmark Restart"
        ok-only
        ok-title="OK"
      >
        <b-card-text>
          The node benchmarks will now restart.
        </b-card-text>
      </b-modal>
    </div>
  </b-card>
</template>

<script>
import {
  BCard,
  BButton,
  BModal,
  BCardText,
} from 'bootstrap-vue';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import Ripple from 'vue-ripple-directive';
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';
import BenchmarkService from '@/services/BenchmarkService';

export default {
  components: {
    BCard,
    BButton,
    BModal,
    BCardText,
    ConfirmDialog,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    Ripple,
  },
  data() {
    return {
      modalShow: false,
    };
  },
  methods: {
    onOk() {
      this.modalShow = true;
      const zelidauth = localStorage.getItem('zelidauth');
      BenchmarkService.restartNodeBenchmarks(zelidauth)
        .then((response) => {
          console.log(response);
          this.showToast('success', response.data.data.message || response.data.data);
        })
        .catch((e) => {
          console.log(e);
          this.showToast('danger', 'Error while trying to restart Benchmark');
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
