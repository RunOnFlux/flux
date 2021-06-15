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
    <div class="bookmark-wrapper align-items-center flex-grow-1 d-none d-lg-flex">
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
      </b-dropdown>
    </div>

    <b-navbar-nav class="nav align-items-center ml-auto">
      <dark-Toggler class="d-none d-lg-block" />
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
import { mapState } from 'vuex'
import {
  BLink, BDropdown, BDropdownItemButton, BDropdownDivider, BNavbarNav, BButton, // BNavItemDropdown, BDropdownItem, BDropdownDivider, BAvatar,
} from 'bootstrap-vue'
import DarkToggler from '@core/layouts/components/app-navbar/components/DarkToggler.vue'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'
import Ripple from 'vue-ripple-directive'

import IDService from '@/services/IDService'

const qs = require('qs')

const store = require('store')

export default {
  components: {
    BLink,
    BNavbarNav,
    BDropdown,
    BDropdownItemButton,
    BDropdownDivider,
    BButton,
    // Navbar Components
    DarkToggler,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    Ripple,
  },
  props: {
    toggleVerticalMenuActive: {
      type: Function,
      default: () => {},
    },
  },
  data() {
    return {
      backendURL: '',
    }
  },
  computed: {
    ...mapState('flux', [
      'userconfig',
      'config',
      'privilege',
    ]),
  },
  mounted() {
    const { protocol, hostname } = window.location
    let mybackend = ''
    mybackend += protocol
    mybackend += '//'
    const regex = /[A-Za-z]/g
    if (hostname.match(regex)) {
      const names = hostname.split('.')
      names[0] = 'api'
      mybackend += names.join('.')
    } else {
      mybackend += this.userconfig.externalip
      mybackend += ':'
      mybackend += this.config.apiPort
    }
    this.backendURL = store.get('backendURL') || mybackend
  },
  methods: {
    changeBackendURL(value) {
      store.set('backendURL', value)
      this.backendURL = value
    },
    showToast(variant, title) {
      this.$toast({
        component: ToastificationContent,
        props: {
          title,
          icon: 'BellIcon',
          variant,
        },
      })
    },
    logout() {
      const zelidauth = localStorage.getItem('zelidauth')
      const auth = qs.parse(zelidauth)
      localStorage.removeItem('zelidauth')
      this.$store.commit('flux/setPrivilege', 'none')
      console.log(auth)
      IDService.logoutCurrentSession(zelidauth)
        .then(response => {
          console.log(response)
          if (response.data.status === 'error') {
            console.log(response.data.data.message)
            // SHOULD NEVER HAPPEN. Do not show any message.
          } else {
            this.showToast('success', response.data.data.message)
          }
        })
        .catch(e => {
          console.log(e)
          this.showToast('danger', e.toString())
        })
    },
  },
}
</script>
