<template>
  <div>
    <img src="@/assets/ZelNodes.svg">
    <h1>{{ defaultResponse.status }}</h1>
    <h1>Node owner Zel ID: {{ zelid }}</h1>
    <h1>{{ defaultResponse.message }}</h1>
  </div>
</template>

<script>
import DefaultService from '@/services/DefaultService'

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
      zelid: ''
    }
  },
  mounted() {
    this.getDefault()
    console.log(config.server.localport)
  },
  methods: {
    async getDefault() {
      const response = await DefaultService.fetchDefault()
      this.defaultResponse.status = response.data.status
      this.defaultResponse.message = response.data.data
    },
    getUserConfig() {
      this.zelid = userconfig.init.zelid
    }
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
h1 {
  font-weight: normal;
}
</style>
