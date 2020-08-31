<template>
  <div>
    <ElInput
      type="text"
      placeholder="Search for block, transaction or address"
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
    <div
      :key="uniqueKeyBlock"
      v-if="explorerSection === 'block'"
    >
      <el-row v-if="!blocksWithTransaction[height]">
        Loading Block...
      </el-row>
      <div v-if="blocksWithTransaction[height]">
        <el-row>
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
        </el-row>
        <el-row>
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
        </el-row>
        <el-row>
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
        </el-row>
        <el-row>
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
        </el-row>
        <el-row>
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
        </el-row>
        <el-row>
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
        </el-row>
        <el-row>
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
        </el-row>
        <el-row>
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
        </el-row>
        <el-row>
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
        </el-row>
        <el-row>
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
        </el-row>
        <el-row>
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
        </el-row>
        <el-row>
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
        </el-row>
        <el-row>
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
        </el-row>
        <el-row>
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
        <el-row>
          <el-col :span="6">
            <div class="grid-content bg-purple">
              Transactions
            </div>
          </el-col>
          <el-col :span="18">
            <div class="grid-content bg-purple-light">
              <div
                v-for="tx in blocksWithTransaction[height].tx"
                :key="tx"
              >
                {{ tx }}
              </div>
            </div>
          </el-col>
        </el-row>
        <br>
        Transactions:
        <br>
        <div
          v-for="transaction in blocksWithTransaction[height].transactions"
          :key="transaction.txid"
        >
          <Transaction :transaction="transaction" />
          <br>
        </div>
        <div v-if="blocksWithTransaction[height].transactions">
          <p v-if="blocksWithTransaction[height].transactions.length < blocksWithTransaction[height].tx.length">
            Loading More Transactions...
          </p>
        </div>
      </div>
    </div>

    <div
      :key="uniqueKeyAddress"
      v-if="explorerSection === 'address'"
    >
      <el-row v-if="!addressWithTransactions[address]">
        Loading Address...
      </el-row>
      <div v-if="addressWithTransactions[address]">
        <el-row>
          <el-col :span="6">
            <div class="grid-content bg-purple">
              Address
            </div>
          </el-col>
          <el-col :span="18">
            <div class="grid-content bg-purple-light">
              {{ addressWithTransactions[address].address }}
            </div>
          </el-col>
        </el-row>
        <el-row>
          <el-col :span="6">
            <div class="grid-content bg-purple">
              Balance
            </div>
          </el-col>
          <el-col :span="18">
            <div class="grid-content bg-purple-light">
              {{ addressWithTransactions[address].balance }}
            </div>
          </el-col>
        </el-row>
        <el-row>
          <el-col :span="6">
            <div class="grid-content bg-purple">
              No. Transactions
            </div>
          </el-col>
          <el-col :span="18">
            <div class="grid-content bg-purple-light">
              {{ addressWithTransactions[address].transactions.length }}
            </div>
          </el-col>
        </el-row>
        <el-row>
          <el-col :span="6">
            <div class="grid-content bg-purple">
              No. ZelNode Transactions
            </div>
          </el-col>
          <el-col :span="18">
            <div class="grid-content bg-purple-light">
              {{ addressWithTransactions[address].zelnodeTxs.length }}
            </div>
          </el-col>
        </el-row>
        <br>
        Transactions:
        <br>
        <div
          v-for="transaction in addressWithTransactions[address].fetchedTransactions"
          :key="transaction.txid"
        >
          <Transaction :transaction="transaction" />
          <br>
        </div>
        <div v-if="addressWithTransactions[address].fetchedTransactions">
          <p v-if="addressWithTransactions[address].fetchedTransactions.length < addressWithTransactions[address].transactions.length">
            Loading More Transactions...
          </p>
        </div>
        <div v-if="addressWithTransactions[address].zelnodeTxs.length > 0">
          <br>
          ZelNode Transactions:
          <br>
          <div
            v-for="transaction in addressWithTransactions[address].zelnodeTxs"
            :key="transaction.txid"
          >
            <ZelNodeTx :transaction="transaction" />
            <br>
          </div>
        </div>
      </div>
    </div>

    <div
      :key="uniqueKey"
      v-if="explorerSection === 'transaction'"
    >
      <el-row v-if="!transactionDetail.txid">
        Loading Transaction...
      </el-row>
      <div v-if="transactionDetail.txid">
        <Transaction :transaction="transactionDetail" />
      </div>
    </div>
    <div v-if="errorMessage !== ''">
      <h3>
        {{ errorMessage }}
      </h3>
    </div>
    <div>
      {{ 'Synced: ' + scannedHeight + '/' + getInfoResponse.data.blocks}}
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

import ZelCashService from '@/services/ZelCashService';
import ExplorerService from '@/services/ExplorerService';

const Transaction = () => import('@/components/Transaction.vue');
const ZelNodeTx = () => import('@/components/ZelNodeTx.vue');

Vue.use(Vuex);

const vue = new Vue();

export default {
  name: 'Explorer',
  components: {
    Transaction,
    ZelNodeTx,
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
      errorMessage: '',
      activeName: 'explorer',
      getInfoResponse: {
        status: '',
        data: '',
      },
      scannedHeight: 0,
      blocks: [],
      searchBar: '',
      blocksWithTransaction: {},
      address: '',
      addressWithTransactions: {},
      height: 0,
      transactionDetail: {},
      uniqueKey: 100000,
      uniqueKeyBlock: 10000,
      uniqueKeyAddress: 10000,
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
      this.switcher(val);
    },
    searchBar(val) {
      if (parseInt(val, 10) > 0 && parseInt(val, 10).toString().length === val.length) {
        this.getBlock(val);
      } else if (val.length === 64) {
        this.getBlock(val);
      } else if (val.length >= 30 && val.length < 38) {
        this.getAddress(val);
      } else {
        this.$store.commit('setExplorerSection', 'explorer');
      }
    },
    activeName(val, oldVal) {
      console.log(val, oldVal);
      this.switcher(val);
    },
  },
  mounted() {
    this.switcher(this.explorerSection);
  },
  methods: {
    switcher(value) {
      switch (value) {
        case 'explorer':
          this.zelcashGetInfo();
          this.getSyncedHeight();
          break;
        case 'block':
          // nothing to do
          break;
        case 'address':
          // nothing to do
          break;
        case 'transaction':
          // nothing to do
          break;
        default:
          console.log('Explorer Section: Unrecognized method');
      }
    },
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
        vue.$customMes.error(this.errorMessage);
      }
    },
    async getSyncedHeight() {
      const response = await ExplorerService.getScannedHeight();
      if (response.data.status === 'success') {
        this.scannedHeight = response.data.data.generalScannedHeight;
      } else {
        this.scannedHeight = 'ERROR';
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
      const blockHashes = [];
      this.blocks.forEach((block) => {
        blockHashes.push(block.hash);
      });
      // parallel may result in error 500
      await Promise.all(blocksToFetch.map(async (blockIndex) => {
        const blockContent = await ZelCashService.getBlock(blockIndex, verbosity);
        if (blockContent.data.status === 'success') {
          if (!this.existInArray(blockHashes, blockContent.data.data.hash)) {
            this.blocks.push(blockContent.data.data);
          }
        }
      }));
      console.log(this.blocks);
    },
    async getBlockTransactions(transactionArray, height) {
      this.blocksWithTransaction[height].transactions = [];
      this.uniqueKeyBlock += 1;
      const verbose = 1;
      let i = 0;
      // parallel is not possible as zelcash will result in error 500
      // await Promise.all(transactionArray.map(async (transaction) => {
      //   const txContent = await ZelCashService.getRawTransaction(transaction, verbose);
      //   if (txContent.data.status === 'success') {
      //     this.blocksWithTransaction[height].transactions.push(txContent.data.data);
      //   }
      // }));
      // eslint-disable-next-line no-restricted-syntax
      for (const transaction of transactionArray) {
        // eslint-disable-next-line no-await-in-loop
        const txContent = await ZelCashService.getRawTransaction(transaction, verbose);
        if (txContent.data.status === 'success') {
          const transactionDetail = txContent.data.data;
          transactionDetail.senders = [];
          this.blocksWithTransaction[height].transactions.push(transactionDetail);
          this.uniqueKeyAddress += 1;
          // fetching of senders
          if (transactionDetail.version < 5 && transactionDetail.version > 0) {
            const sendersToFetch = [];
            transactionDetail.vin.forEach((vin) => {
              if (!vin.coinbase) {
                sendersToFetch.push(vin);
              }
            });
            // eslint-disable-next-line no-restricted-syntax
            for (const sender of sendersToFetch) {
              // eslint-disable-next-line no-await-in-loop
              const senderInformation = await this.getSenderForBlockOrAddress(sender.txid, sender.vout);
              this.blocksWithTransaction[height].transactions[i].senders.push(senderInformation);
              this.uniqueKeyBlock += 1;
            }
            this.uniqueKeyBlock += 1;
          }
        }
        i += 1;
        this.uniqueKeyBlock += 1;
      }
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
    async getAddressTransactions(transactionArray, address) {
      this.addressWithTransactions[address].fetchedTransactions = [];
      this.uniqueKeyAddress += 1;
      const verbose = 1;
      let i = 0;
      // parallel is not possible as zelcash will result in error 500
      // await Promise.all(transactionArray.map(async (transaction) => {
      //   const txContent = await ZelCashService.getRawTransaction(transaction, verbose);
      //   if (txContent.data.status === 'success') {
      //     this.blocksWithTransaction[height].transactions.push(txContent.data.data);
      //   }
      // }));
      // eslint-disable-next-line no-restricted-syntax
      for (const transaction of transactionArray) {
        // eslint-disable-next-line no-await-in-loop
        const txContent = await ZelCashService.getRawTransaction(transaction.txid, verbose);
        if (txContent.data.status === 'success') {
          const transactionDetail = txContent.data.data;
          transactionDetail.senders = [];
          this.addressWithTransactions[address].fetchedTransactions.push(transactionDetail);
          this.uniqueKeyAddress += 1;
          // fetching of senders
          if (transactionDetail.version < 5 && transactionDetail.version > 0) {
            const sendersToFetch = [];
            transactionDetail.vin.forEach((vin) => {
              if (!vin.coinbase) {
                sendersToFetch.push(vin);
              }
            });
            // eslint-disable-next-line no-restricted-syntax
            for (const sender of sendersToFetch) {
              // eslint-disable-next-line no-await-in-loop
              const senderInformation = await this.getSenderForBlockOrAddress(sender.txid, sender.vout);
              this.addressWithTransactions[address].fetchedTransactions[i].senders.push(senderInformation);
              this.uniqueKeyAddress += 1;
            }
            this.uniqueKeyAddress += 1;
          }
        }
        i += 1;
        this.uniqueKeyAddress += 1;
      }
    },
    async getAddress(address) {
      this.address = 'dummyAddress';
      this.$store.commit('setExplorerSection', 'address');
      if (!this.addressWithTransactions[address]) {
        const responseAddr = await ExplorerService.getAddressTransactions(address);
        const responseBalance = await ExplorerService.getAddressBalance(address);
        console.log(responseAddr);
        console.log(responseBalance);
        if (responseAddr.data.status === 'success' && responseBalance.data.status === 'success' && responseAddr.data.data !== null) {
          this.address = address;
          this.addressWithTransactions[address] = {};
          this.addressWithTransactions[address].transactions = responseAddr.data.data;
          this.addressWithTransactions[address].address = address;
          this.addressWithTransactions[address].balance = responseBalance.data.data;
          this.addressWithTransactions[address].zelnodeTxs = [];
          this.getAddressTransactions(responseAddr.data.data, address);
          const responseZelNodeTxs = await ExplorerService.getZelNodeTransactions(address);
          if (responseZelNodeTxs.data.status === 'success') {
            this.addressWithTransactions[address].zelnodeTxs = responseZelNodeTxs.data.data;
            this.uniqueKeyAddress += 1;
          }
        } else {
          vue.$customMes.info('Not found');
          this.$store.commit('setExplorerSection', 'explorer');
        }
      } else {
        this.address = address;
      }
    },
    async getTransaction(hash) {
      this.transactionDetail = {};
      const verbose = 1;
      this.$store.commit('setExplorerSection', 'transaction');
      const txContent = await ZelCashService.getRawTransaction(hash, verbose);
      console.log(txContent);
      if (txContent.data.status === 'success') {
        if (txContent.data.data.version < 5 && txContent.data.data.version > 0) {
          const txA = txContent.data.data;
          txA.senders = [];
          this.transactionDetail = txA;
          const sendersToFetch = [];
          txContent.data.data.vin.forEach((vin) => {
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
            const txDetail = txContent.data.data;
            txDetail.senders = senders;
            this.transactionDetail = txDetail;
            this.uniqueKey += 1;
          }
        } else {
          this.transactionDetail = txContent.data.data;
          this.uniqueKey += 1;
        }
      } else {
        vue.$customMes.info('Not found');
        this.$store.commit('setExplorerSection', 'explorer');
      }
      console.log(this.transactionDetail);
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
    async getSender(txid, vout) {
      const verbose = 1;
      const txContent = await ZelCashService.getRawTransaction(txid, verbose);
      console.log(txContent);
      if (txContent.data.status === 'success') {
        const sender = txContent.data.data.vout[vout];
        this.uniqueKey += 1;
        return sender;
      }
      this.uniqueKey += 1;
      return 'Sender not found';
    },
    async getSenderForBlockOrAddress(txid, vout) {
      const verbose = 1;
      const txContent = await ZelCashService.getRawTransaction(txid, verbose);
      console.log(txContent);
      if (txContent.data.status === 'success') {
        const sender = txContent.data.data.vout[vout];
        return sender;
      }
      return 'Sender not found';
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
