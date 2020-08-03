<template>
  <div class="zelcashsection">
    <div v-if="zelCashSection === 'welcomeinfo'">
      <div class="status">
        <h4>
          ZelNode owner Zel ID: {{ userconfig.zelid }}
        </h4>
        <h4>
          Status: {{ getZelNodeStatusResponse.zelnodeStatus }}
        </h4>
      </div>

      <div>
        <p>
          ZelCash version: {{ callResponse.data.version }}
        </p>
        <p>
          Protocol version: {{ callResponse.data.protocolversion }}
        </p>
        <p>
          Current Blockchain Height: {{ callResponse.data.blocks }}
        </p>
        <div v-if="callResponse.data.errors != ''">
          <p>
            Error: {{ callResponse.data.errors }}
          </p>
        </div>
      </div>
    </div>
    <div v-if="zelCashSection === 'getinfo'">
      <div>
        <p>Output from Get Info command</p>
      </div>
      <div>
        <p>
          ZelCash version: {{ callResponse.data.version }}
        </p>
        <p>
          Protocol version: {{ callResponse.data.protocolversion }}
        </p>
        <p>
          Wallet version: {{ callResponse.data.walletversion }}
        </p>
        <p v-if="callResponse.data.balance">
          Balance: {{ callResponse.data.balance }} ZEL
        </p>
        <p>
          Blocks: {{ callResponse.data.blocks }}
        </p>
        <p>
          Time Offset: {{ callResponse.data.timeoffset }}
        </p>
        <p>
          Connections: {{ callResponse.data.connections }}
        </p>
        <p>
          Proxy: {{ callResponse.data.proxy }}
        </p>
        <p>
          Difficulty: {{ callResponse.data.difficulty }}
        </p>
        <p>
          Testnet: {{ callResponse.data.testnet }}
        </p>
        <p>
          Key Pool Oldest: {{ new Date(callResponse.data.keypoololdest * 1000).toLocaleString('en-GB', timeoptions) }}
        </p>
        <p>
          Key Pool Size: {{ callResponse.data.keypoolsize }}
        </p>
        <p>
          Pay TX Fee: {{ callResponse.data.paytxfee }}
        </p>
        <p>
          Relay Fee: {{ callResponse.data.relayfee }}
        </p>
        <p v-if="callResponse.data.errors != ''">
          Error: {{ callResponse.data.errors }}
        </p>
      </div>
    </div>
    <div
      v-if="zelCashSection === 'help'"
      class="helpSection"
    >
      <div>
        <p>Help section output is listed below. Click on a command to find more specifics about it</p>
      </div>
      <div
        class="helpSectionData"
        v-if="callResponse.data"
      >
        <el-collapse
          accordion
          v-model="activeHelpNames"
          @change="zelcashHelpSpecific"
        >
          <div
            v-for="help of helpResponse"
            :key=help
          >
            <div v-if="help.startsWith('=')">
              <br>
              <h2>
                {{ help.split(' ')[1] }}
              </h2>
            </div>
            <el-collapse-item
              :name="help"
              v-if="!help.startsWith('=')"
            >
              <template slot="title">
                <p>
                  <b>{{ help }}</b>
                </p>
              </template>
              <p class="helpSpecific">{{ currentHelpResponse || 'Loading help message...' }}</p>
            </el-collapse-item>
          </div>
        </el-collapse>

      </div>
      <div v-else>
        Obtaining help section...
      </div>
    </div>
    <div v-if="zelCashSection === 'rescanblockchain'">
      <div>
        <p>Click on Rescan ZelCash button to Rescan ZelCash Blockchain</p>
      </div>
      BlockHeight:
      <el-input-number
        controls-position="right"
        placeholder="insert blockheight"
        v-model="rescanZelCashHeight"
        :min="0"
        :max="1000000"
      ></el-input-number>
      <el-popconfirm
        confirmButtonText='Rescan ZelCash blockhain data'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Reindexes ZelCash daemon"
        @onConfirm="rescanZelCash()"
      >
        <ElButton slot="reference">
          Rescan ZelCash
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="zelCashSection === 'reindexblockchain'">
      <div>
        <p>Click on Reindex ZelCash button to Reindex ZelCash Blockchain</p>
      </div>
      <el-popconfirm
        confirmButtonText='Reindex'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Reindex ZelCash Blockchain"
        @onConfirm="reindexZelCash()"
      >
        <ElButton slot="reference">
          Reindex ZelCash
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="zelCashSection === 'start'">
      <div>
        <p>Click on Start ZelCash button to Start ZelCash daemon</p>
      </div>
      <el-popconfirm
        confirmButtonText='Start ZelCash daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="green"
        title="Starts ZelCash daemon"
        @onConfirm="startZelCash()"
      >
        <ElButton slot="reference">
          Start ZelCash
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="zelCashSection === 'restart'">
      <div>
        <p>Click on Restart ZelCash button to restart ZelCash daemon</p>
      </div>
      <el-popconfirm
        confirmButtonText='Restart ZelCash daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="orange"
        title="Restarts ZelCash daemon"
        @onConfirm="restartZelCash()"
      >
        <ElButton slot="reference">
          Restart ZelCash
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="zelCashSection === 'stop'">
      <div>
        <p>Click on Stop ZelCash button to stop ZelCash daemon</p>
      </div>
      <el-popconfirm
        confirmButtonText='Stop ZelCash daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Stops ZelCash daemon"
        @onConfirm="stopZelCash()"
      >
        <ElButton slot="reference">
          Stop ZelCash
        </ElButton>
      </el-popconfirm>
    </div>
    <!-- ZELNODE SECTION -->
    <div v-if="zelCashSection === 'getzelnodestatus'">
      <div>
        <p>Output from Get ZelNode Status command</p>
      </div>
      <div>
        <p>
          Status: {{ callResponse.data.status }}
        </p>
        <p>
          Collateral: {{ callResponse.data.collateral }}
        </p>
        <p v-if="callResponse.data.txhash">
          TX Hash: {{ callResponse.data.txhash }}
        </p>
        <p v-if="callResponse.data.outidx">
          Output ID: {{ callResponse.data.outidx }}
        </p>
        <p v-if="callResponse.data.ip">
          IP: {{ callResponse.data.ip }}
        </p>
        <p v-if="callResponse.data.network">
          Network: {{ callResponse.data.network }}
        </p>
        <p v-if="callResponse.data.added_height">
          Added Height: {{ callResponse.data.added_height }}
        </p>
        <p v-if="callResponse.data.confirmed_height">
          Confirmed Height: {{ callResponse.data.proxy }}
        </p>
        <p v-if="callResponse.data.last_confirmed_height">
          Last Confirmed Height: {{ callResponse.data.last_confirmed_height }}
        </p>
        <p v-if="callResponse.data.last_paid_height">
          Last Paid Height: {{ callResponse.data.last_paid_height }}
        </p>
        <p v-if="callResponse.data.tier">
          Tier: {{ callResponse.data.tier }}
        </p>
        <p v-if="callResponse.data.payment_address">
          Payment Address: {{ callResponse.data.payment_address }}
        </p>
        <p v-if="callResponse.data.pubkey">
          Public Key: {{ callResponse.data.pubkey }}
        </p>
        <p v-if="callResponse.data.activesince">
          Active Since: {{ callResponse.data.activesince }}
        </p>
        <p v-if="callResponse.data.lastpaid">
          Last Paid: {{ callResponse.data.lastpaid }}
        </p>
      </div>
    </div>
    <div v-if="zelCashSection === 'listzelnodes'">
      <el-table
        :data="zelnodeList"
        style="width: 100%"
      >
        <el-table-column type="expand">
          <template slot-scope="props">
            <p>Collateral: {{ props.row.collateral }}</p>
            <p>Last Paid: {{ new Date(props.row.lastpaid * 1000).toLocaleString('en-GB', timeoptions) }}</p>
            <p>Active Since: {{ new Date(props.row.activesince * 1000).toLocaleString('en-GB', timeoptions) }}</p>
            <p>Last Paid Height: {{ props.row.last_paid_height }}</p>
            <p>Confirmed Height: {{ props.row.confirmed_height }}</p>
            <p>Last Confirmed Height: {{ props.row.last_confirmed_height }}</p>
            <p>Rank: {{ props.row.rank }}</p>
          </template>
        </el-table-column>
        <el-table-column
          label="Address"
          prop="payment_address"
        >
        </el-table-column>
        <el-table-column
          label="IP"
          prop="ip"
        >
        </el-table-column>
        <el-table-column
          label="Tier"
          prop="tier"
        >
        </el-table-column>
        <el-table-column
          label="Added Height"
          prop="added_height"
        >
        </el-table-column>
        <el-table-column align="right">
          <template
            slot="header"
            slot-scope="scope"
          >
            <el-input
              v-if="scope"
              v-model="filterZelNodes"
              size="mini"
              placeholder="Type to search"
            />
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div v-if="zelCashSection === 'viewdeterministiczelnodelist'">
      <el-table
        :data="zelnodeList"
        style="width: 100%"
      >
        <el-table-column type="expand">
          <template slot-scope="props">
            <p>Collateral: {{ props.row.collateral }}</p>
            <p>TX Hash: {{ props.row.txhash }}</p>
            <p>Output ID: {{ props.row.outidx }}</p>
            <p>Public Key: {{ props.row.pubkey }}</p>
            <p>Network: {{ props.row.network }}</p>
            <p>Last Paid: {{ new Date(props.row.lastpaid * 1000).toLocaleString('en-GB', timeoptions) }}</p>
            <p>Active Since: {{ new Date(props.row.activesince * 1000).toLocaleString('en-GB', timeoptions) }}</p>
            <p>Last Paid Height: {{ props.row.last_paid_height }}</p>
            <p>Confirmed Height: {{ props.row.confirmed_height }}</p>
            <p>Last Confirmed Height: {{ props.row.last_confirmed_height }}</p>
            <p>Rank: {{ props.row.rank }}</p>
          </template>
        </el-table-column>
        <el-table-column
          label="Address"
          prop="payment_address"
        >
        </el-table-column>
        <el-table-column
          label="IP"
          prop="ip"
        >
        </el-table-column>
        <el-table-column
          label="Tier"
          prop="tier"
        >
        </el-table-column>
        <el-table-column
          label="Added Height"
          prop="added_height"
        >
        </el-table-column>
        <el-table-column align="right">
          <template
            slot="header"
            slot-scope="scope"
          >
            <el-input
              v-if="scope"
              v-model="filterZelNodes"
              size="mini"
              placeholder="Type to search"
            />
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div v-if="zelCashSection === 'getzelnodecount'">
      <div>
        <p>Output from Get ZelNode Count command</p>
      </div>
      <div>
        <p>
          Total: {{ callResponse.data.total }}
        </p>
        <p>
          Stable: {{ callResponse.data.stable }}
        </p>
        <p>
          BASIC Tier: {{ callResponse.data['basic-enabled'] }}
        </p>
        <p>
          SUPER Tier: {{ callResponse.data['super-enabled'] }}
        </p>
        <p>
          BAMF Tier: {{ callResponse.data['bamf-enabled'] }}
        </p>
        <p>
          IPv4: {{ callResponse.data.ipv4 }}
        </p>
        <p>
          IPv6: {{ callResponse.data.ipv6 }}
        </p>
        <p>
          Tor: {{ callResponse.data.onion }}
        </p>
      </div>
    </div>
    <div v-if="zelCashSection === 'getstartlist'">
      <el-table
        empty-text="No ZelNode in Start state"
        :data="zelnodeList"
        style="width: 100%"
      >
        <el-table-column type="expand">
          <template slot-scope="props">
            <p>Collateral: {{ props.row.collateral }}</p>
          </template>
        </el-table-column>
        <el-table-column
          label="Address"
          prop="payment_address"
        >
        </el-table-column>
        <el-table-column
          label="Added Height"
          prop="added_height"
        >
        </el-table-column>
        <el-table-column
          label="Expires In Blocks"
          prop="expires_in"
        >
        </el-table-column>
        <el-table-column align="right">
          <template
            slot="header"
            slot-scope="scope"
          >
            <el-input
              v-if="scope"
              v-model="filterZelNodes"
              size="mini"
              placeholder="Type to search"
            />
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div v-if="zelCashSection === 'getdoslist'">
      <el-table
        empty-text="No ZelNode in DOS state"
        :data="zelnodeList"
        style="width: 100%"
      >
        <el-table-column type="expand">
          <template slot-scope="props">
            <p>Collateral: {{ props.row.collateral }}</p>
          </template>
        </el-table-column>
        <el-table-column
          label="Address"
          prop="payment_address"
        >
        </el-table-column>
        <el-table-column
          label="Added Height"
          prop="added_height"
        >
        </el-table-column>
        <el-table-column
          label="Eligible In Blocks"
          prop="eligible_in"
        >
        </el-table-column>
        <el-table-column align="right">
          <template
            slot="header"
            slot-scope="scope"
          >
            <el-input
              v-if="scope"
              v-model="filterZelNodes"
              size="mini"
              placeholder="Type to search"
            />
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div v-if="zelCashSection === 'zelnodecurrentwinner'">
      <p>
        Current ZelNode winners that will be paid in next ZelCash block
      </p>
      <el-table
        empty-text="No Data"
        :data="zelnodeWinners"
        style="width: 100%"
      >
        <el-table-column type="expand">
          <template slot-scope="props">
            <p>Collateral: {{ props.row.collateral }}</p>
            <p>Last Paid Height: {{ props.row.last_paid_height }}</p>
            <p>Confirmed Height: {{ props.row.confirmed_height }}</p>
            <p>Last Confirmed Height: {{ props.row.last_confirmed_height }}</p>
          </template>
        </el-table-column>
        <el-table-column
          label="Address"
          prop="payment_address"
        >
        </el-table-column>
        <el-table-column
          label="IP"
          prop="ip"
        >
        </el-table-column>
        <el-table-column
          label="Tier"
          prop="tier"
        >
        </el-table-column>
        <el-table-column
          label="Added Height"
          prop="added_height"
        >
        </el-table-column>
      </el-table>
    </div>
    <!-- BENCHMARKS -->
    <div v-if="zelCashSection === 'getbenchmarks'">
      <div>
        <p>Output from Get Benchmarks command</p>
      </div>
      <div>
        <p>
          Status: {{ callResponse.data.status }}
        </p>
        <p>
          Time: {{ new Date(callResponse.data.time * 1000).toLocaleString('en-GB', timeoptions) }}
        </p>
        <p>
          IP address: {{ callResponse.data.ipaddress }}
        </p>
        <p>
          CPU cores: {{ callResponse.data.cores }}
        </p>
        <p>
          RAM (GB): {{ callResponse.data.ram }}
        </p>
        <p>
          SSD (GB): {{ callResponse.data.ssd }}
        </p>
        <p>
          HDD (GB): {{ callResponse.data.hdd }}
        </p>
        <p>
          Write Speed (MB/s): {{ callResponse.data.ddwrite }}
        </p>
        <p>
          CPU Speed (eps): {{ callResponse.data.eps }}
        </p>
      </div>
    </div>
    <div v-if="zelCashSection === 'getbenchstatus'">
      <div>
        <p>Output from Get Bench Status command</p>
      </div>
      <div>
        <p>
          Status: {{ callResponse.data.status }}
        </p>
        <p>
          Benchmarking: {{ callResponse.data.benchmarking }}
        </p>
        <p>
          ZelBack: {{ callResponse.data.zelback }}
        </p>
      </div>
    </div>
    <div v-if="zelCashSection === 'startzelbenchd'">
      <div>
        <p>Click on Start ZelBench button to Start ZelBench Daemon</p>
      </div>
      <el-popconfirm
        confirmButtonText='Start'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="green"
        title="Start ZelBench Daemon"
        @onConfirm="zelcashStartZelBenchd()"
      >
        <ElButton slot="reference">
          Start ZelBench
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="zelCashSection === 'stopzelbenchd'">
      <div>
        <p>Click on Stop ZelBench button to Stop ZelBench Daemon</p>
      </div>
      <el-popconfirm
        confirmButtonText='Stop'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Stop ZelBench Daemon"
        @onConfirm="zelcashStopZelBenchd()"
      >
        <ElButton slot="reference">
          Stop ZelBench
        </ElButton>
      </el-popconfirm>
    </div>
    <!-- BLOCKCHAIN -->
    <div v-if="zelCashSection === 'getblockchaininfo'">
      <div>
        <p>Output from Get Blockchain Info command</p>
      </div>
      <div>
        <el-input
          type="textarea"
          autosize
          readonly
          v-model="callResponse.data"
        >
        </el-input>
      </div>
    </div>
    <!-- MINING -->
    <div v-if="zelCashSection === 'getmininginfo'">
      <div>
        <p>Output from Get Mining Info command</p>
      </div>
      <div>
        <el-input
          type="textarea"
          autosize
          readonly
          v-model="callResponse.data"
        >
        </el-input>
      </div>
    </div>
    <!-- NETWORK -->
    <div v-if="zelCashSection === 'getnetworkinfo'">
      <div>
        <p>Output from Get Network Info command</p>
      </div>
      <div>
        <el-input
          type="textarea"
          autosize
          readonly
          v-model="callResponse.data"
        >
        </el-input>
      </div>
    </div>
    <!-- RAW TRANSACTION -->
    <div v-if="zelCashSection === 'getrawtransaction'">
      <div>
        <p>Please paste a transaction ID into input field below to get it's raw transaction</p>
      </div>
      <div>
        <el-input
          placeholder="Insert TXID"
          v-model="generalInput"
        >
        </el-input>
      </div>
      <div>
        <ElButton @click="zelcashGetRawTransaction()">
          Get Transaction
        </ElButton>
      </div>
      <div>
        <el-input
          v-if="callResponse.data"
          type="textarea"
          autosize
          readonly
          v-model="callResponse.data"
        >
        </el-input>
      </div>
    </div>
    <!-- UTIL -->
    <div v-if="zelCashSection === 'validateaddress'">
      <div>
        <p>Please paste a transparent ZelCash address to display information about it</p>
      </div>
      <div>
        <el-input
          placeholder="Insert transparent ZelCash address"
          v-model="generalInput"
        >
        </el-input>
      </div>
      <div>
        <ElButton @click="zelcashValidateAddress()">
          Validate Address
        </ElButton>
      </div>
      <div>
        <el-input
          v-if="callResponse.data"
          type="textarea"
          autosize
          readonly
          v-model="callResponse.data"
        >
        </el-input>
      </div>
    </div>
    <!-- WALLET -->
    <div v-if="zelCashSection === 'getwalletinfo'">
      <div>
        <p>Output from Get Wallet Info command</p>
      </div>
      <div>
        <el-input
          type="textarea"
          autosize
          readonly
          v-model="callResponse.data"
        >
        </el-input>
      </div>
    </div>
    <!-- DEBUG -->
    <div v-if="zelCashSection === 'debug'">
      <div>
        <p>Following action will download ZelCash debug file. This may take a few minutes depending on file size</p>
      </div>
      <el-popconfirm
        confirmButtonText='Download Debug'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Download ZelCash Debug file?"
        @onConfirm="downloadZelCashDebugFile()"
      >
        <ElButton slot="reference">
          Download Debug File
        </ElButton>
      </el-popconfirm>
      <p v-if="total && downloaded">
        {{ (downloaded / 1e6).toFixed(2) + " / " + (total / 1e6).toFixed(2) }} MB - {{ ((downloaded / total) * 100).toFixed(2) + "%" }}
        <el-tooltip
          content="Cancel Download"
          placement="top"
        >
          <el-button
            v-if="total && downloaded && total !== downloaded"
            type="danger"
            icon="el-icon-close"
            circle
            size="mini"
            @click="cancelDownload"
          ></el-button>
        </el-tooltip>
      </p>
      <br><br>
      <div>
        <div>
          <p>Following action will show last 100 lines of ZelCash debug file</p>
        </div>
        <el-popconfirm
          confirmButtonText='Show Debug'
          cancelButtonText='No, Thanks'
          icon="el-icon-info"
          iconColor="red"
          title="Show ZelCash Debug file?"
          @onConfirm="tailZelCashDebug()"
        >
          <ElButton slot="reference">
            Show Debug File
          </ElButton>
        </el-popconfirm>
        <br><br>
        <el-input
          v-if="callResponse.data.message"
          type="textarea"
          autosize
          v-model="zelcashDebugTail"
        >
        </el-input>
      </div>
    </div>
    <div v-if="callResponse.status === 'error'">
      <p>
        Error: {{ callResponse.data.message || callResponse.data }}
      </p>
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

import ZelCashService from '@/services/ZelCashService';
import ZelNodeService from '@/services/ZelNodeService';

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'ZelCash',
  data() {
    return {
      timeoptions: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
      generalInput: '', // general
      callResponse: { // general
        status: '',
        data: '',
      },
      getZelNodeStatusResponse: {
        status: '',
        data: '',
        zelnodeStatus: 'Checking status...',
      },
      total: '',
      downloaded: '',
      abortToken: {},
      activeHelpNames: '',
      currentHelpResponse: '',
      rescanZelCashHeight: 0,
      filterZelNodes: '',
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'zelCashSection',
    ]),
    zelcashDebugTail() {
      if (this.callResponse.data.message) {
        return this.callResponse.data.message.split('\n').reverse().filter((el) => el !== '').join('\n');
      }
      return this.callResponse.data;
    },
    helpResponse() {
      if (this.callResponse.data) {
        return this.callResponse.data.split('\n').filter((el) => el !== '').map((el) => (el.startsWith('=') ? el : el.split(' ')[0]));
      }
      return [];
    },
    zelnodeList() {
      if (this.callResponse.data) {
        const filteredList = this.callResponse.data.filter((data) => JSON.stringify(data).toLowerCase().includes(this.filterZelNodes.toLowerCase()));
        return filteredList;
      }
      return [];
    },
    zelnodeWinners() {
      if (this.callResponse.data) {
        const keys = Object.keys(this.callResponse.data);
        const winnersArray = [];
        keys.forEach((key) => {
          winnersArray.push(this.callResponse.data[key]);
        });
        return winnersArray;
      }
      return [];
    },
  },
  watch: {
    zelCashSection(val, oldVal) {
      console.log(val, oldVal);
      this.callResponse.status = '';
      this.callResponse.data = '';
      this.generalInput = '';
      this.switcher(val);
    },
  },
  mounted() {
    this.switcher(this.zelCashSection);
  },
  methods: {
    switcher(value) {
      switch (value) {
        case 'welcomeinfo':
          this.zelcashGetInfo();
          this.zelcashWelcomeGetZelNodeStatus();
          break;
        case 'getinfo':
          this.zelcashGetInfo();
          break;
        case 'help':
          this.zelcashHelp();
          break;
        case 'stop':
          break;
        case 'start':
          break;
        case 'restart':
          break;
        case 'debug':
          break;
        case 'getzelnodestatus':
          this.zelcashGetZelNodeStatus();
          break;
        case 'listzelnodes':
          this.zelcashListZelNodes();
          break;
        case 'viewdeterministiczelnodelist':
          this.zelcashViewDeterministicZelNodeList();
          break;
        case 'getzelnodecount':
          this.zelcashGetZelNodeCount();
          break;
        case 'getstartlist':
          this.zelcashGetStartList();
          break;
        case 'getdoslist':
          this.zelcashGetDOSList();
          break;
        case 'zelnodecurrentwinner':
          this.zelcashZelNodeCurrentWinner();
          break;
        case 'getbenchmarks':
          this.zelcashGetBenchmarks();
          break;
        case 'getbenchstatus':
          this.zelcashGetBenchStatus();
          break;
        case 'startzelbenchd':
          break;
        case 'stopzelbenchd':
          break;
        case 'getblockchaininfo':
          this.zelcashGetBlockchainInfo();
          break;
        case 'getmininginfo':
          this.zelcashGetMiningInfo();
          break;
        case 'getnetworkinfo':
          this.zelcashGetNetworkInfo();
          break;
        case 'getrawtransaction':
          break;
        case 'validateaddress':
          break;
        case 'getwalletinfo':
          this.zelcashGetWalletInfo();
          break;
        case null:
          console.log('ZelCash Section hidden');
          break;
        default:
          console.log('ZelCash Section: Unrecognized method');
      }
    },
    async zelcashGetInfo() {
      const response = await ZelCashService.getInfo();
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async zelcashHelp() {
      const response = await ZelCashService.help();
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async zelcashHelpSpecific() {
      this.currentHelpResponse = '';
      const response = await ZelCashService.helpSpecific(this.activeHelpNames);
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        const modifiedHelp = response.data.data.split('\n');
        const ml = modifiedHelp.length;
        let spaces = 0;
        for (let i = 0; i < ml; i += 1) {
          let whiteSpaceAdd = '';
          if (modifiedHelp[i].trim() === '{' || modifiedHelp[i].trim() === '[') {
            spaces += 4;
            for (let j = 0; j < spaces; j += 1) {
              whiteSpaceAdd += '\u00A0';
            }
            modifiedHelp[i] = whiteSpaceAdd + modifiedHelp[i];
            spaces += 4;
          } else if (modifiedHelp[i].trim() === '}' || modifiedHelp[i].trim() === ']') {
            spaces -= 4;
            for (let j = 0; j < spaces; j += 1) {
              whiteSpaceAdd += '\u00A0';
            }
            modifiedHelp[i] = whiteSpaceAdd + modifiedHelp[i];
            spaces -= 4;
          } else {
            for (let j = 0; j < spaces; j += 1) {
              whiteSpaceAdd += '\u00A0';
            }
            modifiedHelp[i] = whiteSpaceAdd + modifiedHelp[i];
          }
        }
        this.currentHelpResponse = modifiedHelp.join('\n');
      }
    },
    startZelCash() {
      vue.$message.warning('ZelCash will start');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelCashService.start(zelidauth)
        .then((response) => {
          vue.$message({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
        })
        .catch(() => {
          vue.$message.error('Error while trying to start ZelCash');
        });
    },
    stopZelCash() {
      vue.$message.warning('ZelCash will be stopped');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelCashService.stopZelCash(zelidauth)
        .then((response) => {
          vue.$message({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
        })
        .catch(() => {
          vue.$message.error('Error while trying to stop ZelCash');
        });
    },
    restartZelCash() {
      vue.$message.warning('ZelCash will now restart');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelCashService.restart(zelidauth)
        .then((response) => {
          vue.$message({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
        })
        .catch(() => {
          vue.$message.error('Error while trying to restart ZelCash');
        });
    },
    rescanZelCash() {
      vue.$message.warning('ZelCash will now rescan. This will take up to an hour.');
      const zelidauth = localStorage.getItem('zelidauth');
      const blockheight = this.rescanZelCashHeight > 0 ? this.rescanZelCashHeight : 0;
      ZelCashService.rescanZelCash(zelidauth, blockheight)
        .then((response) => {
          vue.$message({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
        })
        .catch(() => {
          vue.$message.error('Error while trying to rescan ZelCash');
        });
    },
    reindexZelCash() {
      vue.$message.warning('ZelCash will now reindex. This will take several hours.');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelNodeService.reindexZelCash(zelidauth)
        .then((response) => {
          vue.$message({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
        })
        .catch(() => {
          vue.$message.error('Error while trying to reindex ZelCash');
        });
    },
    async zelcashWelcomeGetZelNodeStatus() {
      const response = await ZelCashService.getZelNodeStatus();
      this.getZelNodeStatusResponse.status = response.data.status;
      this.getZelNodeStatusResponse.data = response.data.data;
      console.log(this.getZelNodeStatusResponse.data);
      if (this.getZelNodeStatusResponse.data) {
        if (this.getZelNodeStatusResponse.data.status === 'CONFIRMED' || this.getZelNodeStatusResponse.data.location === 'CONFIRMED') {
          this.getZelNodeStatusResponse.zelnodeStatus = 'ZelNode is working correctly';
        } else if (this.getZelNodeStatusResponse.data.status === 'STARTED' || this.getZelNodeStatusResponse.data.location === 'STARTED') {
          this.getZelNodeStatusResponse.zelnodeStatus = 'ZelNode has just been started. Flux is running with limited capabilities.';
        } else {
          this.getZelNodeStatusResponse.zelnodeStatus = 'ZelNode is not confirmed. Flux is running with limited capabilities.';
        }
      }
    },
    // ZELNODE
    async zelcashGetZelNodeStatus() {
      const response = await ZelCashService.getZelNodeStatus();
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async zelcashListZelNodes() {
      const response = await ZelCashService.listZelNodes();
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async zelcashViewDeterministicZelNodeList() {
      const response = await ZelCashService.viewDeterministicZelNodeList();
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async zelcashGetZelNodeCount() {
      const response = await ZelCashService.getZelNodeCount();
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async zelcashGetStartList() {
      const response = await ZelCashService.getStartList();
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async zelcashGetDOSList() {
      const response = await ZelCashService.getDOSList();
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async zelcashZelNodeCurrentWinner() {
      const response = await ZelCashService.zelnodeCurrentWinner();
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    // BENCHMARKS
    async zelcashGetBenchmarks() {
      const response = await ZelCashService.getBenchmarks();
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = JSON.parse(response.data.data);
      }
    },
    async zelcashGetBenchStatus() {
      const response = await ZelCashService.getBenchStatus();
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = JSON.parse(response.data.data);
      }
    },
    zelcashStartZelBenchd() {
      vue.$message.warning('ZelBench will now try to start');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelCashService.startZelBench(zelidauth)
        .then((response) => {
          vue.$message({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
        })
        .catch(() => {
          vue.$message.error('Error while trying to start ZelBench');
        });
    },
    zelcashStopZelBenchd() {
      vue.$message.warning('ZelBench will now try to stop');
      const zelidauth = localStorage.getItem('zelidauth');
      ZelCashService.stopZelBench(zelidauth)
        .then((response) => {
          vue.$message({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
        })
        .catch(() => {
          vue.$message.error('Error while trying to stop ZelBench');
        });
    },
    // BLOCKCHAIN
    async zelcashGetBlockchainInfo() {
      const response = await ZelCashService.getBlockchainInfo();
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = JSON.stringify(response.data.data, undefined, '\t');
      }
    },
    // MINING
    async zelcashGetMiningInfo() {
      const response = await ZelCashService.getMiningInfo();
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = JSON.stringify(response.data.data, undefined, '\t');
      }
    },
    // NETWORK
    async zelcashGetNetworkInfo() {
      const response = await ZelCashService.getNetworkInfo();
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = JSON.stringify(response.data.data, undefined, '\t');
      }
    },
    // RAW TRANSACTION
    async zelcashGetRawTransaction() {
      const response = await ZelCashService.getRawTransaction(this.generalInput, 1);
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = JSON.stringify(response.data.data, undefined, '\t');
      }
    },
    // UTIL
    async zelcashValidateAddress() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelCashService.validateAddress(zelidauth, this.generalInput);
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = JSON.stringify(response.data.data, undefined, '\t');
      }
    },
    // WALLET
    async zelcashGetWalletInfo() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelCashService.getWalletInfo(zelidauth);
      if (response.data.status === 'error') {
        vue.$message.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = JSON.stringify(response.data.data, undefined, '\t');
      }
    },
    // DEBUG
    cancelDownload() {
      this.abortToken.cancel('User download cancelled');
      this.downloaded = '';
      this.total = '';
    },
    async downloadZelCashDebugFile() {
      const self = this;
      self.abortToken = ZelCashService.cancelToken();
      const zelidauth = localStorage.getItem('zelidauth');
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        responseType: 'blob',
        onDownloadProgress(progressEvent) {
          self.downloaded = progressEvent.loaded;
          self.total = progressEvent.total;
        },
        cancelToken: self.abortToken.token,
      };
      const response = await ZelCashService.justAPI().get('/zelnode/zelcashdebug', axiosConfig);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'debug.log');
      document.body.appendChild(link);
      link.click();
    },
    tailZelCashDebug() {
      const zelidauth = localStorage.getItem('zelidauth');
      ZelCashService.tailZelCashDebug(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message || response.data.data);
          } else {
            this.callResponse.status = response.data.status;
            this.callResponse.data = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$message.error('Error while trying to get latest debug of ZelCash');
        });
    },
  },
};
</script>
