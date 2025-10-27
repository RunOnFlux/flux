<template>
  <b-tab
    :active="activeAppsTab"
    :title="activeAppsTab ? 'My Active Apps' : 'My Expired Apps'"
  >
    <b-overlay
      :show="loading"
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
            <b-form-group
              class="mb-0"
              label="Per Page"
              label-cols-sm="auto"
              label-align-sm="left"
            >
              <b-form-select
                v-model="tableOptions.perPage"
                size="sm"
                :options="tableOptions.pageOptions"
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
              class="mb-0 mt-0"
            >
              <b-input-group size="sm">
                <b-form-input
                  v-model="tableOptions.filter"
                  type="search"
                  placeholder="Type to Search"
                />
                <b-input-group-append>
                  <b-button
                    :disabled="!tableOptions.filter"
                    @click="tableOptions.filter = ''"
                  >
                    Clear
                  </b-button>
                </b-input-group-append>
              </b-input-group>
            </b-form-group>
          </b-col>
        </b-row>
        <b-row>
          <b-col cols="12">
            <b-table
              class="myapps-table"
              striped
              outlined
              responsive
              :items="apps"
              :fields="mergedFields"
              :sort-by.sync="tableOptions.sortBy"
              :sort-desc.sync="tableOptions.sortDesc"
              :sort-direction="tableOptions.sortDirection"
              :filter="tableOptions.filter"
              :filter-included-fields="['name']"
              :per-page="tableOptions.perPage"
              :current-page="tableOptions.currentPage"
              show-empty
              sort-icon-left
              :empty-text="emptyText"
            >
              <template #cell(description)="row">
                <kbd class="text-secondary textarea text" style="float: left; text-align:left;">{{ row.item.description }}</kbd>
              </template>
              <template #cell(name)="row">
                <div class="text-left">
                  <kbd class="alert-info no-wrap" style="border-radius: 15px; font-weight: 700 !important;"> <b-icon scale="1.2" icon="app-indicator" />&nbsp;&nbsp;{{ row.item.name }}&nbsp; </kbd>
                  <br>
                  <small style="font-size: 11px;">
                    <div class="d-flex align-items-center" style="margin-top: 3px">
                          &nbsp;&nbsp;<b-icon scale="1.4" icon="speedometer2" />&nbsp;&nbsp;<kbd class="alert-success" style="border-radius: 15px;">&nbsp;<b>{{ getServiceUsageValue(1, row.item.name, row.item) }}</b>&nbsp;</kbd>&nbsp;
                      &nbsp;<b-icon scale="1.4" icon="cpu" />&nbsp;&nbsp;<kbd class="alert-success" style="border-radius: 15px;">&nbsp;<b>{{ getServiceUsageValue(0, row.item.name, row.item) }}</b>&nbsp;</kbd>&nbsp;
                      &nbsp;<b-icon scale="1.4" icon="hdd" />&nbsp;&nbsp;<kbd class="alert-success" style="border-radius: 15px;">&nbsp;<b>{{ getServiceUsageValue(2, row.item.name, row.item) }}</b>&nbsp;</kbd>&nbsp;
                      <b-icon scale="1.2" icon="geo-alt" />&nbsp;<kbd class="alert-warning" style="border-radius: 15px;">&nbsp;<b>{{ row.item.instances }}</b>&nbsp;</kbd>
                    </div>
                    <expiry-label v-if="activeAppsTab" :expire-time="labelForExpire(row.item.expire, row.item.height)" />
                  </small>
                </div>
              </template>
              <template #cell(show_details)="row">
                <a @click="showLocations(row, apps)">
                  <v-icon
                    :name="row.detailsShowing ? 'chevron-up' : 'chevron-down'"
                    class="ml-1"
                  />
                </a>
              </template>
              <template #row-details="row">
                <b-card class="mx-2">
                  <h3 class="no-wrap align-items-center justify-content-center">
                    <kbd class="alert-info d-flex" style="border-radius: 15px; font-family: monospace; padding-right: 100%">
                      <b-icon
                        scale="1"
                        icon="info-square"
                        class="ml-1"
                        style="margin-top: 2px;"
                      />
                      <span style="margin-left: 10px;">Application Information</span>
                    </kbd>
                  </h3>
                  <div class="ml-1 wrap-text-info">
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
                    <div v-if="row.item.version >= 5">
                      <list-entry
                        v-if="row.item.contacts.length > 0"
                        title="Contacts"
                        :data="JSON.stringify(row.item.contacts)"
                      />
                      <div v-if="row.item.geolocation.length">
                        <div
                          v-for="location in row.item.geolocation"
                          :key="location"
                        >
                          <list-entry
                            title="Geolocation"
                            :data="getGeolocation(location)"
                          />
                        </div>
                      </div>
                      <div v-else>
                        <list-entry
                          title="Continent"
                          data="All"
                        />
                        <list-entry
                          title="Country"
                          data="All"
                        />
                        <list-entry
                          title="Region"
                          data="All"
                        />
                      </div>
                    </div>
                    <list-entry
                      v-if="row.item.instances"
                      title="Instances"
                      :data="row.item.instances.toString()"
                    />
                    <list-entry
                      title="Expires in"
                      :data="labelForExpire(row.item.expire, row.item.height)"
                    />
                    <list-entry
                      v-if="row.item?.nodes?.length > 0"
                      title="Enterprise Nodes"
                      :data="row.item.nodes ? row.item.nodes.toString() : 'Not scoped'"
                    />
                    <list-entry
                      title="Static IP"
                      :data="row.item.staticip ? 'Yes, Running only on Static IP nodes' : 'No, Running on all nodes'"
                    />
                  </div>
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
                        :data="constructAutomaticDomains(row.item.ports, row.item.name).toString()"
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
                          :data="`${row.item.cpubasic} vCore`"
                        />
                        <list-entry
                          title="CPU Nimbus"
                          :data="`${row.item.cpusuper} vCore`"
                        />
                        <list-entry
                          title="CPU Stratus"
                          :data="`${row.item.cpubamf} vCore`"
                        />
                        <list-entry
                          title="RAM Cumulus"
                          :data="`${row.item.rambasic} MB`"
                        />
                        <list-entry
                          title="RAM Nimbus"
                          :data="`${row.item.ramsuper} MB`"
                        />
                        <list-entry
                          title="RAM Stratus"
                          :data="`${row.item.rambamf} MB`"
                        />
                        <list-entry
                          title="SSD Cumulus"
                          :data="`${row.item.hddbasic} GB`"
                        />
                        <list-entry
                          title="SSD Nimbus"
                          :data="`${row.item.hddsuper} GB`"
                        />
                        <list-entry
                          title="SSD Stratus"
                          :data="`${row.item.hddbamf} GB`"
                        />
                      </div>
                      <div v-else>
                        <list-entry
                          title="CPU"
                          :data="`${row.item.cpu} vCore`"
                        />
                        <list-entry
                          title="RAM"
                          :data="`${row.item.ram} MB`"
                        />
                        <list-entry
                          title="SSD"
                          :data="`${row.item.hdd} GB`"
                        />
                      </div>
                    </b-card>
                  </div>
                  <div v-else>
                    <h3 class="no-wrap align-items-center justify-content-center">
                      <kbd class="alert-info d-flex" style="border-radius: 15px; font-family: monospace; padding-right: 100%">
                        <b-icon
                          scale="1"
                          icon="box"
                          class="ml-1"
                          style="margin-top: 2px;"
                        />
                        <span style="margin-left: 10px;">Composition</span>
                      </kbd>
                    </h3>
                    <b-card
                      v-for="(component, index) in row.item.compose"
                      :key="index"
                      class="mb-0"
                    >
                      <h3 class="no-wrap">
                        <kbd class="alert-success d-flex" style="border-radius: 15px; font-family: monospace; max-width: 500px;">
                          <b-icon
                            scale="1"
                            icon="menu-app-fill"
                            class="ml-1"
                          /> &nbsp;{{ component.name }}&nbsp;</kbd>
                      </h3>
                      <div class="ml-1 wrap-text-info">
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
                          title="Repository Authentication"
                          :data="component.repoauth ? 'Content Encrypted' : 'Public'"
                        />
                        <list-entry
                          title="Custom Domains"
                          :data="component.domains.toString() || 'none'"
                        />
                        <list-entry
                          title="Automatic Domains"
                          :data="constructAutomaticDomains(component.ports, row.item.name, { componentName: component.name, index }).toString()"
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
                          title="Environment Parameters"
                          :data="component.environmentParameters.length > 0 ? component.environmentParameters.toString() : 'none'"
                        />
                        <list-entry
                          title="Commands"
                          :data="component.commands.length > 0 ? component.commands.toString() : 'none'"
                        />
                        <list-entry
                          title="Secret Environment Parameters"
                          :data="component.secrets ? 'Content Encrypted' : 'none'"
                        />
                        <div v-if="component.tiered">
                          <list-entry
                            title="CPU Cumulus"
                            :data="`${component.cpubasic} vCore`"
                          />
                          <list-entry
                            title="CPU Nimbus"
                            :data="`${component.cpusuper} vCore`"
                          />
                          <list-entry
                            title="CPU Stratus"
                            :data="`${component.cpubamf} vCore`"
                          />
                          <list-entry
                            title="RAM Cumulus"
                            :data="`${component.rambasic} MB`"
                          />
                          <list-entry
                            title="RAM Nimbus"
                            :data="`${component.ramsuper} MB`"
                          />
                          <list-entry
                            title="RAM Stratus"
                            :data="`${component.rambamf} MB`"
                          />
                          <list-entry
                            title="SSD Cumulus"
                            :data="`${component.hddbasic} GB`"
                          />
                          <list-entry
                            title="SSD Nimbus"
                            :data="`${component.hddsuper} GB`"
                          />
                          <list-entry
                            title="SSD Stratus"
                            :data="`${component.hddbamf} GB`"
                          />
                        </div>
                        <div v-else>
                          <list-entry
                            title="CPU"
                            :data="`${component.cpu} vCore`"
                          />
                          <list-entry
                            title="RAM"
                            :data="`${component.ram} MB`"
                          />
                          <list-entry
                            title="SSD"
                            :data="`${component.hdd} GB`"
                          />
                        </div>
                      </div>
                    </b-card>
                  </div>
                  <locations v-if="activeAppsTab" :app-locations="appLocations" />
                </b-card>
              </template>
              <template #cell(actions)="row">
                <manage v-if="activeAppsTab" :row="row" @open-app-management="openAppManagement" />
                <redeploy v-else :row="row" />
              </template>
            </b-table>
          </b-col>
        </b-row>
        <b-col cols="12">
          <div class="d-flex justify-content-between align-items-center">
            <div v-if="apps?.length">
              <b-icon class="ml-1" scale="1.4" icon="layers" />&nbsp;
              <b>&nbsp;<kbd class="alert-success" style="border-radius: 15px;">&nbsp;{{ apps.length }}&nbsp;</kbd></b>
            </div>
            <div class="text-center flex-grow-1">
              <b-pagination
                v-if="apps?.length"
                v-model="tableOptions.currentPage"
                :total-rows="apps.length"
                :per-page="tableOptions.perPage"
                align="center"
                size="sm"
                class="mt-1 mb-0"
              />
            </div>
          </div>
        </b-col>
      </b-card>
    </b-overlay>
  </b-tab>
</template>

<script>
import AppsService from '@/services/AppsService';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ListEntry from '@/views/components/ListEntry.vue';

import Locations from '@/views/components/myApps/Locations.vue';
import Redeploy from '@/views/components/myApps/Redeploy.vue';
import Manage from '@/views/components/myApps/Manage.vue';
import ExpiryLabel from '@/views/components/myApps/ExpiryLabel.vue';

const geolocations = require('../../../libs/geolocation');

export default {
  expose: ['hideTabs'],
  components: {
    Locations,
    Redeploy,
    Manage,
    ExpiryLabel,
    ListEntry,
  },

  props: {
    apps: {
      type: Array,
      required: true,
    },
    currentBlockHeight: {
      type: Number,
      required: true,
    },
    activeAppsTab: {
      type: Boolean,
      default: true,
    },
    loading: {
      type: Boolean,
      default: false,
    },
    fields: {
      type: Array,
      default() {
        return [];
      },
    },
    loggedIn: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      appLocations: [],
      defaultFields: [
        { key: 'show_details', label: '' },
        {
          key: 'name', label: 'Name', sortable: true, thStyle: { width: '5%' },
        },
        { key: 'description', label: 'Description', thStyle: { width: '87%' } },
        {
          key: 'actions', label: '', class: 'text-center', thStyle: { width: '8%' },
        },
      ],
      tableOptions: {
        perPage: 25,
        pageOptions: [5, 10, 25, 50, 100],
        currentPage: 1,
        totalRows: 1,
        sortBy: '',
        sortDesc: false,
        sortDirection: 'asc',
        filter: '',
      },
    };
  },
  computed: {
    emptyText() {
      if (!this.loggedIn) return 'You must log in to see your applications.';
      return this.activeAppsTab ? 'No Global Apps are owned.' : 'No owned Apps are expired.';
    },
    mergedFields() {
      // deep copy (would use structuredClone but we dont have a polyfill for 14.18.1)
      const fields = this.fields.map((a) => ({ ...a }));
      this.defaultFields.forEach((field) => {
        if (!fields.find((f) => f.key === field.key)) fields.push(field);
      });
      return fields;
    },
  },
  methods: {
    hideTabs() {
      this.apps.forEach((item) => {
        this.$set(item, '_showDetails', false);
      });
    },
    openAppManagement(appName) {
      this.$emit('open-app-management', appName);
    },
    getGeolocation(geo) {
      if (geo.startsWith('a') && !geo.startsWith('ac') && !geo.startsWith('a!c')) {
        // specific continent
        const continentCode = geo.slice(1);
        const continentExists = geolocations.continents.find((continent) => continent.code === continentCode) || { name: 'ALL' };
        return `Continent: ${continentExists.name || 'Unkown'}`;
      } if (geo.startsWith('b')) {
        // specific country
        const countryCode = geo.slice(1);
        const countryExists = geolocations.countries.find((country) => country.code === countryCode) || { name: 'ALL' };
        return `Country: ${countryExists.name || 'Unkown'}`;
      } if (geo.startsWith('ac')) {
        // allowed location
        const specifiedLocation = geo.slice(2);
        const locations = specifiedLocation.split('_');
        const continentCode = locations[0];
        const countryCode = locations[1];
        const regionName = locations[2];
        const continentExists = geolocations.continents.find((continent) => continent.code === continentCode) || { name: 'ALL' };
        const countryExists = geolocations.countries.find((country) => country.code === countryCode) || { name: 'ALL' };
        let locationString = `Allowed location: Continent: ${continentExists.name}`;
        if (countryCode) {
          locationString += `, Country: ${countryExists.name}`;
        }
        if (regionName) {
          locationString += `, Region: ${regionName}`;
        }
        return locationString;
      } if (geo.startsWith('a!c')) {
        // forbidden location
        const specifiedLocation = geo.slice(3);
        const locations = specifiedLocation.split('_');
        const continentCode = locations[0];
        const countryCode = locations[1];
        const regionName = locations[2];
        const continentExists = geolocations.continents.find((continent) => continent.code === continentCode) || { name: 'ALL' };
        const countryExists = geolocations.countries.find((country) => country.code === countryCode) || { name: 'ALL' };
        let locationString = `Forbidden location: Continent: ${continentExists.name}`;
        if (countryCode) {
          locationString += `, Country: ${countryExists.name}`;
        }
        if (regionName) {
          locationString += `, Region: ${regionName}`;
        }
        return locationString;
      }
      return 'All locations allowed';
    },
    constructAutomaticDomains(ports, appName, options = {}) {
      const { componentName = '', index = 0 } = options;

      const lowerCaseName = appName.toLowerCase();
      const lowerCaseCopmonentName = componentName.toLowerCase();
      if (!lowerCaseCopmonentName) {
        const domains = [];
        if (index === 0) {
          domains.push(`${lowerCaseName}.app.runonflux.io`);
        }
        // flux specs dont allow more than 10 ports so domainString is enough
        for (let i = 0; i < ports.length; i += 1) {
          const portDomain = `${lowerCaseName}_${ports[i]}.app.runonflux.io`;
          domains.push(portDomain);
        }
        return domains;
      }
      const domains = [];
      if (index === 0) {
        domains.push(`${lowerCaseName}.app.runonflux.io`);
      }
      // flux specs dont allow more than 10 ports so domainString is enough
      for (let i = 0; i < ports.length; i += 1) {
        const portDomain = `${lowerCaseName}_${ports[i]}.app.runonflux.io`;
        domains.push(portDomain);
      }
      return domains;
    },
    minutesToString(minutes) {
      let value = minutes * 60;
      const units = {
        day: 24 * 60 * 60,
        hour: 60 * 60,
        minute: 60,
        second: 1,
      };
      const result = [];
      Object.keys(units).forEach((name) => {
        const p = Math.floor(value / units[name]);
        if (p === 1) result.push(` ${p} ${name}`);
        if (p >= 2) result.push(` ${p} ${name}s`);
        value %= units[name];
      });

      return result;
    },
    labelForExpire(expire, height) {
      if (!height) return 'Application Expired';

      if (this.currentBlockHeight === -1) {
        return 'Not possible to calculate expiration';
      }
      const forkBlock = 2020000;
      // After PON fork, default expire is 88000 blocks (4x22000)
      const defaultExpire = height >= forkBlock ? 88000 : 22000;
      const expires = expire || defaultExpire;
      let effectiveExpiry = height + expires;

      // If app was registered before the fork (block 2020000) and we're currently past the fork,
      // adjust the expiry calculation since the blockchain moves 4x faster post-fork
      if (height < forkBlock && this.currentBlockHeight >= forkBlock && effectiveExpiry > forkBlock) {
        const remainingBlocksAfterFork = effectiveExpiry - forkBlock;
        effectiveExpiry = forkBlock + (remainingBlocksAfterFork * 4);
      }

      const blocksToExpire = effectiveExpiry - this.currentBlockHeight;
      if (blocksToExpire < 1) {
        return 'Application Expired';
      }
      // Block time: 2 minutes before fork (block 2020000), 30 seconds (0.5 minutes) after fork
      const minutesPerBlock = this.currentBlockHeight >= forkBlock ? 0.5 : 2;
      const minutesRemaining = blocksToExpire * minutesPerBlock;
      const result = this.minutesToString(minutesRemaining);
      if (result.length > 2) {
        return `${result[0]}, ${result[1]}, ${result[2]}`;
      }
      if (result.length > 1) {
        return `${result[0]}, ${result[1]}`;
      }
      return `${result[0]}`;
    },
    getServiceUsageValue(index, name, compose) {
      if (typeof compose?.compose === 'undefined') {
        this.usage = [+compose.ram, +compose.cpu, +compose.hdd];
        return this.usage[index];
      }
      // Assuming getServiceUsage returns an array
      const serviceUsage = this.getServiceUsage(name, compose.compose);
      // Return the value at the specified index
      return serviceUsage[index];
    },
    getServiceUsage(serviceName, spec) {
      let totalRAM = 0;
      let totalCPU = 0;
      let totalHDD = 0;
      spec.forEach((composeObj) => {
        totalRAM += composeObj.ram;
        totalCPU += composeObj.cpu;
        totalHDD += composeObj.hdd;
      });
      // Return an array containing the sum of RAM, CPU, and HDD usage
      return [totalRAM, totalCPU.toFixed(1), totalHDD];
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
    showLocations(row, items) {
      if (row.detailsShowing) {
        row.toggleDetails();
      } else {
        items.forEach((item) => {
          this.$set(item, '_showDetails', false);
        });
        this.$nextTick(() => {
          row.toggleDetails();
          if (this.activeAppsTab) this.loadLocations(row);
        });
      }
    },
    async loadLocations(row) {
      const response = await AppsService.getAppLocation(row.item.name).catch((error) => {
        this.showToast('danger', error.message || error);
        return { data: { status: 'fail' } };
      });
      if (response.data.status === 'success') {
        const { data: { data: appLocations } } = response;
        this.appLocations = appLocations;
      }
    },
  },
};
</script>
<style lang="scss">
  .myapps-table td:nth-child(1) {
    padding: 0 0 0 5px;
  }
  .myapps-table th:nth-child(1) {
    padding: 0 0 0 5px;
  }
  .myapps-table thead th,
  .myapps-table tbody td {
    text-transform: none !important;
  }
  .b-table-sort-icon-left {
    padding-left:  20px !important;
  }
  .wrap-text-info {
    white-space: normal !important;
    overflow-wrap: break-word;
    word-break: break-word;
  }
</style>
