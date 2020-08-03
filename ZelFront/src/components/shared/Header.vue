<template>
  <div class="header-menu">
    <el-menu
      :default-active="activeIndex"
      :collapse="isMobile"
      :mode="windowWidth < 805 ? 'vertical' : 'horizontal'"
      @select="handleSelect"
      :unique-opened=true
      :class="{ mobilemenu: isMobile, hidden: !showMenu }"
      background-color="#333333"
      text-color="#fff"
      active-text-color="#ffd04b"
    >
      <el-menu-item index="0">
        <div class='header-logo'>
          <span class="helper"></span>
          <img src="@/assets/img/flux_white_logo.svg">
        </div>
      </el-menu-item>
      <el-submenu
        v-if="privilage === 'user' || privilage === 'admin' || privilage === 'zelteam'"
        index="1"
        :popper-append-to-body=true
      >
        <template slot="title">ZelCash</template>
        <el-submenu
          :popper-append-to-body=true
          index="1-1"
        >
          <template slot="title">Control</template>
          <el-menu-item index="1-1-1">Get Info</el-menu-item>
          <el-menu-item index="1-1-2">Help</el-menu-item>
          <el-menu-item
            index="1-1-3"
            v-if="privilage === 'admin'"
          >
            <!-- part of Wallet as well -->
            Rescan BlockChain
          </el-menu-item>
          <el-menu-item
            index="1-1-4"
            v-if="privilage === 'admin'"
          >
            Reindex BlockChain
          </el-menu-item>
          <el-menu-item
            index="1-1-5"
            v-if="privilage === 'admin' || privilage === 'zelteam'"
          >
            Start
          </el-menu-item>
          <el-menu-item
            index="1-1-6"
            v-if="privilage === 'admin'"
          >
            Stop
          </el-menu-item>
          <el-menu-item
            index="1-1-7"
            v-if="privilage === 'admin' || privilage === 'zelteam'"
          >
            Restart
          </el-menu-item>
        </el-submenu>
        <el-submenu
          :popper-append-to-body=true
          index="1-2"
        >
          <template slot="title">ZelNode</template>
          <el-menu-item index="1-2-1">Get ZelNode Status</el-menu-item>
          <el-menu-item index="1-2-2">List ZelNodes</el-menu-item>
          <el-menu-item index="1-2-3">View Deterministic ZelNode List</el-menu-item>
          <el-menu-item index="1-2-4">Get ZelNode Count</el-menu-item>
          <el-menu-item index="1-2-5">Get Start List</el-menu-item>
          <el-menu-item index="1-2-6">Get DOS List</el-menu-item>
          <el-menu-item index="1-2-7">ZelNode Current Winner</el-menu-item>
        </el-submenu>
        <el-submenu
          :popper-append-to-body=true
          index="1-3"
        >
          <template slot="title">Benchmarks</template>
          <el-menu-item index="1-3-1">Get Benchmarks</el-menu-item>
          <el-menu-item index="1-3-2">Get Bench Status</el-menu-item>
          <el-menu-item
            index="1-3-3"
            v-if="privilage === 'admin' || privilage === 'zelteam'"
          >
            Start ZelBench
          </el-menu-item>
          <el-menu-item
            index="1-3-4"
            v-if="privilage === 'admin' || privilage === 'zelteam'"
          >
            Stop ZelBench
          </el-menu-item>
        </el-submenu>
        <el-submenu
          :popper-append-to-body=true
          index="1-4"
        >
          <template slot="title">BlockChain</template>
          <el-menu-item index="1-4-1">Get BlockChain Info</el-menu-item>
        </el-submenu>
        <el-submenu
          :popper-append-to-body=true
          index="1-5"
        >
          <template slot="title">Mining</template>
          <el-menu-item index="1-5-1">Get Mining Info</el-menu-item>
        </el-submenu>
        <el-submenu
          :popper-append-to-body=true
          index="1-6"
        >
          <template slot="title">Network</template>
          <el-menu-item index="1-6-1">Get Network Info</el-menu-item>
        </el-submenu>
        <el-submenu
          :popper-append-to-body=true
          index="1-7"
        >
          <template slot="title">Raw Transactions</template>
          <el-menu-item index="1-7-1">Get Raw Transaction</el-menu-item>
        </el-submenu>
        <el-submenu
          :popper-append-to-body=true
          index="1-8"
        >
          <template slot="title">Util</template>
          <el-menu-item index="1-8-1">Validate Address</el-menu-item>
        </el-submenu>
        <el-submenu
          :popper-append-to-body=true
          index="1-9"
        >
          <template slot="title">Wallet</template>
          <el-menu-item index="1-9-1">Get Wallet Info</el-menu-item>
        </el-submenu>
        <el-menu-item
          v-if="privilage === 'zelteam' || privilage === 'admin'"
          index="1-10"
        >
          Debug
        </el-menu-item>
      </el-submenu>
      <el-submenu
        v-if="privilage === 'user' || privilage === 'admin' || privilage === 'zelteam'"
        index="2"
        :popper-append-to-body=true
      >
        <template slot="title">ZelBench</template>
        <el-submenu
          :popper-append-to-body=true
          index="2-1"
        >
          <template slot="title">Control</template>
          <el-menu-item index="2-1-1">Help</el-menu-item>
          <el-menu-item
            index="2-1-2"
            v-if="privilage === 'admin' || privilage === 'zelteam'"
          >
            Start
          </el-menu-item>
          <el-menu-item
            index="2-1-3"
            v-if="privilage === 'admin'"
          >
            Stop
          </el-menu-item>
          <el-menu-item
            index="2-1-4"
            v-if="privilage === 'admin' || privilage === 'zelteam'"
          >
            Restart
          </el-menu-item>
        </el-submenu>
        <el-submenu
          :popper-append-to-body=true
          index="2-2"
        >
          <template slot="title">ZelNode</template>
          <el-menu-item index="2-2-1">Get Benchmarks</el-menu-item>
          <el-menu-item index="2-2-2">Get Info</el-menu-item>
        </el-submenu>
        <el-submenu
          :popper-append-to-body=true
          index="2-3"
        >
          <template slot="title">Benchmarks</template>
          <el-menu-item index="2-3-1">Get Status</el-menu-item>
          <el-menu-item
            index="2-3-2"
            v-if="privilage === 'admin' || privilage === 'zelteam'"
          >
            Restart Node Benchmarks
          </el-menu-item>
          <el-menu-item
            index="2-3-3"
            v-if="privilage === 'admin'"
          >
            Sign ZelNode Transaction
          </el-menu-item>
        </el-submenu>
        <el-menu-item
          v-if="privilage === 'zelteam' || privilage === 'admin'"
          index="2-4"
        >
          Debug
        </el-menu-item>
      </el-submenu>
      <el-submenu
        v-if="privilage === 'user' || privilage === 'admin' || privilage === 'zelteam'"
        index="3"
        :popper-append-to-body=true
      >
        <template slot="title">Flux</template>
        <el-menu-item index="3-1">Node Status</el-menu-item>
        <el-menu-item index="3-2">Flux Network</el-menu-item>
        <el-menu-item index="3-3">Debug</el-menu-item>
      </el-submenu>
      <el-submenu
        v-if="privilage === 'user' || privilage === 'admin' || privilage === 'zelteam'"
        index="4"
        :popper-append-to-body=true
      >
        <template slot="title">ZelApps</template>
        <el-menu-item index="4-1">Local ZelApps</el-menu-item>
        <el-menu-item index="4-2">Global ZelApps</el-menu-item>
        <el-menu-item index="4-3">Register ZelApp</el-menu-item>
      </el-submenu>
      <el-submenu
        v-if="privilage === 'user' || privilage === 'admin' || privilage === 'zelteam'"
        index="10"
        :popper-append-to-body=true
      >
        <template slot="title">ZelAdmin</template>
        <el-menu-item index="10-1">Logged Sessions</el-menu-item>
        <el-menu-item
          v-if="privilage === 'zelteam' || privilage === 'admin'"
          index="10-2"
        >
          Manage Flux
        </el-menu-item>
        <el-menu-item
          v-if="privilage === 'zelteam' || privilage === 'admin'"
          index="10-3"
        >
          Manage ZelCash
        </el-menu-item>
        <el-menu-item
          v-if="privilage === 'zelteam' || privilage === 'admin'"
          index="10-4"
        >
          Manage ZelBench
        </el-menu-item>
        <el-menu-item
          v-if="privilage === 'zelteam' || privilage === 'admin'"
          index="10-5"
        >
          Manage Users
        </el-menu-item>
        <!--<el-menu-item index="10-4">Active Login Phrases</el-menu-item>-->
      </el-submenu>
      <el-menu-item index="50">
        Very Basic Explorer
      </el-menu-item>
      <el-menu-item
        v-if="privilage === 'user' || privilage === 'admin' || privilage === 'zelteam'"
        index="100"
      >
        Log Out
      </el-menu-item>
    </el-menu>
    <div
      v-if="windowWidth < 805"
      class="container"
      :class="{ change: showMenu }"
      @click="showMenu = !showMenu"
    >
      <div class="bar1"></div>
      <div class="bar2"></div>
      <div class="bar3"></div>
    </div>
  </div>
</template>

<script>
import Vue from 'vue';

import zelIDService from '@/services/ZelIDService';

const qs = require('qs');

const vue = new Vue();

export default {
  name: 'Header',
  props: {
    privilage: String,
  },
  data() {
    return {
      activeIndex: '0',
      windowWidth: window.innerWidth,
      showMenu: false,
    };
  },
  computed: {
    isMobile() {
      if (this.windowWidth < 805) {
        return true;
      }
      return false;
    },
  },
  beforeDestroy() {
    window.removeEventListener('resize', this.handleResize);
  },
  mounted() {
    window.addEventListener('resize', this.handleResize);
  },
  methods: {
    handleResize() {
      this.windowWidth = window.innerWidth;
    },
    handleSelect(key, keyPath) {
      this.showMenu = false;
      console.log(key, keyPath);
      console.log(key);
      switch (key) {
        case '0':
          this.$store.commit('setZelCashSection', 'welcomeinfo');
          break;
        case '1-1-1':
          this.$store.commit('setZelCashSection', 'getinfo');
          break;
        case '1-1-2':
          this.$store.commit('setZelCashSection', 'help');
          break;
        case '1-1-3':
          this.$store.commit('setZelCashSection', 'rescanblockchain');
          break;
        case '1-1-4':
          this.$store.commit('setZelCashSection', 'reindexblockchain');
          break;
        case '1-1-5':
          this.$store.commit('setZelCashSection', 'start');
          break;
        case '1-1-6':
          this.$store.commit('setZelCashSection', 'stop');
          break;
        case '1-1-7':
          this.$store.commit('setZelCashSection', 'restart');
          break;
        case '1-2-1':
          this.$store.commit('setZelCashSection', 'getzelnodestatus');
          break;
        case '1-2-2':
          this.$store.commit('setZelCashSection', 'listzelnodes');
          break;
        case '1-2-3':
          this.$store.commit('setZelCashSection', 'viewdeterministiczelnodelist');
          break;
        case '1-2-4':
          this.$store.commit('setZelCashSection', 'getzelnodecount');
          break;
        case '1-2-5':
          this.$store.commit('setZelCashSection', 'getstartlist');
          break;
        case '1-2-6':
          this.$store.commit('setZelCashSection', 'getdoslist');
          break;
        case '1-2-7':
          this.$store.commit('setZelCashSection', 'zelnodecurrentwinner');
          break;
        case '1-3-1':
          this.$store.commit('setZelCashSection', 'getbenchmarks');
          break;
        case '1-3-2':
          this.$store.commit('setZelCashSection', 'getbenchstatus');
          break;
        case '1-3-3':
          this.$store.commit('setZelCashSection', 'startzelbenchd');
          break;
        case '1-3-4':
          this.$store.commit('setZelCashSection', 'stopzelbenchd');
          break;
        case '1-4-1':
          this.$store.commit('setZelCashSection', 'getblockchaininfo');
          break;
        case '1-5-1':
          this.$store.commit('setZelCashSection', 'getmininginfo');
          break;
        case '1-6-1':
          this.$store.commit('setZelCashSection', 'getnetworkinfo');
          break;
        case '1-7-1':
          this.$store.commit('setZelCashSection', 'getrawtransaction');
          break;
        case '1-8-1':
          this.$store.commit('setZelCashSection', 'validateaddress');
          break;
        case '1-9-1':
          this.$store.commit('setZelCashSection', 'getwalletinfo');
          break;
        case '1-10':
          this.$store.commit('setZelCashSection', 'debug');
          break;
        case '2-1-1':
          this.$store.commit('setZelBenchSection', 'help');
          break;
        case '2-1-2':
          this.$store.commit('setZelBenchSection', 'start');
          break;
        case '2-1-3':
          this.$store.commit('setZelBenchSection', 'stop');
          break;
        case '2-1-4':
          this.$store.commit('setZelBenchSection', 'restart');
          break;
        case '2-2-1':
          this.$store.commit('setZelBenchSection', 'getbenchmarks');
          break;
        case '2-2-2':
          this.$store.commit('setZelBenchSection', 'getinfo');
          break;
        case '2-3-1':
          this.$store.commit('setZelBenchSection', 'getstatus');
          break;
        case '2-3-2':
          this.$store.commit('setZelBenchSection', 'restartnodebenchmarks');
          break;
        case '2-3-3':
          this.$store.commit('setZelBenchSection', 'signzelnodetransaction');
          break;
        case '2-4':
          this.$store.commit('setZelBenchSection', 'debug');
          break;
        case '3-1':
          this.$store.commit('setZelNodeSection', 'getinfo');
          break;
        case '3-2':
          this.$store.commit('setZelNodeSection', 'network');
          break;
        case '3-3':
          this.$store.commit('setZelNodeSection', 'debug');
          break;
        case '4-1':
          this.$store.commit('setZelAppsSection', 'localzelapps');
          break;
        case '4-2':
          this.$store.commit('setZelAppsSection', 'globalzelapps');
          break;
        case '4-3':
          this.$store.commit('setZelAppsSection', 'registerzelapp');
          break;
        case '10-1':
          this.$store.commit('setZelAdminSection', 'loggedsessions');
          break;
        case '10-2':
          this.$store.commit('setZelAdminSection', 'manageflux');
          break;
        case '10-3':
          this.$store.commit('setZelAdminSection', 'managezelcash');
          break;
        case '10-4':
          this.$store.commit('setZelAdminSection', 'managezelbench');
          break;
        case '10-5':
          this.$store.commit('setZelAdminSection', 'manageusers');
          break;
        case '50':
          this.$store.commit('setExplorerSection', 'explorer');
          break;
        case '100':
          this.logoutCurrentSession();
          this.activeIndex = '0';
          break;
        default:
          vue.$message.info('Feature coming soon!');
          console.log('Menu: Unrecognized method');
      }
    },
    logoutCurrentSession() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      localStorage.removeItem('zelidauth');
      this.$store.commit('setPrivilage', 'none');
      this.$store.commit('setZelCashSection', 'welcomeinfo');
      console.log(auth);
      zelIDService.logoutCurrentSession(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            console.log(response.data.data.message);
            // SHOULD NEVER HAPPEN. Do not show any message.
          } else {
            vue.$message.success(response.data.data.message);
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$message.error(e.toString());
        });
    },
  },
};
</script>
