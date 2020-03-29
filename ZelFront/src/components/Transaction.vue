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
            {{ transactionDetail.confirmations }}
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
            {{ transactionDetail.version }} {{ transactionDetail.version === 5 ? ' - ZelNode transaction' : JSON.stringify(transactionDetail.vin).includes('coinbase')
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
            {{ calculateTxFee() }} ZEL
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

    <div
      :key="uniqueKey"
      v-if="transactionDetail.version < 5 && transactionDetail.version > 0"
    >
      <div
        v-for="i in Math.max(transactionDetail.vin.length, transactionDetail.vout.length)"
        :key="i"
      >
        <el-row v-if="i === 1 && transactionDetail.version === 4">
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
              <i
                v-if="i === 1"
                class="el-icon-arrow-right"
              ></i>
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

        <el-row v-if="i === 1">
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
              <i class="el-icon-arrow-right"></i>
              JoinSplits {{ transactionDetail.vJoinSplit.length }}
              <i class="el-icon-arrow-right"></i>
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
              <div v-if="transactionDetail.vin[i - 1]">
                <div>
                  <div v-if="transactionDetail.vin[i - 1].coinbase">
                    Newly generated coins
                  </div>
                  <div
                    :key="transactionDetail.senders[i - 1]"
                    v-else-if="typeof transactionDetail.senders[i - 1] === 'object'"
                  >
                    {{ transactionDetail.senders[i - 1].value }} ZEL
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
              <i
                v-if="i === 1"
                class="el-icon-arrow-right"
              ></i>
            </div>
          </el-col>
          <el-col :span="11">
            <div class="grid-content bg-purple-light">
              <div v-if="transactionDetail.vout[i - 1]">
                {{ transactionDetail.vout[i - 1].scriptPubKey.addresses[0] }} {{ transactionDetail.vout[i - 1].value }} ZEL
              </div>
            </div>
          </el-col>
        </el-row>
      </div>
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
            ZelNode Public Key
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
            ZelNode Network
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

import ZelCashService from '@/services/ZelCashService';

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
      height: 0,
      transactionDetail: {},
      uniqueKey: 100000,
    };
  },
  mounted() {
    console.log('here');
    this.getTransaction(this.transaction);
  },
  methods: {
    async getTransaction(tx) {
      this.transactionDetail = {};
      const txA = tx;
      txA.senders = [];
      this.transactionDetail = txA;
      if (tx.version < 5 && tx.version > 0) {
        const sendersToFetch = [];
        tx.vin.forEach((vin) => {
          if (!vin.coinbase) {
            sendersToFetch.push(vin);
          }
        });
        const senders = [];
        // eslint-disable-next-line no-restricted-syntax
        for (const sender of sendersToFetch) {
          // eslint-disable-next-line no-await-in-loop
          const senderInformation = await this.getSender(sender.txid, sender.vout);
          senders.push(senderInformation);
          const txDetail = tx;
          txDetail.senders = senders;
          this.transactionDetail = txDetail;
          this.uniqueKey += 1;
        }
        const txDetail = tx;
        txDetail.senders = senders;
        this.transactionDetail = txDetail;
        this.uniqueKey += 1;
      } else {
        this.transactionDetail = tx;
      }
    },
    formatTimeAgo(timeCreated) {
      const periods = {
        month: 30 * 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000,
        hour: 60 * 60 * 1000,
        minute: 60 * 1000,
      };
      const diff = new Date().getTime() - (timeCreated * 1000);

      if (diff > periods.month) {
        // it was at least a month ago
        return `${Math.floor(diff / periods.month)}mo ago`;
      }
      if (diff > periods.week) {
        return `${Math.floor(diff / periods.week)}w ago`;
      }
      if (diff > periods.day) {
        return `${Math.floor(diff / periods.day)}d ago`;
      }
      if (diff > periods.hour) {
        return `${Math.floor(diff / periods.hour)}h ago`;
      }
      if (diff > periods.minute) {
        return `${Math.floor(diff / periods.minute)}m ago`;
      }
      return 'Just now';
    },
    getValueHexBuffer(hex) {
      const buf = Buffer.from(hex, 'hex').reverse();
      return buf.toString('hex');
    },
    getCollateralIndex(hex) {
      const buf = Buffer.from(hex, 'hex').reverse();
      return parseInt(buf.toString('hex'), 16);
    },
    async getSender(txid, vout) {
      const verbose = 1;
      const txContent = await ZelCashService.getRawTransaction(txid, verbose);
      console.log(txContent);
      if (txContent.data.status === 'success') {
        const sender = txContent.data.data.vout[vout];
        this.calculateTxFee();
        this.uniqueKey += 1;
        return sender;
      }
      this.calculateTxFee();
      this.uniqueKey += 1;
      return 'Sender not found';
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
