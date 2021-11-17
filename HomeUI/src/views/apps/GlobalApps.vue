<template>
  <div>
    <b-tabs
      v-if="!managedApplication"
      @activate-tab="tabChanged()"
    >
      <b-tab
        active
        title="Active Apps"
      >
        <b-overlay
          :show="tableconfig.active.loading"
          variant="transparent"
          blur="5px"
        >
          <b-card>
            <b-row>
              <b-col cols="12">
                <b-table
                  class="apps-active-table"
                  striped
                  hover
                  responsive
                  :items="tableconfig.active.apps"
                  :fields="tableconfig.active.fields"
                  show-empty
                  empty-text="No Flux Apps are active"
                >
                  <template #cell(show_details)="row">
                    <a @click="showLocations(row, tableconfig.active.apps)">
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
                        title="Description"
                        :data="row.item.description"
                      />
                      <list-entry
                        title="Owner"
                        :data="row.item.owner"
                      />
                      <list-entry
                        title="Hash"
                        :data="row.item.hash"
                      />
                      <list-entry
                        v-if="row.item.instances"
                        title="Instances"
                        :data="row.item.instances.toString()"
                      />
                      <h4>Composition</h4>
                      <div v-if="row.item.version <= 3">
                        <b-card>
                          <list-entry
                            title="Repository"
                            :data="row.item.repotag"
                          />
                          <list-entry
                            title="Custom Domains"
                            :data="row.item.domains.toString() || 'none'"
                          />
                          <list-entry
                            title="Automatic Domains"
                            :data="constructAutomaticDomains(row.item.ports, undefined, row.item.name).toString()"
                          />
                          <list-entry
                            title="Ports"
                            :data="row.item.ports.toString()"
                          />
                          <list-entry
                            title="Container Ports"
                            :data="row.item.containerPorts.toString()"
                          />
                          <list-entry
                            title="Container Data"
                            :data="row.item.containerData"
                          />
                          <list-entry
                            title="Enviroment Parameters"
                            :data="row.item.enviromentParameters.length > 0 ? row.item.enviromentParameters.toString() : 'none'"
                          />
                          <list-entry
                            title="Commands"
                            :data="row.item.commands.length > 0 ? row.item.commands.toString() : 'none'"
                          />
                          <div v-if="row.item.tiered">
                            <list-entry
                              title="CPU Cumulus"
                              :data="row.item.cpubasic + ' vCore'"
                            />
                            <list-entry
                              title="CPU Nimbus"
                              :data="row.item.cpusuper + ' vCore'"
                            />
                            <list-entry
                              title="CPU Stratus"
                              :data="row.item.cpubamf + ' vCore'"
                            />
                            <list-entry
                              title="RAM Cumulus"
                              :data="row.item.rambasic + ' MB'"
                            />
                            <list-entry
                              title="RAM Nimbus"
                              :data="row.item.ramsuper + ' MB'"
                            />
                            <list-entry
                              title="RAM Stratus"
                              :data="row.item.rambamf + ' MB'"
                            />
                            <list-entry
                              title="SSD Cumulus"
                              :data="row.item.hddbasic + ' GB'"
                            />
                            <list-entry
                              title="SSD Nimbus"
                              :data="row.item.hddsuper + ' GB'"
                            />
                            <list-entry
                              title="SSD Stratus"
                              :data="row.item.hddbamf + ' GB'"
                            />
                          </div>
                          <div v-else>
                            <list-entry
                              title="CPU"
                              :data="row.item.cpu + ' vCore'"
                            />
                            <list-entry
                              title="RAM"
                              :data="row.item.ram + ' MB'"
                            />
                            <list-entry
                              title="SSD"
                              :data="row.item.hdd + ' GB'"
                            />
                          </div>
                        </b-card>
                      </div>
                      <div v-else>
                        <b-card
                          v-for="(component, index) in row.item.compose"
                          :key="index"
                        >
                          <b-card-title>
                            Component {{ component.name }}
                          </b-card-title>
                          <list-entry
                            title="Name"
                            :data="component.name"
                          />
                          <list-entry
                            title="Description"
                            :data="component.description"
                          />
                          <list-entry
                            title="Repository"
                            :data="component.repotag"
                          />
                          <list-entry
                            title="Custom Domains"
                            :data="component.domains.toString() || 'none'"
                          />
                          <list-entry
                            title="Automatic Domains"
                            :data="constructAutomaticDomains(component.ports, component.name, row.item.name).toString()"
                          />
                          <list-entry
                            title="Ports"
                            :data="component.ports.toString()"
                          />
                          <list-entry
                            title="Container Ports"
                            :data="component.containerPorts.toString()"
                          />
                          <list-entry
                            title="Container Data"
                            :data="component.containerData"
                          />
                          <list-entry
                            title="Enviroment Parameters"
                            :data="component.enviromentParameters.length > 0 ? component.enviromentParameters.toString() : 'none'"
                          />
                          <list-entry
                            title="Commands"
                            :data="component.commands.length > 0 ? component.commands.toString() : 'none'"
                          />
                          <div v-if="component.tiered">
                            <list-entry
                              title="CPU Cumulus"
                              :data="component.cpubasic + ' vCore'"
                            />
                            <list-entry
                              title="CPU Nimbus"
                              :data="component.cpusuper + ' vCore'"
                            />
                            <list-entry
                              title="CPU Stratus"
                              :data="component.cpubamf + ' vCore'"
                            />
                            <list-entry
                              title="RAM Cumulus"
                              :data="component.rambasic + ' MB'"
                            />
                            <list-entry
                              title="RAM Nimbus"
                              :data="component.ramsuper + ' MB'"
                            />
                            <list-entry
                              title="RAM Stratus"
                              :data="component.rambamf + ' MB'"
                            />
                            <list-entry
                              title="SSD Cumulus"
                              :data="component.hddbasic + ' GB'"
                            />
                            <list-entry
                              title="SSD Nimbus"
                              :data="component.hddsuper + ' GB'"
                            />
                            <list-entry
                              title="SSD Stratus"
                              :data="component.hddbamf + ' GB'"
                            />
                          </div>
                          <div v-else>
                            <list-entry
                              title="CPU"
                              :data="component.cpu + ' vCore'"
                            />
                            <list-entry
                              title="RAM"
                              :data="component.ram + ' MB'"
                            />
                            <list-entry
                              title="SSD"
                              :data="component.hdd + ' GB'"
                            />
                          </div>
                        </b-card>
                      </div>
                      <h4>Locations</h4>
                      <b-table
                        class="locations-table"
                        striped
                        hover
                        :items="appLocations"
                        :fields="appLocationFields"
                      >
                        <template #cell(visit)="locationRow">
                          <b-button
                            size="sm"
                            class="mr-0"
                            variant="danger"
                            @click="openApp(row.item.name, locationRow.item.ip, row.item.port || (row.item.ports ? row.item.ports[0] : row.item.compose[0].ports[0]))"
                          >
                            Visit
                          </b-button>
                        </template>
                      </b-table>
                    </b-card>
                  </template>
                  <template #cell(visit)="row">
                    <b-button
                      size="sm"
                      class="mr-0"
                      variant="danger"
                      @click="openGlobalApp(row.item.name)"
                    >
                      Visit
                    </b-button>
                  </template>
                </b-table>
              </b-col>
            </b-row>
          </b-card>
        </b-overlay>
      </b-tab>
      <b-tab title="My Apps">
        <b-overlay
          :show="tableconfig.active.loading"
          variant="transparent"
          blur="5px"
        >
          <b-card>
            <b-row>
              <b-col cols="12">
                <b-table
                  class="myapps-table"
                  striped
                  hover
                  responsive
                  :items="myGlobalApps"
                  :fields="tableconfig.my.fields"
                  show-empty
                  empty-text="No Global Apps are owned"
                >
                  <template #cell(show_details)="row">
                    <a @click="showLocations(row, myGlobalApps)">
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
                        title="Description"
                        :data="row.item.description"
                      />
                      <list-entry
                        title="Owner"
                        :data="row.item.owner"
                      />
                      <list-entry
                        title="Hash"
                        :data="row.item.hash"
                      />
                      <list-entry
                        v-if="row.item.instances"
                        title="Instances"
                        :data="row.item.instances.toString()"
                      />
                      <h4>Composition</h4>
                      <div v-if="row.item.version <= 3">
                        <b-card>
                          <list-entry
                            title="Repository"
                            :data="row.item.repotag"
                          />
                          <list-entry
                            title="Custom Domains"
                            :data="row.item.domains.toString() || 'none'"
                          />
                          <list-entry
                            title="Automatic Domains"
                            :data="constructAutomaticDomains(row.item.ports, undefined, row.item.name).toString()"
                          />
                          <list-entry
                            title="Ports"
                            :data="row.item.ports.toString()"
                          />
                          <list-entry
                            title="Container Ports"
                            :data="row.item.containerPorts.toString()"
                          />
                          <list-entry
                            title="Container Data"
                            :data="row.item.containerData"
                          />
                          <list-entry
                            title="Enviroment Parameters"
                            :data="row.item.enviromentParameters.length > 0 ? row.item.enviromentParameters.toString() : 'none'"
                          />
                          <list-entry
                            title="Commands"
                            :data="row.item.commands.length > 0 ? row.item.commands.toString() : 'none'"
                          />
                          <div v-if="row.item.tiered">
                            <list-entry
                              title="CPU Cumulus"
                              :data="row.item.cpubasic + ' vCore'"
                            />
                            <list-entry
                              title="CPU Nimbus"
                              :data="row.item.cpusuper + ' vCore'"
                            />
                            <list-entry
                              title="CPU Stratus"
                              :data="row.item.cpubamf + ' vCore'"
                            />
                            <list-entry
                              title="RAM Cumulus"
                              :data="row.item.rambasic + ' MB'"
                            />
                            <list-entry
                              title="RAM Nimbus"
                              :data="row.item.ramsuper + ' MB'"
                            />
                            <list-entry
                              title="RAM Stratus"
                              :data="row.item.rambamf + ' MB'"
                            />
                            <list-entry
                              title="SSD Cumulus"
                              :data="row.item.hddbasic + ' GB'"
                            />
                            <list-entry
                              title="SSD Nimbus"
                              :data="row.item.hddsuper + ' GB'"
                            />
                            <list-entry
                              title="SSD Stratus"
                              :data="row.item.hddbamf + ' GB'"
                            />
                          </div>
                          <div v-else>
                            <list-entry
                              title="CPU"
                              :data="row.item.cpu + ' vCore'"
                            />
                            <list-entry
                              title="RAM"
                              :data="row.item.ram + ' MB'"
                            />
                            <list-entry
                              title="SSD"
                              :data="row.item.hdd + ' GB'"
                            />
                          </div>
                        </b-card>
                      </div>
                      <div v-else>
                        <b-card
                          v-for="(component, index) in row.item.compose"
                          :key="index"
                        >
                          <b-card-title>
                            Component {{ component.name }}
                          </b-card-title>
                          <list-entry
                            title="Name"
                            :data="component.name"
                          />
                          <list-entry
                            title="Description"
                            :data="component.description"
                          />
                          <list-entry
                            title="Repository"
                            :data="component.repotag"
                          />
                          <list-entry
                            title="Custom Domains"
                            :data="component.domains.toString() || 'none'"
                          />
                          <list-entry
                            title="Automatic Domains"
                            :data="constructAutomaticDomains(component.ports, component.name, row.item.name).toString()"
                          />
                          <list-entry
                            title="Ports"
                            :data="component.ports.toString()"
                          />
                          <list-entry
                            title="Container Ports"
                            :data="component.containerPorts.toString()"
                          />
                          <list-entry
                            title="Container Data"
                            :data="component.containerData"
                          />
                          <list-entry
                            title="Enviroment Parameters"
                            :data="component.enviromentParameters.length > 0 ? component.enviromentParameters.toString() : 'none'"
                          />
                          <list-entry
                            title="Commands"
                            :data="component.commands.length > 0 ? component.commands.toString() : 'none'"
                          />
                          <div v-if="component.tiered">
                            <list-entry
                              title="CPU Cumulus"
                              :data="component.cpubasic + ' vCore'"
                            />
                            <list-entry
                              title="CPU Nimbus"
                              :data="component.cpusuper + ' vCore'"
                            />
                            <list-entry
                              title="CPU Stratus"
                              :data="component.cpubamf + ' vCore'"
                            />
                            <list-entry
                              title="RAM Cumulus"
                              :data="component.rambasic + ' MB'"
                            />
                            <list-entry
                              title="RAM Nimbus"
                              :data="component.ramsuper + ' MB'"
                            />
                            <list-entry
                              title="RAM Stratus"
                              :data="component.rambamf + ' MB'"
                            />
                            <list-entry
                              title="SSD Cumulus"
                              :data="component.hddbasic + ' GB'"
                            />
                            <list-entry
                              title="SSD Nimbus"
                              :data="component.hddsuper + ' GB'"
                            />
                            <list-entry
                              title="SSD Stratus"
                              :data="component.hddbamf + ' GB'"
                            />
                          </div>
                          <div v-else>
                            <list-entry
                              title="CPU"
                              :data="component.cpu + ' vCore'"
                            />
                            <list-entry
                              title="RAM"
                              :data="component.ram + ' MB'"
                            />
                            <list-entry
                              title="SSD"
                              :data="component.hdd + ' GB'"
                            />
                          </div>
                        </b-card>
                      </div>
                      <h4>Locations</h4>
                      <b-table
                        class="locations-table"
                        striped
                        hover
                        :items="appLocations"
                        :fields="appLocationFields"
                      >
                        <template #cell(visit)="locationRow">
                          <b-button
                            size="sm"
                            class="mr-0"
                            variant="danger"
                            @click="openApp(row.item.name, locationRow.item.ip, row.item.port || (row.item.ports ? row.item.ports[0] : row.item.compose[0].ports[0]))"
                          >
                            Visit
                          </b-button>
                        </template>
                      </b-table>
                    </b-card>
                  </template>
                  <template #cell(visit)="row">
                    <b-button
                      size="sm"
                      class="mr-0"
                      variant="danger"
                      @click="openGlobalApp(row.item.name)"
                    >
                      Visit
                    </b-button>
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
    </b-tabs>
    <div v-if="managedApplication">
      <management
        :app-name="managedApplication"
        :global="true"
        :installed-apps="[]"
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
  BOverlay,
} from 'bootstrap-vue';

import Ripple from 'vue-ripple-directive';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ListEntry from '@/views/components/ListEntry.vue';
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';
import Management from '@/views/apps/Management.vue';
import AppsService from '@/services/AppsService';

const qs = require('qs');

export default {
  components: {
    BTabs,
    BTab,
    BTable,
    BCol,
    BCard,
    BRow,
    BButton,
    BOverlay,
    ListEntry,
    ConfirmDialog,
    Management,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    Ripple,
  },
  data() {
    return {
      managedApplication: '',
      appLocations: [],
      appLocationFields: [
        { key: 'ip', label: 'IP Address' },
        { key: 'visit', label: '' },
      ],
      myappLocations: [],
      myappLocationFields: [
        { key: 'ip', label: 'IP Address' },
        { key: 'visit', label: '' },
      ],
      tableconfig: {
        active: {
          apps: [],
          fields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'description', label: 'Description', sortable: true },
            { key: 'visit', label: 'Visit' },
          ],
          loading: true,
        },
        my: {
          apps: [],
          fields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'description', label: 'Description', sortable: true },
            { key: 'visit', label: 'Visit' },
            { key: 'manage', label: 'Manage' },
          ],
        },
      },
    };
  },
  computed: {
    myGlobalApps() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      if (this.tableconfig.active.apps) {
        return this.tableconfig.active.apps.filter((app) => app.owner === auth.zelid);
      }
      return [];
    },
  },
  mounted() {
    this.appsGetListGlobalApps();
  },
  methods: {
    openAppManagement(appName) {
      this.managedApplication = appName;
    },
    clearManagedApplication() {
      this.managedApplication = '';
    },
    async appsGetListGlobalApps() {
      this.tableconfig.active.loading = true;
      const response = await AppsService.globalAppSpecifications();
      console.log(response);
      this.tableconfig.active.apps = response.data.data;
      this.tableconfig.active.loading = false;
    },
    openApp(name, _ip, _port) {
      console.log(name, _ip, _port);
      if (_port && _ip) {
        const ip = _ip;
        const port = _port;
        let url = `http://${ip}:${port}`;
        if (name === 'KadenaChainWebNode') {
          url = `https://${ip}:${port}/chainweb/0.0/mainnet01/cut`;
        }
        this.openSite(url);
      } else {
        this.showToast('danger', 'Unable to open App :(');
      }
    },
    async openGlobalApp(appName) { // open through FDM
      const response = await AppsService.getAppLocation(appName).catch((error) => {
        this.showToast('danger', error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        const appLocations = response.data.data;
        const location = appLocations[0];
        if (!location) {
          this.showToast('danger', 'Application is awaiting launching...');
        } else {
          const url = `https://${appName}.app.runonflux.io`;
          this.openSite(url);
        }
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
    },
    openSite(url) {
      const win = window.open(url, '_blank');
      win.focus();
    },
    tabChanged() {
      this.tableconfig.active.apps.forEach((item) => {
        this.$set(item, '_showDetails', false);
      });
      this.appLocations = [];
    },
    showLocations(row, items) {
      if (row.detailsShowing) {
        row.toggleDetails();
      } else {
        items.forEach((item) => {
          this.$set(item, '_showDetails', false);
        });
        this.$nextTick(() => {
          row.toggleDetails();
          this.loadLocations(row);
        });
      }
    },
    async loadLocations(row) {
      console.log(row);
      this.appLocations = [];
      const response = await AppsService.getAppLocation(row.item.name).catch((error) => {
        this.showToast('danger', error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        const appLocations = response.data.data;
        this.appLocations = appLocations;
      }
    },
    showToast(variant, title, icon = 'InfoIcon') {
      this.$toast({
        component: ToastificationContent,
        props: {
          title,
          icon,
          variant,
        },
      });
    },
    constructAutomaticDomains(ports, componentName = '', appName) {
      const domainString = 'abcdefghijklmno'; // enough
      const lowerCaseName = appName.toLowerCase();
      const lowerCaseCopmonentName = componentName.toLowerCase();
      if (!lowerCaseCopmonentName) {
        const domains = [`${lowerCaseName}.app.runonflux.io`];
        // flux specs dont allow more than 10 ports so domainString is enough
        for (let i = 0; i < ports.length; i += 1) {
          const portDomain = `${domainString[i]}.${lowerCaseName}.app.runonflux.io`;
          domains.push(portDomain);
        }
        return domains;
      }
      const domains = [`${lowerCaseName}.app.runonflux.io`, `${lowerCaseCopmonentName}.${lowerCaseName}.app.runonflux.io`];
      // flux specs dont allow more than 10 ports so domainString is enough
      for (let i = 0; i < ports.length; i += 1) {
        const portDomain = `${domainString[i]}.${lowerCaseCopmonentName}.${lowerCaseName}.app.runonflux.io`;
        domains.push(portDomain);
      }
      return domains;
    },
  },
};
</script>

<style>
.apps-active-table td:nth-child(1) {
  padding: 0 0 0 5px;
}
.apps-active-table th:nth-child(1) {
  padding: 0 0 0 5px;
}
.myapps-table td:nth-child(1) {
  padding: 0 0 0 5px;
}
.myapps-table th:nth-child(1) {
  padding: 0 0 0 5px;
}
.myapps-table td:nth-child(5) {
  width: 105px;
}
.myapps-table th:nth-child(5) {
  width: 105px;
}
.myapps-table td:nth-child(6) {
  width: 105px;
}
.myapps-table th:nth-child(6) {
  width: 105px;
}
.locations-table td:nth-child(1) {
  width: 105px;
}
.locations-table th:nth-child(1) {
  width: 105px;
}
</style>
