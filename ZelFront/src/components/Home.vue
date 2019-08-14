<template>
  <div>
    <img src="@/assets/ZelNodes.svg">
    <h1>{{ defaultResponse.status || 'Error connecting to zelcashd'}}</h1>
    <h1>Node owner Zel ID: {{ zelid }}</h1>
    <h1>{{ defaultResponse.message }}</h1>

    <div>
      <a
        @click="initiateLoginWS"
        :href="'zel:?action=sign&message=' + loginPhrase + '&icon=http%3A%2F%2Fzelid.io%2Fimg%2FzelID.svg&callback=http%3A%2F%2F' + externalip + ':' + apiPort + '%2Fzelid%2Fverifylogin%2F'"
      >
        <img src="@/assets//zelID.svg" />
      </a>
    </div>

    {{ loginForm.message }}

    <div class="form">
      <div>
        <input
          type="text"
          name="address"
          placeholder="address"
          v-model="loginForm.address"
        >
      </div>
      <div>
        <input
          type="text"
          name="signature"
          placeholder="signature"
          v-model="loginForm.signature"
        >
      </div>
      <div>
        <button @click="login">Login</button>
        <button @click="loggedUsers">Logged Users</button>
        <button @click="activeLoginPhrases">active Login Phrases</button>
      </div>
    </div>
  </div>
</template>

<script>
import DefaultService from '@/services/DefaultService'
import zelIDService from '@/services/ZelIDService'
import Vue from 'vue'

const qs = require('qs')
const config = require('../../../config/default')
const userconfig = require('../../../config/userconfig')
const vue = new Vue()

export default {
  name: 'Home',
  data() {
    return {
      defaultResponse: {
        status: '',
        message: ''
      },
      zelid: '',
      externalip: '',
      loginPhrase: '',
      apiPort: 16127,
      loginForm: {
        address: '',
        signature: '',
        message: ''
      },
      websocket: null
    }
  },
  mounted() {
    this.getDefault()
    this.getUserConfig()
    this.getZelIdLoginPhrase()
    this.apiPort = config.server.localport
    console.log(config.server.localport)
  },
  methods: {
    async getDefault() {
      const response = await DefaultService.fetchDefault()
      this.defaultResponse.status = response.data.status
      this.defaultResponse.message = response.data.data
    },
    getUserConfig() {
      this.zelid = userconfig.initial.zelid
      this.externalip = userconfig.initial.ipaddress
    },
    getZelIdLoginPhrase() {
      zelIDService.loginPhrase()
        .then(response => {
          console.log(response)
          this.loginPhrase = response.data
          this.loginForm.message = response.data
        })
        .catch(error => {
          console.log(error)
          vue.$message.error(error)
        })
    },
    login() {
      console.log(this.loginForm)
      zelIDService.verifyLogin(this.loginForm)
        .then(response => {
          console.log(response)
          if (response.data.status === 'success' && response.data.data) {
            // we are now signed. Store our values
            const zelidauth = {
              zelid: this.loginForm.address,
              signature: this.loginForm.signature
            }
            localStorage.setItem('zelidauth', qs.stringify(zelidauth))
            vue.$message.success(response.data.data.message)
          } else {
            vue.$message.error(response.data.data.message)
          }
        })
        .catch(e => {
          console.log(e)
          vue.$message.error(e.toString())
        })
    },
    loggedUsers() {
      const zelidauth = localStorage.getItem('zelidauth')
      const auth = qs.parse(zelidauth)
      console.log(auth)
      zelIDService.loggedUsers(zelidauth)
        .then(response => {
          console.log(response)
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message)
          }
        })
        .catch(e => {
          console.log(e)
          vue.$message.error(e.toString())
        })
    },
    activeLoginPhrases() {
      const zelidauth = localStorage.getItem('zelidauth')
      const auth = qs.parse(zelidauth)
      console.log(auth)
      zelIDService.activeLoginPhrases(zelidauth)
        .then(response => {
          console.log(response)
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message)
          }
        })
        .catch(e => {
          console.log(e)
          console.log(e.code)
          vue.$message.error(e.toString())
        })
    },
    initiateLoginWS() {
      const self = this
      const wsuri = `ws://${this.externalip}:${this.apiPort}/ws/zelid/${this.loginPhrase}`
      const websocket = new WebSocket(wsuri)
      this.websocket = websocket

      websocket.onopen = (evt) => { self.onOpen(evt) }
      websocket.onclose = (evt) => { self.onClose(evt) }
      websocket.onmessage = (evt) => { self.onMessage(evt) }
      websocket.onerror = (evt) => { self.onError(evt) }
    },
    onError(evt) {
      console.log(evt)
    },
    onMessage(evt) {
      const data = qs.parse(evt.data)
      if (data.status === 'success' && data.data) {
        // we are now signed. Store our values
        const zelidauth = {
          zelid: data.data.zelid,
          signature: data.data.signature
        }
        localStorage.setItem('zelidauth', qs.stringify(zelidauth))
        vue.$message.success(data.data.message)
      }
      console.log(data)
      console.log(evt)
    },
    onClose(evt) {
      console.log(evt)
    },
    onOpen(evt) {
      console.log(evt)
    }
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
h1 {
  font-weight: normal;
}
img {
  width: 400px;
}
</style>
