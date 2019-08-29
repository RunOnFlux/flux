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
        <el-menu-item index="1-1">Get Info</el-menu-item>
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
        <template slot="title">ZelFlux</template>
        <el-menu-item index="3-1">Flux Info</el-menu-item>
      </el-submenu>
      <el-submenu
        v-if="privilage === 'admin'"
        index="10"
      >
        <template slot="title">ZelAdmin</template>
        <el-menu-item index="10-1">Update Flux</el-menu-item>
        <el-menu-item index="10-2">Rebuild Flux</el-menu-item>
        <el-menu-item index="10-3">Logged Users</el-menu-item>
        <el-menu-item index="10-3">Active Login Phrases</el-menu-item>
        <el-submenu index="10-4">
          <template slot="title">Logout options</template>
          <el-menu-item index="10-4-1">Logout current session</el-menu-item>
          <el-menu-item index="10-4-2">Logout all sessions</el-menu-item>
        </el-submenu>
      </el-submenu>
      <el-submenu
        v-if="privilage === 'zelteam'"
        index="10"
      >
        <template slot="title">ZelAdmin</template>
        <el-menu-item index="10-1">Update Flux</el-menu-item>
        <el-menu-item index="10-2">Rebuild Flux</el-menu-item>
        <el-submenu index="10-4">
          <template slot="title">Logout options</template>
          <el-menu-item index="10-4-1">Logout current session</el-menu-item>
          <el-menu-item index="10-4-2">Logout all sessions</el-menu-item>
        </el-submenu>
      </el-submenu>
    </el-menu>
  </div>
</template>

<script>

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
    },
  },
};
</script>
