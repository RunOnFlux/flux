<template>
  <div class="daemonSection">
    <div v-if="daemonSection === 'welcomeinfo'">
      <div class="status">
        <h4>
          Flux owner ZelID: {{ userconfig.zelid }}
        </h4>
        <h4>
          Status: {{ getNodeStatusResponse.nodeStatus }}
        </h4>
      </div>

      <div>
        <p>
          Daemon version: {{ callResponse.data.version }}
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
    <div v-if="daemonSection === 'getinfo'">
      <div>
        <p>Output from Get Info command</p>
      </div>
      <div>
        <p>
          Daemon version: {{ callResponse.data.version }}
        </p>
        <p>
          Protocol version: {{ callResponse.data.protocolversion }}
        </p>
        <p>
          Wallet version: {{ callResponse.data.walletversion }}
        </p>
        <p v-if="callResponse.data.balance">
          Balance: {{ callResponse.data.balance }} FLUX
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
      v-if="daemonSection === 'help'"
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
          @change="daemonHelpSpecific"
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
    <div v-if="daemonSection === 'rescanblockchain'">
      <div>
        <p>Click on Rescan Daemon button to Rescan Flux Blockchain</p>
      </div>
      BlockHeight:
      <el-input-number
        controls-position="right"
        placeholder="insert blockheight"
        v-model="rescanDaemonHeight"
        :min="0"
        :max="1000000"
      ></el-input-number>
      <el-popconfirm
        confirmButtonText='Rescan Flux blockhain data'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Reindexes Flux daemon"
        @onConfirm="rescanDaemon()"
        @confirm="rescanDaemon()"
      >
        <ElButton slot="reference">
          Rescan Daemon
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="daemonSection === 'reindexblockchain'">
      <div>
        <p>Click on Reindex Daemon button to Reindex Flux Blockchain</p>
      </div>
      <el-popconfirm
        confirmButtonText='Reindex'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Reindex Flux Blockchain"
        @onConfirm="reindexDaemon()"
        @confirm="reindexDaemon()"
      >
        <ElButton slot="reference">
          Reindex Daemon
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="daemonSection === 'start'">
      <div>
        <p>Click on Start Daemon button to Start Flux daemon</p>
      </div>
      <el-popconfirm
        confirmButtonText='Start Flux daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="green"
        title="Starts Flux daemon"
        @onConfirm="startDaemon()"
        @confirm="startDaemon()"
      >
        <ElButton slot="reference">
          Start Daemon
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="daemonSection === 'restart'">
      <div>
        <p>Click on Restart Daemon button to restart Flux daemon</p>
      </div>
      <el-popconfirm
        confirmButtonText='Restart Flux daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="orange"
        title="Restarts Flux daemon"
        @onConfirm="restartDaemon()"
        @confirm="restartDaemon()"
      >
        <ElButton slot="reference">
          Restart Daemon
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="daemonSection === 'stop'">
      <div>
        <p>Click on Stop Daemon button to stop Flux daemon</p>
      </div>
      <el-popconfirm
        confirmButtonText='Stop Flux daemon'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Stops Flux daemon"
        @onConfirm="stopDaemon()"
        @confirm="stopDaemon()"
      >
        <ElButton slot="reference">
          Stop Daemon
        </ElButton>
      </el-popconfirm>
    </div>
    <!-- ZELNODE SECTION -->
    <div v-if="daemonSection === 'getzelnodestatus'">
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
    <div v-if="daemonSection === 'listzelnodes'">
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
    <div v-if="daemonSection === 'viewdeterministiczelnodelist'">
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
    <div v-if="daemonSection === 'getzelnodecount'">
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
          Cumulus Tier: {{ callResponse.data['basic-enabled'] || callResponse.data['cumulus-enabled'] }}
        </p>
        <p>
          Nimbus Tier: {{ callResponse.data['super-enabled'] || callResponse.data['nimbus-enabled'] }}
        </p>
        <p>
          Stratus Tier: {{ callResponse.data['bamf-enabled'] || callResponse.data['stratus-enabled'] }}
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
    <div v-if="daemonSection === 'getstartlist'">
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
    <div v-if="daemonSection === 'getdoslist'">
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
    <div v-if="daemonSection === 'zelnodecurrentwinner'">
      <p>
        Current ZelNode winners that will be paid in next Flux block
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
    <div v-if="daemonSection === 'getbenchmarks'">
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
    <div v-if="daemonSection === 'getbenchstatus'">
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
          Flux: {{ callResponse.data.zelback || callResponse.data.flux }}
        </p>
      </div>
    </div>
    <div v-if="daemonSection === 'startzelbenchd'">
      <div>
        <p>Click on Start Benchmark button to Start Benchmark Daemon</p>
      </div>
      <el-popconfirm
        confirmButtonText='Start'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="green"
        title="Start Benchmark Daemon"
        @onConfirm="daemonStartBenchmark()"
        @confirm="daemonStartBenchmark()"
      >
        <ElButton slot="reference">
          Start Benchmark
        </ElButton>
      </el-popconfirm>
    </div>
    <div v-if="daemonSection === 'stopzelbenchd'">
      <div>
        <p>Click on Stop Benchmark button to Stop Benchmark Daemon</p>
      </div>
      <el-popconfirm
        confirmButtonText='Stop'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Stop Benchmark Daemon"
        @onConfirm="daemonStopBenchmark()"
        @confirm="daemonStopBenchmark()"
      >
        <ElButton slot="reference">
          Stop Benchmark
        </ElButton>
      </el-popconfirm>
    </div>
    <!-- BLOCKCHAIN -->
    <div v-if="daemonSection === 'getblockchaininfo'">
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
    <div v-if="daemonSection === 'getmininginfo'">
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
    <div v-if="daemonSection === 'getnetworkinfo'">
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
    <div v-if="daemonSection === 'getrawtransaction'">
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
        <ElButton @click="daemonGetRawTransaction()">
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
    <div v-if="daemonSection === 'validateaddress'">
      <div>
        <p>Please paste a transparent Flux address to display information about it</p>
      </div>
      <div>
        <el-input
          placeholder="Insert transparent Flux address"
          v-model="generalInput"
        >
        </el-input>
      </div>
      <div>
        <ElButton @click="fluxValidateAddress()">
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
    <div v-if="daemonSection === 'getwalletinfo'">
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
    <div v-if="daemonSection === 'debug'">
      <div>
        <p>Following action will download Daemon debug file. This may take a few minutes depending on file size</p>
      </div>
      <el-popconfirm
        confirmButtonText='Download Debug'
        cancelButtonText='No, Thanks'
        icon="el-icon-info"
        iconColor="red"
        title="Download Daemon Debug file?"
        @onConfirm="downloadDaemonDebugFile()"
        @confirm="downloadDaemonDebugFile()"
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
          <p>Following action will show last 100 lines of Daemon debug file</p>
        </div>
        <el-popconfirm
          confirmButtonText='Show Debug'
          cancelButtonText='No, Thanks'
          icon="el-icon-info"
          iconColor="red"
          title="Show Daemon Debug file?"
          @onConfirm="tailDaemonDebug()"
          @confirm="tailDaemonDebug()"
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
          v-model="daemonDebugTail"
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

import DaemonService from '@/services/DaemonService';
import FluxService from '@/services/FluxService';

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'Daemon',
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
      getNodeStatusResponse: {
        status: '',
        data: '',
        nodeStatus: 'Checking status...',
      },
      total: '',
      downloaded: '',
      abortToken: {},
      activeHelpNames: '',
      currentHelpResponse: '',
      rescanDaemonHeight: 0,
      filterZelNodes: '',
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'daemonSection',
    ]),
    daemonDebugTail() {
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
    daemonSection(val, oldVal) {
      console.log(val, oldVal);
      this.callResponse.status = '';
      this.callResponse.data = '';
      this.generalInput = '';
      this.switcher(val);
    },
  },
  mounted() {
    this.switcher(this.daemonSection);
  },
  methods: {
    switcher(value) {
      switch (value) {
        case 'welcomeinfo':
          this.daemonGetInfo();
          this.daemonWelcomeGetZelNodeStatus();
          break;
        case 'getinfo':
          this.daemonGetInfo();
          break;
        case 'help':
          this.daemonHelp();
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
          this.daemonGetNodeStatus();
          break;
        case 'listzelnodes':
          this.daemonListZelNodes();
          break;
        case 'viewdeterministiczelnodelist':
          this.daemonViewDeterministicZelNodeList();
          break;
        case 'getzelnodecount':
          this.daemonGetZelNodeCount();
          break;
        case 'getstartlist':
          this.daemonGetStartList();
          break;
        case 'getdoslist':
          this.daemonGetDOSList();
          break;
        case 'zelnodecurrentwinner':
          this.daemonZelNodeCurrentWinner();
          break;
        case 'getbenchmarks':
          this.daemonGetBenchmarks();
          break;
        case 'getbenchstatus':
          this.daemonGetBenchStatus();
          break;
        case 'startzelbenchd':
          break;
        case 'stopzelbenchd':
          break;
        case 'getblockchaininfo':
          this.daemonGetBlockchainInfo();
          break;
        case 'getmininginfo':
          this.daemonGetMiningInfo();
          break;
        case 'getnetworkinfo':
          this.daemonGetNetworkInfo();
          break;
        case 'getrawtransaction':
          break;
        case 'validateaddress':
          break;
        case 'getwalletinfo':
          this.daemonGetWalletInfo();
          break;
        case null:
          console.log('Daemon Section hidden');
          break;
        default:
          console.log('Daemon Section: Unrecognized method');
      }
    },
    async daemonGetInfo() {
      const response = await DaemonService.getInfo();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async daemonHelp() {
      const response = await DaemonService.help();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async daemonHelpSpecific() {
      this.currentHelpResponse = '';
      const response = await DaemonService.helpSpecific(this.activeHelpNames);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
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
    startDaemon() {
      vue.$customMes.warning('Daemon will start');
      const zelidauth = localStorage.getItem('zelidauth');
      DaemonService.start(zelidauth)
        .then((response) => {
          vue.$customMes({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
        })
        .catch(() => {
          vue.$customMes.error('Error while trying to start Daemon');
        });
    },
    stopDaemon() {
      vue.$customMes.warning('Daemon will be stopped');
      const zelidauth = localStorage.getItem('zelidauth');
      DaemonService.stopDaemon(zelidauth)
        .then((response) => {
          vue.$customMes({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
        })
        .catch(() => {
          vue.$customMes.error('Error while trying to stop Daemon');
        });
    },
    restartDaemon() {
      vue.$customMes.warning('Daemon will now restart');
      const zelidauth = localStorage.getItem('zelidauth');
      DaemonService.restart(zelidauth)
        .then((response) => {
          vue.$customMes({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
        })
        .catch(() => {
          vue.$customMes.error('Error while trying to restart Daemon');
        });
    },
    rescanDaemon() {
      vue.$customMes.warning('Daemon will now rescan. This will take up to an hour.');
      const zelidauth = localStorage.getItem('zelidauth');
      const blockheight = this.rescanDaemonHeight > 0 ? this.rescanDaemonHeight : 0;
      DaemonService.rescanDaemon(zelidauth, blockheight)
        .then((response) => {
          vue.$customMes({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
        })
        .catch(() => {
          vue.$customMes.error('Error while trying to rescan Daemon');
        });
    },
    reindexDaemon() {
      vue.$customMes.warning('Daemon will now reindex. This will take several hours.');
      const zelidauth = localStorage.getItem('zelidauth');
      FluxService.reindexDaemon(zelidauth)
        .then((response) => {
          vue.$customMes({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
        })
        .catch(() => {
          vue.$customMes.error('Error while trying to reindex Daemon');
        });
    },
    async daemonWelcomeGetZelNodeStatus() {
      const response = await DaemonService.getZelNodeStatus();
      this.getNodeStatusResponse.status = response.data.status;
      this.getNodeStatusResponse.data = response.data.data;
      console.log(this.getNodeStatusResponse.data);
      if (this.getNodeStatusResponse.data) {
        if (this.getNodeStatusResponse.data.status === 'CONFIRMED' || this.getNodeStatusResponse.data.location === 'CONFIRMED') {
          this.getNodeStatusResponse.nodeStatus = 'Flux is working correctly';
        } else if (this.getNodeStatusResponse.data.status === 'STARTED' || this.getNodeStatusResponse.data.location === 'STARTED') {
          this.getNodeStatusResponse.nodeStatus = 'Flux has just been started. Flux is running with limited capabilities.';
        } else {
          this.getNodeStatusResponse.nodeStatus = 'Flux is not confirmed. Flux is running with limited capabilities.';
        }
      }
    },
    // ZELNODE
    async daemonGetNodeStatus() {
      const response = await DaemonService.getZelNodeStatus();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async daemonListZelNodes() {
      const response = await DaemonService.listZelNodes();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async daemonViewDeterministicZelNodeList() {
      const response = await DaemonService.viewDeterministicZelNodeList();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async daemonGetZelNodeCount() {
      const response = await DaemonService.getZelNodeCount();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async daemonGetStartList() {
      const response = await DaemonService.getStartList();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async daemonGetDOSList() {
      const response = await DaemonService.getDOSList();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async daemonZelNodeCurrentWinner() {
      const response = await DaemonService.zelnodeCurrentWinner();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    // BENCHMARKS
    async daemonGetBenchmarks() {
      const response = await DaemonService.getBenchmarks();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = JSON.parse(response.data.data);
      }
    },
    async daemonGetBenchStatus() {
      const response = await DaemonService.getBenchStatus();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = JSON.parse(response.data.data);
      }
    },
    daemonStartBenchmark() {
      vue.$customMes.warning('Benchmark will now try to start');
      const zelidauth = localStorage.getItem('zelidauth');
      DaemonService.startBenchmark(zelidauth)
        .then((response) => {
          vue.$customMes({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
        })
        .catch(() => {
          vue.$customMes.error('Error while trying to start Benchmark');
        });
    },
    daemonStopBenchmark() {
      vue.$customMes.warning('Benchmark will now try to stop');
      const zelidauth = localStorage.getItem('zelidauth');
      DaemonService.stopBenchmark(zelidauth)
        .then((response) => {
          vue.$customMes({
            type: response.data.status,
            message: response.data.data.message || response.data.data,
          });
        })
        .catch(() => {
          vue.$customMes.error('Error while trying to stop Benchmark');
        });
    },
    // BLOCKCHAIN
    async daemonGetBlockchainInfo() {
      const response = await DaemonService.getBlockchainInfo();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = JSON.stringify(response.data.data, undefined, '\t');
      }
    },
    // MINING
    async daemonGetMiningInfo() {
      const response = await DaemonService.getMiningInfo();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = JSON.stringify(response.data.data, undefined, '\t');
      }
    },
    // NETWORK
    async daemonGetNetworkInfo() {
      const response = await DaemonService.getNetworkInfo();
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = JSON.stringify(response.data.data, undefined, '\t');
      }
    },
    // RAW TRANSACTION
    async daemonGetRawTransaction() {
      const response = await DaemonService.getRawTransaction(this.generalInput, 1);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = JSON.stringify(response.data.data, undefined, '\t');
      }
    },
    // UTIL
    async fluxValidateAddress() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await DaemonService.validateAddress(zelidauth, this.generalInput);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = JSON.stringify(response.data.data, undefined, '\t');
      }
    },
    // WALLET
    async daemonGetWalletInfo() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await DaemonService.getWalletInfo(zelidauth);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
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
    async downloadDaemonDebugFile() {
      const self = this;
      self.abortToken = DaemonService.cancelToken();
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
      const response = await DaemonService.justAPI().get('/flux/daemondebug', axiosConfig);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'debug.log');
      document.body.appendChild(link);
      link.click();
    },
    tailDaemonDebug() {
      const zelidauth = localStorage.getItem('zelidauth');
      DaemonService.tailDaemonDebug(zelidauth)
        .then((response) => {
          if (response.data.status === 'error') {
            vue.$customMes.error(response.data.data.message || response.data.data);
          } else {
            this.callResponse.status = response.data.status;
            this.callResponse.data = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error while trying to get latest debug of Daemon');
        });
    },
  },
};
</script>
