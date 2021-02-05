<template>
  <div class="footer-grid">
    <div class="footer-left">
      <el-select
        v-model="backendURL"
        placeholder="Select Backend"
        filterable
        allow-create
        @change=changeBackendURL
      >
        <el-option
          key="Default"
          :label="`http://${userconfig.externalip}:${config.apiPort}`"
          :value="`http://${userconfig.externalip}:${config.apiPort}`"
        >
        </el-option>
        <el-option
          key="HTTPS"
          label="https://api.runonflux.io"
          value="https://api.runonflux.io"
        >
        </el-option>
      </el-select>
    </div>
    <div class="footer-middle">
      <ElLink
        type="primary"
        href="https://github.com/zelcash/zelflux"
        target="_blank" rel="noopener noreferrer"
      >The gateway to the Zel Network</ElLink>
    </div>
    <div class="footer-right">
      Flux {{ 'v' + zelfluxVersion}}
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';
import axios from 'axios';

import ZelNodeService from '@/services/ZelNodeService';

const store = require('store');

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'Footer',
  data() {
    return {
      backendURL: '',
    };
  },
  computed: {
    ...mapState([
      'userconfig',
      'config',
      'zelfluxVersion',
    ]),
  },
  mounted() {
    const { protocol, hostname } = window.location;
    let mybackend = '';
    mybackend += protocol;
    mybackend += '//';
    const regex = /[A-Za-z]/g;
    if (hostname.match(regex)) {
      const names = hostname.split['.'];
      names[0] = 'api';
      mybackend += names.join('.');
    } else {
      mybackend += this.userconfig.externalip;
      mybackend += ':';
      mybackend += this.config.apiPort;
    }
    this.backendURL = store.get('backendURL') || mybackend;
    const self = this;
    ZelNodeService.getZelFluxVersion()
      .then((response) => {
        console.log(response);
        const version = response.data.data;
        this.$store.commit('setZelFluxVersion', version);
        self.getLatestZelFluxVersion();
      })
      .catch((e) => {
        console.log(e);
        console.log(e.code);
        vue.$customMes.error(e.toString());
      });
  },
  methods: {
    getLatestZelFluxVersion() {
      const self = this;
      axios.get('https://raw.githubusercontent.com/zelcash/zelflux/master/package.json')
        .then((response) => {
          console.log(response);
          if (response.data.version !== self.zelfluxVersion) {
            vue.$customMes.warning('Flux needs to be updated!');
          } else {
            vue.$customMes.success('Flux is up to date');
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error('Error verifying recent version');
        });
    },
    changeBackendURL(value) {
      store.set('backendURL', value);
    },
  },
};
</script>
