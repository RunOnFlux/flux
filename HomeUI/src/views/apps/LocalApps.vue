<template>
  <div>
    <div :class="managedApplication ? 'd-none' : ''">
      <b-tabs pills @activate-tab="tabChanged()">
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
                    outlined
                    responsive
                    :items="tableconfig.installed.apps"
                    :fields="isLoggedIn() ? tableconfig.installed.loggedInFields : tableconfig.installed.fields"
                    show-empty
                    empty-text="No Flux Apps installed"
                    sort-icon-left
                  >
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
                          <span :class="{ 'red-text': isLessThanTwoDays(labelForExpire(row.item.expire, row.item.height)) }" class="no-wrap">
                            &nbsp;&nbsp;<b-icon scale="1.2" icon="hourglass-split" />
                            {{ labelForExpire(row.item.expire, row.item.height) }}&nbsp;&nbsp;
                          </span>
                        </small>
                      </div>
                    </template>
                    <template #cell(visit)="row">
                      <b-button
                        v-b-tooltip.hover.top="'Visit App'"
                        size="sm"
                        class="mr-0 no-wrap hover-underline"
                        variant="link"
                        @click="openApp(row.item.name)"
                      >
                        <b-icon
                          scale="1"
                          icon="front"
                        />
                        Visit
                      </b-button>
                    </template>
                    <template #cell(description)="row">
                      <kbd class="text-secondary textarea" style="float: left; text-align:left;">{{ row.item.description }}</kbd>
                    </template>
                    <template #cell(state)="row">
                      <kbd :class="getBadgeClass(row.item.name)" style="border-radius: 15px">&nbsp;<b>{{ getStateByName(row.item.name) }}</b>&nbsp;</kbd>
                    </template>
                    <template #cell(show_details)="row">
                      <a @click="showLocations(row, tableconfig.installed.apps)">
                        <v-icon
                          v-if="!row.detailsShowing"
                          name="chevron-down"
                          class="ml-1"
                        />
                        <v-icon
                          v-if="row.detailsShowing"
                          name="chevron-up"
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
                        <div class="ml-1">
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
                            <div class="ml-1">
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
                                :data="constructAutomaticDomains(component.ports, component.name, row.item.name, index).toString()"
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
                        <h3 class="no-wrap align-items-center justify-content-center">
                          <kbd class="alert-info d-flex" style="border-radius: 15px; font-family: monospace; padding-right: 100%">
                            <b-icon
                              scale="1"
                              icon="pin-map-fill"
                              style="margin-top: 2px; margin-left: 10px;"
                            />
                            <span style="margin-left: 10px;">Locations</span>
                          </kbd>
                        </h3>
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
                                  v-model="appLocationOptions.filterOne"
                                  type="search"
                                  placeholder="Type to Search"
                                />
                                <b-input-group-append>
                                  <b-button
                                    :disabled="!appLocationOptions.filterOne"
                                    @click="appLocationOptions.filterOne = ''"
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
                              borderless
                              :per-page="appLocationOptions.perPage"
                              :current-page="appLocationOptions.currentPage"
                              :items="appLocations"
                              :fields="appLocationFields"
                              thead-class="d-none"
                              :filter="appLocationOptions.filterOne"
                              show-empty
                              sort-icon-left
                              empty-text="No instances found.."
                            >
                              <template #cell(ip)="locationRow">
                                <div class="no-wrap">
                                  <kbd class="alert-info" style="border-radius: 15px;">
                                    <b-icon
                                      scale="1.1"
                                      icon="hdd-network-fill"
                                    /></kbd>
                                  &nbsp;<kbd class="alert-success no-wrap" style="border-radius: 15px;">
                                    <b>&nbsp;&nbsp;{{ locationRow.item.ip }}&nbsp;&nbsp;</b>
                                  </kbd>
                                </div>
                              </template>
                              <template #cell(visit)="locationRow">
                                <div class="d-flex justify-content-end">
                                  <b-button
                                    v-b-tooltip.hover.top="'Visit App'"
                                    size="sm"
                                    class="mr-1"
                                    pill
                                    variant="dark"
                                    @click="openApp(row.item.name, locationRow.item.ip.split(':')[0], getProperPort(row.item))"
                                  >
                                    <b-icon
                                      scale="1"
                                      icon="door-open"
                                    />
                                    App
                                  </b-button>
                                  <b-button
                                    v-b-tooltip.hover.top="'Visit FluxNode'"
                                    size="sm"
                                    class="mr-0"
                                    pill
                                    variant="outline-dark"
                                    @click="openNodeFluxOS(locationRow.item.ip.split(':')[0], locationRow.item.ip.split(':')[1] ? +locationRow.item.ip.split(':')[1] - 1 : 16126)"
                                  >
                                    <b-icon
                                      scale="1"
                                      icon="house-door-fill"
                                    />
                                    FluxNode
                                  </b-button>&nbsp;&nbsp;
                                </div>
                              </template>
                            </b-table>
                          </b-col>
                          <b-col cols="12">
                            <b-pagination
                              v-model="appLocationOptions.currentPage"
                              :total-rows="appLocations?.length || 1"
                              :per-page="appLocationOptions.perPage"
                              align="center"
                              size="sm"
                              class="my-0 mt-1"
                            />
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
                      <b-button-toolbar>
                        <b-button-group size="sm">
                          <b-button
                            v-if="isFluxAdminLoggedIn()"
                            :id="`start-installed-app-${row.item.name}`"
                            v-b-tooltip.hover.top="'Start App'"
                            :disabled="isAppInList(row.item.name, tableconfig.running.apps)"
                            size="sm"
                            class="no-wrap"
                            variant="outline-dark"
                          >
                            <b-icon
                              scale="1.2"
                              icon="play-fill"
                              class="icon-style-start"
                              :class="{ 'disable-hover': isAppInList(row.item.name, tableconfig.running.apps) }"
                            />
                          </b-button>
                          <confirm-dialog
                            :target="`start-installed-app-${row.item.name}`"
                            confirm-button="Start App"
                            @confirm="startApp(row.item.name)"
                          />
                          <b-button
                            v-if="isFluxAdminLoggedIn()"
                            :id="`stop-installed-app-${row.item.name}`"
                            v-b-tooltip.hover.top="'Stop App'"
                            size="sm"
                            class="mr-0"
                            variant="outline-dark"
                            :disabled="!isAppInList(row.item.name, tableconfig.running.apps)"
                          >
                            <b-icon
                              scale="1.2"
                              icon="stop-circle"
                              class="icon-style-stop"
                              :class="{ 'disable-hover': !isAppInList(row.item.name, tableconfig.running.apps) }"
                            />
                          </b-button>
                          <confirm-dialog
                            :target="`stop-installed-app-${row.item.name}`"
                            confirm-button="Stop App"
                            @confirm="stopApp(row.item.name)"
                          />
                          <b-button
                            v-if="isFluxAdminLoggedIn()"
                            :id="`restart-installed-app-${row.item.name}`"
                            v-b-tooltip.hover.top="'Restart App'"
                            size="sm"
                            class="no-wrap"
                            variant="outline-dark"
                          >
                            <b-icon
                              scale="1"
                              icon="bootstrap-reboot"
                              class="icon-style-restart"
                            />
                          </b-button>
                          <confirm-dialog
                            :target="`restart-installed-app-${row.item.name}`"
                            confirm-button="Restart App"
                            @confirm="restartApp(row.item.name)"
                          />
                          <b-button
                            :id="`remove-installed-app-${row.item.name}`"
                            v-b-tooltip.hover.top="'Remove App'"
                            size="sm"
                            class="no-wrap"
                            variant="outline-dark"
                          >
                            <b-icon
                              scale="1"
                              icon="trash"
                              class="icon-style-trash"
                            />
                          </b-button>
                          <confirm-dialog
                            :target="`remove-installed-app-${row.item.name}`"
                            confirm-button="Remove App"
                            @confirm="removeApp(row.item.name)"
                          />
                          <!-- <b-button
                            :id="`manage-installed-app-${row.item.name}`"
                            v-b-tooltip.hover.top="'Manage App'"
                            size="sm"
                            class="no-wrap"
                            variant="outline-dark"
                          >
                            <b-icon
                              scale="1"
                              icon="gear"
                              class="icon-style-gear"
                            />
                          </b-button>
                          <confirm-dialog
                            :target="`manage-installed-app-${row.item.name}`"
                            confirm-button="Manage App"
                            @confirm="openAppManagement(row.item.name)"
                          /> -->
                        </b-button-group>
                      </b-button-toolbar>
                    </template>
                  </b-table>
                </b-col>
              </b-row>
              <div v-if="tableconfig.installed?.apps?.length > 0" class="mt-1">
                <b-icon class="ml-1" scale="1.4" icon="layers" />&nbsp;
                <b>&nbsp;<kbd class="alert-success" style="border-radius: 15px;">&nbsp;{{ tableconfig.installed?.apps?.length }}&nbsp;</kbd></b>
              </div>
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
                <b-col
                  md="4"
                  sm="4"
                  class="my-1"
                >
                  <b-form-group class="mb-0">
                    <label class="d-inline-block text-left mr-50">Per page</label>
                    <b-form-select
                      id="perPageSelect"
                      v-model="tableconfig.globalAvailable.perPage"
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
                    class="mb-0 mt-0"
                  >
                    <b-input-group size="sm">
                      <b-form-input
                        id="filterInput"
                        v-model="tableconfig.globalAvailable.filter"
                        type="search"
                        placeholder="Type to Search"
                      />
                      <b-input-group-append>
                        <b-button
                          :disabled="!tableconfig.globalAvailable.filter"
                          @click="tableconfig.globalAvailable.filter = ''"
                        >
                          Clear
                        </b-button>
                      </b-input-group-append>
                    </b-input-group>
                  </b-form-group>
                </b-col>
                <b-col cols="12 mt-0">
                  <b-table
                    class="apps-globalAvailable-table"
                    striped
                    outlined
                    responsive
                    :per-page="tableconfig.globalAvailable.perPage"
                    :current-page="tableconfig.globalAvailable.currentPage"
                    :items="tableconfig.globalAvailable.apps"
                    :fields="isFluxAdminLoggedIn() ? tableconfig.globalAvailable.loggedInFields : tableconfig.globalAvailable.fields"
                    :filter="tableconfig.globalAvailable.filter"
                    :filter-included-fields="['name']"
                    show-empty
                    sort-icon-left
                    empty-text="No Flux Apps Globally Available"
                  >
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
                          <span :class="{ 'red-text': isLessThanTwoDays(labelForExpire(row.item.expire, row.item.height)) }" class="no-wrap">
                            &nbsp;&nbsp;<b-icon scale="1.2" icon="hourglass-split" />
                            {{ labelForExpire(row.item.expire, row.item.height) }}&nbsp;&nbsp;
                          </span>
                        </small>
                      </div>
                    </template>
                    <template #cell(description)="row">
                      <kbd class="text-secondary textarea" style="float: left; text-align:left;">{{ row.item.description }}</kbd>
                    </template>
                    <template #cell(show_details)="row">
                      <a @click="showLocations(row, tableconfig.globalAvailable.apps)">
                        <v-icon
                          v-if="!row.detailsShowing"
                          name="chevron-down"
                          class="ml-1"
                        />
                        <v-icon
                          v-if="row.detailsShowing"
                          name="chevron-up"
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
                        <div class="ml-1">
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
                            <div class="ml-1">
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
                                :data="constructAutomaticDomains(component.ports, component.name, row.item.name, index).toString()"
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
                        <h3 class="no-wrap align-items-center justify-content-center">
                          <kbd class="alert-info d-flex" style="border-radius: 15px; font-family: monospace; padding-right: 100%">
                            <b-icon
                              scale="1"
                              icon="pin-map-fill"
                              style="margin-top: 2px; margin-left: 10px;"
                            />
                            <span style="margin-left: 10px;">Locations</span>
                          </kbd>
                        </h3>
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
                                  v-model="appLocationOptions.filterTree"
                                  type="search"
                                  placeholder="Type to Search"
                                />
                                <b-input-group-append>
                                  <b-button
                                    :disabled="!appLocationOptions.filterTree"
                                    @click="appLocationOptions.filterTree = ''"
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
                              borderless
                              :per-page="appLocationOptions.perPage"
                              :current-page="appLocationOptions.currentPage"
                              :items="appLocations"
                              :fields="appLocationFields"
                              thead-class="d-none"
                              :filter="appLocationOptions.filterTree"
                              show-empty
                              sort-icon-left
                              empty-text="No instances found.."
                            >
                              <template #cell(ip)="locationRow">
                                <div class="no-wrap">
                                  <kbd class="alert-info" style="border-radius: 15px;">
                                    <b-icon
                                      scale="1.1"
                                      icon="hdd-network-fill"
                                    /></kbd>
                                  &nbsp;<kbd class="alert-success no-wrap" style="border-radius: 15px;">
                                    <b>&nbsp;&nbsp;{{ locationRow.item.ip }}&nbsp;&nbsp;</b>
                                  </kbd>
                                </div>
                              </template>
                              <template #cell(visit)="locationRow">
                                <div class="d-flex justify-content-end">
                                  <b-button
                                    v-b-tooltip.hover.top="'Visit App'"
                                    size="sm"
                                    class="mr-1"
                                    pill
                                    variant="dark"
                                    @click="openApp(row.item.name, locationRow.item.ip.split(':')[0], getProperPort(row.item))"
                                  >
                                    <b-icon
                                      scale="1"
                                      icon="door-open"
                                    />
                                    App
                                  </b-button>
                                  <b-button
                                    v-b-tooltip.hover.top="'Visit FluxNode'"
                                    size="sm"
                                    class="mr-0"
                                    pill
                                    variant="outline-dark"
                                    @click="openNodeFluxOS(locationRow.item.ip.split(':')[0], locationRow.item.ip.split(':')[1] ? +locationRow.item.ip.split(':')[1] - 1 : 16126)"
                                  >
                                    <b-icon
                                      scale="1"
                                      icon="house-door-fill"
                                    />
                                    FluxNode
                                  </b-button>&nbsp;&nbsp;
                                </div>
                              </template>
                            </b-table>
                          </b-col>
                          <b-col cols="12">
                            <b-pagination
                              v-model="appLocationOptions.currentPage"
                              :total-rows="appLocations?.length || 1"
                              :per-page="appLocationOptions.perPage"
                              align="center"
                              size="sm"
                              class="my-0 mt-1"
                            />
                          </b-col>
                        </b-row>
                      </b-card>
                    </template>
                    <template #cell(install)="row">
                      <b-button
                        :id="`install-app-${row.item.name}`"
                        v-b-tooltip.hover.top="'Install App'"
                        size="sm"
                        class="mr-0 no-wrap"
                        pill
                        variant="primary"
                      >
                        <b-icon
                          scale="0.9"
                          icon="layer-forward"
                        />
                        Install
                      </b-button>
                      <confirm-dialog
                        :target="`install-app-${row.item.name}`"
                        confirm-button="Install App"
                        @confirm="installAppLocally(row.item.name)"
                      />
                    </template>
                  </b-table>
                </b-col>
                <b-col cols="12">
                  <b-pagination
                    v-model="tableconfig.globalAvailable.currentPage"
                    :total-rows="tableconfig?.globalAvailable?.apps?.length || 1"
                    :per-page="tableconfig.globalAvailable.perPage"
                    align="center"
                    size="sm"
                    class="my-0 mt-1"
                  />
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
                    outlined
                    responsive
                    :per-page="tableconfig.local.perPage"
                    :current-page="tableconfig.local.currentPage"
                    :items="tableconfig.local.apps"
                    :fields="tableconfig.local.fields"
                    :sort-by.sync="tableconfig.local.sortBy"
                    :sort-desc.sync="tableconfig.local.sortDesc"
                    :sort-direction="tableconfig.local.sortDirection"
                    :filter="tableconfig.local.filter"
                    :filter-included-fields="['name']"
                    show-empty
                    sort-icon-left
                    :empty-text="'No Local Apps owned.'"
                    @filtered="onFilteredLocal"
                  >
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
                          <span :class="{ 'red-text': isLessThanTwoDays(labelForExpire(row.item.expire, row.item.height)) }" class="no-wrap">
                            &nbsp;&nbsp;<b-icon scale="1.2" icon="hourglass-split" />
                            {{ labelForExpire(row.item.expire, row.item.height) }}&nbsp;&nbsp;
                          </span>
                        </small>
                      </div>
                    </template>
                    <template #cell(visit)="row">
                      <b-button
                        v-b-tooltip.hover.top="'Visit App'"
                        size="sm"
                        class="mr-0 no-wrap hover-underline"
                        variant="link"
                        @click="openApp(row.item.name)"
                      >
                        <b-icon
                          scale="1"
                          icon="front"
                        />
                        Visit
                      </b-button>
                    </template>
                    <template #cell(description)="row">
                      <kbd class="text-secondary textarea" style="float: left; text-align:left;">{{ row.item.description }}</kbd>
                    </template>
                    <template #cell(state)="row">
                      <kbd :class="getBadgeClass(row.item.name)" style="border-radius: 15px">&nbsp;<b>{{ getStateByName(row.item.name) }}</b>&nbsp;</kbd>
                    </template>

                    <template #cell(show_details)="row">
                      <a @click="showLocations(row, tableconfig.local.apps)">
                        <v-icon
                          v-if="!row.detailsShowing"
                          name="chevron-down"
                          class="ml-1"
                        />
                        <v-icon
                          v-if="row.detailsShowing"
                          name="chevron-up"
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
                        <div class="ml-1">
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
                            <div class="ml-1">
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
                                :data="constructAutomaticDomains(component.ports, component.name, row.item.name, index).toString()"
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
                        <h3 class="no-wrap align-items-center justify-content-center">
                          <kbd class="alert-info d-flex" style="border-radius: 15px; font-family: monospace; padding-right: 100%">
                            <b-icon
                              scale="1"
                              icon="pin-map-fill"
                              style="margin-top: 2px; margin-left: 10px;"
                            />
                            <span style="margin-left: 10px;">Locations</span>
                          </kbd>
                        </h3>
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
                                  v-model="appLocationOptions.filterTree"
                                  type="search"
                                  placeholder="Type to Search"
                                />
                                <b-input-group-append>
                                  <b-button
                                    :disabled="!appLocationOptions.filterTree"
                                    @click="appLocationOptions.filterTree = ''"
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
                              borderless
                              :per-page="appLocationOptions.perPage"
                              :current-page="appLocationOptions.currentPage"
                              :items="appLocations"
                              :fields="appLocationFields"
                              thead-class="d-none"
                              :filter="appLocationOptions.filterTree"
                              show-empty
                              sort-icon-left
                              empty-text="No instances found.."
                            >
                              <template #cell(ip)="locationRow">
                                <div class="no-wrap">
                                  <kbd class="alert-info" style="border-radius: 15px;">
                                    <b-icon
                                      scale="1.1"
                                      icon="hdd-network-fill"
                                    /></kbd>
                                  &nbsp;<kbd class="alert-success no-wrap" style="border-radius: 15px;">
                                    <b>&nbsp;&nbsp;{{ locationRow.item.ip }}&nbsp;&nbsp;</b>
                                  </kbd>
                                </div>
                              </template>
                              <template #cell(visit)="locationRow">
                                <div class="d-flex justify-content-end">
                                  <b-button
                                    v-b-tooltip.hover.top="'Visit App'"
                                    size="sm"
                                    class="mr-1"
                                    pill
                                    variant="dark"
                                    @click="openApp(row.item.name, locationRow.item.ip.split(':')[0], getProperPort(row.item))"
                                  >
                                    <b-icon
                                      scale="1"
                                      icon="door-open"
                                    />
                                    App
                                  </b-button>
                                  <b-button
                                    v-b-tooltip.hover.top="'Visit FluxNode'"
                                    size="sm"
                                    class="mr-0"
                                    pill
                                    variant="outline-dark"
                                    @click="openNodeFluxOS(locationRow.item.ip.split(':')[0], locationRow.item.ip.split(':')[1] ? +locationRow.item.ip.split(':')[1] - 1 : 16126)"
                                  >
                                    <b-icon
                                      scale="1"
                                      icon="house-door-fill"
                                    />
                                    FluxNode
                                  </b-button>&nbsp;&nbsp;
                                </div>
                              </template>
                            </b-table>
                          </b-col>
                          <b-col cols="12">
                            <b-pagination
                              v-model="appLocationOptions.currentPage"
                              :total-rows="appLocations?.length || 1"
                              :per-page="appLocationOptions.perPage"
                              align="center"
                              size="sm"
                              class="my-0 mt-1"
                            />
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
                      <b-button-toolbar>
                        <b-button-group size="sm">
                          <b-button
                            :id="`start-local-app-${row.item.name}`"
                            v-b-tooltip.hover.top="'Start App'"
                            :disabled="isAppInList(row.item.name, tableconfig.running.apps)"
                            size="sm"
                            class="no-wrap"
                            variant="outline-dark"
                          >
                            <b-icon
                              scale="1.2"
                              icon="play-fill"
                              class="icon-style-start"
                              :class="{ 'disable-hover': isAppInList(row.item.name, tableconfig.running.apps) }"
                            />
                          </b-button>
                          <confirm-dialog
                            :target="`start-local-app-${row.item.name}`"
                            confirm-button="Start App"
                            @confirm="startApp(row.item.name)"
                          />
                          <b-button
                            :id="`stop-local-app-${row.item.name}`"
                            v-b-tooltip.hover.top="'Stop App'"
                            size="sm"
                            class="mr-0"
                            variant="outline-dark"
                            :disabled="!isAppInList(row.item.name, tableconfig.running.apps)"
                          >
                            <b-icon
                              scale="1.2"
                              icon="stop-circle"
                              class="icon-style-stop"
                              :class="{ 'disable-hover': !isAppInList(row.item.name, tableconfig.running.apps) }"
                            />
                          </b-button>
                          <confirm-dialog
                            :target="`stop-local-app-${row.item.name}`"
                            confirm-button="Stop App"
                            @confirm="stopApp(row.item.name)"
                          />
                          <b-button
                            :id="`restart-local-app-${row.item.name}`"
                            v-b-tooltip.hover.top="'Restart App'"
                            size="sm"
                            class="no-wrap"
                            variant="outline-dark"
                          >
                            <b-icon
                              scale="1"
                              icon="bootstrap-reboot"
                              class="icon-style-restart"
                            />
                          </b-button>
                          <confirm-dialog
                            :target="`restart-local-app-${row.item.name}`"
                            confirm-button="Restart App"
                            @confirm="restartApp(row.item.name)"
                          />
                          <b-button
                            :id="`remove-local-app-${row.item.name}`"
                            v-b-tooltip.hover.top="'Remove App'"
                            size="sm"
                            class="no-wrap"
                            variant="outline-dark"
                          >
                            <b-icon
                              scale="1"
                              icon="trash"
                              class="icon-style-trash"
                            />
                          </b-button>
                          <confirm-dialog
                            :target="`remove-local-app-${row.item.name}`"
                            confirm-button="Remove App"
                            @confirm="removeApp(row.item.name)"
                          />
                          <b-button
                            :id="`manage-local-app-${row.item.name}`"
                            v-b-tooltip.hover.top="'Manage App'"
                            size="sm"
                            class="no-wrap"
                            variant="outline-dark"
                          >
                            <b-icon
                              scale="1"
                              icon="gear"
                              class="icon-style-gear"
                            />
                          </b-button>
                          <confirm-dialog
                            :target="`manage-local-app-${row.item.name}`"
                            confirm-button="Manage App"
                            @confirm="openAppManagement(row.item.name)"
                          />
                        </b-button-group>
                      </b-button-toolbar>
                    </template>
                  </b-table>
                </b-col>
                <b-col cols="12">
                  <div class="d-flex justify-content-between align-items-center">
                    <div>
                      <div v-if="isLoggedIn() && tableconfig?.local?.totalRows > 0" class="d-inline ml-2">
                        <b-icon scale="1.4" icon="layers" />
                        <b>&nbsp;&nbsp;<kbd class="alert-success" style="border-radius: 15px;">&nbsp;{{ tableconfig.local.totalRows }}&nbsp;</kbd></b>
                      </div>
                    </div>
                    <div class="text-center flex-grow-1">
                      <b-pagination
                        v-if="tableconfig?.local?.totalRows > 0"
                        v-model="tableconfig.local.currentPage"
                        :total-rows="tableconfig.local.totalRows"
                        :per-page="tableconfig.local.perPage"
                        align="center"
                        size="sm"
                        class="my-0 mt-1"
                      />
                    </div>
                  </div>
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
              ref="outputTextarea"
              plaintext
              no-resize
              :rows="output.length + 1"
              :value="stringOutput()"
              class="mt-1"
            />
          </b-col>
          <b-col
            v-if="downloadOutputReturned"
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
import {
  BTabs,
  BTab,
  BTable,
  BCol,
  BCard,
  // BCardTitle,
  BRow,
  BButton,
  BFormGroup,
  BButtonToolbar,
  BButtonGroup,
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

const store = require('store');
const qs = require('qs');
const timeoptions = require('@/libs/dateFormat');

const geolocations = require('../../libs/geolocation');

export default {
  components: {
    BTabs,
    BTab,
    BTable,
    BCol,
    BCard,
    // BCardTitle,
    BRow,
    BButton,
    BButtonToolbar,
    BButtonGroup,
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
      stateAppsNames: [],
      tableKey: 0,
      timeoptions,
      output: [],
      downloading: false,
      downloadOutputReturned: false,
      downloadOutput: {
      },
      managedApplication: '',
      daemonBlockCount: -1,
      tableconfig: {
        running: {
          apps: [],
          status: '',
          loggedInFields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'description', label: 'Description' },
            { key: 'visit', label: 'Visit', thStyle: { width: '3%' } },
            { key: 'actions', label: 'Actions', thStyle: { width: '15%' } },
          ],
          fields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'description', label: 'Description' },
            { key: 'visit', label: 'Visit', thStyle: { width: '3%' } },
          ],
          loading: true,
        },
        installed: {
          apps: [],
          status: '',
          loggedInFields: [
            { key: 'show_details', label: '' },
            // eslint-disable-next-line object-curly-newline
            { key: 'name', label: 'Name', sortable: true },
            {
              key: 'state', label: 'State', class: 'text-center', thStyle: { width: '2%' },
            },
            {
              key: 'description', label: 'Description', class: 'text-left',
            },
            { key: 'actions', label: '', thStyle: { width: '12%' } },
            // eslint-disable-next-line object-curly-newline
            { key: 'visit', label: '', class: 'text-center', thStyle: { width: '2%' } },
          ],
          fields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'description', label: 'Description' },
            // eslint-disable-next-line object-curly-newline
            { key: 'visit', label: '', class: 'text-center', thStyle: { width: '3%' } },
          ],
          loading: true,
        },
        available: {
          apps: [],
          status: '',
          loggedInFields: [
            { key: 'show_details', label: '' },
            // eslint-disable-next-line object-curly-newline
            { key: 'name', label: 'Name', sortable: true, thStyle: { width: '18%' } },
            { key: 'description', label: 'Description', thStyle: { width: '75%' } },
            { key: 'install', label: '', thStyle: { width: '5%' } },
          ],
          fields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'description', label: 'Description', thStyle: { width: '80%' } },
          ],
          loading: true,
        },
        globalAvailable: {
          apps: [],
          status: '',
          loggedInFields: [
            { key: 'show_details', label: '' },
            // eslint-disable-next-line object-curly-newline
            { key: 'name', label: 'Name', sortable: true, thStyle: { width: '18%' } },
            { key: 'description', label: 'Description', thStyle: { width: '75%' } },
            { key: 'install', label: '', thStyle: { width: '5%' } },
          ],
          fields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'description', label: 'Description', thStyle: { width: '80%' } },
          ],
          loading: true,
          perPage: 50,
          pageOptions: [5, 10, 25, 50, 100],
          filter: '',
          filterOn: [],
          currentPage: 1,
          totalRows: 1,
        },
        local: {
          apps: [],
          status: '',
          fields: [
            { key: 'show_details', label: '' },
            { key: 'name', label: 'Name', sortable: true },
            { key: 'description', label: 'Description' },
            { key: 'actions', label: '', thStyle: { width: '15%' } },
            // eslint-disable-next-line object-curly-newline
            { key: 'visit', label: '', class: 'text-center', thStyle: { width: '3%' } },
          ],
          perPage: 5,
          pageOptions: [5, 10, 25, 50, 100],
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
        perPage: 5,
        pageOptions: [5, 10, 25, 50, 100],
        currentPage: 1,
        totalRows: 1,
        filterOne: '',
        filterTwo: '',
        filterTree: '',
      },
      callResponse: { // general
        status: '',
        data: '',
      },
    };
  },
  computed: {
    ...mapState('flux', [
      'config',
      'userconfig',
      'privilege',
    ]),
    isApplicationInstalledLocally() {
      if (this.tableconfig.installed.apps) {
        const installed = this.tableconfig.installed.apps.find((app) => app.name === this.managedApplication);
        if (installed) {
          return true;
        }
        return false;
      }
      return false;
    },
  },
  mounted() {
    this.getFluxNodeStatus();
    this.appsGetAvailableApps();
    this.appsGetListRunningApps();
    this.appsGetInstalledApps();
    this.appsGetListGlobalApps();
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
    this.getDaemonBlockCount();
  },
  methods: {
    openNodeFluxOS(_ip, _port) {
      console.log(_ip, _port);
      if ((_port && _ip)) {
        const ip = _ip;
        const port = _port;
        const url = `http://${ip}:${port}`;
        this.openSite(url);
      } else {
        this.showToast('danger', 'Unable to open FluxOS :(');
      }
    },
    tabChanged() {
      this.tableconfig.installed.apps.forEach((item) => {
        this.$set(item, '_showDetails', false);
      });
      this.tableconfig.available.apps.forEach((item) => {
        this.$set(item, '_showDetails', false);
      });
      this.tableconfig.globalAvailable.apps.forEach((item) => {
        this.$set(item, '_showDetails', false);
      });
      this.appLocations = [];
      if (this.downloading === false) {
        this.output = [];
      }
    },
    isLessThanTwoDays(timeString) {
      const parts = timeString?.split(',').map((str) => str.trim());
      let days = 0;
      let hours = 0;
      let minutes = 0;
      // eslint-disable-next-line no-restricted-syntax
      for (const part of parts) {
        if (part.includes('days')) {
          days = parseInt(part, 10);
        } else if (part.includes('hours')) {
          hours = parseInt(part, 10);
        } else if (part.includes('minutes')) {
          minutes = parseInt(part, 10);
        }
      }
      const totalMinutes = ((days * 24 * 60) + (hours * 60) + minutes);
      return totalMinutes < 2880;
    },
    getServiceUsageValue(index, name, compose) {
      if (typeof compose?.compose === 'undefined') {
        this.usage = [+compose.ram, +compose.cpu, +compose.hdd];
        return this.usage[index];
      }
      const serviceUsage = this.getServiceUsage(name, compose.compose);
      return serviceUsage[index];
    },
    getServiceUsage(serviceName, spec) {
      // Calculate total RAM, CPU, and HDD usage using reduce method
      const [totalRAM, totalCPU, totalHDD] = spec.reduce((acc, composeObj) => {
        // Ensure composeObj properties are numbers
        const ram = +composeObj.ram || 0;
        const cpu = +composeObj.cpu || 0;
        const hdd = +composeObj.hdd || 0;
        // Add to accumulator
        acc[0] += ram;
        acc[1] += cpu;
        acc[2] += hdd;
        return acc;
      }, [0, 0, 0]);
      return [totalRAM, totalCPU.toFixed(1), totalHDD];
    },
    getBadgeClass(appName) {
      const state = this.getStateByName(appName);
      return {
        'alert-success': state === 'running',
        'alert-danger': state === 'stopped',
      };
    },
    getStateByName(appName) {
      const filteredApps = this.stateAppsNames.filter((obj) => obj.name === appName);
      if (filteredApps?.length > 0) {
        return filteredApps[0].state;
      // eslint-disable-next-line no-else-return
      } else {
        return 'stopped';
      }
    },
    isAppInList(appName, appList) {
      // console.log(appList.length);
      if (appList?.length === 0) {
        return false;
      }
      // console.log(appList.some((app) => app.name === appName));
      return appList.some((app) => app.name === appName);
    },
    // getStateByName(name, data) {
    //   const foundObject = data.find((obj) => obj.Names.some((n) => n.includes(`_${name}`)));
    //   if (foundObject) {
    //     return true;
    //   // eslint-disable-next-line no-else-return
    //   } else {
    //     return false;
    //   }
    // },
    minutesToString(minutes) {
      let value = minutes * 60;
      const units = {
        day: 24 * 60 * 60,
        hour: 60 * 60,
        minute: 60,
        second: 1,
      };
      const result = [];
      // eslint-disable-next-line no-restricted-syntax, guard-for-in
      for (const name in units) {
        const p = Math.floor(value / units[name]);
        if (p === 1) result.push(` ${p} ${name}`);
        if (p >= 2) result.push(` ${p} ${name}s`);
        value %= units[name];
      }
      return result;
    },
    labelForExpire(expire, height) {
      if (this.daemonBlockCount === -1) {
        return 'Not possible to calculate expiration';
      }
      const forkBlock = 2020000;
      // After PON fork, default expire is 88000 blocks (4x22000)
      const defaultExpire = height >= forkBlock ? 88000 : 22000;
      const expires = expire || defaultExpire;
      let effectiveExpiry = height + expires;

      // If app was registered before the fork (block 2020000) and we're currently past the fork,
      // adjust the expiry calculation since the blockchain moves 4x faster post-fork
      if (height < forkBlock && this.daemonBlockCount >= forkBlock && effectiveExpiry > forkBlock) {
        const remainingBlocksAfterFork = effectiveExpiry - forkBlock;
        effectiveExpiry = forkBlock + (remainingBlocksAfterFork * 4);
      }

      const blocksToExpire = effectiveExpiry - this.daemonBlockCount;
      if (blocksToExpire < 1) {
        return 'Application Expired';
      }
      // Block time: 2 minutes before fork (block 2020000), 30 seconds (0.5 minutes) after fork
      const minutesPerBlock = this.daemonBlockCount >= forkBlock ? 0.5 : 2;
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
    async appsGetListGlobalApps() {
      this.tableconfig.globalAvailable.loading = true;
      const response = await AppsService.globalAppSpecifications();
      console.log(response);
      // remove marketplace apps from the list and extract
      // marketplace apps to parse the title
      const apps = response.data.data.sort((a, b) => (a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1));
      this.tableconfig.globalAvailable.apps = apps;
      this.tableconfig.globalAvailable.loading = false;
      this.tableconfig.globalAvailable.status = response.data.status;
    },
    async getDaemonBlockCount() {
      const response = await DaemonService.getBlockCount();
      if (response.data.status === 'success') {
        this.daemonBlockCount = response.data.data;
      }
    },
    async getFluxNodeStatus() {
      const response = await DaemonService.getFluxNodeStatus();
      if (response.data.status === 'success') {
        this.tier = response.data.data.tier;
      }
    },
    async appsGetInstalledApps() {
      this.tableconfig.installed.loading = true;
      const response = await AppsService.installedApps();
      // console.log(response);
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
        // console.log(response.data);
        // this is coming from docker;
        const apps = response.data.data;
        const runningAppsNames = [];
        const runningAppsSpecifics = [];
        self.stateAppsNames = [];
        apps.forEach((app) => {
          // get application specification IF it is composed app
          const appName = app.Names[0].startsWith('/flux') ? app.Names[0].slice(5) : app.Names[0].slice(4);
          if (appName.includes('_')) {
            runningAppsNames.push(appName.split('_')[1]);
            if (!appName.includes('watchtower')) {
              const jsonObject = {
                name: appName.split('_')[1],
                state: app.State,
              };
              self.stateAppsNames.push(jsonObject);
            }
          } else {
            runningAppsNames.push(appName);
            if (!appName.includes('watchtower')) {
              const jsonObject = {
                name: appName,
                state: app.State,
              };
              self.stateAppsNames.push(jsonObject);
            }
          }
        });
        // console.log(self.stateAppsNames);
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
        // console.log(response);
        self.tableconfig.running.status = response.data.status;
        self.tableconfig.running.apps = runningAppsSpecifics;
        self.tableconfig.running.loading = false;
        self.tableconfig.running.status = response.data.data;
      }, timeout);
    },
    async appsGetAvailableApps() {
      this.tableconfig.available.loading = true;
      const response = await AppsService.availableApps();
      // console.log(response);
      this.tableconfig.available.status = response.data.status;
      this.tableconfig.available.apps = response.data.data;
      this.tableconfig.available.loading = false;
    },
    openApp(name, _ip, _port) {
      if (_port && _ip) {
        // console.log(name, _ip, _port);
        const url = `http://${_ip}:${_port}`;
        this.openSite(url);
      } else {
        const appInfo = this.installedApp(name);
        const backendURL = store.get('backendURL') || `http://${this.userconfig.externalip}:${this.config.apiPort}`;
        const ip = backendURL.split(':')[1].split('//')[1];
        const port = appInfo.port || appInfo.ports ? appInfo?.ports[0] : appInfo?.compose[0].ports[0];
        // console.log(name, ip, port);
        if (port === '') {
          this.showToast('danger', 'Unable to open App :(, App does not have a port.');
          return;
        }
        const url = `http://${ip}:${port}`;
        this.openSite(url);
      }
    },
    getProperPort(appSpecs) {
      if (appSpecs.port) {
        return appSpecs.port;
      }
      if (appSpecs.ports) {
        return appSpecs.ports[0];
      }
      for (let i = 0; i < appSpecs.compose.length; i += 1) {
        for (let j = 0; j < appSpecs.compose[i].ports.length; j += 1) {
          if (appSpecs.compose[i].ports[j]) return appSpecs.compose[i].ports[j];
        }
      }
      return null;
    },
    installedApp(appName) {
      return this.tableconfig.installed.apps.find((app) => app.name === appName);
    },
    openSite(url) {
      const win = window.open(url, '_blank');
      win.focus();
    },
    async stopApp(app) {
      this.output = [];
      this.showToast('warning', `Stopping ${this.getAppName(app)}`);
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.stopApp(zelidauth, app);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      this.appsGetListRunningApps(5000);
      // console.log(response);
    },
    async startApp(app) {
      this.output = [];
      this.showToast('warning', `Starting ${this.getAppName(app)}`);
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.startApp(zelidauth, app);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      this.appsGetListRunningApps(5000);
      // console.log(response);
    },
    async restartApp(app) {
      this.output = [];
      this.showToast('warning', `Restarting ${this.getAppName(app)}`);
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.restartApp(zelidauth, app);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      this.appsGetListRunningApps(5000);
      // console.log(response);
    },
    async pauseApp(app) {
      this.output = [];
      this.showToast('warning', `Pausing ${this.getAppName(app)}`);
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.pauseApp(zelidauth, app);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      // console.log(response);
    },
    async unpauseApp(app) {
      this.output = [];
      this.showToast('warning', `Unpausing ${this.getAppName(app)}`);
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.unpauseApp(zelidauth, app);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      // console.log(response);
    },
    redeployAppSoft(app) {
      this.redeployApp(app, false);
    },
    redeployAppHard(app) {
      this.redeployApp(app, true);
    },
    async redeployApp(app, force) {
      const self = this;
      this.output = [];
      this.downloadOutput = {};
      this.downloadOutputReturned = false;
      this.showToast('warning', `Redeploying ${this.getAppName(app)}`);
      const zelidauth = localStorage.getItem('zelidauth');
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.event.target.response);
          self.output = JSON.parse(`[${progressEvent.event.target.response.replace(/}{/g, '},{')}]`);
        },
      };
      const response = await AppsService.justAPI().get(`/apps/redeploy/${app}/${force}`, axiosConfig);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
        if (this.output[this.output.length - 1].status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else if (this.output[this.output.length - 1].status === 'warning') {
          this.showToast('warning', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          this.showToast('success', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        }
      }
    },
    async removeApp(app) {
      const appName = this.getAppName(app);
      const self = this;
      this.output = [];
      this.showToast('warning', `Removing ${appName}`);
      const zelidauth = localStorage.getItem('zelidauth');
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.event.target.response);
          self.output = JSON.parse(`[${progressEvent.event.target.response.replace(/}{/g, '},{')}]`);
        },
      };
      const response = await AppsService.justAPI().get(`/apps/appremove/${app}`, axiosConfig);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
        if (this.output[this.output.length - 1].status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else if (this.output[this.output.length - 1].status === 'warning') {
          this.showToast('warning', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          this.showToast('success', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        }
        setTimeout(() => {
          this.appsGetInstalledApps();
          this.appsGetListRunningApps();
          self.managedApplication = '';
        }, 5000);
      }
    },
    async installAppLocally(app) {
      const appName = this.getAppName(app);
      const self = this;
      this.output = [];
      this.downloadOutput = {};
      this.downloadOutputReturned = false;
      this.downloading = true;
      this.showToast('warning', `Installing ${appName}`);
      const zelidauth = localStorage.getItem('zelidauth');
      // const response = await AppsService.installAppLocally(zelidauth, app);
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.event.target.response);
          self.output = JSON.parse(`[${progressEvent.event.target.response.replace(/}{/g, '},{')}]`);
        },
      };
      const response = await AppsService.justAPI().get(`/apps/installapplocally/${app}`, axiosConfig);
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
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else if (this.output[this.output.length - 1].status === 'warning') {
          this.showToast('warning', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          this.showToast('success', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        }
        this.appsGetInstalledApps();
        this.appsGetListRunningApps();
      }
      this.downloading = false;
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
    isFluxAdminLoggedIn() {
      return (this.privilege === 'fluxteam');
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
          this.downloadOutputReturned = true;
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: output.progressDetail,
            variant: 'danger',
          });
        } else if (output.status === 'Verifying Checksum') {
          this.downloadOutputReturned = true;
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: { current: 1, total: 1 },
            variant: 'warning',
          });
        } else if (output.status === 'Download complete') {
          this.downloadOutputReturned = true;
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: { current: 1, total: 1 },
            variant: 'info',
          });
        } else if (output.status === 'Extracting') {
          this.downloadOutputReturned = true;
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: output.progressDetail,
            variant: 'primary',
          });
        } else if (output.status === 'Pull complete') {
          this.downloadOutputReturned = true;
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: { current: 1, total: 1 },
            variant: 'success',
          });
        } else if (output.status === 'error') {
          string += `Error: ${JSON.stringify(output.data)}\r\n`;
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
    // eslint-disable-next-line default-param-last
    constructAutomaticDomains(ports, componentName = '', appName, index = 0) {
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
  },
};
</script>

<style>
.apps-installed-table thead th,
.apps-installed-table tbody td {
  text-transform: none !important;
}
.apps-available-table thead th,
.apps-available-table tbody td {
  text-transform: none !important;
}
.apps-available-table thead th,
.apps-available-table tbody td {
  text-transform: none !important;
}
.apps-globalAvailable-table thead th,
.apps-globalAvailable-tablet body td {
  text-transform: none !important;
}
.apps-local-table thead th,
.apps-local-table tbody td {
  text-transform: none !important;
}

.apps-running-table td:nth-child(1) {
  padding: 0 0 0 5px;
}
.apps-running-table th:nth-child(1) {
  padding: 0 0 0 5px;
}

.apps-local-table td:nth-child(1) {
  padding: 0 0 0 5px;
}
.apps-local-table th:nth-child(1) {
  padding: 0 0 0 5px;
}

.apps-installed-table td:nth-child(1) {
  padding: 0 0 0 5px;
}
.apps-installed-table th:nth-child(1) {
  padding: 0 0 0 5px;
}

.apps-globalAvailable-table td:nth-child(1) {
  padding: 0 0 0 5px;
}

.apps-globalAvailable-table th:nth-child(1) {
  padding: 0 0 0 5px;
}

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

.icon-style-trash:hover {
  color: red; /* Color on hover */
  transition: color 0.2s;
}
.icon-style-start:hover {
  color: green; /* Color on hover */
  transition: color 0.2s;
}
.icon-style-stop:hover {
  color: red; /* Color on hover */
  transition: color 0.3s;
}
.icon-style-restart:hover {
  color: cornflowerblue; /* Color on hover */
  transition: color 0.2s;
}
.icon-style-gear:hover {
  color: cornflowerblue; /* Color on hover */
  transition: color 0.2s;
}
.disable-hover:hover {
  /* Define a style to disable hover effects */
  /* For example, setting the same styles as normal state to effectively disable hover effects */
  color: inherit;
  background-color: inherit;
  border-color: inherit;
  /* Add any other styles to visually indicate that hover is disabled */
}
.textarea {
 display: block; height: inherit; white-space: normal; border-radius: 10px;
  }
.hover-underline:hover {
    text-decoration: underline;
}
.red-text {
  background-color: rgba(255, 0, 0, 0.25);
  border-radius: 15px;
  display: inline-block;
  margin: 0 0.1em;
  padding: 0.1em 0.6em;
  font-weight: 800;
  color: #FF0000;
}
.no-wrap {
  white-space: nowrap !important;
}
</style>
