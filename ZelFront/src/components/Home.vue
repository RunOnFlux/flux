<template>
  <div>
    <img src="@/assets/ZelNodes.svg">
    <h1>{{ defaultResponse.status }}</h1>
    <h1>Node owner Zel ID: {{ zelid }}</h1>
    <h1>{{ defaultResponse.message }}</h1>

    <a :href="'zel:?action=sign&message=' + loginPhrase + '&icon=http%3A%2F%2Fzelid.io%2Fimg%2FzelID.svg&callback=http%3A%2F%2F' + externalip + ':' + apiPort + '%2Fzelid%2Fverifylogin%2F'">
      <img src="@/assets//zelID.svg" />
    </a>

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
      </div>
    </div>
  </div>
</template>

<script>
import DefaultService from '@/services/DefaultService'
import zelIDService from '@/services/ZelIDService'

const config = require('../../../config/default')
const userconfig = require('../../../config/userconfig')

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
      }
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
        })
    },
    login() {
      console.log(this.loginForm)
      zelIDService.verifyLogin(this.loginForm)
        .then(response => {
          console.log(response)
        })
        .catch(e => {
          console.log(e)
        })
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
