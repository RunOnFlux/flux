<template>
  <div class="footer-grid">
    <div class="footer-left">
      <el-select
        v-model="backendURL"
        placeholder="Select Backend"
        :label="backendURL"
        filterable
        allow-create
        @change="changeBackendURL"
      >
        <el-option
          key="Default"
          :label="`http://${userconfig.externalip}:${config.apiPort}`"
          :value="`http://${userconfig.externalip}:${config.apiPort}`"
        />
        <el-option
          key="HTTPS"
          label="https://api.runonflux.io"
          value="https://api.runonflux.io"
        />
      </el-select>
    </div>
    <div class="footer-middle">
      <ElLink
        type="primary"
        href="https://github.com/runonflux/flux"
        target="_blank"
        rel="noopener noreferrer"
      >
        Flux, Your Gateway to a Decentralized World
      </ElLink>
    </div>
    <div class="footer-right">
      Flux {{ 'v' + fluxVersion }}
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';
import axios from 'axios';

import FluxService from '@/services/FluxService';

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
      'fluxVersion',
    ]),
  },
  mounted() {
    const { protocol, hostname } = window.location;
    let mybackend = '';
    mybackend += protocol;
    mybackend += '//';
    const regex = /[A-Za-z]/g;
    if (hostname.match(regex)) {
      const names = hostname.split('.');
      names[0] = 'api';
      mybackend += names.join('.');
    } else {
      mybackend += this.userconfig.externalip;
      mybackend += ':';
      mybackend += this.config.apiPort;
    }
    this.backendURL = store.get('backendURL') || mybackend;
    const self = this;
    FluxService.getFluxVersion()
      .then((response) => {
        console.log(response);
        const version = response.data.data;
        this.$store.commit('flux/setFluxVersion', version);
        self.getLatestFluxVersion();
      })
      .catch((e) => {
        console.log(e);
        console.log(e.code);
        vue.$customMes.error(e.toString());
      });
  },
  methods: {
    getLatestFluxVersion() {
      const self = this;
      axios.get('https://raw.githubusercontent.com/runonflux/flux/master/package.json')
        .then((response) => {
          console.log(response);
          if (response.data.version !== self.fluxVersion) {
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
