<template>
  <div>
    <div
      :class="managedApplication ? 'd-none' : ''"
    >
      <b-tabs>
        <b-tab
          active
          title="Running"
        >
          <b-overlay
            :show="tableconfig.running.loading"
            variant="transparent"
            blur="5px"
          >
            <b-card>
              <b-row>
                <b-col cols="12">
                  <b-table
                    class="apps-running-table"
                    striped
                    hover
                    responsive
                    :items="tableconfig.running.apps"
                    :fields="isLoggedIn() ? tableconfig.running.loggedInFields : tableconfig.running.fields"
                    show-empty
                    empty-text="No Flux Apps running"
                  >
                    <template #cell(Names)="row">
                      {{ row.item.Names[0].startsWith('/flux') ? row.item.Names[0].substr(5, row.item.Names[0].length) : row.item.Names[0].substr(4, row.item.Names[0].length) }}
                    </template>
                    <template #cell(visit)="row">
                      <b-button
                        size="sm"
                        class="mr-0"
                        variant="danger"
                        @click="openApp(row.item.Names[0].startsWith('/flux') ? row.item.Names[0].substr(5, row.item.Names[0].length) : row.item.Names[0].substr(4, row.item.Names[0].length))"
                      >
                        Visit
                      </b-button>
                    </template>
                    <template #cell(actions)="row">
                      <b-button
                        :id="`stop-running-app-${row.item.Names[0]}`"
                        size="sm"
                        class="mr-0"
                        variant="danger"
                      >
                        Stop
                      </b-button>
                      <confirm-dialog
                        :target="`stop-running-app-${row.item.Names[0]}`"
                        confirm-button="Stop App"
                        @confirm="stopAll(row.item.Names[0].substr(1, row.item.Names[0].length))"
                      />
                    </template>
                  </b-table>
                </b-col>
              </b-row>
            </b-card>
          </b-overlay>
        </b-tab>
        <b-tab
          title="Installed"
        >
          <b-overlay
            :show="tableconfig.installed.loading"
            variant="transparent"
            blur="5px"
          >
            <b-card>
              <b-row>
                <b-col cols="12">
                  <b-table
                    class="apps-installed-table"
                    striped
                    hover
                    responsive
                    :items="tableconfig.installed.apps"
                    :fields="isLoggedIn() ? tableconfig.installed.loggedInFields : tableconfig.installed.fields"
                    show-empty
                    empty-text="No Flux Apps installed"
                  >
                    <template #cell(Name)="row">
                      {{ getAppName(row.item.name) }}
                    </template>
                    <template #cell(ports)="row">
                      {{ row.item.port || row.item.ports.toString() }}
                    </template>
                    <template #cell(cpu)="row">
                      {{ resolveCpu(row.item) }}
                    </template>
                    <template #cell(ram)="row">
                      {{ resolveRam(row.item) }}
                    </template>
                    <template #cell(hdd)="row">
                      {{ resolveHdd(row.item) }}
                    </template>
                    <template #cell(actions)="row">
                      <b-button
                        :id="`start-installed-app-${row.item.name}`"
                        size="sm"
                        class="mr-1"
                        variant="danger"
                      >
                        Start
                      </b-button>
                      <confirm-dialog
                        :target="`start-installed-app-${row.item.name}`"
                        confirm-button="Start App"
                        @confirm="startApp(row.item.name)"
                      />
                      <b-button
                        :id="`restart-installed-app-${row.item.name}`"
                        size="sm"
                        class="mr-0"
                        variant="danger"
                      >
                        Restart
                      </b-button>
                      <confirm-dialog
                        :target="`restart-installed-app-${row.item.name}`"
                        confirm-button="Restart App"
                        @confirm="restartApp(row.item.name)"
                      />
                    </template>
                    <template #cell(remove)="row">
                      <b-button
                        :id="`remove-installed-app-${row.item.name}`"
                        size="sm"
                        class="mr-0"
                        variant="danger"
                      >
                        Remove
                      </b-button>
                      <confirm-dialog
                        :target="`remove-installed-app-${row.item.name}`"
                        confirm-button="Remove App"
                        @confirm="removeApp(row.item.name)"
                      />
                    </template>
                    <template #cell(manage)="row">
                      <b-button
                        :id="`manage-installed-app-${row.item.name}`"
                        size="sm"
                        class="mr-0"
                        variant="danger"
                      >
                        Manage
                      </b-button>
                      <confirm-dialog
                        :target="`manage-installed-app-${row.item.name}`"
                        confirm-button="Manage App"
                        @confirm="openAppManagement(row.item.name)"
                      />
                    </template>
                  </b-table>
                </b-col>
              </b-row>
            </b-card>
          </b-overlay>
        </b-tab>
        <b-tab
          title="Available"
        >
          <b-overlay
            :show="tableconfig.available.loading"
            variant="transparent"
            blur="5px"
          >
            <b-card>
              <b-row>
                <b-col cols="12">
                  <b-table
                    class="apps-available-table"
                    striped
                    hover
                    responsive
                    :items="tableconfig.available.apps"
                    :fields="isLoggedIn() ? tableconfig.available.loggedInFields : tableconfig.available.fields"
                    show-empty
                    empty-text="No Flux Apps available"
                  >
                    <template #cell(show_details)="row">
                      <a @click="showLocations(row, tableconfig.available.apps)">
                        <v-icon
                          v-if="!row.detailsShowing"
                          name="chevron-down"
                        />
                        <v-icon
                          v-if="row.detailsShowing"
                          name="chevron-up"
                        />
                      </a>
                    </template>
                    <template #row-details="row">
                      <b-card class="mx-2">
                        <list-entry
                          v-if="row.item.description"
                          title="Description"
                          :data="row.item.description"
                        />
                        <list-entry
                          v-if="row.item.owner"
                          title="Owner"
                          :data="row.item.owner"
                        />
                        <list-entry
                          v-if="row.item.hash"
                          title="Hash"
                          :data="row.item.hash"
                        />
                        <h4>Locations</h4>
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
                                v-model="appLocationOptions.perPage"
                                size="sm"
                                :options="appLocationOptions.pageOptions"
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
                                  v-model="appLocationOptions.filter"
                                  type="search"
                                  placeholder="Type to Search"
                                />
                                <b-input-group-append>
                                  <b-button
                                    :disabled="!appLocationOptions.filter"
                                    @click="appLocationOptions.filter = ''"
                                  >
                                    Clear
                                  </b-button>
                                </b-input-group-append>
                              </b-input-group>
                            </b-form-group>
                          </b-col>

                          <b-col cols="12">
                            <b-table
                              class="locations-table"
                              striped
                              hover
                              :per-page="appLocationOptions.perPage"
                              :current-page="appLocationOptions.currentPage"
                              :items="appLocations"
                              :fields="appLocationFields"
                            >
                              <template #cell(visit)="locationRow">
                                <b-button
                                  size="sm"
                                  class="mr-0"
                                  variant="danger"
                                  @click="openApp(row.item.name, locationRow.item.ip, row.item.port || row.item.ports[0])"
                                >
                                  Visit
                                </b-button>
                              </template>
                            </b-table>
                          </b-col>
                          <b-col cols="12">
                            <b-pagination
                              v-model="appLocationOptions.currentPage"
                              :total-rows="appLocationOptions.totalRows"
                              :per-page="appLocationOptions.perPage"
                              align="center"
                              size="sm"
                              class="my-0"
                            />
                            <span class="table-total">Total: {{ appLocationOptions.totalRows }}</span>
                          </b-col>
                        </b-row>
                      </b-card>
                    </template>
                    <template #cell(Name)="row">
                      {{ getAppName(row.item.name) }}
                    </template>
                    <template #cell(ports)="row">
                      {{ row.item.port || row.item.ports.toString() }}
                    </template>
                    <template #cell(cpu)="row">
                      {{ resolveCpu(row.item) }}
                    </template>
                    <template #cell(ram)="row">
                      {{ resolveRam(row.item) }}
                    </template>
                    <template #cell(hdd)="row">
                      {{ resolveHdd(row.item) }}
                    </template>
                    <template #cell(install)="row">
                      <b-button
                        :id="`install-app-${row.item.name}`"
                        size="sm"
                        class="mr-0"
                        variant="danger"
                      >
                        Install
                      </b-button>
                      <confirm-dialog
                        :target="`install-app-${row.item.name}`"
                        confirm-button="Install App"
                        @confirm="installTemporaryLocalApp(row.item.name)"
                      />
                    </template>
                  </b-table>
                </b-col>
              </b-row>
            </b-card>
          </b-overlay>
        </b-tab>
        <b-tab
          title="My Local Apps"
        >
          <b-overlay
            :show="tableconfig.installed.loading"
            variant="transparent"
            blur="5px"
          >
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
                      v-model="tableconfig.local.perPage"
                      size="sm"
                      :options="tableconfig.local.pageOptions"
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
                        v-model="tableconfig.local.filter"
                        type="search"
                        placeholder="Type to Search"
                      />
                      <b-input-group-append>
                        <b-button
                          :disabled="!tableconfig.local.filter"
                          @click="tableconfig.local.filter = ''"
                        >
                          Clear
                        </b-button>
                      </b-input-group-append>
                    </b-input-group>
                  </b-form-group>
                </b-col>

                <b-col cols="12">
                  <b-table
                    class="apps-local-table"
                    striped
                    hover
                    responsive
                    :per-page="tableconfig.local.perPage"
                    :current-page="tableconfig.local.currentPage"
                    :items="tableconfig.local.apps"
                    :fields="tableconfig.local.fields"
                    :sort-by.sync="tableconfig.local.sortBy"
                    :sort-desc.sync="tableconfig.local.sortDesc"
                    :sort-direction="tableconfig.local.sortDirection"
                    :filter="tableconfig.local.filter"
                    :filter-included-fields="tableconfig.local.filterOn"
                    show-empty
                    empty-text="No Local Apps owned"
                    @filtered="onFilteredLocal"
                  >
                    <template #cell(Name)="row">
                      {{ getAppName(row.item.name) }}
                    </template>
                    <template #cell(ports)="row">
                      {{ row.item.port || row.item.ports.toString() }}
                    </template>
                    <template #cell(cpu)="row">
                      {{ resolveCpu(row.item) }}
                    </template>
                    <template #cell(ram)="row">
                      {{ resolveRam(row.item) }}
                    </template>
                    <template #cell(hdd)="row">
                      {{ resolveHdd(row.item) }}
                    </template>
                    <template #cell(actions)="row">
                      <b-button
                        :id="`start-local-app-${row.item.name}`"
                        size="sm"
                        class="mr-1"
                        variant="danger"
                      >
                        Start
                      </b-button>
                      <confirm-dialog
                        :target="`start-local-app-${row.item.name}`"
                        confirm-button="Start App"
                        @confirm="startApp(row.item.name)"
                      />
                      <b-button
                        :id="`restart-local-app-${row.item.name}`"
                        size="sm"
                        class="mr-0"
                        variant="danger"
                      >
                        Restart
                      </b-button>
                      <confirm-dialog
                        :target="`restart-local-app-${row.item.name}`"
                        confirm-button="Restart App"
                        @confirm="restartApp(row.item.name)"
                      />
                    </template>
                    <template #cell(remove)="row">
                      <b-button
                        :id="`remove-local-app-${row.item.name}`"
                        size="sm"
                        class="mr-0"
                        variant="danger"
                      >
                        Remove
                      </b-button>
                      <confirm-dialog
                        :target="`remove-local-app-${row.item.name}`"
                        confirm-button="Remove App"
                        @confirm="removeApp(row.item.name)"
                      />
                    </template>
                    <template #cell(manage)="row">
                      <b-button
                        :id="`manage-installed-app-${row.item.name}`"
                        size="sm"
                        class="mr-0"
                        variant="danger"
                      >
                        Manage
                      </b-button>
                      <confirm-dialog
                        :target="`manage-installed-app-${row.item.name}`"
                        confirm-button="Manage App"
                        @confirm="openAppManagement(row.item.name)"
                      />
                    </template>
                  </b-table>
                </b-col>
                <b-col cols="12">
                  <b-pagination
                    v-model="tableconfig.local.currentPage"
                    :total-rows="tableconfig.local.totalRows"
                    :per-page="tableconfig.local.perPage"
                    align="center"
                    size="sm"
                    class="my-0"
                  />
                  <span class="table-total">Total: {{ tableconfig.local.totalRows }}</span>
                </b-col>
              </b-row>
            </b-card>
          </b-overlay>
        </b-tab>
      </b-tabs>
      <div
        v-if="output"
        class="actionCenter"
      >
        <br>
        <b-form-textarea
          plaintext
          no-resize
          :rows="output.length"
          :value="stringOutput()"
          class="mt-1"
        />
      </div>
    </div>
    <div
      v-if="managedApplication"
    >
      <management
        :app-name="managedApplication"
        :global="false"
        :installed-apps="tableconfig.installed.apps"
        @back="clearManagedApplication()"
      />
    </div>
  </div>
</template>

<script>
import {
  BTabs,
  BTab,
  BTable,
  BCol,
  BCard,
  BRow,
  BButton,
  BFormGroup,
  BFormInput,
  BFormSelect,
  BInputGroup,
  BInputGroupAppend,
  BFormTextarea,
  BOverlay,
  BPagination,
} from 'bootstrap-vue'

import Ripple from 'vue-ripple-directive'
import { mapState } from 'vuex'
import AppsService from '@/services/AppsService'
import DaemonService from '@/services/DaemonService'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'
import ConfirmDialog from '@/views/components/ConfirmDialog.vue'
import ListEntry from '@/views/components/ListEntry.vue'
import Management from '@/views/apps/Management.vue'

const store = require('store')
const timeoptions = require('@/libs/dateFormat')
const qs = require('qs')

export default {
  components: {
    BTabs,
    BTab,
    BTable,
    BCol,
    BCard,
    BRow,
    BButton,
    BFormGroup,
    BFormInput,
    BFormSelect,
    BInputGroup,
    BInputGroupAppend,
    BFormTextarea,
    BOverlay,
    BPagination,
    ConfirmDialog,
    ListEntry,
    Management,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    Ripple,
  },
  data() {
    return {
      timeoptions,
      output: '',
      managedApplication: '',
      tableconfig: {
        running: {
          apps: [],
          status: '',
          loggedInFields: [
            { key: 'Names', label: 'Name', sortable: true },
            { key: 'Image', label: 'Image', sortable: true },
            { key: 'visit', label: 'Visit' },
            { key: 'actions', label: 'Actions' },
          ],
          fields: [
            { key: 'Names', label: 'Name', sortable: true },
            { key: 'Image', label: 'Image', sortable: true },
            { key: 'visit', label: 'Visit' },
          ],
          loading: true,
        },
        installed: {
          apps: [],
          status: '',
          loggedInFields: [
            { key: 'name', label: 'Name', sortable: true },
            { key: 'ports', label: 'Port', sortable: true },
            { key: 'cpu', label: 'CPU', sortable: true },
            { key: 'ram', label: 'RAM', sortable: true },
            { key: 'hdd', label: 'HDD', sortable: true },
            { key: 'actions', label: 'Actions' },
            { key: 'remove', label: 'Remove' },
            { key: 'manage', label: 'Manage' },
          ],
          fields: [
            { key: 'name', label: 'Name', sortable: true },
            { key: 'ports', label: 'Port', sortable: true },
            { key: 'cpu', label: 'CPU', sortable: true },
            { key: 'ram', label: 'RAM', sortable: true },
            { key: 'hdd', label: 'HDD', sortable: true },
          ],
          loading: true,
        },
        available: {
          apps: [],
          status: '',
          loggedInFields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'ports', label: 'Port', sortable: true },
            { key: 'cpu', label: 'CPU', sortable: true },
            { key: 'ram', label: 'RAM', sortable: true },
            { key: 'hdd', label: 'HDD', sortable: true },
            { key: 'install', label: 'Install' },
          ],
          fields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'ports', label: 'Port', sortable: true },
            { key: 'cpu', label: 'CPU', sortable: true },
            { key: 'ram', label: 'RAM', sortable: true },
            { key: 'hdd', label: 'HDD', sortable: true },
          ],
          loading: true,
        },
        local: {
          apps: [],
          status: '',
          fields: [
            { key: 'name', label: 'Name', sortable: true },
            { key: 'ports', label: 'Port', sortable: true },
            { key: 'cpu', label: 'CPU', sortable: true },
            { key: 'ram', label: 'RAM', sortable: true },
            { key: 'hdd', label: 'HDD', sortable: true },
            { key: 'actions', label: 'Actions' },
            { key: 'remove', label: 'Remove' },
            { key: 'manage', label: 'Manage' },
          ],
          perPage: 10,
          pageOptions: [10, 25, 50, 100],
          sortBy: '',
          sortDesc: false,
          sortDirection: 'asc',
          connectedPeers: [],
          filter: '',
          filterOn: [],
          currentPage: 1,
          totalRows: 1,
        },
        instances: {
          data: [],
          fields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'ip', label: 'IP Address', sortable: true },
            { key: 'hash', label: 'Hash', sortable: true },
            { key: 'visit', label: 'Visit' },
          ],
        },
      },
      tier: '',
      appLocations: [],
      appLocationFields: [
        { key: 'ip', label: 'IP Address', sortable: true },
        { key: 'visit', label: '' },
      ],
      appLocationOptions: {
        perPage: 10,
        pageOptions: [10, 25, 50, 100],
        currentPage: 1,
        totalRows: 1,
      },
      callResponse: { // general
        status: '',
        data: '',
      },
    }
  },
  computed: {
    ...mapState('flux', [
      'config',
      'userconfig',
      'privilege',
    ]),
    isApplicationInstalledLocally() {
      if (this.tableconfig.installed.apps) {
        const installed = this.tableconfig.installed.apps.find(app => app.name === this.managedApplication)
        if (installed) {
          return true
        }
        return false
      }
      return false
    },
  },
  mounted() {
    this.getZelNodeStatus()
    this.appsGetAvailableApps()
    this.appsGetListRunningApps()
    this.appsGetInstalledApps()
  },
  methods: {
    async getZelNodeStatus() {
      const response = await DaemonService.getZelNodeStatus()
      if (response.data.status === 'success') {
        this.tier = response.data.data.tier
      }
    },
    async appsGetInstalledApps() {
      this.tableconfig.installed.loading = true
      const response = await AppsService.installedApps()
      console.log(response)
      this.tableconfig.installed.status = response.data.status
      this.tableconfig.installed.apps = response.data.data
      this.tableconfig.installed.loading = false

      const zelidauth = localStorage.getItem('zelidauth')
      const auth = qs.parse(zelidauth)
      this.tableconfig.local.apps = this.tableconfig.installed.apps.filter(app => app.owner === auth.zelid)
      this.tableconfig.local.totalRows = this.tableconfig.local.apps.length
    },
    async appsGetListRunningApps(timeout = 0) {
      this.tableconfig.running.loading = true
      const self = this
      setTimeout(async () => {
        const response = await AppsService.listRunningApps()
        console.log(response)
        self.tableconfig.running.status = response.data.status
        self.tableconfig.running.apps = response.data.data
        self.tableconfig.running.loading = false
      }, timeout)
    },
    async appsGetAvailableApps() {
      this.tableconfig.available.loading = true
      const response = await AppsService.availableApps()
      console.log(response)
      this.tableconfig.available.status = response.data.status
      this.tableconfig.available.apps = response.data.data
      this.tableconfig.available.loading = false
    },
    openApp(name, _ip, _port) {
      console.log(name, _ip, _port)
      const appInfo = this.installedApp(name)
      if (appInfo || (_port && _ip)) {
        const backendURL = store.get('backendURL') || `http://${this.userconfig.externalip}:${this.config.apiPort}`
        const ip = _ip || backendURL.split(':')[1].split('//')[1]
        const port = _port || appInfo.port || appInfo.ports[0]
        let url = `http://${ip}:${port}`
        if (name === 'KadenaChainWebNode') {
          url = `https://${ip}:${port}/chainweb/0.0/mainnet01/cut`
        }
        this.openSite(url)
      } else {
        this.showToast('danger', 'Unable to open App :(')
      }
    },
    installedApp(appName) {
      return this.tableconfig.installed.apps.find(app => app.name === appName)
    },
    openSite(url) {
      const win = window.open(url, '_blank')
      win.focus()
    },
    async stopAll(app) {
      this.output = ''
      this.showToast('warning', `Stopping ${this.getAppName(app)}`)
      const zelidauth = localStorage.getItem('zelidauth')
      const response = await AppsService.stopAll(zelidauth, app)
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data)
      } else {
        this.showToast('danger', response.data.data.message || response.data.data)
      }
      this.appsGetListRunningApps(15000)
      console.log(response)
    },
    async startApp(app) {
      this.output = ''
      this.showToast('warning', `Starting ${this.getAppName(app)}`)
      const zelidauth = localStorage.getItem('zelidauth')
      const response = await AppsService.startApp(zelidauth, app)
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data)
      } else {
        this.showToast('danger', response.data.data.message || response.data.data)
      }
      this.appsGetListRunningApps(30000)
      console.log(response)
    },
    async restartApp(app) {
      this.output = ''
      this.showToast('warning', `Restarting ${this.getAppName(app)}`)
      const zelidauth = localStorage.getItem('zelidauth')
      const response = await AppsService.restartApp(zelidauth, app)
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data)
      } else {
        this.showToast('danger', response.data.data.message || response.data.data)
      }
      this.appsGetListRunningApps(30000)
      console.log(response)
    },
    async pauseApp(app) {
      this.output = ''
      this.showToast('warning', `Pausing ${this.getAppName(app)}`)
      const zelidauth = localStorage.getItem('zelidauth')
      const response = await AppsService.pauseApp(zelidauth, app)
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data)
      } else {
        this.showToast('danger', response.data.data.message || response.data.data)
      }
      console.log(response)
    },
    async unpauseApp(app) {
      this.output = ''
      this.showToast('warning', `Unpausing ${this.getAppName(app)}`)
      const zelidauth = localStorage.getItem('zelidauth')
      const response = await AppsService.unpauseApp(zelidauth, app)
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data)
      } else {
        this.showToast('danger', response.data.data.message || response.data.data)
      }
      console.log(response)
    },
    redeployAppSoft(app) {
      this.redeployApp(app, false)
    },
    redeployAppHard(app) {
      this.redeployApp(app, true)
    },
    async redeployApp(app, force) {
      const self = this
      this.output = ''
      this.showToast('warning', `Redeploying ${this.getAppName(app)}`)
      const zelidauth = localStorage.getItem('zelidauth')
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.target.response)
          self.output = JSON.parse(`[${progressEvent.target.response.replace(/}{/g, '},{')}]`)
        },
      }
      const response = await AppsService.justAPI().get(`/apps/redeploy/${app}/${force}`, axiosConfig)
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data)
      } else {
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`)
        if (this.output[this.output.length - 1].status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data)
        } else {
          this.showToast('success', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data)
        }
      }
    },
    async removeApp(app) {
      const self = this
      this.output = ''
      this.showToast('warning', `Removing ${this.getAppName(app)}`)
      const zelidauth = localStorage.getItem('zelidauth')
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.target.response)
          self.output = JSON.parse(`[${progressEvent.target.response.replace(/}{/g, '},{')}]`)
        },
      }
      const response = await AppsService.justAPI().get(`/apps/appremove/${app}`, axiosConfig)
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data)
      } else {
        this.appsGetInstalledApps()
        this.appsGetListRunningApps()
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`)
        if (this.output[this.output.length - 1].status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data)
        } else {
          this.showToast('success', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data)
        }
        setTimeout(() => {
          self.managedApplication = ''
        }, 5000)
      }
    },
    async installTemporaryLocalApp(app) { // todo rewrite to installApp later
      const appName = app
      const self = this
      this.output = ''
      this.showToast('warning', `Installing ${this.getAppName(app)}`)
      const zelidauth = localStorage.getItem('zelidauth')
      // const response = await AppsService.installTemporaryLocalApp(zelidauth, app);
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.target.response)
          self.output = JSON.parse(`[${progressEvent.target.response.replace(/}{/g, '},{')}]`)
        },
      }
      const response = await AppsService.justAPI().get(`/apps/installtemporarylocalapp/${appName}`, axiosConfig)
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data)
      } else {
        console.log(response)
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`)
        console.log(this.output)
        for (let i = 0; i < this.output.length; i += 1) {
          if (this.output[i] && this.output[i].data && this.output[i].data.message && this.output[i].data.message.includes('Error occured')) {
            // error is defined one line above
            if (this.output[i - 1] && this.output[i - 1].data) {
              this.showToast('danger', this.output[i - 1].data.message || this.output[i - 1].data)
              return
            }
          }
        }
        if (this.output[this.output.length - 1].status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data)
        } else {
          this.showToast('success', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data)
        }
        this.appsGetInstalledApps()
        this.appsGetListRunningApps()
      }
    },
    resolveCpu(app) {
      console.log(this.tier)
      if (this.tier === 'BASIC' || this.tier === 'CUMULUS') {
        return (`${app.cpubasic || app.cpu} cores`)
      }
      if (this.tier === 'SUPER' || this.tier === 'NIMBUS') {
        return (`${app.cpusuper || app.cpu} cores`)
      }
      if (this.tier === 'BAMF' || this.tier === 'STRATUS') {
        return (`${app.cpubamf || app.cpu} cores`)
      }
      return (`${app.cpu} cores`)
    },
    resolveRam(app) {
      if (this.tier === 'BASIC' || this.tier === 'CUMULUS') {
        return (`${app.rambasic || app.ram} MB`)
      }
      if (this.tier === 'SUPER' || this.tier === 'NIMBUS') {
        return (`${app.ramsuper || app.ram} MB`)
      }
      if (this.tier === 'BAMF' || this.tier === 'STRATUS') {
        return (`${app.rambamf || app.ram} MB`)
      }
      return (`${app.ram} MB`)
    },
    resolveHdd(app) {
      if (this.tier === 'BASIC' || this.tier === 'CUMULUS') {
        return (`${app.hddbasic || app.hdd} GB`)
      }
      if (this.tier === 'SUPER' || this.tier === 'NIMBUS') {
        return (`${app.hddsuper || app.hdd} GB`)
      }
      if (this.tier === 'BAMF' || this.tier === 'STRATUS') {
        return (`${app.hddbamf || app.hdd} GB`)
      }
      return (`${app.hdd} GB`)
    },
    getAppName(appName) {
      // this id is used for volumes, docker names so we know it reall belongs to flux
      if (appName && appName.startsWith('zel')) {
        return appName.substr(3, appName.length)
      }
      if (appName && appName.startsWith('flux')) {
        return appName.substr(4, appName.length)
      }
      return appName
    },
    isLoggedIn() {
      return (this.privilege === 'fluxteam' || this.privilege === 'admin')
    },
    showLocations(row, items) {
      if (row.detailsShowing) {
        row.toggleDetails()
      } else {
        items.forEach(item => {
          this.$set(item, '_showDetails', false)
        })
        this.$nextTick(() => {
          row.toggleDetails()
          this.loadLocations(row)
        })
      }
    },
    async loadLocations(row) {
      console.log(row)
      this.appLocations = []
      const response = await AppsService.getAppLocation(row.item.name).catch(error => {
        this.showToast('danger', error.message || error)
      })
      console.log(response)
      if (response.data.status === 'success') {
        const appLocations = response.data.data
        this.appLocations = appLocations
        this.appLocationOptions.totalRows = this.appLocations.length
      }
    },
    openAppManagement(appName) {
      this.managedApplication = appName
    },
    clearManagedApplication() {
      this.managedApplication = ''
      this.appsGetInstalledApps()
      this.appsGetListRunningApps()
    },
    onFilteredLocal(filteredItems) {
      // Trigger pagination to update the number of buttons/pages due to filtering
      this.tableconfig.local.totalRows = filteredItems.length
      this.tableconfig.local.currentPage = 1
    },
    stringOutput() {
      let string = ''
      this.output.forEach(output => {
        string += `${JSON.stringify(output)}\r\n`
      })
      return string
    },
    showToast(variant, title, icon = 'InfoIcon') {
      this.$toast({
        component: ToastificationContent,
        props: {
          title,
          icon,
          variant,
        },
      })
    },
  },
}
</script>

<style>
.apps-available-table td:nth-child(1) {
  padding: 0 0 0 5px;
}
.apps-available-table th:nth-child(1) {
  padding: 0 0 0 5px;
}
.locations-table td:nth-child(1) {
  width: 105px;
}
.locations-table th:nth-child(1) {
  width: 105px;
}
</style>
