<template>
  <b-card>
    <div>
      <b-button
        id="restart-benchmark"
        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
        variant="outline-primary"
        size="md"
        class="ml-1"
      >
        Restart Benchmark
      </b-button>
      <confirm-dialog
        target="restart-benchmark"
        confirm-button="Restart Benchmark"
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
          The benchmark will now be restarted.
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
} from 'bootstrap-vue'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'
import ConfirmDialog from '@/views/components/ConfirmDialog.vue'
import Ripple from 'vue-ripple-directive'
import BenchmarkService from '@/services/BenchmarkService'

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
    }
  },
  methods: {
    onOk() {
      this.modalShow = true
      const zelidauth = localStorage.getItem('zelidauth')
      BenchmarkService.restart(zelidauth)
        .then(response => {
          this.showToast('success', response.data.data.message || response.data.data)
        })
        .catch(() => {
          this.showToast('danger', 'Error while trying to restart Benchmark')
        })
    },
    showToast(variant, title, icon = 'InfoIcon') {
      this.$toast({
        component: ToastificationContent,
        props: {
          title,
          icon,
          variant,
        },
      })
    },
  },
}
</script>

<style>

</style>
