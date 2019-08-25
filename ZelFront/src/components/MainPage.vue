<template>
  <div class="mainDivStyle">
    <div class="header">
      <Header />
    </div>
    <div
      v-if="loginForm.message && getInfoResponse.status === 'success'"
      class="content"
    >
      <div class="status">
        <h4>
          ZelNode owner Zel ID: {{ zelid }}
        </h4>
        <h4>
          Status: {{ getZelNodeStatusResponse.zelnodeStatus }}
        </h4>
      </div>

      <div class="getInfoResponse">
        <p>
          ZelCash version {{ getInfoResponse.message.version }}
        </p>
        <p>
          Protocol version {{ getInfoResponse.message.protocolversion }}
        </p>
        <p>
          Current Blockchain Height: {{ getInfoResponse.message.blocks }}
        </p>
        <div v-if="getInfoResponse.message.errors != ''">
          <p>
            Error: {{ getInfoResponse.message.errors }}
          </p>
        </div>
      </div>
      <br>
      <!--<h4>logged privilage {{ privilage }}</h4>-->
      <p>
        Log in using Zel ID
      </p>
      <div>
        <a
          @click="initiateLoginWS"
          :href="'zel:?action=sign&message=' + loginPhrase + '&icon=http%3A%2F%2Fzelid.io%2Fimg%2FzelID.svg&callback=http%3A%2F%2F' + externalip + ':' + apiPort + '%2Fzelid%2Fverifylogin%2F'"
        >
          <img
            class="zelidLogin"
            src="@/assets/img/zelID.svg"
          />
        </a>
      </div>

      <p>
        or sign the following message with any bitcoin address.
      </p>
      <ElForm
        :model="loginForm"
        class="loginForm"
      >
        <ElFormItem>
          <ElInput
            type="text"
            name="message"
            placeholder="message"
            v-model="loginForm.message"
            disabled
          >
            <template slot="prepend">Message: </template>
          </ElInput>
        </ElFormItem>
        <ElFormItem>
          <ElInput
            type="text"
            name="address"
            placeholder="insert bitcoin address"
            v-model="loginForm.address"
          >
            <template slot="prepend">Address: </template>
          </ElInput>
        </ElFormItem>
        <ElFormItem>
          <ElInput
            type="text"
            name="signature"
            placeholder="insert signature"
            v-model="loginForm.signature"
          >
            <template slot="prepend">Signature: </template>
          </ElInput>
        </ElFormItem>
        <ElButton
          class="generalButton"
          @click="login()"
        >
          Login
        </ElButton>
      </ElForm>

      <div v-if="privilage === 'admin'">
        <ElButton
          class="loggedUsers"
          @click="loggedUsers()"
        >
          Logged Users
        </ElButton>
        <ElButton
          class="loggedUsers"
          @click="activeLoginPhrases()"
        >
          active Login Phrases
        </ElButton>
        <ElButton
          class="generalButton"
          @click="logoutCurrentSession()"
        >
          Logout current session
        </ElButton>
        <ElButton
          class="generalButton"
          @click="logoutAllSessions()"
        >
          Logout all sessions
        </ElButton>
        <ElButton
          class="generalButton"
          @click="logOutAllUsers()"
        >
          Logout all users
        </ElButton>
      </div>
      <div v-if="privilage === 'user' || privilage === 'zelteam'">
        <ElButton
          class="
        generalButton"
          @click="logoutCurrentSession()"
        >
          Logout current session
        </ElButton>
        <ElButton
          class="generalButton"
          @click="logoutAllSessions()"
        >
          Logout all sessions
        </ElButton>
      </div>
    </div>
    <div
      v-else-if="loginForm.message === ''"
      class="content"
    >
      <div v-if="errorMessage === ''">
        <h4>
          Error connecting to ZelBack
        </h4>
      </div>
      <div v-else>
        <h4>
          {{ errorMessage }}
        </h4>
      </div>
    </div>
    <div
      v-else-if="getInfoResponse.status === 'error'"
      class="content"
    >
      <h4>
        Error connecting to ZelCash daemon
      </h4>
    </div>
    <div
      v-else
      class="content"
    >
      <h4>
        Loading...
      </h4>
    </div>
    <div class="footer">
      <Footer />
    </div>
  </div>
</template>

<script>
import Header from '@/components/shared/Header'
import Footer from '@/components/shared/Footer'

import ZelCashService from '@/services/ZelCashService'
import zelIDService from '@/services/ZelIDService'
import Vue from 'vue'

const qs = require('qs')
const config = require('../../../config/default')
const userconfig = require('../../../config/userconfig')
const vue = new Vue()

export default {
  name: 'MainPage',
  components: { Header, Footer },
  data() {
    return {
      getInfoResponse: {
        status: '',
        message: ''
      },
      getZelNodeStatusResponse: {
        status: '',
        message: '',
        zelnodeStatus: 'Checking status...'
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
      websocket: null,
      privilage: 'none', // user, admin, zelteam
      errorMessage: ''
    }
  },
  mounted() {
    this.loadSession()
    this.getZelIdLoginPhrase()
    this.zelcashGetInfo()
    this.zelcashGetZelNodeStatus()
    this.getUserConfig()
    this.apiPort = config.server.localport
    console.log(config.server.localport)
  },
  methods: {
    loadSession() {
      const zelidauth = localStorage.getItem('zelidauth')
      const auth = qs.parse(zelidauth)
      this.privilage = 'none'
      if (auth) {
        if (auth.zelid) {
          if (auth.zelid === config.zelTeamZelId) {
            this.privilage = 'zelteam'
          } else if (auth.zelid === userconfig.initial.zelid) {
            this.privilage = 'admin'
          } else if (auth.zelid.length > 24) { // very basic check that does the job needed
            this.privilage = 'user'
          }
        }
      }
    },
    async zelcashGetInfo() {
      const response = await ZelCashService.getInfo()
      this.getInfoResponse.status = response.data.status
      this.getInfoResponse.message = response.data.data
    },
    async zelcashGetZelNodeStatus() {
      // TODO
      const response = await ZelCashService.getZelNodeStatus()
      this.getZelNodeStatusResponse.status = response.data.status
      this.getZelNodeStatusResponse.message = response.data.data
      console.log(this.getZelNodeStatusResponse.message)
      if (this.getZelNodeStatusResponse.message) {
        if (this.getZelNodeStatusResponse.message.status === 4) {
          this.getZelNodeStatusResponse.zelnodeStatus = 'ZelNode is working correctly'
        } else {
          const statusCode = this.getZelNodeStatusResponse.message.code || this.getZelNodeStatusResponse.message.status
          this.getZelNodeStatusResponse.zelnodeStatus = `Error status code: ${statusCode}. ZelNode not yet active. Flux is running with limited capabilities.`
        }
      }
    },
    getUserConfig() {
      this.zelid = userconfig.initial.zelid
      this.externalip = userconfig.initial.ipaddress
    },
    getZelIdLoginPhrase() {
      zelIDService.loginPhrase()
        .then(response => {
          console.log(response)
          if (response.data.status === 'error') {
            this.errorMessage = response.data.data.message
          } else {
            this.loginPhrase = response.data
            this.loginForm.message = response.data
          }
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
            this.privilage = response.data.data.privilage
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
    logoutCurrentSession() {
      const zelidauth = localStorage.getItem('zelidauth')
      const auth = qs.parse(zelidauth)
      console.log(auth)
      zelIDService.logoutCurrentSession(zelidauth)
        .then(response => {
          console.log(response)
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message)
          } else {
            localStorage.removeItem('zelidauth')
            this.privilage = 'none'
            vue.$message.success(response.data.data.message)
          }
        })
        .catch(e => {
          console.log(e)
          vue.$message.error(e.toString())
        })
    },
    logoutAllSessions() {
      const zelidauth = localStorage.getItem('zelidauth')
      const auth = qs.parse(zelidauth)
      console.log(auth)
      zelIDService.logoutAllSessions(zelidauth)
        .then(response => {
          console.log(response)
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message)
          } else {
            localStorage.removeItem('zelidauth')
            this.privilage = 'none'
            vue.$message.success(response.data.data.message)
          }
        })
        .catch(e => {
          console.log(e)
          vue.$message.error(e.toString())
        })
    },
    logOutAllUsers() {
      const zelidauth = localStorage.getItem('zelidauth')
      const auth = qs.parse(zelidauth)
      console.log(auth)
      zelIDService.logoutAllUsers(zelidauth)
        .then(response => {
          console.log(response)
          if (response.data.status === 'error') {
            vue.$message.error(response.data.data.message)
          } else {
            localStorage.removeItem('zelidauth')
            this.privilage = 'none'
            vue.$message.success(response.data.data.message)
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
        this.privilage = data.data.privilage
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
