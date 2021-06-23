<template>
  <b-card>
    <b-row>
      <b-col
        md="4"
        sm="4"
        class="my-1"
      >
        <b-form-group class="mb-0">
          <label class="d-inline-block text-left mr-50">Per page</label>
          <b-form-select
            id="perPageSelect"
            v-model="perPage"
            size="sm"
            :options="pageOptions"
            class="w-50"
          />
        </b-form-group>
      </b-col>
      <b-col
        md="8"
        class="my-1"
      >
        <b-form-group
          label="Filter"
          label-cols-sm="1"
          label-align-sm="right"
          label-for="filterInput"
          class="mb-0"
        >
          <b-input-group size="sm">
            <b-form-input
              id="filterInput"
              v-model="filter"
              type="search"
              placeholder="Type to Search"
            />
            <b-input-group-append>
              <b-button
                :disabled="!filter"
                @click="filter = ''"
              >
                Clear
              </b-button>
            </b-input-group-append>
          </b-input-group>
        </b-form-group>
      </b-col>

      <b-col cols="12">
        <b-table
          striped
          hover
          responsive
          small
          :per-page="perPage"
          :current-page="currentPage"
          :items="items"
          :fields="fields"
          :sort-by.sync="sortBy"
          :sort-desc.sync="sortDesc"
          :sort-direction="sortDirection"
          :filter="filter"
          :filter-included-fields="filterOn"
          show-empty
          empty-text="No Sessions"
          @filtered="onFiltered"
        >
          <template #cell(logout)="row">
            <v-icon
              v-b-tooltip.hover.top="'Currently logged and used session by you'"
              name="info-circle"
              class="mr-1"
              :class="row.item.loginPhrase === currentLoginPhrase ? '' : 'hidden'"
            />
            <b-button
              :id="`${row.item.loginPhrase}`"
              size="sm"
              class="mr-0"
              variant="danger"
              @click="logoutPopoverShow[row.item.loginPhrase] = true"
            >
              Log Out
            </b-button>
            <b-popover
              ref="popover"
              :target="`${row.item.loginPhrase}`"
              triggers="click"
              :show.sync="logoutPopoverShow[row.item.loginPhrase]"
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
                    @click="onLogoutClose(row.item)"
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
                  @click="onLogoutClose(row.item)"
                >
                  Cancel
                </b-button>
                <b-button
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  size="sm"
                  variant="primary"
                  @click="onLogoutOK(row.item)"
                >
                  Log Out!
                </b-button>
              </div>
            </b-popover>
          </template>
        </b-table>
      </b-col>

      <b-col cols="12">
        <b-pagination
          v-model="currentPage"
          :total-rows="totalRows"
          :per-page="perPage"
          align="center"
          size="sm"
          class="my-0"
        />
      </b-col>
    </b-row>
    <div class="text-center">
      <b-button
        id="logout-all"
        size="sm"
        class="mt-2"
        variant="danger"
        @click="logoutAllPopoverShow = true"
      >
        Logout all sessions
      </b-button>
      <b-popover
        ref="popover"
        target="logout-all"
        triggers="click"
        :show.sync="logoutAllPopoverShow"
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
              @click="onLogoutAllClose()"
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
            @click="onLogoutAllClose()"
          >
            Cancel
          </b-button>
          <b-button
            v-ripple.400="'rgba(255, 255, 255, 0.15)'"
            size="sm"
            variant="primary"
            @click="onLogoutAllOK()"
          >
            Log Out All!
          </b-button>
        </div>
      </b-popover>
    </div>
  </b-card>
</template>

<script>
import {
  BCard,
  BTable,
  BRow,
  BCol,
  BFormGroup,
  BFormSelect,
  BPagination,
  BInputGroup,
  BFormInput,
  BInputGroupAppend,
  BButton,
  VBTooltip,
  BPopover,
} from 'bootstrap-vue'
import IDService from '@/services/IDService'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'
import Ripple from 'vue-ripple-directive'

const qs = require('qs')

export default {
  components: {
    BCard,
    BTable,
    BRow,
    BCol,
    BPagination,
    BFormGroup,
    BFormSelect,
    BInputGroup,
    BFormInput,
    BInputGroupAppend,
    BButton,
    BPopover,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    'b-tooltip': VBTooltip,
    Ripple,
  },
  data() {
    return {
      perPage: 10,
      pageOptions: [10, 25, 50, 100],
      sortBy: '',
      sortDesc: false,
      sortDirection: 'asc',
      items: [],
      filter: '',
      filterOn: [],
      fields: [
        { key: 'zelid', label: 'ZelID', sortable: true },
        { key: 'loginPhrase', label: 'Login Phrase', sortable: true },
        { key: 'logout', label: '' },
      ],
      totalRows: 1,
      currentPage: 1,
      logoutPopoverShow: {},
      logoutAllPopoverShow: false,
    }
  },
  computed: {
    sortOptions() {
      // Create an options list from our fields
      return this.fields
        .filter(f => f.sortable)
        .map(f => ({ text: f.label, value: f.key }))
    },
    currentLoginPhrase() {
      const zelidauth = localStorage.getItem('zelidauth')
      const auth = qs.parse(zelidauth)
      console.log(auth)
      return auth.loginPhrase
    },
  },
  mounted() {
    this.loggedSessions()
  },
  methods: {
    async loggedSessions() {
      const zelidauth = localStorage.getItem('zelidauth')
      const auth = qs.parse(zelidauth)
      console.log(auth)
      IDService.loggedSessions(zelidauth)
        .then(response => {
          console.log(response)
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
            this.items = response.data.data
            this.totalRows = this.items.length
            this.currentPage = 1
          }
        })
        .catch(e => {
          console.log(e)
          this.$toast({
            component: ToastificationContent,
            props: {
              title: e.toString(),
              icon: 'InfoIcon',
              variant: 'danger',
            },
          })
        })
    },
    onFiltered(filteredItems) {
      // Trigger pagination to update the number of buttons/pages due to filtering
      this.totalRows = filteredItems.length
      this.currentPage = 1
    },
    onLogoutClose(row) {
      this.logoutPopoverShow[row.loginPhrase] = false
    },
    async onLogoutOK(row) {
      this.logoutPopoverShow[row.loginPhrase] = false
      // const self = this
      const zelidauth = localStorage.getItem('zelidauth')
      const auth = qs.parse(zelidauth)
      IDService.logoutSpecificSession(zelidauth, row.loginPhrase)
        .then(response => {
          console.log(response)
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
            this.$toast({
              component: ToastificationContent,
              props: {
                title: response.data.data.message || response.data.data,
                icon: 'InfoIcon',
                variant: 'success',
              },
            })
            if (row.loginPhrase === auth.loginPhrase) {
              localStorage.removeItem('zelidauth')
              this.$store.commit('flux/setPrivilege', 'none')
              // Navigate back to the home screen
              this.$router.replace('/')
            } else {
              this.loggedSessions()
            }
          }
        })
        .catch(e => {
          console.log(e)
          this.$toast({
            component: ToastificationContent,
            props: {
              title: e.toString(),
              icon: 'InfoIcon',
              variant: 'danger',
            },
          })
        })
    },
    onLogoutAllClose() {
      this.logoutAllPopoverShow = false
    },
    async onLogoutAllOK() {
      this.logoutAllPopoverShow = false
      const zelidauth = localStorage.getItem('zelidauth')
      IDService.logoutAllSessions(zelidauth)
        .then(response => {
          console.log(response)
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
            localStorage.removeItem('zelidauth')
            this.$store.commit('flux/setPrivilege', 'none')
            // Navigate back to the home screen
            this.$router.replace('/')
            this.$toast({
              component: ToastificationContent,
              props: {
                title: response.data.data.message || response.data.data,
                icon: 'InfoIcon',
                variant: 'success',
              },
            })
          }
        })
        .catch(e => {
          console.log(e)
          this.$toast({
            component: ToastificationContent,
            props: {
              title: e.toString(),
              icon: 'InfoIcon',
              variant: 'danger',
            },
          })
        })
    },
  },
}
</script>

<style>

</style>
