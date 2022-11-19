import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
const path = require("path");
export default defineConfig({
  plugins: [vue({
    template: {
      compilerOptions: {
        compatConfig: {
          MODE: 3
        }
      }
    },
  })],
  optimizeDeps: {
    include: [
      'ZelBack/config/default',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './HomeUI/src/'),
      '@axios': path.resolve(__dirname, './HomeUI/src/libs/axios'),
      '@core': path.resolve(__dirname, './HomeUI/src/@core'),
      '@themeConfig': path.resolve(__dirname, './HomeUI/themeConfig.js'),
      '@validations': path.resolve(__dirname, './HomeUI/src/@core/utils/validations/validations.js'),
      ZelBack: path.resolve(__dirname, './ZelBack'),
      Config: path.resolve(__dirname, './config'),
      vue: '@vue/compat'
    },
  },
})
