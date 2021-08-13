<template>
  <b-overlay
    :show="signingInProgress"
    variant="transparent"
    blur="5px"
  >
    <b-card>
      <b-card-text>
        Please paste a valid Flux Transaction (hex) below
      </b-card-text>
      <b-form-input
        v-model="hexFluxTransaction"
        placeholder="Transaction Hex"
      />
      <b-button
        id="sign-transaction"
        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
        variant="outline-primary"
        size="md"
        class="my-1"
      >
        Sign Transaction
      </b-button>
      <div
        v-if="callResponse.status === 'success'"
        class="ml-1 mt-1"
      >
        <p>
          Status: {{ callResponse.data.status }}
        </p>
        <p v-if="callResponse.data.tier">
          Tier: {{ callResponse.data.tier }}
        </p>
        <p v-if="callResponse.data.hex">
          Hex: {{ callResponse.data.hex }}
        </p>
      </div>
      <b-popover
        ref="popover"
        target="sign-transaction"
        triggers="click"
        :show.sync="popoverShow"
        placement="auto"
        container="my-container"
      >
        <template v-slot:title>
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
            @click="signFluxTransaction"
          >
            Sign Transaction
          </b-button>
        </div>
      </b-popover>
      <b-form-textarea
        v-if="callResponse.data"
        plaintext
        no-resize
        rows="30"
        :value="callResponse.data"
      />
    </b-card>
  </b-overlay>
</template>

<script>
import {
  BCard,
  BCardText,
  BButton,
  BPopover,
  BFormInput,
  BFormTextarea,
  BOverlay,
} from 'bootstrap-vue'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'
import Ripple from 'vue-ripple-directive'
import BenchmarkService from '@/services/BenchmarkService'

export default {
  components: {
    BCard,
    BCardText,
    BButton,
    BPopover,
    BFormInput,
    BFormTextarea,
    BOverlay,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    Ripple,
  },
  data() {
    return {
      txid: '',
      popoverShow: false,
      callResponse: {
        status: '',
        data: '',
      },
      hexFluxTransaction: '',
      signingInProgress: false,
    }
  },
  methods: {
    onClose() {
      this.popoverShow = false
    },
    signFluxTransaction() {
      this.popoverShow = false
      if (!this.hexFluxTransaction) {
        this.$toast({
          component: ToastificationContent,
          props: {
            title: 'No Flux transaction hex provided',
            icon: 'InfoIcon',
            variant: 'danger',
          },
        })
        return
      }
      this.signingInProgress = true
      const zelidauth = localStorage.getItem('zelidauth')
      BenchmarkService.signFluxTransaction(zelidauth, this.hexFluxTransaction)
        .then(response => {
          console.log(response)
          if (response.data.status === 'error') {
            this.$toast({
              component: ToastificationContent,
              props: {
                title: response.data.data.message || response.data.data,
                icon: 'InfoIcon',
                variant: 'danger',
              },
            })
          } else {
            this.callResponse.status = response.data.status
            this.callResponse.data = response.data.data
          }
          this.signingInProgress = false
        })
        .catch(error => {
          console.log(error)
          this.$toast({
            component: ToastificationContent,
            props: {
              title: 'Error while trying to sign Flux transaction',
              icon: 'InfoIcon',
              variant: 'danger',
            },
          })
          this.signingInProgress = false
        })
    },
  },
}
</script>

<style>

</style>
