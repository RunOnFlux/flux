<template>
  <b-img
    :src="skin === 'dark' ? appLogoImageDark : appLogoImage"
    alt="logo"
  />
</template>

<script>
import { BImg } from 'bootstrap-vue'
import useAppConfig from '@core/app-config/useAppConfig'
import { $themeConfig } from '@themeConfig'

export default {
  components: {
    BImg,
  },
  setup() {
    const { skin } = useAppConfig()

    // App Name
    const { appName, appLogoImageDark, appLogoImage } = $themeConfig.app

    return {
      // Skin
      skin,

      // App Name
      appName,
      appLogoImage,
      appLogoImageDark,
    }
  },
}
</script>

<style>
</style>
