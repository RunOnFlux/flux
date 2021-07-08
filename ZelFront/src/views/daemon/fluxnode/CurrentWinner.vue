<template>
  <b-card title="Current FluxNode winners that will be paid in the next Flux block">
    <app-collapse>
      <app-collapse-item
        v-for="(item, key) in callResponse.data"
        :key="key"
        :title="toPascalCase(key)"
      >
        <list-entry
          title="Address"
          :data="callResponse.data[key].payment_address"
        />
        <list-entry
          title="IP Address"
          :data="callResponse.data[key].ip"
        />
        <list-entry
          title="Added Height"
          :number="callResponse.data[key].added_height"
        />
        <list-entry
          title="Collateral"
          :data="callResponse.data[key].collateral"
        />
        <list-entry
          title="Last Paid Height"
          :number="callResponse.data[key].last_paid_height"
        />
        <list-entry
          title="Confirmed Height"
          :number="callResponse.data[key].confirmed_height"
        />
        <list-entry
          title="Last Confirmed Height"
          :number="callResponse.data[key].last_confirmed_height"
        />
      </app-collapse-item>
    </app-collapse>
  </b-card>
</template>

<script>
import {
  BCard,
} from 'bootstrap-vue'
import ListEntry from '@/views/components/ListEntry.vue'
import DaemonService from '@/services/DaemonService'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'
import AppCollapse from '@core/components/app-collapse/AppCollapse.vue'
import AppCollapseItem from '@core/components/app-collapse/AppCollapseItem.vue'

export default {
  components: {
    BCard,
    ListEntry,
    AppCollapse,
    AppCollapseItem,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  data() {
    return {
      callResponse: {
        status: '',
        data: '',
      },
    }
  },
  mounted() {
    this.daemonFluxCurrentWinner()
  },
  methods: {
    async daemonFluxCurrentWinner() {
      const response = await DaemonService.fluxCurrentWinner()
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
        console.log(response)
      }
    },
    toPascalCase(str) {
      const arr = str.split(/\s|_/)
      let i
      let l
      for (i = 0, l = arr.length; i < l; i += 1) {
        arr[i] = arr[i].substr(0, 1).toUpperCase()
                 + (arr[i].length > 1 ? arr[i].substr(1).toLowerCase() : '')
      }
      return arr.join(' ')
    },
  },
}
</script>

<style>
.fluxnode-table td:nth-child(1) {
  padding: 0 0 0 5px;
}
.fluxnode-table th:nth-child(1) {
  padding: 0 0 0 5px;
}
</style>
