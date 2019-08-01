<template>
  <div class="hello">
    <h1>{{ defaultResponse.status }}</h1>
    <h1>{{ defaultResponse.message }}</h1>
  </div>
</template>

<script>
import DefaultService from '@/services/DefaultService'

const config = require('../../../config/default')

export default {
  name: 'Home',
  data() {
    return {
      defaultResponse: {
        status: '',
        message: ''
      }
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
    }
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
h1,
h2 {
  font-weight: normal;
}

a {
  color: #42b983;
}
</style>
