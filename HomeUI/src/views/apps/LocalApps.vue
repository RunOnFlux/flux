<template>
  <div>
    <div :class="managedApplication ? 'd-none' : ''">
      <b-tabs @activate-tab="output = ''; downloading = false">
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
                    <template #cell(show_details)="row">
                      <a @click="showLocations(row, tableconfig.installed.apps)">
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
                        <div v-if="row.item.version >= 5">
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
                              title="Environment Parameters"
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
                              title="Environment Parameters"
                              :data="component.environmentParameters.length > 0 ? component.environmentParameters.toString() : 'none'"
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
                      </b-card>
                    </template>
                    <template #cell(Name)="row">
                      {{ row.item.name }}
                    </template>
                    <template #cell(Description)="row">
                      {{ row.item.description }}
                    </template>
                    <template #cell(visit)="row">
                      <b-button
                        size="sm"
                        class="mr-0"
                        variant="danger"
                        @click="openApp(row.item.name)"
                      >
                        Visit
                      </b-button>
                    </template>
                    <template #cell(actions)="row">
                      <b-button
                        :id="`stop-running-app-${row.item.name}`"
                        size="sm"
                        class="mr-0"
                        variant="danger"
                      >
                        Stop
                      </b-button>
                      <confirm-dialog
                        :target="`stop-running-app-${row.item.name}`"
                        confirm-button="Stop App"
                        @confirm="stopApp(row.item.name)"
                      />
                    </template>
                  </b-table>
                </b-col>
              </b-row>
            </b-card>
          </b-overlay>
        </b-tab>
        <b-tab title="Installed">
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
                    <template #cell(show_details)="row">
                      <a @click="showLocations(row, tableconfig.installed.apps)">
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
                        <div v-if="row.item.version >= 5">
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
                              title="Environment Parameters"
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
                              title="Environment Parameters"
                              :data="component.environmentParameters.length > 0 ? component.environmentParameters.toString() : 'none'"
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
                                  @click="openApp(row.item.name, locationRow.item.ip, row.item.port || (row.item.ports ? row.item.ports[0] : row.item.compose[0].ports[0]))"
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
                    <template #cell(Description)="row">
                      {{ row.item.description }}
                    </template>
                    <template #cell(actions)="row">
                      <b-button
                        :id="`start-installed-app-${row.item.name}`"
                        size="sm"
                        class="w-100 mr-1"
                        style="margin-bottom: 2px;"
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
                        class="w-100 mr-1"
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
        <b-tab title="Available">
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
                        <div v-if="row.item.version >= 5">
                          <list-entry
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
                              title="Environment Parameters"
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
                              title="Environment Parameters"
                              :data="component.environmentParameters.length > 0 ? component.environmentParameters.toString() : 'none'"
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
                                  @click="openApp(row.item.name, locationRow.item.ip, row.item.port || (row.item.ports ? row.item.ports[0] : row.item.compose[0].ports[0]))"
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
                    <template #cell(Description)="row">
                      {{ row.item.description }}
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
        <b-tab title="My Local Apps">
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
                    <template #cell(show_details)="row">
                      <a @click="showLocations(row, tableconfig.local.apps)">
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
                        <div v-if="row.item.version >= 5">
                          <list-entry
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
                              title="Environment Parameters"
                              :data="component.environmentParameters.length > 0 ? component.environmentParameters.toString() : 'none'"
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
                                  @click="openApp(row.item.name, locationRow.item.ip, row.item.port || (row.item.ports ? row.item.ports[0] : row.item.compose[0].ports[0]))"
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
                    <template #cell(Description)="row">
                      {{ row.item.description }}
                    </template>
                    <template #cell(actions)="row">
                      <b-button
                        :id="`start-local-app-${row.item.name}`"
                        size="sm"
                        class="w-100 mr-1"
                        style="margin-bottom: 2px;"
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
                        class="w-100 mr-1"
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
                        :id="`manage-local-app-${row.item.name}`"
                        size="sm"
                        class="mr-0"
                        variant="danger"
                      >
                        Manage
                      </b-button>
                      <confirm-dialog
                        :target="`manage-local-app-${row.item.name}`"
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
        v-if="output.length > 0"
        class="actionCenter"
      >
        <br>
        <b-row>
          <b-col cols="9">
            <b-form-textarea
              plaintext
              no-resize
              :rows="output.length + 1"
              :value="stringOutput()"
              class="mt-1"
            />
          </b-col>
          <b-col
            v-if="downloading"
            cols="3"
          >
            <h3>Downloads</h3>
            <div
              v-for="download in downloadOutput"
              :key="download.id"
            >
              <h4> {{ download.id }}</h4>
              <b-progress
                :value="download.detail.current / download.detail.total * 100"
                max="100"
                striped
                height="1rem"
                :variant="download.variant"
              />
              <br>
            </div>
          </b-col>
        </b-row>
      </div>
    </div>
    <div v-if="managedApplication">
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
import { computed } from "vue";
import {
  BTabs,
  BTab,
  BTable,
  BCol,
  BCard,
  BCardTitle,
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
  BProgress,
} from 'bootstrap-vue';

import Ripple from 'vue-ripple-directive';
import { mapState } from 'vuex';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';
import ListEntry from '@/views/components/ListEntry.vue';
import Management from '@/views/apps/Management.vue';
import AppsService from '@/services/AppsService';
import DaemonService from '@/services/DaemonService';

import qs from 'qs';
import store from 'store';
const timeoptions = require('@/libs/dateFormat');

const geolocations = require('../../libs/geolocation');

export default {
  components: {
    BTabs,
    BTab,
    BTable,
    BCol,
    BCard,
    BCardTitle,
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
    BProgress,
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
      output: [],
      downloading: false,
      downloadOutput: {
      },
      managedApplication: '',
      tableconfig: {
        running: {
          apps: [],
          status: '',
          loggedInFields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'description', label: 'Description', sortable: true },
            { key: 'visit', label: 'Visit' },
            { key: 'actions', label: 'Actions' },
          ],
          fields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'description', label: 'Description', sortable: true },
            { key: 'visit', label: 'Visit' },
          ],
          loading: true,
        },
        installed: {
          apps: [],
          status: '',
          loggedInFields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'description', label: 'Description', sortable: true },
            { key: 'actions', label: 'Actions' },
            { key: 'remove', label: 'Remove' },
            { key: 'manage', label: 'Manage' },
          ],
          fields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'description', label: 'Description', sortable: true },
          ],
          loading: true,
        },
        available: {
          apps: [],
          status: '',
          loggedInFields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'description', label: 'Description', sortable: true },
            { key: 'install', label: 'Install' },
          ],
          fields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'description', label: 'Description', sortable: true },
          ],
          loading: true,
        },
        local: {
          apps: [],
          status: '',
          fields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'description', label: 'Description', sortable: true },
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
    };
  },
  setup() {
    const { ...mapState } = ('flux', [
      'config',
      'userconfig',
      'privilege',
    ]);

    const isApplicationInstalledLocally = computed(() => {
      if (this.tableconfig.installed.apps) {
        const installed = this.tableconfig.installed.apps.find((app) => app.name === this.managedApplication);
        if (installed) {
          return true;
        }
        return false;
      }
      return false;
    });

    return {
      mapState,
      isApplicationInstalledLocally
    }
  },
  mounted() {
    this.getZelNodeStatus();
    this.appsGetAvailableApps();
    this.appsGetListRunningApps();
    this.appsGetInstalledApps();
    const { hostname, port } = window.location;
    const regex = /[A-Za-z]/g;
    if (!hostname.match(regex)) {
      if (typeof hostname === 'string') {
        this.$store.commit('flux/setUserIp', hostname);
      }
      if (+port > 16100) {
        const apiPort = +port + 1;
        this.$store.commit('flux/setFluxPort', apiPort);
      }
    }
  },
  methods: {
    async getZelNodeStatus() {
      const response = await DaemonService.getZelNodeStatus();
      if (response.data.status === 'success') {
        this.tier = response.data.data.tier;
      }
    },
    async appsGetInstalledApps() {
      this.tableconfig.installed.loading = true;
      const response = await AppsService.installedApps();
      console.log(response);
      this.tableconfig.installed.status = response.data.status;
      this.tableconfig.installed.apps = response.data.data;
      this.tableconfig.installed.loading = false;

      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      this.tableconfig.local.apps = this.tableconfig.installed.apps.filter((app) => app.owner === auth.zelid);
      this.tableconfig.local.totalRows = this.tableconfig.local.apps.length;
    },
    async appsGetListRunningApps(timeout = 0) {
      this.tableconfig.running.loading = true;
      const self = this;
      setTimeout(async () => {
        const response = await AppsService.listRunningApps();
        // this is coming from docker;
        const apps = response.data.data;
        const runningAppsNames = [];
        const runningAppsSpecifics = [];
        apps.forEach((app) => {
          // get application specification IF it is composed app
          const appName = app.Names[0].startsWith('/flux') ? app.Names[0].slice(5) : app.Names[0].slice(4);
          if (appName.includes('_')) {
            runningAppsNames.push(appName.split('_')[1]);
          } else {
            runningAppsNames.push(appName);
          }
        });
        const runningAppsok = [...new Set(runningAppsNames)];
        // eslint-disable-next-line no-restricted-syntax
        for (const app of runningAppsok) {
          // get specificaitons of the app
          // eslint-disable-next-line no-await-in-loop
          const res = await AppsService.getAppSpecifics(app);
          if (res.data.status === 'success') {
            runningAppsSpecifics.push(res.data.data);
          }
        }
        console.log(response);
        self.tableconfig.running.status = response.data.status;
        self.tableconfig.running.apps = runningAppsSpecifics;
        self.tableconfig.running.loading = false;
      }, timeout);
    },
    async appsGetAvailableApps() {
      this.tableconfig.available.loading = true;
      const response = await AppsService.availableApps();
      console.log(response);
      this.tableconfig.available.status = response.data.status;
      this.tableconfig.available.apps = response.data.data;
      this.tableconfig.available.loading = false;
    },
    openApp(name, _ip, _port) {
      console.log(name, _ip, _port);
      const appInfo = this.installedApp(name);
      if (appInfo || (_port && _ip)) {
        const backendURL = store.get('backendURL') || `http://${this.userconfig.externalip}:${this.config.apiPort}`;
        const ip = _ip || backendURL.split(':')[1].split('//')[1];
        const port = _port || appInfo.port || appInfo.ports ? appInfo.ports[0] : appInfo.compose[0].ports[0];
        let url = `http://${ip}:${port}`;
        if (name === 'KadenaChainWebNode') {
          url = `https://${ip}:${port}/chainweb/0.0/mainnet01/cut`;
        }
        this.openSite(url);
      } else {
        this.showToast('danger', 'Unable to open App :(');
      }
    },
    installedApp(appName) {
      return this.tableconfig.installed.apps.find((app) => app.name === appName);
    },
    openSite(url) {
      const win = window.open(url, '_blank');
      win.focus();
    },
    async stopApp(app) {
      this.output = '';
      this.showToast('warning', `Stopping ${this.getAppName(app)}`);
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.stopApp(zelidauth, app);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      this.appsGetListRunningApps(8000);
      console.log(response);
    },
    async startApp(app) {
      this.output = '';
      this.showToast('warning', `Starting ${this.getAppName(app)}`);
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.startApp(zelidauth, app);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      this.appsGetListRunningApps(15000);
      console.log(response);
    },
    async restartApp(app) {
      this.output = '';
      this.showToast('warning', `Restarting ${this.getAppName(app)}`);
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.restartApp(zelidauth, app);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      this.appsGetListRunningApps(15000);
      console.log(response);
    },
    async pauseApp(app) {
      this.output = '';
      this.showToast('warning', `Pausing ${this.getAppName(app)}`);
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.pauseApp(zelidauth, app);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      console.log(response);
    },
    async unpauseApp(app) {
      this.output = '';
      this.showToast('warning', `Unpausing ${this.getAppName(app)}`);
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.unpauseApp(zelidauth, app);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      console.log(response);
    },
    redeployAppSoft(app) {
      this.redeployApp(app, false);
    },
    redeployAppHard(app) {
      this.redeployApp(app, true);
    },
    async redeployApp(app, force) {
      const self = this;
      this.output = '';
      this.showToast('warning', `Redeploying ${this.getAppName(app)}`);
      const zelidauth = localStorage.getItem('zelidauth');
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.target.response);
          self.output = JSON.parse(`[${progressEvent.target.response.replace(/}{/g, '},{')}]`);
        },
      };
      const response = await AppsService.justAPI().get(`/apps/redeploy/${app}/${force}`, axiosConfig);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
        if (this.output[this.output.length - 1].status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].status);
        } else {
          this.showToast('success', this.output[this.output.length - 1].status);
        }
      }
    },
    async removeApp(app) {
      const appName = this.getAppName(app);
      const okAppsForAdmin = [
        'FoldingAtHomeB',
        'KadenaChainWebNode',
        'KadenaChainWebData',
        'FoldingAtHomeArm64',
      ];
      if (!okAppsForAdmin.includes(appName) && this.privilege === 'admin') { // node owner but app is a global app
        this.showToast('danger', `This application ${appName} cannot be removed by node owner`);
        return;
      }
      const self = this;
      this.output = '';
      this.showToast('warning', `Removing ${appName}`);
      const zelidauth = localStorage.getItem('zelidauth');
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.target.response);
          self.output = JSON.parse(`[${progressEvent.target.response.replace(/}{/g, '},{')}]`);
        },
      };
      const response = await AppsService.justAPI().get(`/apps/appremove/${app}`, axiosConfig);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
        if (this.output[this.output.length - 1].status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].status);
        } else {
          this.showToast('success', this.output[this.output.length - 1].status);
        }
        setTimeout(() => {
          this.appsGetInstalledApps();
          this.appsGetListRunningApps();
          self.managedApplication = '';
        }, 5000);
      }
    },
    async installTemporaryLocalApp(app) { // todo rewrite to installApp later
      const appName = this.getAppName(app);
      const self = this;
      this.output = [];
      this.downloadOutput = {};
      this.downloading = true;
      this.showToast('warning', `Installing ${appName}`);
      if (appName === 'KadenaChainWebNode' || appName === 'KadenaChainWebData') {
        this.showToast('danger', 'Kadena application is now a Global applicaiton. Local installation is no longer possible');
        return;
      }
      const zelidauth = localStorage.getItem('zelidauth');
      // const response = await AppsService.installTemporaryLocalApp(zelidauth, app);
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.target.response);
          self.output = JSON.parse(`[${progressEvent.target.response.replace(/}{/g, '},{')}]`);
        },
      };
      const response = await AppsService.justAPI().get(`/apps/installtemporarylocalapp/${app}`, axiosConfig);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        console.log(response);
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
        console.log(this.output);
        for (let i = 0; i < this.output.length; i += 1) {
          if (this.output[i] && this.output[i].data && this.output[i].data.message && this.output[i].data.message.includes('Error occured')) {
            // error is defined one line above
            if (this.output[i - 1] && this.output[i - 1].data) {
              this.showToast('danger', this.output[i - 1].data.message || this.output[i - 1].data);
              return;
            }
          }
        }
        if (this.output[this.output.length - 1].status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].status);
        } else {
          this.showToast('success', this.output[this.output.length - 1].status);
        }
        this.appsGetInstalledApps();
        this.appsGetListRunningApps();
      }
    },
    getAppName(appName) {
      // this id is used for volumes, docker names so we know it reall belongs to flux
      if (appName && appName.startsWith('zel')) {
        return appName.slice(3);
      }
      if (appName && appName.startsWith('flux')) {
        return appName.slice(4);
      }
      return appName;
    },
    isLoggedIn() {
      return (this.privilege === 'fluxteam' || this.privilege === 'admin');
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
        this.appLocationOptions.totalRows = this.appLocations.length;
      }
    },
    openAppManagement(app) {
      const appName = this.getAppName(app);
      // const okAppsForAdmin = [
      //   'FoldingAtHomeB',
      //   'KadenaChainWebNode',
      //   'KadenaChainWebData',
      //   'FoldingAtHomeArm64',
      // ];
      // if (!okAppsForAdmin.includes(appName) && this.privilege === 'admin') { // node owner but app is a global app
      //   this.showToast('danger', `This application ${appName} cannot be managed by node owner`);
      // } else {
      this.managedApplication = appName;
      // }
    },
    clearManagedApplication() {
      this.managedApplication = '';
      this.appsGetInstalledApps();
      this.appsGetListRunningApps();
    },
    onFilteredLocal(filteredItems) {
      // Trigger pagination to update the number of buttons/pages due to filtering
      this.tableconfig.local.totalRows = filteredItems.length;
      this.tableconfig.local.currentPage = 1;
    },
    stringOutput() {
      let string = '';
      this.output.forEach((output) => {
        if (output.status === 'success') {
          string += `${output.data.message || output.data}\r\n`;
        } else if (output.status === 'Downloading') {
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: output.progressDetail,
            variant: 'danger',
          });
        } else if (output.status === 'Verifying Checksum') {
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: { current: 1, total: 1 },
            variant: 'warning',
          });
        } else if (output.status === 'Download complete') {
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: { current: 1, total: 1 },
            variant: 'info',
          });
        } else if (output.status === 'Extracting') {
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: output.progressDetail,
            variant: 'primary',
          });
        } else if (output.status === 'Pull complete') {
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: { current: 1, total: 1 },
            variant: 'success',
          });
        } else {
          string += `${output.status}\r\n`;
        }
      });
      return string;
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
      const lowerCaseName = appName.toLowerCase();
      const lowerCaseCopmonentName = componentName.toLowerCase();
      if (!lowerCaseCopmonentName) {
        const domains = [`${lowerCaseName}.app.runonflux.io`];
        // flux specs dont allow more than 10 ports so domainString is enough
        for (let i = 0; i < ports.length; i += 1) {
          const portDomain = `${lowerCaseName}_${ports[i]}.app.runonflux.io`;
          domains.push(portDomain);
        }
        return domains;
      }
      const domains = [`${lowerCaseName}.app.runonflux.io`];
      // flux specs dont allow more than 10 ports so domainString is enough
      for (let i = 0; i < ports.length; i += 1) {
        const portDomain = `${lowerCaseName}_${ports[i]}.app.runonflux.io`;
        domains.push(portDomain);
      }
      return domains;
    },
    ensureObject(parameter) {
      if (typeof parameter === 'object') {
        return parameter;
      }
      let param;
      try {
        param = JSON.parse(parameter);
      } catch (e) {
        param = qs.parse(parameter);
      }
      return param;
    },
    getGeolocation(geo) {
      if (geo.startsWith('a') && !geo.startsWith('ac') && geo.startsWith('a!c')) {
        // specific continent
        const continentCode = geo.slice(1);
        const continentExists = geolocations.continents.find((continent) => continent.code === continentCode);
        return `Continent: ${continentExists.name || 'Unkown'}`;
      } if (geo.startsWith('b')) {
        // specific country
        const countryCode = geo.slice(1);
        const countryExists = geolocations.countries.find((country) => country.code === countryCode);
        return `Country: ${countryExists.name || 'Unkown'}`;
      } if (geo.startsWith('ac')) {
        // allowed location
        const specifiedLocation = geo.slice(2);
        const locations = specifiedLocation.split('_');
        const continentCode = locations[0];
        const countryCode = locations[1];
        const regionName = locations[2];
        const continentExists = geolocations.continents.find((continent) => continent.code === continentCode);
        const countryExists = geolocations.countries.find((country) => country.code === countryCode);
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
        const continentExists = geolocations.continents.find((continent) => continent.code === continentCode);
        const countryExists = geolocations.countries.find((country) => country.code === countryCode);
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
  },
};
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
