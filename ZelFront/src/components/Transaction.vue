<template>
  <div>
    <el-row v-if="!transactionDetail.txid">
      Loading Transaction...
    </el-row>
    <div v-if="transactionDetail.txid">
      <el-row>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            TXID
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.txid }}
          </div>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Date
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ new Date(transactionDetail.blocktime * 1000).toLocaleString('en-GB', timeoptions) }}
          </div>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Confirmations
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.height ? height - transactionDetail.height + 1 : 0 }}
          </div>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Version
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.version }} {{ transactionDetail.version === 5 ? ' - Flux transaction' : JSON.stringify(transactionDetail.vin).includes('coinbase')
              ? ' - Coinbase transaction' : ' - Standard transaction' }}
          </div>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Size
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.hex.length / 2 }} Bytes
          </div>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Fee
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ calculateTxFee() }} FLUX
          </div>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Height
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.height }}
          </div>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Block Hash
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.blockhash }}
          </div>
        </el-col>
      </el-row>
    </div>

    <div v-if="transactionDetail.version < 5 && transactionDetail.version > 0">
      <el-row>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Overwintered
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.overwintered }}
          </div>
        </el-col>
      </el-row>
      <el-row v-if="transactionDetail.version === 4">
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Version Group ID
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.versiongroupid }}
          </div>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Lock Time
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.locktime }}
          </div>
        </el-col>
      </el-row>
      <el-row v-if="transactionDetail.version === 4">
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Expiry Height
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.expiryheight }}
          </div>
        </el-col>
      </el-row>
    </div>

    <div v-if="transactionDetail.version < 5 && transactionDetail.version > 0">
      <el-row v-if="transactionDetail.version === 4">
        <el-col :span="11">
          <div class="grid-content bg-purple">
            <div v-if="transactionDetail.vShieldedSpend.length > 0">
              {{ transactionDetail.vShieldedSpend.length }} sapling inputs
            </div>
            <div v-else>
              No sapling inputs
            </div>
          </div>
        </el-col>
        <el-col :span="2">
          <div class="grid-content bg-purple">
            <i class="el-icon-arrow-right" />
          </div>
        </el-col>
        <el-col :span="11">
          <div class="grid-content bg-purple-light">
            <div v-if="transactionDetail.vShieldedOutput.length > 0">
              {{ transactionDetail.vShieldedOutput.length }} sapling outputs
            </div>
            <div v-else>
              No sapling outputs
            </div>
          </div>
        </el-col>
      </el-row>

      <el-row>
        <el-col :span="10">
          <div class="grid-content bg-purple">
            <div v-if="transactionDetail.vJoinSplit.length > 0">
              {{ calculateJoinSplitInput(transactionDetail.vJoinSplit) }} sprout input
            </div>
            <div v-else>
              No sprout inputs
            </div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="grid-content bg-purple">
            <i class="el-icon-arrow-right" />
            JoinSplits {{ transactionDetail.vJoinSplit.length }}
            <i class="el-icon-arrow-right" />
          </div>
        </el-col>
        <el-col :span="10">
          <div class="grid-content bg-purple-light">
            <div v-if="transactionDetail.vJoinSplit.length > 0">
              {{ calculateJoinSplitOutput(transactionDetail.vJoinSplit) }} sprout output
            </div>
            <div v-else>
              No sprout outputs
            </div>
          </div>
        </el-col>
      </el-row>

      <el-row :gutter="0">
        <el-col :span="11">
          <div class="grid-content bg-purple">
            <div
              v-for="i in transactionDetail.vin.length"
              :key="i"
            >
              <div>
                <div v-if="transactionDetail.vin[i - 1].coinbase">
                  Newly generated coins
                </div>
                <div
                  v-else-if="typeof transactionDetail.senders[i - 1] === 'object'"
                  :key="transactionDetail.senders[i - 1].value || transactionDetail.senders[i - 1]"
                >
                  {{ transactionDetail.senders[i - 1].value }} FLUX
                  {{ transactionDetail.senders[i - 1].scriptPubKey.addresses[0] }}
                </div>
                <div v-else>
                  {{ transactionDetail.senders[i - 1] || 'Loading Sender' }}
                </div>
              </div>
            </div>
          </div>
        </el-col>
        <el-col :span="2">
          <div class="grid-content bg-purple">
            <i class="el-icon-arrow-right" />
          </div>
        </el-col>
        <el-col :span="11">
          <div class="grid-content bg-purple-light">
            <div
              v-for="i in transactionDetail.vout.length"
              :key="i"
            >
              <div v-if="transactionDetail.vout[i - 1].scriptPubKey.addresses">
                {{ transactionDetail.vout[i - 1].scriptPubKey.addresses[0] }} {{ transactionDetail.vout[i - 1].value }} FLUX
              </div>
              <div v-else>
                {{ decodeMessage(transactionDetail.vout[i - 1].asm) }}
              </div>
            </div>
          </div>
        </el-col>
      </el-row>
    </div>

    <div v-if="transactionDetail.version === 5">
      <el-row>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Type
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.type }}
          </div>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Collateral Hash
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ getValueHexBuffer(transactionDetail.hex.slice(10, 74)) }}
          </div>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Collateral Index
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ getCollateralIndex(transactionDetail.hex.slice(74, 82)) }}
          </div>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Signature
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.sig }}
          </div>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Signature Time
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ new Date(transactionDetail.sigtime * 1000).toLocaleString('en-GB', timeoptions) }}
          </div>
        </el-col>
      </el-row>
      <el-row v-if="transactionDetail.type === 'Starting a zelnode'">
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Collateral Public Key
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.collateral_pubkey }}
          </div>
        </el-col>
      </el-row>
      <el-row v-if="transactionDetail.type === 'Starting a zelnode'">
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Flux Public Key
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.zelnode_pubkey }}
          </div>
        </el-col>
      </el-row>
      <el-row v-if="transactionDetail.type === 'Confirming a zelnode'">
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Flux Network
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.ip }}
          </div>
        </el-col>
      </el-row>
      <el-row v-if="transactionDetail.type === 'Confirming a zelnode'">
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Update Type
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.update_type }}
          </div>
        </el-col>
      </el-row>
      <el-row v-if="transactionDetail.type === 'Confirming a zelnode'">
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Benchmark Tier
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.benchmark_tier }}
          </div>
        </el-col>
      </el-row>
      <el-row v-if="transactionDetail.type === 'Confirming a zelnode'">
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Benchmark Signature
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.benchmark_sig }}
          </div>
        </el-col>
      </el-row>
      <el-row v-if="transactionDetail.type === 'Confirming a zelnode'">
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Benchmark Signature Time
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ new Date(transactionDetail.benchmark_sigtime * 1000).toLocaleString('en-GB', timeoptions) }}
          </div>
        </el-col>
      </el-row>
    </div>
  </div>
</template>

<script>
import Vuex from 'vuex';
import Vue from 'vue';

Vue.use(Vuex);

export default {
  name: 'Explorer',
  props: {
    transaction: {
      type: Object,
      default() {
        return { version: 0 };
      },
    },
    height: {
      type: Number,
      default() {
        return 0;
      },
    },
  },
  data() {
    return {
      timeoptions: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
      transactionDetail: {},
    };
  },
  mounted() {
    this.processTransaction(this.transaction);
  },
  methods: {
    async processTransaction(tx) {
      this.transactionDetail = {};
      this.transactionDetail = tx;
      this.calculateTxFee();
    },
    getValueHexBuffer(hex) {
      const buf = Buffer.from(hex, 'hex').reverse();
      return buf.toString('hex');
    },
    getCollateralIndex(hex) {
      const buf = Buffer.from(hex, 'hex').reverse();
      return parseInt(buf.toString('hex'), 16);
    },
    calculateTxFee() {
      if (this.transactionDetail.version === 5) {
        return 0;
      }
      if (this.transactionDetail.vin[0]) {
        if (this.transactionDetail.vin[0].coinbase) {
          return 0;
        }
      }
      const value = this.transactionDetail.valueBalanceZat || 0;
      let valueOut = 0;
      let valueIn = 0;
      this.transactionDetail.senders.forEach((sender) => {
        if (typeof sender === 'object') {
          valueIn += sender.valueSat;
        }
      });
      this.transactionDetail.vout.forEach((vout) => {
        valueOut += vout.valueSat;
      });
      this.transactionDetail.vJoinSplit.forEach((tx) => {
        valueIn += tx.vpub_newZat;
        valueOut += tx.vpub_oldZat;
      });
      const fee = (value - valueOut + valueIn) / 1e8;
      return fee;
    },
    calculateJoinSplitInput(joinsplit) {
      let valueIn = 0;
      joinsplit.forEach((tx) => {
        valueIn += tx.vpub_newZat;
      });
      return valueIn / 1e8;
    },
    calculateJoinSplitOutput(joinsplit) {
      let valueOut = 0;
      joinsplit.forEach((tx) => {
        valueOut += tx.vpub_oldZat;
      });
      return valueOut / 1e8;
    },
    decodeMessage(asm) {
      const parts = asm.split('OP_RETURN ', 2);
      let message = '';
      if (parts[1]) {
        const encodedMessage = parts[1];
        const hexx = encodedMessage.toString(); // force conversion
        for (let k = 0; k < hexx.length && hexx.substr(k, 2) !== '00'; k += 2) {
          message += String.fromCharCode(
            parseInt(hexx.substr(k, 2), 16),
          );
        }
      }
      return message;
    },
  },
};
</script>

<style scoped>
.grid-content {
  user-select: text;
  border: 1px solid black;
}
.bg-purple {
  background: #d3dce6;
  color: black;
}
.bg-purple-light {
  background: #e5e9f2;
  color: black;
}
</style>
