<template>
  <div class="header-menu">
    <el-menu
      :default-active="activeIndex"
      class="el-menu-demo"
      mode="horizontal"
      @select="handleSelect"
      background-color="#333333"
      text-color="#fff"
      active-text-color="#ffd04b"
    >
      <el-menu-item index="0">
        <div class='header-logo'>
          <span class="helper"></span>
          <img src="@/assets/img/ZelNodes.svg">
        </div>
      </el-menu-item>
      <el-submenu
        v-if="privilage === 'user' || privilage === 'admin' || privilage === 'zelteam'"
        index="1"
      >
        <template slot="title">ZelCash</template>
        <el-submenu index="1-1">
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
            v-if="privilage === 'admin'"
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
            v-if="privilage === 'admin'"
          >
            Restart
          </el-menu-item>
        </el-submenu>
        <el-submenu index="1-2">
          <template slot="title">ZelNode</template>
          <el-menu-item index="1-2-1">Get Info</el-menu-item>
        </el-submenu>
        <el-submenu index="1-3">
          <template slot="title">BlockChain</template>
          <el-menu-item index="1-3-1">Get Info</el-menu-item>
        </el-submenu>
        <el-submenu index="1-4">
          <template slot="title">Mining</template>
          <el-menu-item index="1-4-1">Get Info</el-menu-item>
        </el-submenu>
        <el-submenu index="1-5">
          <template slot="title">Network</template>
          <el-menu-item index="1-5-1">Get Info</el-menu-item>
        </el-submenu>
        <el-submenu index="1-6">
          <template slot="title">Raw Transactions</template>
          <el-menu-item index="1-6-1">Get Info</el-menu-item>
        </el-submenu>
        <el-submenu index="1-7">
          <template slot="title">Utilities</template>
          <el-menu-item index="1-7-1">Get Info</el-menu-item>
        </el-submenu>
        <el-submenu index="1-8">
          <template slot="title">Wallet</template>
          <el-menu-item index="1-8-1">Get Info</el-menu-item>
        </el-submenu>
      </el-submenu>
      <el-submenu
        v-if="privilage === 'user' || privilage === 'admin' || privilage === 'zelteam'"
        index="2"
      >
        <template slot="title">ZelNode</template>
        <el-menu-item index="2-1">ZelNode Status</el-menu-item>
      </el-submenu>
      <el-submenu
        v-if="privilage === 'user' || privilage === 'admin' || privilage === 'zelteam'"
        index="3"
      >
        <template slot="title">ZelApps</template>
        <el-menu-item index="3-1">Information</el-menu-item>
      </el-submenu>
      <el-submenu
        v-if="privilage === 'user' || privilage === 'admin' || privilage === 'zelteam'"
        index="10"
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
          v-if="privilage === 'admin'"
          index="10-4"
        >
          Manage Users
        </el-menu-item>
        <!--<el-menu-item index="10-4">Active Login Phrases</el-menu-item>-->
      </el-submenu>
      <el-menu-item
        v-if="privilage === 'user' || privilage === 'admin' || privilage === 'zelteam'"
        index="100"
      >
        Log Out
      </el-menu-item>
    </el-menu>
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
    };
  },
  methods: {
    handleSelect(key, keyPath) {
      console.log(key, keyPath);
      console.log(key);
      switch (key) {
        case '0':
          this.$store.commit('setZelCashSection', 'getinfo');
          break;
        case '1-1-1':
          this.$store.commit('setZelCashSection', 'getinfo');
          break;
        case '2-1':
          this.$store.commit('setZelNodeSection', 'getinfo');
          break;
        case '3-1':
          vue.$message.info('ZelApps coming soon!');
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
          this.$store.commit('setZelAdminSection', 'manageusers');
          break;
        case '100':
          this.logoutCurrentSession();
          this.activeIndex = 0;
          break;
        default:
          vue.$message.info('Feature coming soon!');
          console.log('Menu: Unrecognised method');
      }
    },
    logoutCurrentSession() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      localStorage.removeItem('zelidauth');
      this.$store.commit('setPrivilage', 'none');
      this.$store.commit('setZelCashSection', 'getinfo');
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
