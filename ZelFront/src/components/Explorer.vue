<template>
  <div>
    <ElInput
      type="text"
      placeholder="Search for block or transaction"
      v-model="searchBar"
    >
    </ElInput>
    <br><br>
    <div v-if="explorerSection === 'explorer'">
      <el-table
        :data="blocks"
        empty-text="Loading Blocks..."
        :default-sort="{prop: 'height', order: 'descending'}"
        style="width: 100%"
        lazy
      >
        <el-table-column
          label="Height"
          prop="height"
        >
          <template slot-scope="scope">
            <el-link
              type="primary"
              @click="getBlock(scope.row.height);"
            >
              {{ scope.row.height }}
            </el-link>
          </template>
        </el-table-column>
        <el-table-column label="Age">
          <template slot-scope="scope">
            {{ formatTimeAgo(scope.row.time) }}
          </template>
        </el-table-column>
        <el-table-column label="Transactions">
          <template slot-scope="scope">
            {{ scope.row.tx.length }}
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div v-if="explorerSection === 'block'">
      <el-row v-if="!blocksWithTransaction[height]">
        Loading Block...
      </el-row>
      <el-row v-if="blocksWithTransaction[height]">
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Height
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ blocksWithTransaction[height].height }}
          </div>
        </el-col>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Hash
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ blocksWithTransaction[height].hash }}
          </div>
        </el-col>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Date
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ new Date(blocksWithTransaction[height].time * 1000).toLocaleString('en-GB', timeoptions) }}
          </div>
        </el-col>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Confirmations
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ blocksWithTransaction[height].confirmations }}
          </div>
        </el-col>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Size
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ blocksWithTransaction[height].size }} Bytes
          </div>
        </el-col>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Version
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ blocksWithTransaction[height].version }}
          </div>
        </el-col>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Nonce
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ blocksWithTransaction[height].nonce }}
          </div>
        </el-col>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Solution
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ blocksWithTransaction[height].solution }}
          </div>
        </el-col>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Bits
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ blocksWithTransaction[height].bits }}
          </div>
        </el-col>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Difficulty
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ blocksWithTransaction[height].difficulty }}
          </div>
        </el-col>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Chainwork
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ blocksWithTransaction[height].chainwork }}
          </div>
        </el-col>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Merkle Root
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ blocksWithTransaction[height].merkleroot }}
          </div>
        </el-col>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Final Sapling Root
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ blocksWithTransaction[height].finalsaplingroot }}
          </div>
        </el-col>
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Anchor
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ blocksWithTransaction[height].anchor }}
          </div>
        </el-col>
      </el-row>
    </div>
    <div v-if="explorerSection === 'transaction'">
      <el-row v-if="!transactionDetail.txid">
        Loading Transaction...
      </el-row>
      <el-row v-if="transactionDetail.txid">
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
        <el-col :span="6">
          <div class="grid-content bg-purple">
            Version
          </div>
        </el-col>
        <el-col :span="18">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.version }} {{ transactionDetail.version === 5 ? ' - ZelNode transaction' : ''}}
          </div>
        </el-col>
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
      <el-row v-if="transactionDetail.version === 5">
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
        <el-col :span="6" v-if="transactionDetail.type === 'Starting a zelnode'">
          <div class="grid-content bg-purple">
            Collateral Public Key
          </div>
        </el-col>
        <el-col :span="18" v-if="transactionDetail.type === 'Starting a zelnode'">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.collateral_pubkey }}
          </div>
        </el-col>
        <el-col :span="6" v-if="transactionDetail.type === 'Starting a zelnode'">
          <div class="grid-content bg-purple">
            ZelNode Public Key
          </div>
        </el-col>
        <el-col :span="18" v-if="transactionDetail.type === 'Starting a zelnode'">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.zelnode_pubkey }}
          </div>
        </el-col>
        <el-col :span="6" v-if="transactionDetail.type === 'Confirming a zelnode'">
          <div class="grid-content bg-purple">
            ZelNode Network
          </div>
        </el-col>
        <el-col :span="18" v-if="transactionDetail.type === 'Confirming a zelnode'">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.ip }}
          </div>
        </el-col>
        <el-col :span="6" v-if="transactionDetail.type === 'Confirming a zelnode'">
          <div class="grid-content bg-purple">
            Update Type
          </div>
        </el-col>
        <el-col :span="18" v-if="transactionDetail.type === 'Confirming a zelnode'">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.update_type }}
          </div>
        </el-col>
        <el-col :span="6" v-if="transactionDetail.type === 'Confirming a zelnode'">
          <div class="grid-content bg-purple">
            Benchmark Tier
          </div>
        </el-col>
        <el-col :span="18" v-if="transactionDetail.type === 'Confirming a zelnode'">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.benchmark_tier }}
          </div>
        </el-col>
        <el-col :span="6" v-if="transactionDetail.type === 'Confirming a zelnode'">
          <div class="grid-content bg-purple">
            Benchmark Signature
          </div>
        </el-col>
        <el-col :span="18" v-if="transactionDetail.type === 'Confirming a zelnode'">
          <div class="grid-content bg-purple-light">
            {{ transactionDetail.benchmark_sig }}
          </div>
        </el-col>
        <el-col :span="6" v-if="transactionDetail.type === 'Confirming a zelnode'">
          <div class="grid-content bg-purple">
           Benchmark Signature Time
          </div>
        </el-col>
        <el-col :span="18" v-if="transactionDetail.type === 'Confirming a zelnode'">
          <div class="grid-content bg-purple-light">
            {{ new Date(transactionDetail.benchmark_sigtime * 1000).toLocaleString('en-GB', timeoptions) }}
          </div>
        </el-col>
      </el-row>
    </div>
    <div v-if="errorMessage !== ''">
      <h3>
        {{ errorMessage }}
      </h3>
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

import ZelCashService from '@/services/ZelCashService';

Vue.use(Vuex);

const vue = new Vue();

export default {
  name: 'Explorer',
  data() {
    return {
      timeoptions: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
      errorMessage: '',
      activeName: 'explorer',
      getInfoResponse: {
        status: '',
        data: '',
      },
      blocks: [],
      searchBar: '',
      blocksWithTransaction: {},
      height: 0,
      transactionDetail: {},
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'explorerSection',
    ]),
  },
  watch: {
    explorerSection(val, oldVal) {
      console.log(val, oldVal);
      switch (val) {
        case 'explorer':
          this.zelcashGetInfo();
          break;
        case 'block':
          // nothing to do
          break;
        case 'transaction':
          // nothing to do
          break;
        default:
          console.log('Explorer Section: Unrecognized method'); // should not be visible if everything works correctly
      }
    },
    searchBar(val) {
      if (parseInt(val, 10) > 0 && parseInt(val, 10).toString().length === val.length) {
        this.getBlock(val);
      } else if (val.length === 64) {
        this.getBlock(val);
      } else {
        this.$store.commit('setExplorerSection', 'explorer');
      }
    },
    activeName(val, oldVal) {
      console.log(val, oldVal);
      switch (val) {
        case 'explorer':
          this.zelcashGetInfo();
          break;
        case 'block':
          // nothing to do
          break;
        case 'transaction':
          // nothing to do
          break;
        default:
          console.log('Explorer Section: Unrecognized method'); // should not be visible if everything works correctly
      }
    },
  },
  mounted() {
    switch (this.explorerSection) {
      case 'explorer':
        this.zelcashGetInfo();
        break;
      case 'block':
        // nothing to do
        break;
      case 'transaction':
        // nothing to do
        break;
      default:
        console.log('Explorer Section: Unrecognized method');
    }
  },
  methods: {
    existInArray(array, element) {
      for (let i = 0; i < array.length; i += 1) {
        if (array[i] === element) {
          return true;
        }
      }
      return false;
    },
    async zelcashGetInfo() {
      const response = await ZelCashService.getInfo();
      this.getInfoResponse.status = response.data.status;
      if (typeof response.data.data.blocks === 'number') {
        if ((response.data.data.blocks > this.getInfoResponse.data.blocks) || !this.getInfoResponse.data.blocks) {
          this.getInfoResponse.data = response.data.data;
          this.getBlocks();
        }
      } else {
        this.errorMessage = 'Unable to communicate with ZelCash node';
        vue.$message.error(this.errorMessage);
      }
    },
    async getBlocks() {
      // fetch information about last 10 blocks
      const height = this.getInfoResponse.data.blocks;
      const verbosity = 1;
      const startingBlockHeight = height - 10;
      const blocksToFetch = [];
      for (let i = startingBlockHeight; i <= height; i += 1) {
        blocksToFetch.push(i);
      }
      await Promise.all(blocksToFetch.map(async (blockIndex) => {
        const blockContent = await ZelCashService.getBlock(blockIndex, verbosity);
        if (blockContent.data.status === 'success') {
          if (!this.existInArray(this.blocks, blockContent.data.data)) {
            this.blocks.push(blockContent.data.data);
          }
        }
      }));
      console.log(this.blocks);
    },
    async getBlockTransactions(transactionArray, height) {
      this.blocksWithTransaction[height].transactions = [];
      const verobose = 1;
      await Promise.all(transactionArray.map(async (transaction) => {
        const txContent = await ZelCashService.getRawTransaction(transaction, verobose);
        if (txContent.data.status === 'success') {
          this.blocksWithTransaction[height].transactions.push(txContent.data.data);
        }
      }));
      console.log(this.blocksWithTransaction);
    },
    async getBlock(heightOrHash) {
      const verbosity = 1;
      this.height = -1;
      this.$store.commit('setExplorerSection', 'block');
      if (!this.blocksWithTransaction[heightOrHash]) {
        const response = await ZelCashService.getBlock(heightOrHash, verbosity);
        if (response.data.status === 'success') {
          this.height = response.data.data.height;
          this.blocksWithTransaction[response.data.data.height] = response.data.data;
          this.getBlockTransactions(response.data.data.tx, response.data.data.height);
        } else {
          this.getTransaction(heightOrHash);
        }
      } else {
        this.height = heightOrHash;
      }
    },
    async getTransaction(hash) {
      this.transactionDetail = {};
      const verobose = 1;
      this.$store.commit('setExplorerSection', 'transaction');
      const txContent = await ZelCashService.getRawTransaction(hash, verobose);
      console.log(txContent);
      if (txContent.data.status === 'success') {
        this.transactionDetail = txContent.data.data;
      } else {
        vue.$message.info('Not found');
        this.$store.commit('setExplorerSection', 'explorer');
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
