<template>
  <div />
</template>

<script>

const qs = require('qs')

export default {
  data() {
    return {
      zelid: '',
    }
  },
  mounted() {
    const zelidauth = localStorage.getItem('zelidauth')
    const auth = qs.parse(zelidauth)
    console.log(auth)
    this.zelid = auth.zelid
  },
}
</script>

<style scoped>

</style>
