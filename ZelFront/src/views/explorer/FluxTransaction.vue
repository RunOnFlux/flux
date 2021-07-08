<template>
  <b-card class="mb-0">
    <list-entry
      title="Version"
      :data="`${transaction.version} ${transaction.version === 5 ? ' - Flux transaction' : JSON.stringify(transaction.vin).includes('coinbase') ? ' - Coinbase transaction' : ' - Standard transaction'}`"
      classes="skinny-list-entry"
    />
    <list-entry
      title="Height"
      :number="transaction.height"
      classes="skinny-list-entry"
    />

    <div v-if="transaction.version === 5">
      <list-entry
        title="Type"
        :data="transaction.type"
        classes="skinny-list-entry"
      />
      <list-entry
        title="Collateral Hash"
        :data="transaction.collateralHash"
        classes="skinny-list-entry"
      />
      <list-entry
        title="Collateral Index"
        :number="transaction.collateralIndex"
        classes="skinny-list-entry"
      />
      <list-entry
        v-if="transaction.type === 'Confirming a zelnode'"
        title="Flux Network"
        :data="transaction.ip"
        classes="skinny-list-entry"
      />
      <list-entry
        v-if="transaction.type === 'Confirming a zelnode'"
        title="Update Type"
        :number="transaction.updateType"
        classes="skinny-list-entry"
      />
      <list-entry
        v-if="transaction.type === 'Confirming a zelnode'"
        title="Benchmark Tier"
        :data="transaction.benchTier"
        classes="skinny-list-entry"
      />
    </div>
  </b-card>
</template>

<script>
import {
  BCard,
} from 'bootstrap-vue'

import ListEntry from '@/views/components/ListEntry.vue'

export default {
  components: {
    BCard,
    ListEntry,
  },
  props: {
    transaction: {
      type: Object,
      default() {
        return { version: 0 }
      },
    },
  },
  data() {
    return {
    }
  },
  mounted() {
  },
  methods: {
  },
}
</script>

<style scoped>
.io-section {
  border-radius: .428rem;
}
.tx {
  border-radius: .2rem;
  margin-bottom: 3px !important;
}
.tx-body {
  padding: 0.4rem 1rem 0.4rem 1rem !important;
}
.tx-body p {
  margin-bottom: 0 !important;
}
.skinny-list-entry {
  margin-top: 2px !important;
  margin-bottom: 2px !important;
}
</style>
