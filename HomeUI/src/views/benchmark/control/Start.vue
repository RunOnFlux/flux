<template>
  <b-card>
    <div>
      <b-button
        id="start-benchmark"
        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
        variant="outline-primary"
        size="md"
        class="ml-1"
      >
        Start Benchmark
      </b-button>
      <b-popover
        ref="popover"
        target="start-benchmark"
        triggers="click"
        :show.sync="popoverShow"
        placement="auto"
        container="my-container"
      >
        <template #title>
          <div class="d-flex justify-content-between align-items-center">
            <span>Are You Sure?</span>
            <b-button
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              class="close"
              variant="transparent"
              aria-label="Close"
              @click="onClose"
            >
              <span
                class="d-inline-block text-white"
                aria-hidden="true"
              >&times;</span>
            </b-button>
          </div>
        </template>

        <div>
          <b-button
            v-ripple.400="'rgba(255, 255, 255, 0.15)'"
            size="sm"
            variant="danger"
            class="mr-1"
            @click="onClose"
          >
            Cancel
          </b-button>
          <b-button
            v-ripple.400="'rgba(255, 255, 255, 0.15)'"
            size="sm"
            variant="primary"
            @click="onOk"
          >
            Start Benchmark
          </b-button>
        </div>
      </b-popover>
      <b-modal
        id="modal-center"
        v-model="modalShow"
        centered
        title="Benchmark Start"
        ok-only
        ok-title="OK"
      >
        <b-card-text>
          The benchmark will now start.
        </b-card-text>
      </b-modal>
    </div>
  </b-card>
</template>

<script>
import {
  BCard,
  BButton,
  BPopover,
  BModal,
  BCardText,
} from 'bootstrap-vue';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import Ripple from 'vue-ripple-directive';
import BenchmarkService from '@/services/BenchmarkService';

export default {
  components: {
    BCard,
    BButton,
    BPopover,
    BModal,
    BCardText,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    Ripple,
  },
  data() {
    return {
      popoverShow: false,
      modalShow: false,
    };
  },
  methods: {
    onClose() {
      this.popoverShow = false;
    },
    onOk() {
      this.popoverShow = false;
      this.modalShow = true;
      const zelidauth = localStorage.getItem('zelidauth');
      BenchmarkService.start(zelidauth)
        .then((response) => {
          this.$toast({
            component: ToastificationContent,
            props: {
              title: response.data.data.message || response.data.data,
              icon: 'InfoIcon',
              variant: 'success',
            },
          });
        })
        .catch(() => {
          this.$toast({
            component: ToastificationContent,
            props: {
              title: 'Error while trying to start Benchmark',
              icon: 'InfoIcon',
              variant: 'danger',
            },
          });
        });
    },
  },
};
</script>

<style>

</style>
