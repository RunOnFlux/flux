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
            Height
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.height }}
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
            {{ transactionDetail.collateralHash }}
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
            {{ transactionDetail.collateralIndex }}
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
            {{ transactionDetail.updateType }}
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
            {{ transactionDetail.benchTier }}
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
  },
  data() {
    return {
      transactionDetail: {},
    };
  },
  mounted() {
    console.log('here');
    this.processTransaction(this.transaction);
  },
  methods: {
    async processTransaction(tx) {
      this.transactionDetail = {};
      this.transactionDetail = tx;
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
