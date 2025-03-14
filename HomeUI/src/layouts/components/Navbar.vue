<template>
  <div class="navbar-container d-flex content align-items-center">
    <!-- Nav Menu Toggler -->
    <ul class="nav navbar-nav d-xl-none">
      <li class="nav-item">
        <b-link
          class="nav-link"
          @click="toggleVerticalMenuActive"
        >
          <feather-icon
            icon="MenuIcon"
            size="21"
          />
        </b-link>
      </li>
    </ul>

    <!-- Left Col -->
    <div class="bookmark-wrapper align-items-center flex-grow-1 d-none d-md-flex">
      <b-dropdown
        v-ripple.400="'rgba(113, 102, 240, 0.15)'"
        :text="backendURL"
        variant="outline-primary"
        size="sm"
      >
        <b-dropdown-item-button @click="changeBackendURL(`http://${userconfig.externalip}:${config.apiPort}`)">
          http://{{ userconfig.externalip }}:{{ config.apiPort }}
        </b-dropdown-item-button>
        <b-dropdown-divider />
        <b-dropdown-item-button @click="changeBackendURL('https://api.runonflux.io')">
          https://api.runonflux.io
        </b-dropdown-item-button>
        <b-dropdown-divider />
        <b-form-input
          id="dropdown-form-custom"
          v-model="customBackend"
          type="text"
          size="sm"
          placeholder="Custom Backend"
          @input="changeBackendURL(customBackend)"
        />
      </b-dropdown>
    </div>

    <b-navbar-nav class="nav align-items-center ml-auto">
      {{ zelid }}
      <dark-Toggler class="d-block" />
      <menu-Collapse-Toggler class="d-block" />
      <b-button
        v-if="privilege !== 'none'"
        variant="outline-primary"
        size="sm"
        @click="logout"
      >
        Logout
      </b-button>
    </b-navbar-nav>
  </div>
</template>

<script>
import { mapState } from 'vuex';
import {
  BLink, BDropdown, BDropdownItemButton, BDropdownDivider, BNavbarNav, BButton, BFormInput, // BNavItemDropdown, BDropdownItem, BDropdownDivider, BAvatar,
} from 'bootstrap-vue';
import DarkToggler from '@core/layouts/components/app-navbar/components/DarkToggler.vue';
import MenuCollapseToggler from '@core/layouts/components/app-navbar/components/MenuCollapseToggler.vue';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import Ripple from 'vue-ripple-directive';
import firebase from '../../libs/firebase';
import IDService from '@/services/IDService';

const qs = require('qs');

const store = require('store');

export default {
  components: {
    BLink,
    BNavbarNav,
    BDropdown,
    BDropdownItemButton,
    BDropdownDivider,
    BButton,
    BFormInput,
    // Navbar Components
    DarkToggler,
    MenuCollapseToggler,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    Ripple,
  },
  props: {
    toggleVerticalMenuActive: {
      type: Function,
      default: () => { },
    },
  },
  data() {
    return {
      backendURL: '',
      customBackend: '',
    };
  },
  computed: {
    ...mapState('flux', [
      'userconfig',
      'config',
      'privilege',
      'zelid',
    ]),
  },
  mounted() {
    const storedZelidauth = localStorage.getItem('zelidauth');
    if (storedZelidauth) {
      const authData = qs.parse(storedZelidauth);
      if (authData.zelid) {
        this.$store.commit('flux/setZelid', authData.zelid);
      }
    }
    const { protocol, hostname, port } = window.location;
    let mybackend = '';
    mybackend += protocol;
    mybackend += '//';
    const regex = /[A-Za-z]/g;
    if (hostname.split('-')[4]) { // node specific domain
      const splitted = hostname.split('-');
      const names = splitted[4].split('.');
      const adjP = +names[0] + 1;
      names[0] = adjP.toString();
      names[2] = 'api';
      splitted[4] = '';
      mybackend += splitted.join('-');
      mybackend += names.join('.');
    } else if (hostname.match(regex)) { // home.runonflux.io -> api.runonflux.io
      const names = hostname.split('.');
      names[0] = 'api';
      mybackend += names.join('.');
    } else {
      if (typeof hostname === 'string') {
        this.$store.commit('flux/setUserIp', hostname);
      }
      if (+port > 16100) {
        const apiPort = +port + 1;
        this.$store.commit('flux/setFluxPort', apiPort);
      }
      mybackend += hostname;
      mybackend += ':';
      mybackend += this.config.apiPort;
    }
    this.backendURL = store.get('backendURL') || mybackend;
  },
  methods: {
    changeBackendURL(value) {
      console.log(value);
      store.set('backendURL', value);
      this.backendURL = value;
    },
    showToast(variant, title) {
      this.$toast({
        component: ToastificationContent,
        props: {
          title,
          icon: 'BellIcon',
          variant,
        },
      });
    },
    async logout() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      localStorage.removeItem('zelidauth');
      this.$store.commit('flux/setPrivilege', 'none');
      this.$store.commit('flux/setZelid', '');
      console.log(auth);
      IDService.logoutCurrentSession(zelidauth)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            console.log(response.data.data.message);
            // SHOULD NEVER HAPPEN. Do not show any message.
          } else {
            this.showToast('success', response.data.data.message);
            // Redirect to home page
            if (this.$route.path === '/') {
              window.location.reload();
            } else {
              this.$router.push({ name: 'home' });
            }
          }
        })
        .catch((e) => {
          console.log(e);
          this.showToast('danger', e.toString());
        });
      try {
        await firebase.auth().signOut();
      } catch (error) {
        console.log(error);
      }
    },
  },
};
</script>
