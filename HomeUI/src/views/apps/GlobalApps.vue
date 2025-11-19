<template>
  <div>
    <b-tabs
      v-if="!managedApplication"
      pills
      @activate-tab="tabChanged()"
    >
      <b-tab
        title="Active Apps"
      >
        <b-overlay
          :show="tableconfig.active.loading"
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
                    v-model="tableconfig.active.perPage"
                    size="sm"
                    :options="tableconfig.active.pageOptions"
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
                      v-model="tableconfig.active.filter"
                      type="search"
                      placeholder="Type to Search"
                    />
                    <b-input-group-append>
                      <b-button
                        :disabled="!tableconfig.active.filter"
                        @click="tableconfig.active.filter = ''"
                      >
                        Clear
                      </b-button>
                    </b-input-group-append>
                  </b-input-group>
                </b-form-group>
              </b-col>
              <b-col cols="12">
                <b-table
                  class="apps-active-table"
                  striped
                  outlined
                  responsive
                  :per-page="tableconfig.active.perPage"
                  :current-page="tableconfig.active.currentPage"
                  :items="tableconfig.active.apps"
                  :fields="tableconfig.active.fields"
                  :sort-by.sync="tableconfig.active.sortBy"
                  :sort-desc.sync="tableconfig.active.sortDesc"
                  :sort-direction="tableconfig.active.sortDirection"
                  :filter="tableconfig.active.filter"
                  :filter-included-fields="['name']"
                  sort-icon-left
                  show-empty
                  empty-text="No Flux Apps are active"
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
                        <span :class="{ 'red-text': isLessThanTwoDays(labelForExpire(row.item.expire, row.item.height)) }" class="no-wrap">
                          &nbsp;&nbsp;<b-icon scale="1.2" icon="hourglass-split" />
                          {{ labelForExpire(row.item.expire, row.item.height) }}&nbsp;&nbsp;
                        </span>
                      </small>
                    </div>
                  </template>
                  <template #cell(show_details)="row">
                    <a @click="showLocations(row, tableconfig.active.apps)">
                      <v-icon
                        v-if="!row.detailsShowing"
                        class="ml-1"
                        name="chevron-down"
                      />
                      <v-icon
                        v-if="row.detailsShowing"
                        class="ml-1"
                        name="chevron-up"
                      />
                    </a>
                  </template>
                  <template #row-details="row">
                    <b-card class="mx-2">
                      <b-button
                        :id="`copy-active-app-${row.item.name}`"
                        v-b-tooltip.hover.top="'Copy to Clipboard'"
                        size="sm"
                        class="mr-2"
                        variant="outline-dark"
                        pill
                        @click="copyToClipboard(JSON.stringify(row.item))"
                      >
                        <b-icon
                          scale="1"
                          icon="clipboard"
                        />
                        Copy Specifications
                      </b-button>
                      <b-button
                        :id="`deploy-active-app-${row.item.name}`"
                        size="sm"
                        class="mr-2"
                        variant="outline-dark"
                        pill
                      >
                        <b-icon
                          scale="1"
                          icon="building"
                        />
                        Deploy Myself
                      </b-button>
                      <confirm-dialog
                        :target="`deploy-active-app-${row.item.name}`"
                        confirm-button="Deploy App"
                        @confirm="redeployApp(row.item, true)"
                      />
                    </b-card>
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
                            borderless
                            :per-page="appLocationOptions.perPage"
                            :current-page="appLocationOptions.currentPage"
                            :items="appLocations"
                            :fields="appLocationFields"
                            thead-class="d-none"
                            :filter="appLocationOptions.filter"
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
                            class="mt-1 mb-0"
                          />
                        </b-col>
                      </b-row>
                    </b-card>
                  </template>
                  <template #cell(visit)="row">
                    <div class="d-flex no-wrap">
                      <b-button
                        v-if="privilege === 'fluxteam'"
                        :id="`manage-installed-app-${row.item.name}`"
                        v-b-tooltip.hover.top="'Manage Installed App'"
                        size="sm"
                        class="mr-0"
                        variant="outline-dark"
                      >
                        <b-icon
                          scale="1"
                          icon="gear"
                        />
                        Manage
                      </b-button>
                      <confirm-dialog
                        :target="`manage-installed-app-${row.item.name}`"
                        confirm-button="Manage App"
                        @confirm="openAppManagement(row.item.name)"
                      />
                      <b-button
                        v-b-tooltip.hover.top="'Visit App'"
                        size="sm"
                        class="mr-0 no-wrap hover-underline"
                        variant="link"
                        @click="openGlobalApp(row.item.name)"
                      >
                        <b-icon
                          scale="1"
                          icon="front"
                        />
                        Visit
                      </b-button>&nbsp;&nbsp;&nbsp;
                    </div>
                  </template>
                </b-table>
              </b-col>
            </b-row>
            <b-col cols="12">
              <b-pagination
                v-model="tableconfig.active.currentPage"
                :total-rows="tableconfig.active?.apps?.length || 1"
                :per-page="tableconfig.active.perPage"
                align="center"
                size="sm"
                class="mt-1 mb-0"
              />
            </b-col>
          </b-card>
        </b-overlay>
      </b-tab>
      <b-tab title="Marketplace Deployments">
        <b-overlay
          :show="tableconfig.active.loading"
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
                    v-model="tableconfig.active_marketplace.perPage"
                    size="sm"
                    :options="tableconfig.active_marketplace.pageOptions"
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
                      v-model="tableconfig.active_marketplace.filter"
                      type="search"
                      placeholder="Type to Search"
                    />
                    <b-input-group-append>
                      <b-button
                        :disabled="!tableconfig.active_marketplace.filter"
                        @click="tableconfig.active_marketplace.filter = ''"
                      >
                        Clear
                      </b-button>
                    </b-input-group-append>
                  </b-input-group>
                </b-form-group>
              </b-col>
              <b-col cols="12">
                <b-table
                  class="apps-active-table"
                  striped
                  outlined
                  responsive
                  :items="tableconfig.active_marketplace.apps"
                  :fields="tableconfig.active_marketplace.fields"
                  :per-page="tableconfig.active_marketplace.perPage"
                  :current-page="tableconfig.active_marketplace.currentPage"
                  :filter="tableconfig.active_marketplace.filter"
                  :filter-included-fields="['name']"
                  show-empty
                  sort-icon-left
                  empty-text="No Flux Marketplace Apps are active"
                >
                  <template #cell(visit)="row">
                    <div class="d-flex no-wrap">
                      <b-button
                        v-if="privilege === 'fluxteam'"
                        :id="`manage-installed-app-${row.item.name}`"
                        v-b-tooltip.hover.top="'Manage Installed App'"
                        size="sm"
                        class="mr-0"
                        variant="outline-dark"
                      >
                        <b-icon
                          scale="1"
                          icon="gear"
                        />
                        Manage
                      </b-button>
                      <confirm-dialog
                        :target="`manage-installed-app-${row.item.name}`"
                        confirm-button="Manage App"
                        @confirm="openAppManagement(row.item.name)"
                      />
                      <b-button
                        v-b-tooltip.hover.top="'Visit App'"
                        size="sm"
                        class="mr-0 no-wrap hover-underline"
                        variant="link"
                        @click="openGlobalApp(row.item.name)"
                      >
                        <b-icon
                          scale="1"
                          icon="front"
                        />
                        Visit
                      </b-button>
                    </div>
                  </template>
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
                        <span :class="{ 'red-text': isLessThanTwoDays(labelForExpire(row.item.expire, row.item.height)) }" class="no-wrap">
                          &nbsp;&nbsp;<b-icon scale="1.2" icon="hourglass-split" />
                          {{ labelForExpire(row.item.expire, row.item.height) }}&nbsp;&nbsp;
                        </span>
                      </small>
                    </div>
                  </template>
                  <template #cell(show_details)="row">
                    <a @click="showLocations(row, tableconfig.active_marketplace.apps)">
                      <v-icon
                        v-if="!row.detailsShowing"
                        class="ml-1"
                        name="chevron-down"
                      />
                      <v-icon
                        v-if="row.detailsShowing"
                        class="ml-1"
                        name="chevron-up"
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
                            borderless
                            :per-page="appLocationOptions.perPage"
                            :current-page="appLocationOptions.currentPage"
                            :items="appLocations"
                            :fields="appLocationFields"
                            thead-class="d-none"
                            :filter="appLocationOptions.filter"
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
                            <!-- <template #cell(visit)="locationRow">
                                <b-button
                                  size="sm"
                                  class="mr-0"
                                  variant="danger"
                                  @click="openApp(row.item.name, locationRow.item.ip.split(':')[0], getProperPort(row.item))"
                                >
                                  Visit
                                </b-button>
                              </template> -->
                          </b-table>
                        </b-col>
                        <b-col cols="12">
                          <b-pagination
                            v-model="appLocationOptions.currentPage"
                            :total-rows="appLocations?.length || 1"
                            :per-page="appLocationOptions.perPage"
                            align="center"
                            size="sm"
                            class="mt-1 mb-0"
                          />
                        </b-col>
                      </b-row>
                    </b-card>
                  </template>
                </b-table>
              </b-col>
            </b-row>
            <b-col cols="12">
              <b-pagination
                v-model="tableconfig.active_marketplace.currentPage"
                :total-rows="tableconfig.active_marketplace?.apps?.length || 1"
                :per-page="tableconfig.active_marketplace.perPage"
                align="center"
                size="sm"
                class="mt-1 mb-0"
              />
            </b-col>
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
  // BCardTitle,
  BRow,
  BButton,
  BOverlay,
  VBTooltip,
} from 'bootstrap-vue';

import Ripple from 'vue-ripple-directive';
import { mapState } from 'vuex';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ListEntry from '@/views/components/ListEntry.vue';
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';
import Management from '@/views/apps/Management.vue';
import AppsService from '@/services/AppsService';
import DaemonService from '@/services/DaemonService';

const qs = require('qs');

const geolocations = require('../../libs/geolocation');

export default {
  components: {
    BTabs,
    BTab,
    BTable,
    BCol,
    BCard,
    // bBCardTitle,
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
    'b-tooltip': VBTooltip,
    Ripple,
  },
  data() {
    return {
      managedApplication: '',
      daemonBlockCount: -1,
      appLocations: [],
      appLocationFields: [
        { key: 'ip', label: 'Locations', thStyle: { width: '30%' } },
        { key: 'visit', label: '' },
      ],
      myappLocations: [],
      myappLocationFields: [
        { key: 'ip', label: 'IP Address', thStyle: { width: '30%' } },
        { key: 'visit', label: '' },
      ],
      tableconfig: {
        active: {
          apps: [],
          fields: [
            { key: 'show_details', label: '' },
            // eslint-disable-next-line object-curly-newline
            { key: 'name', label: 'Name', sortable: true, thStyle: { width: '18%' } },
            { key: 'description', label: 'Description', thStyle: { width: '75%' } },
            // eslint-disable-next-line object-curly-newline
            { key: 'Management', label: '', thStyle: { width: '3%' } },
            // eslint-disable-next-line object-curly-newline
            { key: 'visit', label: '', class: 'text-center', thStyle: { width: '3%' } },
          ],
          loading: true,
          sortBy: '',
          sortDesc: false,
          sortDirection: 'asc',
          filter: '',
          filterOn: [],
          perPage: 25,
          pageOptions: [5, 10, 25, 50, 100],
          currentPage: 1,
          totalRows: 1,
        },
        active_marketplace: {
          apps: [],
          fields: [
            { key: 'show_details', label: '' },
            // eslint-disable-next-line object-curly-newline
            { key: 'name', label: 'Name', sortable: true, thStyle: { width: '18%' } },
            { key: 'description', label: 'Description', thStyle: { width: '75%' } },
            // eslint-disable-next-line object-curly-newline
            { key: 'Management', label: '', thStyle: { width: '3%' } },
            // eslint-disable-next-line object-curly-newline
            { key: 'visit', label: '', class: 'text-center', thStyle: { width: '3%' } },
          ],
          loading: true,
          sortBy: '',
          sortDesc: false,
          sortDirection: 'asc',
          filter: '',
          filterOn: [],
          perPage: 25,
          pageOptions: [5, 10, 25, 50, 100],
          currentPage: 1,
          totalRows: 1,
        },
      },
      allApps: [],
      appLocationOptions: {
        perPage: 5,
        pageOptions: [5, 10, 25, 50, 100],
        currentPage: 1,
        totalRows: 1,
        filterOn: [],
        filter: '',
      },
    };
  },
  computed: {
    ...mapState('flux', [
      'config',
      'userconfig',
      'privilege',
    ]),
    myGlobalApps() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      if (this.allApps) {
        return this.allApps.filter((app) => app.owner === auth.zelid);
      }
      return [];
    },
    isLoggedIn() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      if (auth.zelid) {
        return true;
      }
      return false;
    },
  },
  mounted() {
    this.appsGetListGlobalApps();
    this.getDaemonBlockCount();
  },
  methods: {
    getServiceUsageValue(index, name, compose) {
      // eslint-disable-next-line space-before-blocks
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
      return [totalRAM, totalCPU.toFixed(1), totalHDD];
      // eslint-disable-next-line no-else-return
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
    async getDaemonBlockCount() {
      const response = await DaemonService.getBlockCount();
      if (response.data.status === 'success') {
        this.daemonBlockCount = response.data.data;
      }
    },
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
      this.allApps = response.data.data;
      // remove marketplace apps from the list and extract
      // marketplace apps to parse the title
      this.tableconfig.active.apps = this.allApps.filter((app) => {
        if (app.name.length >= 14) {
          const possibleDateString = app.name.substring(app.name.length - 13, app.name.length);
          const possibleDate = Number(possibleDateString);
          if (!Number.isNaN(possibleDate)) return false;
        }
        return true;
      });
      // only marketplace apps
      this.tableconfig.active_marketplace.apps = this.allApps.filter((app) => {
        if (app.name.length >= 14) {
          const possibleDateString = app.name.substring(app.name.length - 13, app.name.length);
          const possibleDate = Number(possibleDateString);
          if (!Number.isNaN(possibleDate)) return true;
        }
        return false;
      });
      this.tableconfig.active.loading = false;
      this.loadPermanentMessages();
    },
    async loadPermanentMessages() {
      try {
        const zelidauth = localStorage.getItem('zelidauth');
        const auth = qs.parse(zelidauth);
        if (!auth.zelid) {
          return;
        }
        const response = await AppsService.permanentMessagesOwner(auth.zelid);
        const adjustedPermMessages = [];
        // eslint-disable-next-line no-restricted-syntax
        for (const appMess of response.data.data) {
          const appExists = adjustedPermMessages.find((existingApp) => existingApp.appSpecifications.name === appMess.appSpecifications.name);
          if (appExists) {
            if (appMess.height > appExists.height) {
              const index = adjustedPermMessages.findIndex((existingApp) => existingApp.appSpecifications.name === appMess.appSpecifications.name);
              if (index > -1) {
                adjustedPermMessages.splice(index, 1);
                adjustedPermMessages.push(appMess);
              }
            }
          } else {
            adjustedPermMessages.push(appMess);
          }
        }
        const expiredApps = [];
        // eslint-disable-next-line no-restricted-syntax
        for (const appMes of adjustedPermMessages) {
          const appAlreadyDeployed = this.allApps.find((existingApp) => existingApp.name.toLowerCase() === appMes.appSpecifications.name.toLowerCase());
          if (!appAlreadyDeployed) {
            const app = appMes.appSpecifications;
            expiredApps.push(app);
          }
        }
      } catch (error) {
        console.log(error);
      }
    },
    redeployApp(appSpecs, isFromActive = false) {
      const specs = appSpecs;
      if (isFromActive) {
        specs.name += 'XXX';
        specs.name += Date.now().toString().slice(-5);
      }
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      if (auth) {
        specs.owner = auth.zelid;
      } else if (isFromActive) {
        specs.owner = '';
      }
      this.$router.replace({ name: 'apps-registerapp', params: { appspecs: JSON.stringify(appSpecs) } });
    },
    copyToClipboard(appspecs) {
      const specs = JSON.parse(appspecs);
      // eslint-disable-next-line no-underscore-dangle
      delete specs._showDetails;
      const specsString = JSON.stringify(specs);
      const el = document.createElement('textarea');
      el.value = specsString;
      el.setAttribute('readonly', '');
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      this.showToast('success', 'Application Specifications copied to Clipboard');
    },
    openApp(name, _ip, _port) {
      console.log(name, _ip, _port);
      if (_port && _ip) {
        const ip = _ip;
        const port = _port;
        const url = `http://${ip}:${port}`;
        this.openSite(url);
      } else {
        this.showToast('danger', 'Unable to open App :(, App does not have a port.');
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
      this.tableconfig.active_marketplace.apps.forEach((item) => {
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
    getDisplayName(name) {
      const possibleDateString = name.substring(name.length - 13, name.length);
      const possibleDate = Number(possibleDateString);
      if (!Number.isNaN(possibleDate)) {
        return `${name.substring(0, name.length - 13)} - ${new Date(possibleDate).toLocaleString()}`;
      }
      return name;
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
.apps-active-table thead th,
.apps-active-table tbody td {
  text-transform: none !important;
}
.myapps-table thead th,
.myapps-table tbody td {
  text-transform: none !important;
}
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
.wrap-text-info {
  white-space: normal !important;
  overflow-wrap: break-word;
  word-break: break-word;
}
.no-wrap {
  white-space: nowrap !important;
}
</style>
