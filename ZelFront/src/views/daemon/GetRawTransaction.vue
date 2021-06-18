<template>
  <b-card>
    <b-card-text>
      Please paste a Transaction ID below to get the raw transaction data
    </b-card-text>
    <b-form-input
      v-model="txid"
      placeholder="Transaction ID"
    />
    <b-button
      v-ripple.400="'rgba(255, 255, 255, 0.15)'"
      variant="outline-primary"
      size="md"
      class="ml-1 my-1"
      @click="daemonGetRawTransaction"
    >
      Get Transaction
    </b-button>
    <b-form-textarea
      v-if="callResponse.data"
      plaintext
      no-resize
      rows="30"
      :value="callResponse.data"
    />
  </b-card>
</template>

<script>
import {
  BCard,
  BButton,
  BFormInput,
  BFormTextarea,
} from 'bootstrap-vue'
import DaemonService from '@/services/DaemonService'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'

export default {
  components: {
    BCard,
    BButton,
    BFormInput,
    BFormTextarea,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  data() {
    return {
      txid: '',
      callResponse: {
        status: '',
        data: '',
      },
    }
  },
  methods: {
    async daemonGetRawTransaction() {
      const response = await DaemonService.getRawTransaction(this.txid, 1)
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
    },
  },
}
</script>

<style>

</style>
