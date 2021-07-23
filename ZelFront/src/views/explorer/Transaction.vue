<template>
  <b-card class="mb-0">
    <list-entry
      title="Date"
      :data="new Date(transaction.time * 1000).toLocaleString('en-GB', timeoptions.shortDate)"
      classes="skinny-list-entry"
    />
    <list-entry
      title="Confirmations"
      :number="transaction.height ? (currentHeight - transaction.height + 1) : 0"
      classes="skinny-list-entry"
    />
    <list-entry
      title="Version"
      :data="`${transaction.version} ${transaction.version === 5 ? ' - Flux transaction' : JSON.stringify(transaction.vin).includes('coinbase') ? ' - Coinbase transaction' : ' - Standard transaction'}`"
      classes="skinny-list-entry"
    />
    <list-entry
      title="Size"
      :data="`${transaction.hex.length / 2} bytes`"
      classes="skinny-list-entry"
    />
    <list-entry
      title="Fee"
      :data="`${calculateTxFee()} FLUX`"
      classes="skinny-list-entry"
    />
    <!-- <list-entry
      title="Height"
      :number="transaction.height"
      classes="skinny-list-entry"
    />
    <list-entry
      title="Block Hash"
      :data="transaction.blockhash"
      classes="skinny-list-entry"
    /> -->
    <div v-if="transaction.version < 5 && transaction.version > 0">
      <list-entry
        title="Overwintered"
        :data="transaction.overwintered.toString()"
        classes="skinny-list-entry"
      />
      <list-entry
        title="Version Group ID"
        :data="transaction.versiongroupid"
        classes="skinny-list-entry"
      />
      <list-entry
        title="Lock Time"
        :number="transaction.locktime"
        classes="skinny-list-entry"
      />
      <list-entry
        title="Expiry Height"
        :number="transaction.expiryheight"
        classes="skinny-list-entry"
      />
    </div>
    <div v-if="transaction.version < 5 && transaction.version > 0">
      <list-entry
        v-if="transaction.version === 4"
        title="Sapling Inputs / Outputs"
        :data="`${transaction.vShieldedSpend.length} / ${transaction.vShieldedOutput.length}`"
        classes="skinny-list-entry"
      />
      <list-entry
        title="Sprout Inputs / Outputs"
        :data="`${calculateJoinSplitInput(transaction.vJoinSplit)} / ${calculateJoinSplitOutput(transaction.vJoinSplit)}`"
        classes="skinny-list-entry"
      />
      <b-row class="match-height mt-1">
        <b-col cols="6">
          <b-card
            title="Inputs"
            border-variant="secondary"
            class="io-section"
          >
            <div
              v-for="i in transaction.vin.length"
              :key="i"
            >
              <div>
                <div v-if="transaction.vin[i - 1].coinbase">
                  No Inputs (Newly generated coins)
                </div>
                <b-card
                  v-else-if="typeof transaction.senders[i - 1] === 'object'"
                  :key="transaction.senders[i - 1].value || transaction.senders[i - 1]"
                  border-variant="success"
                  class="tx"
                  no-body
                >
                  <b-card-body class="d-flex tx-body">
                    <p class="flex-grow-1">
                      {{ transaction.senders[i - 1].scriptPubKey.addresses[0] }}
                    </p>
                    <p>
                      {{ transaction.senders[i - 1].value }} FLUX
                    </p>
                  </b-card-body>
                </b-card>
                <div v-else>
                  {{ transaction.senders[i - 1] || 'Loading Sender' }}
                </div>
              </div>
            </div>
          </b-card>
        </b-col>
        <b-col cols="6">
          <b-card
            title="Outputs"
            border-variant="secondary"
            class="io-section"
          >
            <b-card
              v-for="i in transaction.vout.length"
              :key="i"
              border-variant="warning"
              class="tx"
              no-body
            >
              <b-card-body
                v-if="transaction.vout[i - 1].scriptPubKey.addresses"
                class="tx-body"
              >
                <b-row>
                  <b-col
                    lg="8"
                    xs="12"
                  >
                    <p class="flex-grow-1">
                      {{ transaction.vout[i - 1].scriptPubKey.addresses[0] }}
                    </p>
                  </b-col>
                  <b-col
                    lg="4"
                    xs="12"
                  >
                    <p>
                      {{ transaction.vout[i - 1].value }} FLUX
                    </p>
                  </b-col>
                </b-row>
              </b-card-body>
              <b-card-body v-else>
                {{ decodeMessage(transaction.vout[i - 1].asm) }}
              </b-card-body>
            </b-card>
          </b-card>
        </b-col>
      </b-row>
    </div>
    <div v-if="transaction.version === 5">
      <list-entry
        title="Type"
        :data="transaction.type"
        classes="skinny-list-entry"
      />
      <list-entry
        title="Collateral Hash"
        :data="getValueHexBuffer(transaction.hex.slice(10, 74))"
        classes="skinny-list-entry"
      />
      <list-entry
        title="Collateral Index"
        :number="getCollateralIndex(transaction.hex.slice(74, 82))"
        classes="skinny-list-entry"
      />
      <list-entry
        title="Signature"
        :data="transaction.sig"
        classes="skinny-list-entry"
      />
      <list-entry
        title="Signature Time"
        :data="new Date(transaction.sigtime * 1000).toLocaleString('en-GB', timeoptions.shortDate)"
        classes="skinny-list-entry"
      />
      <list-entry
        v-if="transaction.type === 'Starting a zelnode'"
        title="Collateral Public Key"
        :data="transaction.collateral_pubkey"
        classes="skinny-list-entry"
      />
      <list-entry
        v-if="transaction.type === 'Starting a zelnode'"
        title="Flux Public Key"
        :data="transaction.zelnode_pubkey"
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
        :number="transaction.update_type"
        classes="skinny-list-entry"
      />
      <list-entry
        v-if="transaction.type === 'Confirming a zelnode'"
        title="Benchmark Tier"
        :data="transaction.benchmark_tier"
        classes="skinny-list-entry"
      />
      <list-entry
        v-if="transaction.type === 'Confirming a zelnode'"
        title="Benchmark Signature"
        :data="transaction.benchmark_sig"
        classes="skinny-list-entry"
      />
      <list-entry
        v-if="transaction.type === 'Confirming a zelnode'"
        title="Benchmark Signature Time"
        :data="new Date(transaction.benchmark_sigtime * 1000).toLocaleString('en-GB', timeoptions.shortDate)"
        classes="skinny-list-entry"
      />
    </div>
  </b-card>
</template>

<script>
import {
  BCard,
  BCardBody,
} from 'bootstrap-vue'

import ListEntry from '@/views/components/ListEntry.vue'

const timeoptions = require('@/libs/dateFormat')

export default {
  components: {
    BCard,
    BCardBody,
    ListEntry,
  },
  props: {
    transaction: {
      type: Object,
      default() {
        return { version: 0 }
      },
    },
    currentHeight: {
      type: Number,
      required: true,
    },
  },
  data() {
    return {
      timeoptions,
    }
  },
  mounted() {
    this.processTransaction()
  },
  methods: {
    async processTransaction() {
      this.calculateTxFee()
    },
    getValueHexBuffer(hex) {
      const buf = Buffer.from(hex, 'hex').reverse()
      return buf.toString('hex')
    },
    getCollateralIndex(hex) {
      const buf = Buffer.from(hex, 'hex').reverse()
      return parseInt(buf.toString('hex'), 16)
    },
    calculateTxFee() {
      if (this.transaction.version === 5) {
        return 0
      }
      if (this.transaction.vin[0]) {
        if (this.transaction.vin[0].coinbase) {
          return 0
        }
      }
      const value = this.transaction.valueBalanceZat || 0
      let valueOut = 0
      let valueIn = 0
      this.transaction.senders.forEach(sender => {
        if (typeof sender === 'object') {
          valueIn += sender.valueSat
        }
      })
      this.transaction.vout.forEach(vout => {
        valueOut += vout.valueSat
      })
      this.transaction.vJoinSplit.forEach(tx => {
        valueIn += tx.vpub_newZat
        valueOut += tx.vpub_oldZat
      })
      const fee = (value - valueOut + valueIn) / 1e8
      return fee
    },
    calculateJoinSplitInput(joinsplit) {
      let valueIn = 0
      joinsplit.forEach(tx => {
        valueIn += tx.vpub_newZat
      })
      return valueIn / 1e8
    },
    calculateJoinSplitOutput(joinsplit) {
      let valueOut = 0
      joinsplit.forEach(tx => {
        valueOut += tx.vpub_oldZat
      })
      return valueOut / 1e8
    },
    decodeMessage(asm) {
      if (!asm) return ''
      const parts = asm.split('OP_RETURN ', 2)
      let message = ''
      if (parts[1]) {
        const encodedMessage = parts[1]
        const hexx = encodedMessage.toString() // force conversion
        for (let k = 0; k < hexx.length && hexx.substr(k, 2) !== '00'; k += 2) {
          message += String.fromCharCode(
            parseInt(hexx.substr(k, 2), 16),
          )
        }
      }
      return message
    },
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
  overflow: hidden;
}
.skinny-list-entry {
  margin-top: 2px !important;
  margin-bottom: 2px !important;
}
</style>
