<template>
  <div class="footer-grid">
    <div class="footer-left">
      <!--<span class="helper"></span>
      <img src="@/assets/img/ZelNodes.svg">-->
    </div>
    <div class="footer-middle">
      <ElLink
        type="primary"
        href="https://github.com/zelcash/zelnoded"
        target="_blank"
      >Your freedom empowered</ElLink>
    </div>
    <div class="footer-right">
      Flux {{ 'v' + version}}
    </div>
  </div>
</template>

<script>
const packageJson = require('../../../../package.json')

export default {
  name: 'Footer',
  data() {
    return {
      version: packageJson.version
    }
  }
}
</script>
