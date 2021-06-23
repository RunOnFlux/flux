<template>
  <div>
    <h6 class="mb-1">
      Click the 'Download File' button to download the log. This may take a few minutes depending on file size.
    </h6>
    <h6 class="mb-1">
      Click the 'Show File' button to view the last 100 lines of the log file.
    </h6>
    <b-row>
      <b-col
        v-for="logType in logTypes"
        :key="logType"
      >
        <b-card :title="`${capitalizeWord(logType)} File`">
          <div>
            <b-button
              :id="`start-download-${logType}`"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="outline-primary"
              size="md"
              block
              class="mr-1"
            >
              Download File
            </b-button>
            <b-card-text
              v-if="total[logType] && downloaded[logType]"
              class="mt-1 mb-0"
            >
              {{ (downloaded[logType] / 1e6).toFixed(2) + " / " + (total[logType] / 1e6).toFixed(2) }} MB - {{ ((downloaded[logType] / total[logType]) * 100).toFixed(2) + "%" }}
            </b-card-text>
            <b-popover
              ref="popover"
              :target="`start-download-${logType}`"
              triggers="click"
              :show.sync="downloadPopoverShow[logType]"
              placement="auto"
              container="my-container"
            >
              <template v-slot:title>
                <div class="d-flex justify-content-between align-items-center">
                  <span>Are You Sure?</span>
                  <b-button
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    class="close"
                    variant="transparent"
                    aria-label="Close"
                    @click="onDownloadClose(logType)"
                  >
                    <span
                      class="d-inline-block text-white"
                      aria-hidden="true"
                    >&times;</span>
                  </b-button>
                </div>
              </template>

              <div>
                <b-button
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  size="sm"
                  variant="danger"
                  class="mr-1"
                  @click="onDownloadClose(logType)"
                >
                  Cancel
                </b-button>
                <b-button
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  size="sm"
                  variant="primary"
                  @click="onDownloadOk(logType)"
                >
                  Download {{ capitalizeWord(logType) }}
                </b-button>
              </div>
            </b-popover>
            <b-button
              :id="`start-tail-${logType}`"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="outline-primary"
              size="md"
              block
              class="mr-1 mt-1"
            >
              Show File
            </b-button>
            <b-popover
              ref="popover"
              :target="`start-tail-${logType}`"
              triggers="click"
              :show.sync="tailPopoverShow[logType]"
              placement="auto"
              container="my-container"
            >
              <template v-slot:title>
                <div class="d-flex justify-content-between align-items-center">
                  <span>Are You Sure?</span>
                  <b-button
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    class="close"
                    variant="transparent"
                    aria-label="Close"
                    @click="onTailClose(logType)"
                  >
                    <span
                      class="d-inline-block text-white"
                      aria-hidden="true"
                    >&times;</span>
                  </b-button>
                </div>
              </template>

              <div>
                <b-button
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  size="sm"
                  variant="danger"
                  class="mr-1"
                  @click="onTailClose(logType)"
                >
                  Cancel
                </b-button>
                <b-button
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  size="sm"
                  variant="primary"
                  @click="onTailOk(logType)"
                >
                  Show {{ capitalizeWord(logType) }}
                </b-button>
              </div>
            </b-popover>
          </div>
        </b-card>
      </b-col>
    </b-row>
    <b-card
      v-if="callResponse.data.message"
    >
      <b-form-textarea
        plaintext
        no-resize
        rows="30"
        :value="callResponse.data.message"
        class="mt-1"
      />
    </b-card>
  </div>
</template>

<script>
import {
  BCard,
  BButton,
  BPopover,
  BFormTextarea,
  BCardText,
  BCol,
  BRow,
} from 'bootstrap-vue'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'
import Ripple from 'vue-ripple-directive'
import axios from 'axios'
import FluxService from '@/services/FluxService'

export default {
  components: {
    BCard,
    BCol,
    BRow,
    BButton,
    BPopover,
    BFormTextarea,
    BCardText,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    Ripple,
  },
  data() {
    return {
      downloadPopoverShow: {},
      tailPopoverShow: {},
      abortToken: {},
      downloaded: {},
      total: {},
      callResponse: {
        status: '',
        data: {},
      },
      logTypes: ['error', 'warn', 'info', 'debug'],
    }
  },
  computed: {
    fluxLogTail() {
      if (this.callResponse.data.message) {
        return this.callResponse.data.message.split('\n').reverse().filter(el => el !== '').join('\n')
      }
      return this.callResponse.data
    },
  },
  methods: {
    cancelDownload(logType) {
      this.abortToken.cancel('User download cancelled')
      this.downloaded[logType] = ''
      this.total[logType] = ''
    },
    onDownloadClose(logType) {
      this.downloadPopoverShow[logType] = false
    },
    async onDownloadOk(logType) {
      const self = this
      if (self.abortToken[logType]) {
        self.abortToken[logType].cancel()
      }
      this.downloadPopoverShow[logType] = false
      const sourceCancelToken = axios.CancelToken
      const cancelToken = sourceCancelToken.source()
      this.abortToken[logType] = cancelToken

      const zelidauth = localStorage.getItem('zelidauth')
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        responseType: 'blob',
        onDownloadProgress(progressEvent) {
          self.downloaded[logType] = progressEvent.loaded
          self.total[logType] = progressEvent.total
          self.$forceUpdate()
        },
        cancelToken: self.abortToken[logType].token,
      }
      const response = await FluxService.justAPI().get(`/flux/${logType}log`, axiosConfig)
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `${logType}.log`)
      document.body.appendChild(link)
      link.click()
    },
    onTailClose(logType) {
      this.tailPopoverShow[logType] = false
    },
    async onTailOk(logType) {
      this.tailPopoverShow[logType] = false
      const zelidauth = localStorage.getItem('zelidauth')
      FluxService.tailFluxLog(logType, zelidauth)
        .then(response => {
          if (response.data.status === 'error') {
            this.$toast({
              component: ToastificationContent,
              props: {
                title: response.data.data.message || response.data.data,
                icon: 'InfoIcon',
                variant: 'danger',
              },
            })
          } else {
            this.callResponse.status = response.data.status
            this.callResponse.data = response.data.data
          }
        })
        .catch(error => {
          this.$toast({
            component: ToastificationContent,
            props: {
              title: `Error while trying to get latest ${logType} log`,
              icon: 'InfoIcon',
              variant: 'danger',
            },
          })
          console.log(error)
        })
    },
    capitalizeWord(word) {
      return word[0].toUpperCase() + word.substr(1)
    },
  },
}
</script>

<style>

</style>
