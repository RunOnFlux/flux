<template>
  <b-card>
    <div>
      <b-button
        id="restart-daemon"
        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
        variant="outline-primary"
        size="md"
        class="ml-1"
      >
        Restart Daemon
      </b-button>
      <b-popover
        ref="popover"
        target="restart-daemon"
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
            Restart Daemon
          </b-button>
        </div>
      </b-popover>
      <b-modal
        id="modal-center"
        v-model="modalShow"
        centered
        title="Daemon Restart"
        ok-only
        ok-title="OK"
      >
        <b-card-text>
          The daemon will now be restarted.
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
import DaemonService from '@/services/DaemonService.js';

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
      DaemonService.restart(zelidauth)
        .then((response) => {
          this.$bvToast.toast({
            component: ToastificationContent,
            props: {
              title: response.data.data.message || response.data.data,
              icon: 'InfoIcon',
              variant: 'success',
            },
          });
        })
        .catch(() => {
          this.$bvToast.toast({
            component: ToastificationContent,
            props: {
              title: 'Error while trying to restart Daemon',
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
