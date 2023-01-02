<template>
  <div>
    <b-row>
      <b-col
        cols="4"
        sm="4"
        lg="2"
      >
        <b-button
          v-if="!explorerView"
          v-ripple.400="'rgba(255, 255, 255, 0.15)'"
          class="mr-2"
          variant="outline-primary"
          pill
          @click="goBackToExplorer"
        >
          <v-icon name="chevron-left" />
          Back
        </b-button>
      </b-col>
      <b-col
        cols="8"
        sm="8"
        lg="10"
      >
        <b-form-input
          v-model="searchBar"
          placeholder="Search for block, transaction or address"
        />
      </b-col>
    </b-row>
    <b-row v-if="explorerView">
      <b-col
        xs="12"
      >
        <b-table
          class="blocks-table mt-2"
          striped
          hover
          responsive
          :items="blocks"
          :fields="blocksFields"
          sort-by="height"
          :sort-desc="true"
          @row-clicked="selectBlock"
        >
          <template #cell(time)="data">
            {{ formatTimeAgo(data.item.time) }}
          </template>
          <template #cell(transactions)="data">
            {{ data.item.tx.length }}
          </template>
        </b-table>
        <div class="text-center">
          <b-button
            v-ripple.400="'rgba(255, 255, 255, 0.15)'"
            class="mt-1"
            variant="primary"
            @click="loadMoreBlocks"
          >
            Load More Blocks
          </b-button>
        </div>
        <div class="syncstatus">
          {{ 'Synced: ' + scannedHeight + '/' + getInfoResponse.data.blocks }}
        </div>
      </b-col>
    </b-row>
    <b-row
      v-if="blockView"
      class="mt-2"
    >
      <b-col cols="12">
        <b-card
          :title="`Block #${selectedBlock.height}`"
        >
          <list-entry
            title="Block Hash"
            :data="selectedBlock.hash"
          />
          <list-entry
            v-if="selectedBlock.height > 0"
            title="Previous Block"
            :number="selectedBlock.height - 1"
            :click="true"
            @click="selectPreviousBlock"
          />
        </b-card>
        <b-card title="Summary">
          <b-row>
            <b-col
              cols="12"
              lg="4"
            >
              <list-entry
                title="Transactions"
                :number="selectedBlock.tx.length"
              />
              <list-entry
                title="Height"
                :number="selectedBlock.height"
              />
              <list-entry
                title="Timestamp"
                :data="new Date(selectedBlock.time * 1000).toLocaleString('en-GB', timeoptions.shortDate)"
              />
              <list-entry
                title="Difficulty"
                :number="selectedBlock.difficulty"
              />
              <list-entry
                title="Size (bytes)"
                :number="selectedBlock.size"
              />
            </b-col>
            <b-col
              cols="12"
              lg="8"
            >
              <list-entry
                title="Version"
                :number="selectedBlock.version"
              />
              <list-entry
                title="Bits"
                :data="selectedBlock.bits"
              />
              <list-entry
                title="Merkle Root"
                :data="selectedBlock.merkleroot"
              />
              <list-entry
                title="Nonce"
                :data="selectedBlock.nonce"
              />
              <list-entry
                title="Solution"
                :data="selectedBlock.solution"
              />
            </b-col>
          </b-row>
        </b-card>
        <b-card title="Transactions">
          <app-collapse>
            <app-collapse-item
              v-for="tx in selectedBlockTransactions"
              :key="tx.txid"
              :title="`TXID: ${tx.txid}`"
              class="txid-title"
            >
              <Transaction
                :transaction="tx"
                :current-height="getInfoResponse.data.blocks"
              />
            </app-collapse-item>
          </app-collapse>
        </b-card>
      </b-col>
    </b-row>
    <b-row
      v-if="txView"
      class="mt-2"
    >
      <b-col cols="12">
        <b-overlay
          :show="!transactionDetail.txid"
          variant="transparent"
          blur="5px"
          opacity="0.82"
        >
          <b-card :title="`Transaction: ${transactionDetail.txid ? transactionDetail.txid : 'Loading...'}`">
            <Transaction
              v-if="transactionDetail.txid"
              :transaction="transactionDetail"
              :current-height="getInfoResponse.data.blocks"
            />
          </b-card>
        </b-overlay>
      </b-col>
    </b-row>

    <b-overlay
      v-if="addressView"
      :show="!addressWithTransactions[address]"
      variant="transparent"
      blur="5px"
      opacity="0.82"
    >
      <b-row
        :key="uniqueKeyAddress"
        class="mt-2 match-height"
      >
        <b-col
          cols="12"
          lg="6"
        >
          <b-card :title="`Address: ${addressWithTransactions[address] ? addressWithTransactions[address].address : 'Loading...'}`">
            <h2>
              Balance: {{ addressWithTransactions[address] ? `${(addressWithTransactions[address].balance / 100000000.0).toLocaleString()} FLUX` : "Loading..." }}
            </h2>
          </b-card>
        </b-col>
        <b-col
          cols="12"
          lg="6"
        >
          <b-card title="Summary">
            <list-entry
              title="No. Transactions"
              :number="addressWithTransactions[address] ? addressWithTransactions[address].transactions.length : 0"
            />
            <list-entry
              title="Flux Transactions"
              :number="addressWithTransactions[address] ? addressWithTransactions[address].fluxTxs.length : 0"
            />
          </b-card>
        </b-col>
      </b-row>
      <b-row
        v-if="addressWithTransactions[address] && addressWithTransactions[address].fetchedTransactions && addressWithTransactions[address].fetchedTransactions.length > 0"
      >
        <b-col cols="12">
          <b-card title="Transactions">
            <app-collapse>
              <app-collapse-item
                v-for="tx in addressWithTransactions[address].fetchedTransactions"
                :key="tx.txid"
                :title="`TXID: ${tx.txid}`"
              >
                <Transaction
                  :transaction="tx"
                  :current-height="getInfoResponse.data.blocks"
                />
              </app-collapse-item>
            </app-collapse>
          </b-card>
        </b-col>
      </b-row>
      <b-row
        v-if="addressWithTransactions[address] && addressWithTransactions[address].fluxTxs && addressWithTransactions[address].fluxTxs.length > 0"
      >
        <b-col cols="12">
          <b-card title="Flux Transactions">
            <app-collapse>
              <app-collapse-item
                v-for="tx in addressWithTransactions[address].fluxTxs"
                :key="tx.txid"
                :title="`TXID: ${tx.txid}`"
              >
                <FluxTransaction :transaction="tx" />
              </app-collapse-item>
            </app-collapse>
          </b-card>
        </b-col>
      </b-row>
    </b-overlay>
  </div>
</template>

<script>
import {
  BButton,
  BCard,
  BFormInput,
  BTable,
  BOverlay,
} from 'bootstrap-vue';

import Ripple from 'vue-ripple-directive';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import AppCollapse from '@core/components/app-collapse/AppCollapse.vue';
import AppCollapseItem from '@core/components/app-collapse/AppCollapseItem.vue';
import ListEntry from '@/views/components/ListEntry.vue';
import Transaction from '@/views/explorer/Transaction.vue';
import FluxTransaction from '@/views/explorer/FluxTransaction.vue';

import DaemonService from '@/services/DaemonService.js';
import ExplorerService from '@/services/ExplorerService.js';

import timeoptions from '@/libs/dateFormat.js';

export default {
  components: {
    BButton,
    BCard,
    BFormInput,
    BTable,
    BOverlay,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
    ListEntry,
    Transaction,
    FluxTransaction,
    AppCollapse,
    AppCollapseItem,
  },
  directives: {
    Ripple,
  },
  data() {
    return {
      timeoptions,
      errorMessage: '',
      scannedHeight: 0,
      getInfoResponse: {
        status: '',
        data: '',
      },
      blocks: [],
      blocksFields: [
        { key: 'height', label: 'Height' },
        { key: 'time', label: 'Age' },
        { key: 'transactions', label: 'Transactions' },
        { key: 'size', label: 'Size' },
      ],
      searchBar: '',
      blocksWithTransaction: {},
      address: '',
      addressWithTransactions: {},
      height: 0,
      transactionDetail: {},
      uniqueKey: 100000,
      uniqueKeyBlock: 10000,
      uniqueKeyAddress: 10000,
      explorerView: true,
      blockView: false,
      txView: false,
      addressView: false,
      lastBlock: 0,
      selectedBlock: {},
      selectedBlockTransactions: [],
    };
  },
  watch: {
    searchBar(val) {
      if (parseInt(val, 10) > 0 && parseInt(val, 10).toString().length === val.length) {
        this.getBlock(val);
      } else if (val.length === 64) {
        this.getBlock(val);
      } else if (val.length >= 30 && val.length < 38) {
        this.getAddress(val);
      }
    },
    selectedBlock: {
      handler(block) {
        this.selectedBlockTransactions = block.transactions;
      },
      deep: true,
      immediate: true,
    },
    addressWithTransactions: {
      handler() {

      },
      deep: true,
      immediate: true,
    },
  },
  mounted() {
    this.daemonGetInfo();
    this.getSyncedHeight();
  },
  methods: {
    async daemonGetInfo() {
      const response = await DaemonService.getInfo();
      this.getInfoResponse.status = response.data.status;
      if (typeof response.data.data.blocks === 'number') {
        if ((response.data.data.blocks > this.getInfoResponse.data.blocks) || !this.getInfoResponse.data.blocks) {
          this.getInfoResponse.data = response.data.data;
          this.lastBlock = this.getInfoResponse.data.blocks;
          this.getBlocks(this.getInfoResponse.data.blocks);
        }
      } else {
        this.errorMessage = 'Unable to communicate with Flux Daemon';
        this.showToast('danger', this.errorMessage);
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
    async getBlocks(height, targetHeight) {
      // fetch information about last 20 blocks
      const verbosity = 1;
      const startingBlockHeight = height - (targetHeight ? 1 : 20);
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
        const blockContent = await DaemonService.getBlock(blockIndex, verbosity);
        if (blockContent.data.status === 'success') {
          if (!blockHashes.includes(blockContent.data.data.hash)) {
            this.blocks.push(blockContent.data.data);
            if (targetHeight && targetHeight === blockContent.data.data.height) {
              this.selectedBlock = blockContent.data.data;
            }
            if (blockContent.data.data.height < this.lastBlock) {
              this.lastBlock = blockContent.data.data.height;
            }
          }
        }
      }));
    },

    loadMoreBlocks() {
      this.getBlocks(this.lastBlock);
    },

    async getBlock(heightOrHash) {
      const verbosity = 1;
      this.height = -1;
      if (!this.blocksWithTransaction[heightOrHash]) {
        const response = await DaemonService.getBlock(heightOrHash, verbosity);
        if (response.data.status === 'success') {
          this.height = response.data.data.height;
          this.selectBlock(response.data.data);
        } else {
          this.getTransaction(heightOrHash);
        }
      } else {
        this.height = heightOrHash;
      }
    },

    async getAddress(address) {
      this.address = 'dummyAddress';
      this.addressView = true;
      this.explorerView = false;
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
          this.addressWithTransactions[address].fluxTxs = [];
          this.getAddressTransactions(responseAddr.data.data, address);
          const responseFluxTxs = await ExplorerService.getFluxTransactions(address);
          console.log(responseFluxTxs);
          if (responseFluxTxs.data.status === 'success') {
            this.addressWithTransactions[address].fluxTxs = responseFluxTxs.data.data;
            this.uniqueKeyAddress += 1;
          }
        } else {
          this.showToast('warning', 'Address not found');
          this.addressView = false;
          this.explorerView = true;
        }
      } else {
        this.address = address;
      }
    },
    async getAddressTransactions(transactionArray, address) {
      this.addressWithTransactions[address].fetchedTransactions = [];
      this.uniqueKeyAddress += 1;
      const verbose = 1;
      let i = 0;
      // parallel is not possible as daemon will result in error 500
      // await Promise.all(transactionArray.map(async (transaction) => {
      //   const txContent = await DaemonService.getRawTransaction(transaction, verbose);
      //   if (txContent.data.status === 'success') {
      //     this.blocksWithTransaction[height].transactions.push(txContent.data.data);
      //   }
      // }));
      // eslint-disable-next-line no-restricted-syntax
      for (const transaction of transactionArray) {
        // eslint-disable-next-line no-await-in-loop
        const txContent = await DaemonService.getRawTransaction(transaction.txid, verbose);
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

    async getTransaction(hash) {
      this.transactionDetail = {};
      this.txView = true;
      this.explorerView = false;
      const verbose = 1;
      const txContent = await DaemonService.getRawTransaction(hash, verbose);
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
        this.showToast('warning', 'Transaction not found');
        this.txView = false;
        this.explorerView = true;
      }
      console.log(this.transactionDetail);
    },

    async getSender(txid, vout) {
      const verbose = 1;
      const txContent = await DaemonService.getRawTransaction(txid, verbose);
      console.log(txContent);
      if (txContent.data.status === 'success') {
        const sender = txContent.data.data.vout[vout];
        return sender;
      }
      return 'Sender not found';
    },
    async getSenderForBlockOrAddress(txid, vout) {
      const verbose = 1;
      const txContent = await DaemonService.getRawTransaction(txid, verbose);
      console.log(txContent);
      if (txContent.data.status === 'success') {
        const sender = txContent.data.data.vout[vout];
        return sender;
      }
      return 'Sender not found';
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
        return `${Math.floor(diff / periods.month)} months ago`;
      }
      if (diff > periods.week) {
        return `${Math.floor(diff / periods.week)} weeks ago`;
      }
      if (diff > periods.day) {
        return `${Math.floor(diff / periods.day)} days ago`;
      }
      if (diff > periods.hour) {
        return `${Math.floor(diff / periods.hour)} hours ago`;
      }
      if (diff > periods.minute) {
        return `${Math.floor(diff / periods.minute)} minutes ago`;
      }
      return 'Just now';
    },

    selectBlock(item) {
      console.log(item);
      this.selectedBlock = item;
      this.explorerView = false;
      this.blockView = true;
      this.txView = false;
      this.addressView = false;
      this.selectedBlock.transactions = [];
      this.getBlockTransactions(this.selectedBlock);
    },
    async getBlockTransactions(block) {
      // this.blocksWithTransaction[height].transactions = [];
      // this.uniqueKeyBlock += 1;
      // const verbose = 1;
      let i = 0;
      // parallel is not possible as daemon will result in error 500
      // await Promise.all(transactionArray.map(async (transaction) => {
      //   const txContent = await DaemonService.getRawTransaction(transaction, verbose);
      //   if (txContent.data.status === 'success') {
      //     this.blocksWithTransaction[height].transactions.push(txContent.data.data);
      //   }
      // }));
      // eslint-disable-next-line no-restricted-syntax
      for (const transaction of block.tx) {
        // eslint-disable-next-line no-await-in-loop
        const txContent = await DaemonService.getRawTransaction(transaction, 1);
        if (txContent.data.status === 'success') {
          const transactionDetail = txContent.data.data;
          transactionDetail.senders = [];
          block.transactions.push(transactionDetail);
          // this.uniqueKeyAddress += 1;
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
              block.transactions[i].senders.push(senderInformation);
              // this.uniqueKeyBlock += 1
            }
            // this.uniqueKeyBlock += 1
          }
        }
        i += 1;
        // this.uniqueKeyBlock += 1;
      }
      console.log(block);
    },

    selectPreviousBlock() {
      const targetBlockHeight = this.selectedBlock.height - 1;
      for (let i = 0; i < this.blocks.length; i += 1) {
        if (this.blocks[i].height === targetBlockHeight) {
          this.selectBlock(this.blocks[i]);
          return;
        }
      }
      this.getBlock(targetBlockHeight);
    },

    goBackToExplorer() {
      this.explorerView = true;
      this.blockView = false;
      this.txView = false;
      this.addressView = false;
    },

    showToast(variant, title, icon = 'InfoIcon') {
      this.$bvToast.toast({
        component: ToastificationContent,
        props: {
          title,
          icon,
          variant,
        },
      });
    },
  },
};
</script>

<style>
.skinny-list-entry {
  margin-top: 2px !important;
  margin-bottom: 2px !important;
}
.txid-title .card-header .collapse-title {
  overflow: auto !important;
}
.syncstatus {
  padding-left: 10px;
  position: absolute;
  margin-top: -50px;
}
</style>
