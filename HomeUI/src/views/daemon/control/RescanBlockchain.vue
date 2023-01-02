<template>
  <b-card>
    <div>
      <label
        for="sb-inline"
        class="mr-1"
      >Block Height</label>
      <input-spin-button
        id="sb-inline"
        v-model="rescanDaemonHeight"
        repeat-step-multiplier="100"
        inline
      />
      <b-button
        id="rescan-daemon"
        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
        :disabled="blockHeight === 0"
        variant="outline-primary"
        size="md"
        class="ml-1 mt-1"
      >
        Rescan Daemon
      </b-button>
      <b-popover
        ref="popover"
        target="rescan-daemon"
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
            Rescan Blockchain
          </b-button>
        </div>
      </b-popover>
      <b-modal
        id="modal-center"
        v-model="modalShow"
        centered
        title="Blockchain Rescanning"
        ok-only
        ok-title="OK"
      >
        <b-card-text>
          The daemon will now start rescanning the blockchain. This will take up to an hour.
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
import InputSpinButton from '@/views/components/InputSpinButton.vue';

export default {
  components: {
    BCard,
    BButton,
    BPopover,
    BModal,
    BCardText,
    InputSpinButton,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    Ripple,
  },
  data() {
    return {
      blockHeight: 0,
      rescanDaemonHeight: 0,
      popoverShow: false,
      modalShow: false,
    };
  },
  mounted() {
    this.daemonGetInfo();
  },
  methods: {
    async daemonGetInfo() {
      const response = await DaemonService.getInfo();
      if (response.data.status === 'error') {
        this.$bvToast.toast({
          component: ToastificationContent,
          props: {
            title: response.data.data.message || response.data.data,
            icon: 'InfoIcon',
            variant: 'danger',
          },
        });
      } else {
        this.blockHeight = response.data.data.blocks;
      }
    },
    onClose() {
      this.popoverShow = false;
    },
    onOk() {
      this.popoverShow = false;
      this.modalShow = true;
      const zelidauth = localStorage.getItem('zelidauth');
      const blockheight = this.rescanDaemonHeight > 0 ? this.rescanDaemonHeight : 0;
      DaemonService.rescanDaemon(zelidauth, blockheight)
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
              title: 'Error while trying to rescan Daemon',
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
