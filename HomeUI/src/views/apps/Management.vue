<!-- eslint-disable no-restricted-syntax -->
<!-- eslint-disable no-restricted-syntax -->
<!-- eslint-disable guard-for-in -->
<!-- eslint-disable vue/no-use-computed-property-like-method -->
<template>
  <div>
    <div>
      <b-button
        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
        class="mr-2"
        variant="outline-primary"
        pill
        @click="goBackToApps"
      >
        <v-icon name="chevron-left" />
        Back
      </b-button>
      {{ applicationManagementAndStatus }}
    </div>
    <b-tabs
      class="mt-2"
      pills
      style="flex-wrap: nowrap;"
      :vertical="windowWidth > 860 ? true : false"
      lazy
      @input="index => updateManagementTab(index)"
    >
      <b-tab
        v-if="windowWidth > 860"
        title="Local App Management"
        disabled
      />
      <b-tab
        active
        title="Specifications"
      >
        <div>
          <b-card>
            <h3><b-icon icon="hdd-network-fill" /> &nbsp;Backend Selection</h3>
            <b-input-group class="my-1" style="width: 350px">
              <b-input-group-prepend>
                <b-input-group-text>
                  <b-icon icon="laptop" />
                </b-input-group-text>
              </b-input-group-prepend>
              <b-form-select
                v-model="selectedIp"
                :options="null"
                @change="selectedIpChanged"
              >
                <b-form-select-option
                  v-for="instance in instances.data"
                  :key="instance.ip"
                  :value="instance.ip"
                >
                  {{ instance.ip }}
                </b-form-select-option>
              </b-form-select>

              <b-button
                ref="BackendRefresh"
                v-b-tooltip.hover.top="'Refresh'"
                v-ripple.400="'rgba(255, 255, 255, 0.12)'"
                variant="outline-success"
                size="sm"
                class="ml-1 bb"
                style="outline: none !important; box-shadow: none !important"
                @click="refreshInfo"
              >
                <b-icon scale="1.2" icon="arrow-clockwise" />
              </b-button>
            </b-input-group>
          </b-card>
        </div>
        <div>
          <b-card>
            <div v-if="callBResponse.data && callResponse.data">
              <div v-if="callBResponse.data.hash !== callResponse.data.hash">
                <h1>Locally running application does not match global specifications! Update needed</h1>
                <br><br>
              </div>
              <div v-else>
                Application is synced with Global network
                <br><br>
              </div>
            </div>
            <h2>Installed Specifications</h2>
            <div
              v-if="callResponse.data"
              style="text-align: left;"
            >
              <b-card class="">
                <list-entry
                  title="Name"
                  :data="callResponse.data.name"
                />
                <list-entry
                  title="Description"
                  :data="callResponse.data.description"
                />
                <list-entry
                  title="Owner"
                  :data="callResponse.data.owner"
                />
                <list-entry
                  title="Hash"
                  :data="callResponse.data.hash"
                />
                <div v-if="callResponse.data.version >= 5">
                  <div v-if="callResponse.data.geolocation.length">
                    <div
                      v-for="location in callResponse.data.geolocation"
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
                  v-if="callResponse.data.instances"
                  title="Instances"
                  :data="callResponse.data.instances.toString()"
                />
                <list-entry
                  title="Specifications version"
                  :number="callResponse.data.version"
                />
                <list-entry
                  title="Registered on Blockheight"
                  :number="callResponse.data.height"
                />
                <list-entry
                  v-if="callResponse.data.hash && callResponse.data.hash.length === 64"
                  title="Expires on Blockheight"
                  :number="callResponse.data.height + (callResponse.data.expire || 22000)"
                />
                <list-entry
                  title="Expires in"
                  :data="getNewExpireLabel"
                />
                <list-entry
                  title="Enterprise Nodes"
                  :data="callResponse.data.nodes ? callResponse.data.nodes.toString() : 'Not scoped'"
                />
                <list-entry
                  title="Static IP"
                  :data="callResponse.data.staticip ? 'Yes, Running only on Static IP nodes' : 'No, Running on all nodes'"
                />
                <h4>Composition</h4>
                <div v-if="callResponse.data.version <= 3">
                  <b-card>
                    <list-entry
                      title="Repository"
                      :data="callResponse.data.repotag"
                    />
                    <list-entry
                      title="Custom Domains"
                      :data="callResponse.data.domains.toString() || 'none'"
                    />
                    <list-entry
                      title="Automatic Domains"
                      :data="constructAutomaticDomains(callResponse.data.ports, callResponse.data.name).toString() || 'none'"
                    />
                    <list-entry
                      title="Ports"
                      :data="callResponse.data.ports.toString() || 'none'"
                    />
                    <list-entry
                      title="Container Ports"
                      :data="callResponse.data.containerPorts.toString() || 'none'"
                    />
                    <list-entry
                      title="Container Data"
                      :data="callResponse.data.containerData.toString() || 'none'"
                    />
                    <list-entry
                      title="Environment Parameters"
                      :data="callResponse.data.enviromentParameters.length > 0 ? callResponse.data.enviromentParameters.toString() : 'none'"
                    />
                    <list-entry
                      title="Commands"
                      :data="callResponse.data.commands.length > 0 ? callResponse.data.commands.toString() : 'none'"
                    />
                    <div v-if="callResponse.data.tiered">
                      <list-entry
                        title="CPU Cumulus"
                        :data="`${callResponse.data.cpubasic} vCore`"
                      />
                      <list-entry
                        title="CPU Nimbus"
                        :data="`${callResponse.data.cpusuper} vCore`"
                      />
                      <list-entry
                        title="CPU Stratus"
                        :data="`${callResponse.data.cpubamf} vCore`"
                      />
                      <list-entry
                        title="RAM Cumulus"
                        :data="`${callResponse.data.rambasic} MB`"
                      />
                      <list-entry
                        title="RAM Nimbus"
                        :data="`${callResponse.data.ramsuper} MB`"
                      />
                      <list-entry
                        title="RAM Stratus"
                        :data="`${callResponse.data.rambamf} MB`"
                      />
                      <list-entry
                        title="SSD Cumulus"
                        :data="`${callResponse.data.hddbasic} GB`"
                      />
                      <list-entry
                        title="SSD Nimbus"
                        :data="`${callResponse.data.hddsuper} GB`"
                      />
                      <list-entry
                        title="SSD Stratus"
                        :data="`${callResponse.data.hddbamf} GB`"
                      />
                    </div>
                    <div v-else>
                      <list-entry
                        title="CPU"
                        :data="`${callResponse.data.cpu} vCore`"
                      />
                      <list-entry
                        title="RAM"
                        :data="`${callResponse.data.ram} MB`"
                      />
                      <list-entry
                        title="SSD"
                        :data="`${callResponse.data.hdd} GB`"
                      />
                    </div>
                  </b-card>
                </div>
                <div v-else>
                  <b-card
                    v-for="(component, index) in callResponse.data.compose"
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
                      title="Repository Authentication"
                      :data="component.repoauth ? 'Content Encrypted' : 'Public'"
                    />
                    <list-entry
                      title="Custom Domains"
                      :data="component.domains.toString() || 'none'"
                    />
                    <list-entry
                      title="Automatic Domains"
                      :data="constructAutomaticDomains(component.ports, callResponse.data.name, index).toString() || 'none'"
                    />
                    <list-entry
                      title="Ports"
                      :data="component.ports.toString() || 'none'"
                    />
                    <list-entry
                      title="Container Ports"
                      :data="component.containerPorts.toString() || 'none'"
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
                  </b-card>
                </div>
              </b-card>
            </div>
            <div v-else>
              Local Specifications loading...
            </div>
            <h2 class="mt-2">
              Global Specifications
            </h2>
            <div
              v-if="callBResponse.data"
              style="text-align: left;"
            >
              <b-card class="">
                <list-entry
                  title="Name"
                  :data="callBResponse.data.name"
                />
                <list-entry
                  title="Description"
                  :data="callBResponse.data.description"
                />
                <list-entry
                  title="Owner"
                  :data="callBResponse.data.owner"
                />
                <list-entry
                  title="Hash"
                  :data="callBResponse.data.hash"
                />
                <div v-if="callBResponse.data.version >= 5">
                  <div v-if="callBResponse.data.geolocation.length">
                    <div
                      v-for="location in callBResponse.data.geolocation"
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
                  v-if="callBResponse.data.instances"
                  title="Instances"
                  :data="callBResponse.data.instances.toString()"
                />
                <list-entry
                  title="Specifications version"
                  :number="callBResponse.data.version"
                />
                <list-entry
                  title="Registered on Blockheight"
                  :number="callBResponse.data.height"
                />
                <list-entry
                  v-if="callBResponse.data.hash && callBResponse.data.hash.length === 64"
                  title="Expires on Blockheight"
                  :number="callBResponse.data.height + (callBResponse.data.expire || 22000)"
                />
                <list-entry
                  title="Expires in"
                  :data="getNewExpireLabel"
                />
                <list-entry
                  title="Enterprise Nodes"
                  :data="callBResponse.data.nodes ? callBResponse.data.nodes.toString() : 'Not scoped'"
                />
                <list-entry
                  title="Static IP"
                  :data="callBResponse.data.staticip ? 'Yes, Running only on Static IP nodes' : 'No, Running on all nodes'"
                />
                <h4>Composition</h4>
                <div v-if="callBResponse.data.version <= 3">
                  <b-card>
                    <list-entry
                      title="Repository"
                      :data="callBResponse.data.repotag"
                    />
                    <list-entry
                      title="Custom Domains"
                      :data="callBResponse.data.domains.toString() || 'none'"
                    />
                    <list-entry
                      title="Automatic Domains"
                      :data="constructAutomaticDomainsGlobal.toString() || 'none'"
                    />
                    <list-entry
                      title="Ports"
                      :data="callBResponse.data.ports.toString() || 'none'"
                    />
                    <list-entry
                      title="Container Ports"
                      :data="callBResponse.data.containerPorts.toString() || 'none'"
                    />
                    <list-entry
                      title="Container Data"
                      :data="callBResponse.data.containerData"
                    />
                    <list-entry
                      title="Environment Parameters"
                      :data="callBResponse.data.enviromentParameters.length > 0 ? callBResponse.data.enviromentParameters.toString() : 'none'"
                    />
                    <list-entry
                      title="Commands"
                      :data="callBResponse.data.commands.length > 0 ? callBResponse.data.commands.toString() : 'none'"
                    />
                    <div v-if="callBResponse.data.tiered">
                      <list-entry
                        title="CPU Cumulus"
                        :data="`${callBResponse.data.cpubasic} vCore`"
                      />
                      <list-entry
                        title="CPU Nimbus"
                        :data="`${callBResponse.data.cpusuper} vCore`"
                      />
                      <list-entry
                        title="CPU Stratus"
                        :data="`${callBResponse.data.cpubamf} vCore`"
                      />
                      <list-entry
                        title="RAM Cumulus"
                        :data="`${callBResponse.data.rambasic} MB`"
                      />
                      <list-entry
                        title="RAM Nimbus"
                        :data="`${callBResponse.data.ramsuper} MB`"
                      />
                      <list-entry
                        title="RAM Stratus"
                        :data="`${callBResponse.data.rambamf} MB`"
                      />
                      <list-entry
                        title="SSD Cumulus"
                        :data="`${callBResponse.data.hddbasic} GB`"
                      />
                      <list-entry
                        title="SSD Nimbus"
                        :data="`${callBResponse.data.hddsuper} GB`"
                      />
                      <list-entry
                        title="SSD Stratus"
                        :data="`${callBResponse.data.hddbamf} GB`"
                      />
                    </div>
                    <div v-else>
                      <list-entry
                        title="CPU"
                        :data="`${callBResponse.data.cpu} vCore`"
                      />
                      <list-entry
                        title="RAM"
                        :data="`${callBResponse.data.ram} MB`"
                      />
                      <list-entry
                        title="SSD"
                        :data="`${callBResponse.data.hdd} GB`"
                      />
                    </div>
                  </b-card>
                </div>
                <div v-else>
                  <b-card
                    v-for="(component, index) in callBResponse.data.compose"
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
                      title="Repository Authentication"
                      :data="component.repoauth ? 'Content Encrypted' : 'Public'"
                    />
                    <list-entry
                      title="Custom Domains"
                      :data="component.domains.toString() || 'none'"
                    />
                    <list-entry
                      title="Automatic Domains"
                      :data="constructAutomaticDomains(component.ports, callBResponse.data.name, index).toString() || 'none'"
                    />
                    <list-entry
                      title="Ports"
                      :data="component.ports.toString() || 'none'"
                    />
                    <list-entry
                      title="Container Ports"
                      :data="component.containerPorts.toString() || 'none'"
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
                  </b-card>
                </div>
              </b-card>
            </div>
            <div v-else-if="callBResponse.status === 'error'">
              Global specifications not found!
            </div>
            <div v-else>
              Global Specifications loading...
            </div>
          </b-card>
        </div>
      </b-tab>
      <b-tab title="Information">
        <h3><b-icon icon="app-indicator" /> {{ appSpecification.name }}</h3>
        <div v-if="appSpecification.version >= 4">
          <div
            v-for="(component, index) in callResponse.data"
            :key="index"
          >
            <h4>Component: {{ component.name }}</h4>
            <div v-if="component.callData">
              <json-viewer
                :value="component.callData"
                :expand-depth="5"
                copyable
                boxed
                theme="jv-dark"
              />
            </div>
          </div>
        </div>
        <div v-else>
          <div v-if="callResponse.data && callResponse.data[0]">
            <json-viewer
              :value="callResponse.data[0].callData"
              :expand-depth="5"
              copyable
              boxed
              theme="jv-dark"
            />
          </div>
        </div>
      </b-tab>
      <b-tab title="Resources">
        <h3><b-icon icon="app-indicator" /> {{ appSpecification.name }}</h3>
        <div v-if="commandExecuting">
          <v-icon
            class="spin-icon"
            name="spinner"
          />
        </div>
        <div v-if="appSpecification.version >= 4">
          <div
            v-for="(component, index) in callResponse.data"
            :key="index"
          >
            <h4>Component: {{ component.name }}</h4>
            <div v-if="component.callData">
              <json-viewer
                :value="component.callData"
                :expand-depth="5"
                copyable
                boxed
                theme="jv-dark"
              />
            </div>
          </div>
        </div>
        <div v-else>
          <div v-if="callResponse.data && callResponse.data[0]">
            <json-viewer
              :value="callResponse.data[0].callData"
              :expand-depth="5"
              copyable
              boxed
              theme="jv-dark"
            />
          </div>
        </div>
      </b-tab>
      <b-tab title="Monitoring">
        <h3>History Statistics 1 hour</h3>
        <div v-if="appSpecification.version >= 4">
          <div
            v-for="(component, index) in callResponse.data"
            :key="index"
          >
            <h4>Component: {{ component.name }}</h4>
            <b-table
              v-if="component.callData"
              class="stats-table"
              :items="generateStatsTableItems(component.callData.lastHour, appSpecification.compose.find((c) => c.name === component.name))"
              :fields="statsFields"
            />
            <div v-else>
              Loading...
            </div>
          </div>
        </div>
        <div v-else>
          <b-table
            v-if="callResponse.data && callResponse.data[0]"
            class="stats-table"
            :items="generateStatsTableItems(callResponse.data[0].callData.lastHour, appSpecification)"
            :fields="statsFields"
          />
          <div v-else>
            Loading...
          </div>
        </div>
        <br><br>
        <h3>History Statistics 24 hours</h3>
        <div v-if="appSpecification.version >= 4">
          <div
            v-for="(component, index) in callResponse.data"
            :key="index"
          >
            <h4>Component: {{ component.name }}</h4>
            <b-table
              v-if="component.callData"
              class="stats-table"
              :items="generateStatsTableItems(component.callData.lastDay, appSpecification.compose.find((c) => c.name === component.name))"
              :fields="statsFields"
            />
            <div v-else>
              Loading...
            </div>
          </div>
        </div>
        <div v-else>
          <b-table
            v-if="callResponse.data && callResponse.data[0]"
            class="stats-table"
            :items="generateStatsTableItems(callResponse.data[0].callData.lastDay, appSpecification)"
            :fields="statsFields"
          />
          <div v-else>
            Loading...
          </div>
        </div>
      </b-tab>
      <b-tab title="File Changes">
        <h3><b-icon icon="app-indicator" /> {{ appSpecification.name }}</h3>
        <div v-if="commandExecuting">
          <v-icon
            class="spin-icon"
            name="spinner"
          />
        </div>
        <div v-if="appSpecification.version >= 4">
          <div
            v-for="(component, index) in callResponse.data"
            :key="index"
          >
            <h4>Component: {{ component.name }}</h4>
            <div v-if="component.callData">
              <kbd class="bg-primary mr-1">Kind: 0 = Modified</kbd>
              <kbd class="bg-success mr-1">Kind: 1 = Added </kbd>
              <kbd class="bg-danger">Kind: 2 = Deleted</kbd>
              <json-viewer
                class="mt-1"
                :value="component.callData"
                :expand-depth="5"
                copyable
                boxed
                theme="jv-dark"
              />
            </div>
          </div>
        </div>
        <div v-else>
          <div v-if="callResponse.data && callResponse.data[0]">
            <kbd class="bg-primary mr-1">Kind: 0 = Modified</kbd>
            <kbd class="bg-success mr-1">Kind: 1 = Added </kbd>
            <kbd class="bg-danger">Kind: 2 = Deleted</kbd>
            <json-viewer
              class="mt-1"
              :value="callResponse.data[0].callData"
              :expand-depth="5"
              copyable
              boxed
              theme="jv-dark"
            />
          </div>
        </div>
      </b-tab>
      <b-tab title="Processes">
        <h3><b-icon icon="app-indicator" /> {{ appSpecification.name }}</h3>
        <div v-if="commandExecuting">
          <v-icon
            class="spin-icon"
            name="spinner"
          />
        </div>
        <div v-if="appSpecification.version >= 4">
          <div
            v-for="(component, index) in callResponse.data"
            :key="index"
          >
            <h4>Component: {{ component.name }}</h4>
            <div v-if="component.callData">
              <json-viewer
                :value="component.callData"
                :expand-depth="5"
                copyable
                boxed
                theme="jv-dark"
              />
            </div>
          </div>
        </div>
        <div v-else>
          <div v-if="callResponse.data && callResponse.data[0]">
            <json-viewer
              :value="callResponse.data[0].callData"
              :expand-depth="5"
              copyable
              boxed
              theme="jv-dark"
            />
          </div>
        </div>
      </b-tab>
      <b-tab title="Log File">
        <h3><b-icon icon="app-indicator" /> {{ appSpecification.name }}</h3>
        <h6 class="mb-2">
          Click the 'Download' button to download the Log file from your Application debug file. This may take a few minutes depending on file size.
        </h6>
        <div v-if="appSpecification.version >= 4">
          <div
            v-for="(component, index) in callResponse.data"
            :key="index"
          >
            <h4>Component: {{ component.name }}</h4>
            <div>
              <div>
                <div class="d-flex align-items-center">
                  <h5 class="mt-1">
                    <kbd class="bg-primary">Last 100 lines of the log file</kbd>
                  </h5>
                </div>
                <b-form-textarea
                  v-if="component.callData"
                  plaintext
                  no-resize
                  rows="15"
                  :value="decodeAsciiResponse(component.callData)"
                  class="mt-1 mb-1"
                  style="background-color: black; color: white; padding: 20px; font-family: monospace; margin-bottom: 25px"
                />
                <b-button
                  :id="`start-download-log-${component.name}_${appSpecification.name}`"
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="outline-primary"
                  size="md"
                  class="w-100 mb-2"
                >
                  Download
                </b-button>
                <confirm-dialog
                  :target="`start-download-log-${component.name}_${appSpecification.name}`"
                  confirm-button="Download Log"
                  @confirm="downloadApplicationLog(`${component.name}_${appSpecification.name}`)"
                />
              </div>
            </div>
          </div>
        </div>
        <div v-else>
          <div>
            <div>
              <h6 class="mb-1 mt-1">
                <kbd class="bg-primary">Last 100 lines of the log file</kbd>
              </h6>
              <b-form-textarea
                v-if="callResponse.data && callResponse.data[0]"
                plaintext
                no-resize
                rows="15"
                :value="decodeAsciiResponse(callResponse.data[0].callData)"
                class="mt-1 mb-1"
                style="background-color: black; color: white; padding: 20px; font-family: monospace; margin-bottom: 25px"
              />
              <b-button
                id="start-download-log"
                v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                variant="outline-primary"
                size="md"
                class="w-100 mb-2"
              >
                Download Debug File
              </b-button>
              <confirm-dialog
                target="start-download-log"
                confirm-button="Download Log"
                @confirm="downloadApplicationLog(appSpecification.name)"
              />
            </div>
          </div>
        </div>
      </b-tab>
      <b-tab title="Control">
        <b-row class="match-height ">
          <b-col xs="6">
            <b-card title="Control">
              <b-card-text class="mb-2">
                General options to control running status of App.
              </b-card-text>
              <div class="text-center">
                <b-button
                  id="start-app"
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="success"
                  aria-label="Start App"
                  class="mx-1 my-1"
                >
                  Start App
                </b-button>
                <confirm-dialog
                  target="start-app"
                  confirm-button="Start App"
                  @confirm="startApp(appName)"
                />
                <b-button
                  id="stop-app"
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="success"
                  aria-label="Stop App"
                  class="mx-1 my-1"
                >
                  Stop App
                </b-button>
                <confirm-dialog
                  target="stop-app"
                  confirm-button="Stop App"
                  @confirm="stopApp(appName)"
                />
                <b-button
                  id="restart-app"
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="success"
                  aria-label="Restart App"
                  class="mx-1 my-1"
                >
                  Restart App
                </b-button>
                <confirm-dialog
                  target="restart-app"
                  confirm-button="Restart App"
                  @confirm="restartApp(appName)"
                />
              </div>
            </b-card>
          </b-col>
          <b-col xs="6">
            <b-card title="Pause">
              <b-card-text class="mb-2">
                The Pause command suspends all processes in the specified App.
              </b-card-text>
              <div class="text-center">
                <b-button
                  id="pause-app"
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="success"
                  aria-label="Pause App"
                  class="mx-1 my-1"
                >
                  Pause App
                </b-button>
                <confirm-dialog
                  target="pause-app"
                  confirm-button="Pause App"
                  @confirm="pauseApp(appName)"
                />
                <b-button
                  id="unpause-app"
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="success"
                  aria-label="Unpause App"
                  class="mx-1 my-1"
                >
                  Unpause App
                </b-button>
                <confirm-dialog
                  target="unpause-app"
                  confirm-button="Unpause App"
                  @confirm="unpauseApp(appName)"
                />
              </div>
            </b-card>
          </b-col>
          <b-col xs="6">
            <b-card title="Monitoring">
              <b-card-text class="mb-2">
                Controls Application Monitoring
              </b-card-text>
              <div class="text-center">
                <b-button
                  id="start-monitoring"
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="success"
                  aria-label="Start Monitoring"
                  class="mx-1 my-1"
                >
                  Start Monitoring
                </b-button>
                <confirm-dialog
                  target="start-monitoring"
                  confirm-button="Start Monitoring"
                  @confirm="startMonitoring(appName)"
                />
                <b-button
                  id="stop-monitoring"
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="success"
                  aria-label="Stop Monitoring"
                  class="mx-1 my-1"
                >
                  Stop Monitoring
                </b-button>
                <confirm-dialog
                  target="stop-monitoring"
                  confirm-button="Stop Monitoring"
                  @confirm="stopMonitoring(appName, false)"
                />
                <b-button
                  id="stop-monitoring-delete"
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="success"
                  aria-label="Stop Monitoring and Delete Monitored Data"
                  class="mx-1 my-1"
                >
                  Stop Monitoring and Delete Monitored Data
                </b-button>
                <confirm-dialog
                  target="stop-monitoring-delete"
                  confirm-button="Stop Monitoring"
                  @confirm="stopMonitoring(appName, true)"
                />
              </div>
            </b-card>
          </b-col>
        </b-row>
        <b-row class="match-height ">
          <b-col xs="6">
            <b-card title="Redeploy">
              <b-card-text class="mb-2">
                Redeployes your application. Hard redeploy removes persistant data storage.
              </b-card-text>
              <div class="text-center">
                <b-button
                  id="redeploy-app-soft"
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="success"
                  aria-label="Soft Redeploy App"
                  class="mx-1 my-1"
                >
                  Soft Redeploy App
                </b-button>
                <confirm-dialog
                  target="redeploy-app-soft"
                  confirm-button="Redeploy"
                  @confirm="redeployAppSoft(appName)"
                />
                <b-button
                  id="redeploy-app-hard"
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="success"
                  aria-label="Hard Redeploy App"
                  class="mx-1 my-1"
                >
                  Hard Redeploy App
                </b-button>
                <confirm-dialog
                  target="redeploy-app-hard"
                  confirm-button="Redeploy"
                  @confirm="redeployAppHard(appName)"
                />
              </div>
            </b-card>
          </b-col>
          <b-col xs="6">
            <b-card title="Remove">
              <b-card-text class="mb-2">
                Stops, uninstalls and removes all App data from this Flux node.
              </b-card-text>
              <div class="text-center">
                <b-button
                  id="remove-app"
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="success"
                  aria-label="Remove App"
                  class="mx-1 my-1"
                >
                  Remove App
                </b-button>
                <confirm-dialog
                  target="remove-app"
                  confirm-button="Remove App"
                  @confirm="removeApp(appName)"
                />
              </div>
            </b-card>
          </b-col>
        </b-row>
      </b-tab>
      <b-tab
        v-if="windowWidth > 860"
        title="Component Control"
        :disabled="!isApplicationInstalledLocally || appSpecification.version <= 3"
      >
        <b-card
          v-for="(component, index) of appSpecification.compose"
          :key="index"
        >
          <h4>{{ component.name }} Component</h4>
          <b-row class="match-height">
            <b-col xs="6">
              <b-card title="Control">
                <b-card-text class="mb-2">
                  General options to control running status of Component.
                </b-card-text>
                <div class="text-center">
                  <b-button
                    :id="`start-app-${component.name}_${appSpecification.name}`"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Start Component"
                    class="mx-1 my-1"
                  >
                    Start Component
                  </b-button>
                  <confirm-dialog
                    :target="`start-app-${component.name}_${appSpecification.name}`"
                    confirm-button="Start Component"
                    @confirm="startApp(`${component.name}_${appSpecification.name}`)"
                  />
                  <b-button
                    :id="`stop-app-${component.name}_${appSpecification.name}`"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Stop Component"
                    class="mx-1 my-1"
                  >
                    Stop Component
                  </b-button>
                  <confirm-dialog
                    :target="`stop-app-${component.name}_${appSpecification.name}`"
                    confirm-button="Stop App"
                    @confirm="stopApp(`${component.name}_${appSpecification.name}`)"
                  />
                  <b-button
                    :id="`restart-app-${component.name}_${appSpecification.name}`"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Restart Component"
                    class="mx-1 my-1"
                  >
                    Restart Component
                  </b-button>
                  <confirm-dialog
                    :target="`restart-app-${component.name}_${appSpecification.name}`"
                    confirm-button="Restart Component"
                    @confirm="restartApp(`${component.name}_${appSpecification.name}`)"
                  />
                </div>
              </b-card>
            </b-col>
            <b-col xs="6">
              <b-card title="Pause">
                <b-card-text class="mb-2">
                  The Pause command suspends all processes in the specified Component.
                </b-card-text>
                <div class="text-center">
                  <b-button
                    :id="`pause-app-${component.name}_${appSpecification.name}`"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Pause Component"
                    class="mx-1 my-1"
                  >
                    Pause Component
                  </b-button>
                  <confirm-dialog
                    :target="`pause-app-${component.name}_${appSpecification.name}`"
                    confirm-button="Pause Component"
                    @confirm="pauseApp(`${component.name}_${appSpecification.name}`)"
                  />
                  <b-button
                    :id="`unpause-app-${component.name}_${appSpecification.name}`"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Unpause Component"
                    class="mx-1 my-1"
                  >
                    Unpause Component
                  </b-button>
                  <confirm-dialog
                    :target="`unpause-app-${component.name}_${appSpecification.name}`"
                    confirm-button="Unpause Component"
                    @confirm="unpauseApp(`${component.name}_${appSpecification.name}`)"
                  />
                </div>
              </b-card>
            </b-col>
            <b-col xs="6">
              <b-card title="Monitoring">
                <b-card-text class="mb-2">
                  Controls Component Monitoring
                </b-card-text>
                <div class="text-center">
                  <b-button
                    :id="`start-monitoring-${component.name}_${appSpecification.name}`"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Start Monitoring"
                    class="mx-1 my-1"
                  >
                    Start Monitoring
                  </b-button>
                  <confirm-dialog
                    :target="`start-monitoring-${component.name}_${appSpecification.name}`"
                    confirm-button="Start Monitoring"
                    @confirm="startMonitoring(`${component.name}_${appSpecification.name}`)"
                  />
                  <b-button
                    :id="`stop-monitoring-${component.name}_${appSpecification.name}`"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Stop Monitoring"
                    class="mx-1 my-1"
                  >
                    Stop Monitoring
                  </b-button>
                  <confirm-dialog
                    :target="`stop-monitoring-${component.name}_${appSpecification.name}`"
                    confirm-button="Stop Monitoring"
                    @confirm="stopMonitoring(`${component.name}_${appSpecification.name}`, false)"
                  />
                  <b-button
                    :id="`stop-monitoring-delete-${component.name}_${appSpecification.name}`"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Stop Monitoring and Delete Monitored Data"
                    class="mx-1 my-1"
                  >
                    Stop Monitoring and Delete Monitored Data
                  </b-button>
                  <confirm-dialog
                    :target="`stop-monitoring-delete-${component.name}_${appSpecification.name}`"
                    confirm-button="Stop Monitoring"
                    @confirm="stopMonitoring(`${component.name}_${appSpecification.name}`, true)"
                  />
                </div>
              </b-card>
            </b-col>
          </b-row>
        </b-card>
      </b-tab>
      <b-tab
        title="Backup/Restore"
        :disabled="!appSpecification?.compose"
      >
        <div>
          <b-card no-body>
            <b-tabs
              pills
              card
            >
              <b-tab
                title="Backup"
                style="margin: 0; padding-top: 0px;"
              >
                <div
                  class="mb-2"
                  style="
                    border: 1px solid #ccc;
                    border-radius: 8px;
                    height: 45px;
                    padding: 12px;
                    line-height: 0px;
                  "
                >
                  <h5>
                    <b-icon
                      class="mr-1"
                      icon="back"
                    /> Manual Backup Container Data
                  </h5>
                </div>
                <div class="mb-2">
                  <b-form-group>
                    <!-- <h7 class="mr-1">
                      Select the application component(s) you would like to backup:
                    </h7> -->
                    <b-form-tags
                      id="tags-component-select"
                      v-model="selectedBackupComponents"
                      size="lg"
                      add-on-change
                      no-outer-focus
                    >
                      <template
                        #default="{
                          tags,
                          inputAttrs,
                          inputHandlers,
                          disabled,
                          removeTag,
                        }"
                      >
                        <ul
                          v-if="tags.length > 0"
                          class="list-inline d-inline-block mb-2"
                        >
                          <li
                            v-for="tag in tags"
                            :key="tag"
                            class="list-inline-item"
                          >
                            <b-form-tag
                              :title="tag"
                              :disabled="disabled"
                              variant="primary"
                              @remove="removeTag(tag)"
                            >
                              {{ tag }}
                            </b-form-tag>
                          </li>
                        </ul>
                        <b-form-select
                          v-bind="inputAttrs"
                          :disabled="disabled || componentAvailableOptions?.length === 0 || components?.length === 1"
                          :options="componentAvailableOptions"
                          v-on="inputHandlers"
                        >
                          <template #first>
                            <option
                              disabled
                              value=""
                            >
                              Select the application component(s) you would like to backup
                            </option>
                          </template>
                        </b-form-select>
                      </template>
                    </b-form-tags>
                  </b-form-group>
                </div>
                <b-button
                  v-if="components?.length > 1"
                  class="mr-1"
                  variant="outline-primary"
                  @click="addAllTags"
                >
                  <b-icon
                    scale="0.9"
                    icon="check2-square"
                    class="mr-1"
                  />
                  Select all
                </b-button>
                <b-button
                  :disabled="selectedBackupComponents.length === 0 || backupProgress === true"
                  variant="outline-primary"
                  style="white-space: nowrap;"
                  @click="createBackup(appName, selectedBackupComponents)"
                >
                  <b-icon
                    scale="0.9"
                    icon="back"
                    class="mr-1"
                  />
                  Create backup
                </b-button>

                <br />
                <div class="mt-1">
                  <div
                    v-if="backupProgress === true"
                    class="mb-2 mt-2 w-100"
                    style="
                              margin: 0 auto;
                              padding: 12px;
                              border: 1px solid #eaeaea;
                              border-radius: 8px;
                              box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                              text-align: center;

                            "
                  >
                    <h5 style="font-size: 16px; margin-bottom: 5px;">
                      <span v-if="backupProgress === true">
                        <b-spinner small /> {{ tarProgress }}
                        <!-- <b-spinner small /> Backing up {{ tarProgress[0] }}... -->
                      </span>
                    </h5>
                    <b-progress
                      v-for="(item, index) in computedFileProgress"
                      v-if="item.progress > 0"
                      :key="index"
                      class="mt-1"
                      style="height: 16px;"
                      :max="100"
                    >
                      <b-progress-bar
                        :value="item.progress"
                        :label="`${item.fileName} - ${item.progress.toFixed(2)}%`"
                        style="font-size: 14px;"
                      />
                    </b-progress>
                  </div>
                </div>

                <div v-if="backupList?.length > 0 && backupProgress === false">
                  <div class="mb-1 text-right">
                    <!-- Select Dropdown -->
                    <b-dropdown
                      class="mr-1"
                      text="Select"
                      variant="outline-primary"
                      style="max-height: 38px; min-width: 100px; white-space: nowrap;"
                    >
                      <template #button-content>
                        <b-icon
                          scale="0.9"
                          icon="check2-square"
                          class="mr-1"
                        />
                        Select
                      </template>
                      <b-dropdown-item
                        :disabled="backupToUpload?.length === backupList?.length"
                        @click="selectAllRows"
                      >
                        <b-icon
                          scale="0.9"
                          icon="check2-circle"
                          class="mr-1"
                        />
                        Select all
                      </b-dropdown-item>
                      <b-dropdown-item
                        :disabled="backupToUpload?.length === 0"
                        @click="clearSelected"
                      >
                        <b-icon
                          scale="0.7"
                          icon="square"
                          class="mr-1"
                        />
                        Select none
                      </b-dropdown-item>
                    </b-dropdown>

                    <!-- Download Dropdown -->
                    <b-dropdown
                      class="mr-1"
                      text="Download"
                      variant="outline-primary"
                      style="max-height: 38px; min-width: 100px; white-space: nowrap;"
                    >
                      <template #button-content>
                        <b-icon
                          scale="0.9"
                          icon="download"
                          class="mr-1"
                        />
                        Download
                      </template>
                      <b-dropdown-item
                        :disabled="backupToUpload?.length === 0"
                        @click="downloadAllBackupFiles(backupToUpload)"
                      >
                        <b-icon
                          scale="0.7"
                          icon="download"
                          class="mr-1"
                        />
                        Download selected
                      </b-dropdown-item>
                      <b-dropdown-item @click="downloadAllBackupFiles(backupList)">
                        <b-icon
                          scale="0.7"
                          icon="download"
                          class="mr-1"
                        />
                        Download all
                      </b-dropdown-item>
                    </b-dropdown>

                    <b-button
                      variant="outline-danger"
                      style="max-height: 38px; min-width: 100px; white-space: nowrap;"
                      @click="deleteLocalBackup(null, backupList)"
                    >
                      <b-icon
                        scale="0.9"
                        icon="trash"
                        class="mr-1"
                      />
                      Remove all
                    </b-button>
                  </div>
                  <b-table
                    v-if="backupList?.length > 0"
                    ref="selectableTable"
                    class="mb-0"
                    :items="backupList"
                    :fields="[
                      ...localBackupTableFields,
                      {
                        key: 'actions',
                        label: 'Actions',
                        thStyle: { width: '5%' },
                        class: 'text-center',
                      },
                    ]"
                    stacked="md"
                    show-empty
                    bordered
                    select-mode="multi"
                    selectable
                    selected-variant="outline-dark"
                    hover
                    small
                    @row-selected="onRowSelected"
                  >
                    <template #thead-top>
                      <b-tr>
                        <b-td
                          colspan="6"
                          class="text-center"
                        >
                          <b>
                            List of available backups on the local machine (backups are automatically deleted 24 hours after creation)
                          </b>
                        </b-td>
                      </b-tr>
                    </template>

                    <template #cell(create)="row">
                      {{ formatDateTime(row.item.create) }}
                    </template>
                    <template #cell(expire)="row">
                      {{ formatDateTime(row.item.create, true) }}
                    </template>
                    <template #cell(isActive)="{ rowSelected }">
                      <template v-if="rowSelected">
                        <span
                          style="color: green"
                          aria-hidden="true"
                        >
                          <b-icon
                            icon="check-square-fill"
                            scale="1"
                            variant="success"
                          /></span>
                        <span class="sr-only">Selected</span>
                      </template>
                      <template v-else>
                        <span
                          style="color: white"
                          aria-hidden="true"
                        >
                          <b-icon
                            icon="square"
                            scale="1"
                            variant="secondary"
                          /></span>
                        <span class="sr-only">Not selected</span>
                      </template>
                    </template>
                    <template #cell(file_size)="row">
                      {{ addAndConvertFileSizes(row.item.file_size) }}
                    </template>
                    <template #cell(actions)="row">
                      <div class="d-flex justify-content-center align-items-center">
                        <b-button
                          :id="`delete-local-backup-${row.item.component}_${backupList[row.index].create}`"
                          v-b-tooltip.hover.top="'Remove file'"
                          variant="outline-danger"
                          class="d-flex justify-content-center align-items-center mr-1 custom-button"
                        >
                          <b-icon
                            class="d-flex justify-content-center align-items-center"
                            scale="0.9"
                            icon="trash"
                          />
                        </b-button>
                        <confirm-dialog
                          :target="`delete-local-backup-${row.item.component}_${backupList[row.index].create}`"
                          confirm-button="Remove File"
                          @confirm="deleteLocalBackup(row.item.component, backupList, backupList[row.index].file)"
                        />
                        <b-button
                          v-b-tooltip.hover.top="'Download file'"
                          variant="outline-primary"
                          class="d-flex justify-content-center align-items-center custom-button"
                          @click="downloadAllBackupFiles([{ component: row.item.component, file: backupList[row.index].file }])"
                        >
                          <b-icon
                            class="d-flex justify-content-center align-items-center"
                            scale="1"
                            icon="cloud-arrow-down"
                          />
                        </b-button>
                      </div>
                    </template>
                  </b-table>
                  <span>Select application component(s) you would like to upload</span>
                  <b-card-text v-if="showProgressBar">
                    <div class="mt-1">
                      <!-- <b-progress
                        :value="`${((downloaded / total) * 100).toFixed(2)}%`"
                        :max="100"
                        show-progress
                        animated
                      /> -->
                      <!-- <b-progress :max="100" show-progress>
                        <b-progress-bar :value="((downloadedSize / (totalSizeMB * 1024 * 1024)) * 100).toFixed(2)" :label="downloadLabel" show-progress animated />
                      </b-progress> -->
                      <!-- <div v-if="fileProgress.length > 0">
                        <div v-for="(item, index) in computedFileProgress" :key="index">
                          {{ item?.fileName }} - {{ item?.progress }}%
                        </div>
                      </div> -->
                      <div
                        v-if="fileProgress.length > 0"
                        class="mb-2 mt-2 w-100"
                        style="
                              margin: 0 auto;
                              padding: 12px;
                              border: 1px solid #eaeaea;
                              border-radius: 8px;
                              box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                              text-align: center;

                            "
                      >
                        <h5 style="font-size: 16px; margin-bottom: 5px;">
                          <span v-if="!allDownloadsCompleted()">
                            <b-spinner small /> Downloading...
                          </span>
                          <span v-else>
                            Download Completed
                          </span>
                        </h5>
                        <b-progress
                          v-for="(item, index) in computedFileProgress"
                          v-if="item.progress > 0"
                          :key="index"
                          class="mt-1"
                          style="height: 16px;"
                          :max="100"
                        >
                          <b-progress-bar
                            :value="item.progress"
                            :label="`${item.fileName} - ${item.progress.toFixed(2)}%`"
                            style="font-size: 14px;"
                          />
                        </b-progress>
                      </div>
                    </div>
                  </b-card-text>
                  <div
                    v-if="backupToUpload.length > 0"
                    class="mt-2"
                  >
                    <div
                      class="mb-2 mt-3"
                      style="
                        border: 1px solid #ccc;
                        border-radius: 8px;
                        height: 45px;
                        padding: 12px;
                        line-height: 0px;
                      "
                    >
                      <h5><b-icon icon="gear-fill" /> Choose your storage method</h5>
                    </div>

                    <b-form-radio-group
                      id="btn-radios-2"
                      v-model="selectedStorageMethod"
                      :options="storageMethod"
                      button-variant="outline-primary"
                      name="radio-btn-outline"
                      :disable="storageMethod"
                      buttons
                    />
                    <div v-if="selectedStorageMethod === 'flux'">
                      <div
                        v-if="sigInPrivilage === true"
                        class="mb-2"
                      >
                        <b-button
                          :disabled="uploadProgress === true"
                          class="mt-2"
                          block
                          variant="outline-primary"
                          @click="uploadToFluxDrive()"
                        >
                          <b-icon
                            scale="1.2"
                            icon="cloud-arrow-up"
                            class="mr-1"
                          />
                          Upload Selected Components To FluxDrive
                        </b-button>
                      </div>
                      <b-button
                        v-if="sigInPrivilage === false"
                        variant="outline-primary"
                        class="mt-1 w-100"
                        @click="removeAllBackup"
                      >
                        <b-icon
                          scale="1.5"
                          icon="cloud-arrow-up"
                          class="mr-1"
                        />
                        Export
                      </b-button>
                    </div>

                    <div v-if="selectedStorageMethod === 'google'">
                      <b-button
                        variant="outline-primary"
                        class="mt-1 w-100"
                        @click="removeAllBackup"
                      >
                        <b-icon
                          scale="1.5"
                          icon="cloud-arrow-up"
                          class="mr-1"
                        />
                        Export
                      </b-button>
                    </div>
                    <b-card-text v-if="showUploadProgressBar">
                      <div class="mt-1">
                        <div
                          v-if="fileProgress.length > 0"
                          class="mb-2 mt-2 w-100"
                          style="
                                margin: 0 auto;
                                padding: 12px;
                                border: 1px solid #eaeaea;
                                border-radius: 8px;
                                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                                text-align: center;

                              "
                        >
                          <h5 style="font-size: 16px; margin-bottom: 5px;">
                            <span>
                              <b-spinner small /> {{ uploadStatus }}
                            </span>
                          </h5>
                          <b-progress
                            v-for="(item, index) in computedFileProgress"
                            v-if="item.progress > 0"
                            :key="index"
                            class="mt-1"
                            style="height: 16px;"
                            :max="100"
                          >
                            <b-progress-bar
                              :value="item.progress"
                              :label="`${item.fileName} - ${item.progress.toFixed(2)}%`"
                              style="font-size: 14px;"
                            />
                          </b-progress>
                        </div>
                      </div>
                    </b-card-text>

                    <b-card-text v-if="showFluxDriveProgressBar">
                      <div class="mt-1">
                        <div
                          v-if="fileProgressFD.length > 0"
                          class="mb-2 mt-2 w-100"
                          style="
                                margin: 0 auto;
                                padding: 12px;
                                border: 1px solid #eaeaea;
                                border-radius: 8px;
                                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                                text-align: center;

                              "
                        >
                          <h5 style="font-size: 16px; margin-bottom: 5px;">
                            <span>
                              <b-spinner small /> {{ fluxDriveUploadStatus }}
                            </span>
                          </h5>
                          <b-progress
                            v-for="(item, index) in computedFileProgressFD"
                            v-if="item.progress > 0"
                            :key="index"
                            class="mt-1"
                            style="height: 16px;"
                            :max="100"
                          >
                            <b-progress-bar
                              :value="item.progress"
                              :label="`${item.fileName} - ${item.progress.toFixed(2)}%`"
                              style="font-size: 14px;"
                            />
                          </b-progress>
                        </div>
                      </div>
                    </b-card-text>
                  </div>
                </div>
              </b-tab>
              <b-tab
                title="Restore"
                style="margin: 0; padding-top: 0px;"
                @click="handleRadioClick"
              >
                <div
                  class="mb-2"
                  style="
                    border: 1px solid #ccc;
                    border-radius: 8px;
                    height: 45px;
                    padding: 12px;
                    line-height: 0px;
                  "
                >
                  <h5>
                    <b-icon
                      class="mr-1"
                      scale="1.4"
                      icon="cloud-download"
                    /> Select restore method
                  </h5>
                </div>
                <b-form-group class="mb-2">
                  <b-row>
                    <b-col
                      class="d-flex align-items-center"
                      style="height: 38px;"
                    >
                      <b-form-radio-group
                        id="btn-radios-2"
                        v-model="selectedRestoreOption"
                        :options="restoreOptions"
                        :disable="restoreOptions"
                        button-variant="outline-primary"
                        name="radio-btn-outline"
                        buttons
                        style="max-height: 38px; min-width: 100px; white-space: nowrap;"
                        @change="handleRadioClick"
                      />
                    </b-col>

                    <b-col
                      class="text-right"
                      style="height: 38px;"
                    >
                      <b-button
                        v-if="selectedRestoreOption === 'FluxDrive'"
                        variant="outline-success"
                        style="max-height: 38px; min-width: 100px; white-space: nowrap;"
                        @click="getFluxDriveBackupList"
                      >
                        <b-icon
                          class="mr-1"
                          scale="1.2"
                          icon="arrow-repeat"
                        />Refresh
                      </b-button>
                    </b-col>
                  </b-row>
                </b-form-group>

                <div v-if="selectedRestoreOption === 'FluxDrive'">
                  <div v-if="sigInPrivilage === true">
                    <div>
                      <b-input-group class="mb-2">
                        <b-input-group-prepend is-text>
                          <b-icon icon="funnel-fill" />
                        </b-input-group-prepend>

                        <b-form-select
                          v-model="nestedTableFilter"
                          :options="restoreComponents"
                        />
                      </b-input-group>
                    </div>
                    <b-table
                      :key="tableBackup"
                      :items="checkpoints"
                      :fields="backupTableFields"
                      stacked="md"
                      show-empty
                      bordered
                      small
                      empty-text="No records available. Please export your backup to FluxDrive."
                      :sort-by.sync="sortbackupTableKey"
                      :sort-desc.sync="sortbackupTableDesc"
                      :tbody-tr-class="rowClassFluxDriveBackups"
                      @filtered="onFilteredBackup"
                    >
                      <template #thead-top>
                        <b-tr>
                          <b-td
                            colspan="6"
                            variant="dark"
                            class="text-center"
                          >
                            <b-icon
                              scale="1.2"
                              icon="back"
                              class="mr-2"
                            /><b>Backups Inventory</b>
                          </b-td>
                        </b-tr>
                      </template>

                      <template #cell(actions)="row">
                        <div class="d-flex justify-content-center align-items-center">
                          <b-button
                            :id="`remove-checkpoint-${row.item.timestamp}`"
                            v-b-tooltip.hover.top="'Remove Backup(s)'"
                            variant="outline-danger"
                            class="d-flex justify-content-center align-items-center mr-1"
                            style="width: 15px; height: 25px"
                          >
                            <b-icon
                              class="d-flex justify-content-center align-items-center"
                              scale="0.9"
                              icon="trash"
                            />
                          </b-button>
                          <confirm-dialog
                            :target="`remove-checkpoint-${row.item.timestamp}`"
                            confirm-button="Remove Backup(s)"
                            @confirm="deleteRestoreBackup(row.item.component, checkpoints, row.item.timestamp)"
                          />
                          <b-button
                            v-b-tooltip.hover.top="'Add all to Restore List'"
                            variant="outline-primary"
                            class="d-flex justify-content-center align-items-center"
                            style="width: 15px; height: 25px"
                            @click="addAllBackupComponents(row.item.timestamp)"
                          >
                            <b-icon
                              class="d-flex justify-content-center align-items-center"
                              scale="0.9"
                              icon="save"
                            />
                          </b-button>
                        </div>
                      </template>
                      <template #cell(timestamp)="row">
                        <kbd class="alert-info no-wrap"><b-icon scale="1.2" icon="hdd" />&nbsp;&nbsp;backup_{{ row.item.timestamp }}</kbd>
                      </template>
                      <template #cell(time)="row">
                        {{ formatDateTime(row.item.timestamp) }}
                      </template>

                      <template #row-details="row">
                        <b-table
                          :key="tableBackup"
                          stacked="md"
                          show-empty
                          bordered
                          hover
                          small
                          class="backups-table"
                          :items="row.item.components.filter(component =>
                            Object.values(component).some(value =>
                              String(value).toLowerCase().includes(nestedTableFilter.toLowerCase()),
                            ),
                          )"
                          :fields="componentsTable1"
                        >
                          <template #cell(file_url)="nestedRow">
                            <div class="ellipsis-wrapper">
                              <b-link
                                :href="nestedRow.item.file_url"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {{ nestedRow.item.file_url }}
                              </b-link>
                            </div>
                          </template>
                          <template #cell(file_size)="nestedRow">
                            {{ addAndConvertFileSizes(nestedRow.item.file_size) }}
                          </template>
                          <template #cell(actions)="nestedRow">
                            <b-button
                              v-b-tooltip.hover.top="'Add to Restore List'"
                              class="d-flex justify-content-center align-items-center"
                              style="
                          margin: auto;
                          width: 95px;
                          height: 25px;
                          display: flex;
                        "
                              variant="outline-primary"
                              @click="addComponent(nestedRow.item, row.item.timestamp)"
                            >
                              <b-icon
                                class="d-flex justify-content-center align-items-center"
                                scale="0.7"
                                icon="plus-lg"
                              />
                            </b-button>
                          </template>
                        </b-table>
                      </template>
                    </b-table>
                    <b-table
                      v-if="newComponents.length > 0"
                      :items="newComponents"
                      :fields="[...newComponentsTableFields, {
                        key: 'actions', label: 'Actions', thStyle: { width: '20%' }, class: 'text-center',
                      }]"
                      stacked="md"
                      show-empty
                      bordered
                      small
                      class="mt-1"
                    >
                      <template #thead-top>
                        <b-tr>
                          <b-td
                            colspan="6"
                            variant="dark"
                            class="text-center"
                          >
                            <b-icon
                              scale="1.2"
                              icon="life-preserver"
                              class="mr-1"
                            /><b>Restore Overview</b>
                          </b-td>
                        </b-tr>
                      </template>
                      <template #cell(timestamp)="row">
                        {{ formatDateTime(row.item.timestamp) }}
                      </template>
                      <template #cell(file_size)="row">
                        {{ addAndConvertFileSizes(row.item.file_size) }}
                      </template>
                      <template #cell(actions)="row">
                        <div class="d-flex justify-content-center align-items-center">
                          <b-button
                            v-b-tooltip.hover.top="'Remove restore job'"
                            variant="outline-danger"
                            class="d-flex justify-content-center align-items-center"
                            style="width: 95px; height: 25px"
                            @click="deleteItem(row.index, newComponents)"
                          >
                            <b-icon
                              class="d-flex justify-content-center align-items-center"
                              scale="0.9"
                              icon="trash"
                            />
                          </b-button>
                        </div>
                      </template>
                      <template #custom-foot>
                        <b-tr>
                          <b-td
                            colspan="3"
                            variant="dark"
                            class="text-right"
                          />
                          <b-td
                            colspan="2"
                            variant="dark"
                            style="text-align: center; vertical-align: middle;"
                          >
                            <b-icon
                              class="mr-2"
                              icon="hdd"
                              scale="1.4"
                            /> {{ addAndConvertFileSizes(totalArchiveFileSize(newComponents)) }}
                          </b-td>
                        </b-tr>
                      </template>
                    </b-table>
                    <b-alert
                      v-model="showTopFluxDrive"
                      class="mt-1 rounded-0 d-flex align-items-center justify-content-center"
                      style="z-index: 1000;"
                      :variant="alertVariant"
                      solid="true"
                      dismissible
                    >
                      <h5 class="mt-1 mb-1">
                        {{ alertMessage }}
                      </h5>
                    </b-alert>
                    <b-button
                      v-if="newComponents?.length > 0 && !restoringFromFluxDrive"
                      class="mt-2"
                      block
                      variant="outline-primary"
                      @click="restoreFromFluxDrive(newComponents)"
                    >
                      <b-icon
                        icon="arrow-clockwise"
                        scale="1.2"
                        class="mr-1"
                      />Restore
                    </b-button>
                    <div
                      v-if="restoringFromFluxDrive === true"
                      class="mb-2 mt-2 w-100"
                      style="
                        margin: 0 auto;
                        padding: 12px;
                        border: 1px solid #eaeaea;
                        border-radius: 8px;
                        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                        text-align: center;
                      "
                    >
                      <h5 style="font-size: 16px; margin-bottom: 5px;">
                        <span v-if="restoringFromFluxDrive === true">
                          <b-spinner small /> {{ restoreFromFluxDriveStatus }}
                          <!-- <b-spinner small /> Backing up {{ tarProgress[0] }}... -->
                        </span>
                      </h5>
                    </div>
                  </div>
                </div>

                <div v-if="selectedRestoreOption === 'Upload File'">
                  <div>
                    <b-input-group class="mb-0">
                      <b-input-group-prepend is-text>
                        <b-icon icon="folder-plus" />
                      </b-input-group-prepend>

                      <b-form-select
                        v-model="restoreRemoteFile"
                        :options="components"
                        style="border-radius: 0"
                        :disabled="remoteFileComponents"
                      >
                        <template #first>
                          <b-form-select-option
                            :value="null"
                            disabled
                          >
                            - Select component -
                          </b-form-select-option>
                        </template>
                      </b-form-select>

                      <b-input-group-append>
                        <b-button
                          v-b-tooltip.hover.top="'Choose file to upload'"
                          :disabled="restoreRemoteFile === null"
                          text="Button"
                          size="sm"
                          variant="outline-primary"
                          @click="addRemoteFile"
                        >
                          <b-icon
                            icon="cloud-arrow-up"
                            scale="1.5"
                          />
                        </b-button>
                      </b-input-group-append>
                    </b-input-group>
                  </div>
                  <div>
                    <!-- Keep the input file element hidden -->
                    <input
                      id="file-selector"
                      ref="fileselector"
                      class="flux-share-upload-input"
                      type="file"
                      style="display: none;"
                      @input="handleFiles"
                    >
                  </div>
                  <b-alert
                    v-model="showTopUpload"
                    class="mt-1 rounded-0 d-flex align-items-center justify-content-center"
                    style="z-index: 1000;"
                    :variant="alertVariant"
                    solid="true"
                    dismissible
                  >
                    <h5 class="mt-1 mb-1">
                      {{ alertMessage }}
                    </h5>
                  </b-alert>
                  <div
                    v-if="files?.length > 0"
                    class="d-flex justify-content-between mt-2"
                  >
                    <b-table
                      class="b-table"
                      small
                      bordered
                      size="sm"
                      :items="files"
                      :fields="computedRestoreUploadFileFields"
                    >
                      <template #thead-top>
                        <b-tr>
                          <b-td
                            colspan="6"
                            variant="dark"
                            class="text-center"
                          >
                            <b-icon
                              scale="1.2"
                              icon="life-preserver"
                              class="mr-1"
                            /><b>Restore Overview</b>
                          </b-td>
                        </b-tr>
                      </template>
                      <template #cell(file)="data">
                        <div class="table-cell">
                          {{ data.value }}
                        </div>
                      </template>
                      <template #cell(file_size)="data">
                        <div class="table-cell no-wrap">
                          {{ addAndConvertFileSizes(data.value) }}
                        </div>
                      </template>
                      <template #cell(actions)="data">
                        <div class="d-flex justify-content-center align-items-center">
                          <b-button
                            v-b-tooltip.hover.top="'Remove restore job'"
                            variant="outline-danger"
                            class="d-flex justify-content-center align-items-center"
                            style="width: 15px; height: 25px"
                            @click="deleteItem(data.index, files, data.item.file, 'upload')"
                          >
                            <b-icon
                              class="d-flex justify-content-center align-items-center"
                              scale="0.9"
                              icon="trash"
                            />
                          </b-button>
                        </div>
                      </template>
                      <template #custom-foot>
                        <b-tr>
                          <b-td
                            colspan="2"
                            variant="dark"
                            class="text-right"
                          />
                          <b-td
                            colspan="2"
                            variant="dark"
                            style="text-align: center; vertical-align: middle;"
                          >
                            <b-icon
                              class="mr-1"
                              icon="hdd"
                              scale="1.4"
                            />{{ addAndConvertFileSizes(files) }}
                          </b-td>
                        </b-tr>
                      </template>
                    </b-table>
                  </div>
                  <div class="mt-2">
                    <div
                      v-if="restoreFromUpload"
                      class="mb-2 mt-2 w-100"
                      style="
                        margin: 0 auto;
                        padding: 12px;
                        border: 1px solid #eaeaea;
                        border-radius: 8px;
                        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                      "
                    >
                      <h5 style="font-size: 16px; margin-bottom: 5px; text-align: center;">
                        <span v-if="restoreFromUpload">
                          <b-spinner small /> {{ restoreFromUploadStatus }}
                        </span>
                      </h5>
                      <div
                        v-for="file in files"
                        v-if="file.uploading"
                        :key="file.file_name"
                        class="upload-item mb-1"
                      >
                        <div :class="file.uploading ? '' : 'hidden'">
                          {{ file.file_name }}
                        </div>
                        <b-progress
                          max="100"
                          height="15px"
                        >
                          <b-progress-bar
                            :value="file.progress"
                            :label="`${file.progress.toFixed(2)}%`"
                            :class="file.uploading ? '' : 'hidden'"
                          />
                        </b-progress>
                        <!-- <b-progress
                          :value="file.progress"
                          max="100"
                          height="15px"
                          show-value
                          :label="`${file.progress.toFixed(2)}%`"
                          :class="file.uploading ? '' : 'hidden'"
                        /> -->
                      </div>
                    </div>
                  </div>
                  <b-button
                    v-if="files?.length > 0 && restoreFromUploadStatus === ''"
                    class="mt-2"
                    block
                    variant="outline-primary"
                    @click="startUpload()"
                  >
                    <b-icon
                      icon="arrow-clockwise"
                      scale="1.1"
                      class="mr-1"
                    />Restore
                  </b-button>
                </div>
                <div v-if="selectedRestoreOption === 'Remote URL'">
                  <div>
                    <b-input-group class="mb-0">
                      <b-input-group-prepend is-text>
                        <b-icon icon="globe" />
                      </b-input-group-prepend>

                      <b-form-input
                        v-model="restoreRemoteUrl"
                        :state="urlValidationState"
                        type="url"
                        placeholder="Enter the URL for your remote backup archive"
                        required
                      />
                      <b-input-group-append>
                        <b-form-select
                          v-model="restoreRemoteUrlComponent"
                          :options="components"
                          :disabled="remoteUrlComponents"
                          style="border-radius: 0"
                        >
                          <template #first>
                            <b-form-select-option
                              :value="null"
                              disabled
                            >
                              - Select component -
                            </b-form-select-option>
                          </template>
                        </b-form-select>
                      </b-input-group-append>
                      <b-input-group-append>
                        <b-button
                          :disabled="restoreRemoteUrlComponent === null"
                          size="sm"
                          variant="outline-primary"
                          @click="addRemoteUrlItem(appName, restoreRemoteUrlComponent)"
                        >
                          <b-icon
                            scale="0.8"
                            icon="plus-lg"
                          />
                        </b-button>
                      </b-input-group-append>
                    </b-input-group>
                    <b-form-invalid-feedback
                      class="mb-2"
                      :state="urlValidationState"
                    >
                      {{ urlValidationMessage }}
                    </b-form-invalid-feedback>
                  </div>
                  <b-alert
                    v-model="showTopRemote"
                    class="mt-1 rounded-0 d-flex align-items-center justify-content-center"
                    style="z-index: 1000;"
                    :variant="alertVariant"
                    solid="true"
                    dismissible
                  >
                    <h5 class="mt-1 mb-1">
                      {{ alertMessage }}
                    </h5>
                  </b-alert>
                  <div
                    v-if="restoreRemoteUrlItems?.length > 0"
                    class="d-flex justify-content-between mt-2"
                  >
                    <b-table
                      class="b-table"
                      small
                      bordered
                      size="sm"
                      :items="restoreRemoteUrlItems"
                      :fields="computedRestoreRemoteURLFields"
                    >
                      <template #thead-top>
                        <b-tr>
                          <b-td
                            colspan="6"
                            variant="dark"
                            class="text-center"
                          >
                            <b-icon
                              scale="1.2"
                              icon="life-preserver"
                              class="mr-1"
                            /><b>Restore Overview</b>
                          </b-td>
                        </b-tr>
                      </template>
                      <template #cell(url)="data">
                        <div class="table-cell no">
                          {{ data.value }}
                        </div>
                      </template>
                      <template #cell(component)="data">
                        <div class="table-cell">
                          {{ data.value }}
                        </div>
                      </template>
                      <template #cell(file_size)="data">
                        <div class="table-cell no-wrap">
                          {{ addAndConvertFileSizes(data.value) }}
                        </div>
                      </template>
                      <template #cell(actions)="data">
                        <div class="d-flex justify-content-center align-items-center">
                          <b-button
                            v-b-tooltip.hover.top="'Remove restore job'"
                            variant="outline-danger"
                            class="d-flex justify-content-center align-items-center"
                            style="width: 15px; height: 25px"
                            @click="deleteItem(data.index, restoreRemoteUrlItems)"
                          >
                            <b-icon
                              class="d-flex justify-content-center align-items-center"
                              scale="0.9"
                              icon="trash"
                            />
                          </b-button>
                        </div>
                      </template>
                      <template #custom-foot>
                        <b-tr>
                          <b-td
                            colspan="2"
                            variant="dark"
                            class="text-right"
                          />
                          <b-td
                            colspan="2"
                            variant="dark"
                            style="text-align: center; vertical-align: middle;"
                          >
                            <b-icon
                              class="mr-1"
                              icon="hdd"
                              scale="1.4"
                            />{{ addAndConvertFileSizes(restoreRemoteUrlItems) }}
                          </b-td>
                        </b-tr>
                      </template>
                    </b-table>
                  </div>
                  <div class="mt-2">
                    <div
                      v-if="downloadingFromUrl === true"
                      class="mb-2 mt-2 w-100"
                      style="
                        margin: 0 auto;
                        padding: 12px;
                        border: 1px solid #eaeaea;
                        border-radius: 8px;
                        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                        text-align: center;
                      "
                    >
                      <h5 style="font-size: 16px; margin-bottom: 5px;">
                        <span v-if="downloadingFromUrl === true">
                          <b-spinner small /> {{ restoreFromRemoteURLStatus }}
                          <!-- <b-spinner small /> Backing up {{ tarProgress[0] }}... -->
                        </span>
                      </h5>
                    </div>
                  </div>
                  <b-button
                    v-if="restoreRemoteUrlItems?.length > 0 && restoreFromRemoteURLStatus === ''"
                    class="mt-2"
                    block
                    variant="outline-primary"
                    @click="restoreFromRemoteFile(appName)"
                  >
                    <b-icon
                      icon="arrow-clockwise"
                      scale="1.1"
                      class="mr-1"
                    />Restore
                  </b-button>
                </div>
              </b-tab>
            </b-tabs>
          </b-card>
        </div>
      </b-tab>
      <b-tab title="Interactive Terminal">
        <div class="text-center ">
          <div>
            <b-card-group deck>
              <b-card header-tag="header">
                <div
                  class="mb-2"
                  style="
                    border: 1px solid #ccc;
                    border-radius: 8px;
                    height: 45px;
                    padding: 12px;
                    text-align: left;
                    line-height: 0px;
                  "
                >
                  <h5>
                    <b-icon
                      class="mr-1"
                      scale="1.2"
                      icon="terminal"
                    /> Browser-based Interactive Terminal
                  </h5>
                </div>
                <div class="d-flex align-items-center">
                  <div
                    v-show="appSpecification?.compose"
                    class="mr-4"
                  >
                    <b-form-select
                      v-model="selectedApp"
                      :options="null"
                      :disabled="!!isVisible || isComposeSingle"
                    >
                      <b-form-select-option
                        value="null"
                        disabled
                      >
                        -- Please select component --
                      </b-form-select-option>
                      <b-form-select-option
                        v-for="component in appSpecification?.compose"
                        :key="component.name"
                        :value="component.name"
                      >
                        {{ component.name }}
                      </b-form-select-option>
                    </b-form-select>
                  </div>
                  <div class="mr-4">
                    <b-form-select
                      v-model="selectedCmd"
                      :options="options"
                      :disabled="!!isVisible"
                      @input="onSelectChangeCmd"
                    >
                      <template #first>
                        <b-form-select-option
                          :option="null"
                          :value="null"
                          disabled
                        >
                          -- Please select command --
                        </b-form-select-option>
                      </template>
                    </b-form-select>
                  </div>
                  <b-button
                    v-if="!isVisible && !isConnecting"
                    class="col-2"
                    href="#"
                    variant="outline-primary"
                    @click="connectTerminal(selectedApp ? `${selectedApp}_${appSpecification.name}` : appSpecification.name)"
                  >
                    Connect
                  </b-button>
                  <b-button
                    v-if="!!isVisible"
                    class="col-2"
                    variant="outline-danger"
                    @click="disconnectTerminal"
                  >
                    Disconnect
                  </b-button>
                  <b-button
                    v-if="isConnecting"
                    class="col-2 align-items-center justify-content-center"
                    variant="outline-primary"
                    disabled
                  >
                    <div class="d-flex align-items-center justify-content-center">
                      <b-spinner
                        class="mr-1"
                        small
                      />
                      Connecting...
                    </div>
                  </b-button>
                  <div class="ml-auto mt-1">
                    <div class="ml-auto d-flex">
                      <b-form-checkbox
                        v-model="enableUser"
                        class="ml-4 mr-1 d-flex align-items-center justify-content-center"
                        switch
                        :disabled="!!isVisible"
                        @input="onSelectChangeUser"
                      >
                        <div
                          class="d-flex"
                          style="font-size: 14px;"
                        >
                          User
                        </div>
                      </b-form-checkbox>
                      <b-form-checkbox
                        v-model="enableEnvironment"
                        class="ml-2 d-flex align-items-center justify-content-center"
                        switch
                        :disabled="!!isVisible"
                        @input="onSelectChangeEnv"
                      >
                        <div
                          class="d-flex"
                          style="font-size: 14px;"
                        >
                          Environment
                        </div>
                      </b-form-checkbox>
                    </div>
                  </div>
                </div>
                <div
                  v-if="selectedCmd === 'Custom' && !isVisible"
                  class="d-flex mt-1"
                >
                  <b-form-input
                    v-model="customValue"
                    placeholder="Enter custom command (string)"
                    :style="{ width: '100%' }"
                  />
                </div>
                <div
                  v-if="enableUser && !isVisible"
                  class="d-flex mt-1"
                >
                  <b-form-input
                    v-model="userInputValue"
                    placeholder="Enter user. Format is one of: user, user:group, uid, or uid:gid."
                    :style="{ width: '100%' }"
                  />
                </div>
                <div
                  v-if="enableEnvironment && !isVisible"
                  class="d-flex mt-1"
                >
                  <b-form-input
                    v-model="envInputValue"
                    placeholder="Enter environment parameters (string)"
                    :style="{ width: '100%' }"
                  />
                </div>
                <div class="d-flex align-items-center mb-1">
                  <div
                    v-if="!!isVisible"
                    class="mt-2"
                  >
                    <template v-if="selectedCmd !== 'Custom'">
                      <span style="font-weight: bold;">Exec into container</span>
                      <span :style="selectedOptionTextStyle">{{ selectedApp || appSpecification.name }}</span>
                      <span style="font-weight: bold;">using command</span>
                      <span :style="selectedOptionTextStyle">{{ selectedOptionText }}</span>
                      <span style="font-weight: bold;">as</span>
                      <span :style="selectedOptionTextStyle">{{ !userInputValue ? 'default user' : userInputValue }}</span>
                    </template>
                    <template v-else>
                      <span style="font-weight: bold;">Exec into container</span>
                      <span :style="selectedOptionTextStyle">{{ selectedApp || appSpecification.name }}</span>
                      <span style="font-weight: bold;">using custom command</span>
                      <span :style="selectedOptionTextStyle">{{ customValue }}</span>
                      <span style="font-weight: bold;">as</span>
                      <span :style="selectedOptionTextStyle">{{ !userInputValue ? 'default user' : userInputValue }}</span>
                    </template>
                  </div>
                </div>
              </b-card>
            </b-card-group>
            <div
              v-show="isVisible"
              ref="terminalElement"
              style="text-align: left;"
            />
          </div>
        </div>
        <div>
          <b-card class="mt-1">
            <div
              class="mb-2"
              style="
                display: flex;
                justify-content: space-between;
                border: 1px solid #ccc;
                border-radius: 8px;
                height: 45px;
                padding: 12px;
                text-align: left;
                line-height: 0px;
              "
            >
              <h5>
                <b-icon
                  class="mr-1"
                  scale="1.2"
                  icon="server"
                /> Volume browser
              </h5>
              <h6
                v-if="selectedAppVolume || !appSpecification?.compose"
                class="progress-label"
              >
                <b-icon
                  class="mr-1"
                  :style="getIconColorStyle(storage.used, storage.total)"
                  :icon="getIconName(storage.used, storage.total)"
                  scale="1.4"
                /> {{ `${storage.used.toFixed(2)} / ${storage.total.toFixed(2)}` }} GB
              </h6>
            </div>
            <div
              class="mr-4 d-flex"
              :class="{ 'mb-2': appSpecification && appSpecification.compose }"
              style="max-width: 250px;"
            >
              <b-form-select
                v-show="appSpecification?.compose"
                v-model="selectedAppVolume"
                :options="null"
                :disabled="isComposeSingle"
                @change="refreshFolderSwitch"
              >
                <b-form-select-option
                  value="null"
                  disabled
                >
                  -- Please select component --
                </b-form-select-option>
                <b-form-select-option
                  v-for="component in appSpecification.compose"
                  :key="component.name"
                  :value="component.name"
                >
                  {{ component.name }}
                </b-form-select-option>
              </b-form-select>
            </div>
            <div
              v-if="fileProgressVolume.length > 0"
              class="mb-2 mt-2 w-100"
              style="
                margin: 0 auto;
                padding: 12px;
                border: 1px solid #eaeaea;
                border-radius: 8px;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                text-align: center;

              "
            >
              <h5 style="font-size: 16px; margin-bottom: 5px;">
                <span v-if="!allDownloadsCompletedVolume()">
                  <b-spinner small /> Downloading...
                </span>
                <span v-else>
                  Download Completed
                </span>
              </h5>
              <b-progress
                v-for="(item, index) in computedFileProgressVolume"
                v-if="item.progress > 0"
                :key="index"
                class="mt-1"
                style="height: 16px;"
                :max="100"
              >
                <b-progress-bar
                  :value="item.progress"
                  :label="`${item.fileName} - ${item.progress.toFixed(2)}%`"
                  style="font-size: 14px;"
                />
              </b-progress>
            </div>
            <div>
              <b-button-toolbar
                v-if="selectedAppVolume || !appSpecification?.compose"
                justify
                class="mb-1 w-100"
              >
                <div class="d-flex flex-row w-100">
                  <b-input-group class="w-100 mr-2">
                    <b-input-group-prepend>
                      <b-input-group-text>
                        <b-icon icon="house-fill" />
                      </b-input-group-text>
                    </b-input-group-prepend>
                    <b-form-input
                      v-model="inputPathValue"
                      class="text-secondary"
                      style="font-weight: bold; font-size: 1.0em;"
                    />
                  </b-input-group>
                  <b-button-group size="sm" />
                  <b-button-group
                    size="sm"
                    class="ml-auto"
                  >
                    <b-button
                      variant="outline-primary"
                      @click="refreshFolder()"
                    >
                      <v-icon name="redo-alt" />
                    </b-button>
                    <b-button
                      variant="outline-primary"
                      @click="uploadFilesDialog = true"
                    >
                      <v-icon name="cloud-upload-alt" />
                    </b-button>
                    <b-button
                      variant="outline-primary"
                      @click="createDirectoryDialogVisible = true"
                    >
                      <v-icon name="folder-plus" />
                    </b-button>
                    <b-modal
                      v-model="createDirectoryDialogVisible"
                      title="Create Folder"
                      size="lg"
                      centered
                      ok-only
                      ok-title="Create Folder"
                      header-bg-variant="primary"
                      @ok="createFolder(newDirName)"
                    >
                      <b-form-group
                        label="Folder Name"
                        label-for="folderNameInput"
                      >
                        <b-form-input
                          id="folderNameInput"
                          v-model="newDirName"
                          size="lg"
                          placeholder="New Folder Name"
                        />
                      </b-form-group>
                    </b-modal>
                    <b-modal
                      v-model="uploadFilesDialog"
                      title="Upload Files"
                      size="lg"
                      header-bg-variant="primary"
                      centered
                      hide-footer
                      @close="refreshFolder()"
                    >
                      <file-upload
                        :upload-folder="getUploadFolder()"
                        :headers="zelidHeader"
                        @complete="refreshFolder"
                      />
                    </b-modal>
                  </b-button-group>
                </div>
              </b-button-toolbar>
              <b-table
                v-if="selectedAppVolume || !appSpecification?.compose"
                class="fluxshare-table"
                hover
                responsive
                small
                outlined
                size="sm"
                :items="folderContentFilter"
                :fields="fields"
                :busy="loadingFolder"
                :sort-compare="sort"
                sort-by="name"
                show-empty
                :empty-text="`Directory is empty.`"
              >
                <template #table-busy>
                  <div class="text-center text-danger my-2">
                    <b-spinner class="align-middle mx-2" />
                    <strong>Loading...</strong>
                  </div>
                </template>
                <template #head(name)="data">
                  {{ data.label.toUpperCase() }}
                </template>
                <template #cell(name)="data">
                  <div v-if="data.item.symLink">
                    <b-link @click="changeFolder(data.item.name)">
                      <b-icon
                        class="mr-1"
                        scale="1.4"
                        icon="folder-symlink"
                      /> {{ data.item.name }}
                    </b-link>
                  </div>
                  <div v-if="data.item.isDirectory">
                    <b-link @click="changeFolder(data.item.name)">
                      <b-icon
                        class="mr-1"
                        scale="1.4"
                        icon="folder"
                      /> {{ data.item.name }}
                    </b-link>
                  </div>
                  <div v-else>
                    <div v-if="!data.item.symLink">
                      <b-icon
                        class="mr-1"
                        scale="1.4"
                        icon="file-earmark"
                      /> {{ data.item.name }}
                    </div>
                  </div>
                </template>
                <template #cell(modifiedAt)="data">
                  <div
                    v-if="!data.item.isUpButton"
                    class="no-wrap"
                  >
                    {{ new Date(data.item.modifiedAt).toLocaleString('en-GB', timeoptions) }}
                  </div>
                </template>
                <template #cell(type)="data">
                  <div v-if="!data.item.isUpButton">
                    <div v-if="data.item.isDirectory">
                      Folder
                    </div>
                    <div v-else-if="data.item.isFile">
                      File
                    </div>
                    <div v-else-if="data.item.isSymbolicLink">
                      File
                    </div>
                    <div v-else>
                      Other
                    </div>
                  </div>
                </template>
                <template #cell(size)="data">
                  <div
                    v-if="data.item.size > 0 && !data.item.isUpButton"
                    class="no-wrap"
                  >
                    {{ addAndConvertFileSizes(data.item.size) }}
                  </div>
                </template>
                <template #cell(actions)="data">
                  <b-button-group
                    v-if="!data.item.isUpButton"
                    size="sm"
                  >
                    <b-button
                      :id="`download-${data.item.name}`"
                      v-b-tooltip.hover.bottom="data.item.isFile ? 'Download' : 'Download zip of folder'"
                      v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                      variant="outline-secondary"
                    >
                      <v-icon :name="data.item.isFile ? 'file-download' : 'file-archive'" />
                    </b-button>
                    <b-button
                      :id="`rename-${data.item.name}`"
                      v-b-tooltip.hover.bottom="'Rename'"
                      v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                      variant="outline-secondary"
                      @click="rename(data.item.name)"
                    >
                      <v-icon name="edit" />
                    </b-button>
                    <b-button
                      :id="`delete-${data.item.name}`"
                      v-b-tooltip.hover.bottom="'Delete'"
                      v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                      variant="outline-secondary"
                    >
                      <v-icon name="trash-alt" />
                    </b-button>
                    <confirm-dialog
                      :target="`delete-${data.item.name}`"
                      :confirm-button="data.item.isFile ? 'Delete File' : 'Delete Folder'"
                      @confirm="deleteFile(data.item.name)"
                    />
                  </b-button-group>
                  <confirm-dialog
                    :target="`download-${data.item.name}`"
                    :confirm-button="data.item.isFile ? 'Download File' : 'Download Folder'"
                    @confirm="data.item.isFile ? download(data.item.name) : download(data.item.name, true, data.item.size)"
                  />
                  <b-modal
                    v-model="renameDialogVisible"
                    title="Rename"
                    size="lg"
                    centered
                    ok-only
                    ok-title="Rename"
                    @ok="confirmRename()"
                  >
                    <b-form-group
                      label="Name"
                      label-for="nameInput"
                    >
                      <b-form-input
                        id="nameInput"
                        v-model="newName"
                        size="lg"
                        placeholder="Name"
                      />
                    </b-form-group>
                  </b-modal>
                </template>
              </b-table>
            </div>
          </b-card>
        </div>
      </b-tab>
      <b-tab
        v-if="windowWidth > 860"
        title="Global App Management"
        disabled
      />
      <b-tab title="Global Control">
        <div v-if="globalZelidAuthorized">
          <b-row class="match-height">
            <b-col xs="6">
              <b-card title="Control">
                <b-card-text class="mb-2">
                  {{ isAppOwner ? 'General options to control all instances of your application' : 'General options to control instances of selected application running on all nodes that you own' }}
                </b-card-text>
                <div class="text-center">
                  <b-button
                    id="start-app-global"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Start App"
                    class="mx-1 my-1"
                  >
                    Start App
                  </b-button>
                  <confirm-dialog
                    target="start-app-global"
                    confirm-button="Start App"
                    @confirm="startAppGlobally(appName)"
                  />
                  <b-button
                    id="stop-app-global"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Stop App"
                    class="mx-1 my-1"
                  >
                    Stop App
                  </b-button>
                  <confirm-dialog
                    target="stop-app-global"
                    confirm-button="Stop App"
                    @confirm="stopAppGlobally(appName)"
                  />
                  <b-button
                    id="restart-app-global"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Restart App"
                    class="mx-1 my-1"
                  >
                    Restart App
                  </b-button>
                  <confirm-dialog
                    target="restart-app-global"
                    confirm-button="Restart App"
                    @confirm="restartAppGlobally(appName)"
                  />
                </div>
              </b-card>
            </b-col>
            <b-col xs="6">
              <b-card title="Pause">
                <b-card-text class="mb-2">
                  {{ isAppOwner ? 'The Pause command suspends all processes of all instances of your app' : 'The Pause command suspends all processes of selected application on all of nodes that you own' }}
                </b-card-text>
                <div class="text-center">
                  <b-button
                    id="pause-app-global"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Pause App"
                    class="mx-1 my-1"
                  >
                    Pause App
                  </b-button>
                  <confirm-dialog
                    target="pause-app-global"
                    confirm-button="Pause App"
                    @confirm="pauseAppGlobally(appName)"
                  />
                  <b-button
                    id="unpause-app-global"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Unpause App"
                    class="mx-1 my-1"
                  >
                    Unpause App
                  </b-button>
                  <confirm-dialog
                    target="unpause-app-global"
                    confirm-button="Unpause App"
                    @confirm="unpauseAppGlobally(appName)"
                  />
                </div>
              </b-card>
            </b-col>
          </b-row>
          <b-row class="match-height">
            <b-col xs="6">
              <b-card title="Redeploy">
                <b-card-text class="mb-2">
                  {{ isAppOwner ? 'Redeployes all instances of your application.'
                    + 'Hard redeploy removes persistant data storage. If app uses syncthing it can takes up to 30 to be up and running.' : 'Redeployes instances of selected application running on all of your nodes. Hard redeploy removes persistant data storage.' }}
                </b-card-text>
                <div class="text-center">
                  <b-button
                    id="redeploy-app-soft-global"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Soft Redeploy App"
                    class="mx-1 my-1"
                  >
                    Soft Redeploy App
                  </b-button>
                  <confirm-dialog
                    target="redeploy-app-soft-global"
                    confirm-button="Redeploy"
                    @confirm="redeployAppSoftGlobally(appName)"
                  />
                  <b-button
                    id="redeploy-app-hard-global"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Hard Redeploy App"
                    class="mx-1 my-1"
                  >
                    Hard Redeploy App
                  </b-button>
                  <confirm-dialog
                    target="redeploy-app-hard-global"
                    confirm-button="Redeploy"
                    @confirm="redeployAppHardGlobally(appName)"
                  />
                </div>
              </b-card>
            </b-col>
            <b-col xs="6">
              <b-card title="Reinstall">
                <b-card-text class="mb-2">
                  {{ isAppOwner ? 'Removes all instances of your App forcing an installation on different nodes.' : 'Removes all instances of selected App on all of your nodes forcing installation on different nodes.' }}
                </b-card-text>
                <div class="text-center">
                  <b-button
                    id="remove-app-global"
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="success"
                    aria-label="Reinstall App"
                    class="mx-1 my-1"
                  >
                    Reinstall App
                  </b-button>
                  <confirm-dialog
                    target="remove-app-global"
                    confirm-button="Reinstall App"
                    @confirm="removeAppGlobally(appName)"
                  />
                </div>
              </b-card>
            </b-col>
          </b-row>
        </div>
        <div v-else>
          Global management session expired. Please log out and back into FluxOS.
        </div>
      </b-tab>
      <b-tab title="Running Instances">
        <div v-if="masterSlaveApp">
          <b-card title="Primary/Standby App Information">
            <list-entry
              title="Current IP selected as Primary running your application"
              :data="masterIP"
            />
          </b-card>
        </div>
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
                v-model="instances.perPage"
                size="sm"
                :options="instances.pageOptions"
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
                  v-model="instances.filter"
                  type="search"
                  placeholder="Type to Search"
                />
                <b-input-group-append>
                  <b-button
                    :disabled="!instances.filter"
                    @click="instances.filter = ''"
                  >
                    Clear
                  </b-button>
                </b-input-group-append>
              </b-input-group>
            </b-form-group>
          </b-col>

          <b-col cols="12">
            <b-table
              :key="tableKey"
              class="app-instances-table"
              striped
              hover
              outlined
              responsive
              :busy="isBusy"
              :per-page="instances.perPage"
              :current-page="instances.currentPage"
              :items="instances.data"
              :fields="instances.fields"
              :sort-by.sync="instances.sortBy"
              :sort-desc.sync="instances.sortDesc"
              :sort-direction="instances.sortDirection"
              :filter="instances.filter"
              show-empty
              :empty-text="`No instances of ${appName}`"
            >
              <template #table-busy>
                <div class="text-center text-danger my-2">
                  <b-spinner class="align-middle mr-1" />
                  <strong>Loading geolocation...</strong>
                </div>
              </template>
              <template #cell(show_details)="row">
                <a @click="row.toggleDetails">
                  <v-icon
                    v-if="!row.detailsShowing"
                    class="ml-2"
                    name="chevron-down"
                  />
                  <v-icon
                    v-if="row.detailsShowing"
                    class="ml-2"
                    name="chevron-up"
                  />
                </a>
              </template>
              <template #row-details="row">
                <b-card class="">
                  <list-entry
                    v-if="row.item.broadcastedAt"
                    title="Broadcast"
                    :data="new Date(row.item.broadcastedAt).toLocaleString('en-GB', timeoptions.shortDate)"
                  />
                  <list-entry
                    v-if="row.item.expireAt"
                    title="Expires"
                    :data="new Date(row.item.expireAt).toLocaleString('en-GB', timeoptions.shortDate)"
                  />
                </b-card>
              </template>
              <template #cell(visit)="locationRow">
                <div class="button-cell">
                  <b-button
                    size="sm"
                    class="mr-1"
                    variant="outline-secondary"
                    @click="openApp(locationRow.item.name, locationRow.item.ip.split(':')[0], getProperPort())"
                  >
                    App
                  </b-button>
                  <b-button
                    size="sm"
                    class="mr-0"
                    variant="outline-primary"
                    @click="openNodeFluxOS(locationRow.item.ip.split(':')[0], locationRow.item.ip.split(':')[1] ? +locationRow.item.ip.split(':')[1] - 1 : 16126)"
                  >
                    FluxNode
                  </b-button>
                </div>
              </template>
            </b-table>
          </b-col>
          <b-col cols="12">
            <b-pagination
              v-model="instances.currentPage"
              :total-rows="instances.totalRows"
              :per-page="instances.perPage"
              align="center"
              size="sm"
              class="my-0"
            />
          </b-col>
        </b-row>
      </b-tab>
      <b-tab
        title="Update/Renew"
        :disabled="!isAppOwner"
      >
        <div
          v-if="!fluxCommunication"
          class="text-danger "
        >
          Warning: Connected Flux is not communicating properly with Flux network
        </div>
        <div
          style="
            border: 1px solid #ccc;
            border-radius: 8px;
            height: 45px;
            padding: 12px;
            line-height: 0px;
          "
        >
          <h5>
            <b-icon
              class="mr-1"
              icon="ui-checks-grid"
            /> Update Application Specifications / Extend subscription
          </h5>
        </div>
        <div class="form-row form-group">
          <b-input-group class="mt-2">
            <b-input-group-prepend>
              <b-input-group-text>
                <b-icon
                  class="mr-1"
                  icon="plus-square"
                />
                Update Specifications
                <v-icon
                  v-b-tooltip.hover.top="'Select if you want to change your application specifications'"
                  name="info-circle"
                  class="ml-1"
                />
              </b-input-group-text>
            </b-input-group-prepend>
            <b-input-group-append is-text>
              <b-form-checkbox
                id="updateSpecifications"
                v-model="updateSpecifications"
                switch
                class="custom-control-primary"
              />
            </b-input-group-append>
          </b-input-group>
        </div>
        <div v-if="updateSpecifications">
          <div v-if="appUpdateSpecification.version >= 4">
            <b-row class="match-height">
              <b-col xs="6">
                <b-card title="Details">
                  <b-form-group
                    label-cols="2"
                    label-cols-lg="1"
                    label="Version"
                    label-for="version"
                  >
                    <b-form-input
                      id="version"
                      v-model="appUpdateSpecification.version"
                      :placeholder="appUpdateSpecification.version.toString()"
                      readonly
                    />
                  </b-form-group>
                  <b-form-group
                    label-cols="2"
                    label-cols-lg="1"
                    label="Name"
                    label-for="name"
                  >
                    <b-form-input
                      id="name"
                      v-model="appUpdateSpecification.name"
                      placeholder="Application Name"
                      readonly
                    />
                  </b-form-group>
                  <b-form-group
                    label-cols="2"
                    label-cols-lg="1"
                    label="Desc."
                    label-for="desc"
                  >
                    <b-form-textarea
                      id="desc"
                      v-model="appUpdateSpecification.description"
                      placeholder="Description"
                      rows="3"
                    />
                  </b-form-group>
                  <b-form-group
                    label-cols="2"
                    label-cols-lg="1"
                    label="Owner"
                    label-for="owner"
                  >
                    <b-form-input
                      id="owner"
                      v-model="appUpdateSpecification.owner"
                      placeholder="ZelID of Application Owner"
                    />
                  </b-form-group>
                  <div v-if="appUpdateSpecification.version >= 5 && !isPrivateApp">
                    <div class="form-row form-group">
                      <label class="col-1 col-form-label">
                        Contacts
                        <v-icon
                          v-b-tooltip.hover.top="'Array of strings of emails Contacts to get notifications ex. app about to expire, app spawns. Contacts are also PUBLIC information.'"
                          name="info-circle"
                          class="mr-1"
                        />
                      </label>
                      <div class="col">
                        <b-form-input
                          id="contacs"
                          v-model="appUpdateSpecification.contacts"
                        />
                      </div>
                      <div class="col-0">
                        <b-button
                          id="upload-contacts"
                          v-b-tooltip.hover.top="
                            'Uploads Contacts to Flux Storage. Contacts will be replaced with a link to Flux Storage instead. This increases maximum allowed contacts while adding enhanced privacy - nobody except FluxOS Team maintaining notifications system has access to contacts.'
                          "
                          variant="outline-primary"
                        >
                          <v-icon name="cloud-upload-alt" />
                        </b-button>
                        <confirm-dialog
                          target="upload-contacts"
                          confirm-button="Upload Contacts"
                          :width="600"
                          @confirm="uploadContactsToFluxStorage()"
                        />
                      </div>
                    </div>
                  </div>
                  <div v-if="appUpdateSpecification.version >= 5 && !isPrivateApp">
                    <h4>Allowed Geolocation</h4>
                    <div
                      v-for="n in numberOfGeolocations"
                      :key="`${n}pos`"
                    >
                      <b-form-group
                        label-cols="3"
                        label-cols-lg="1"
                        :label="`Continent - ${n}`"
                        label-for="Continent"
                      >
                        <b-form-select
                          id="Continent"
                          v-model="allowedGeolocations[`selectedContinent${n}`]"
                          :options="continentsOptions(false)"
                          @change="adjustMaxInstancesPossible()"
                        >
                          <template #first>
                            <b-form-select-option
                              :value="undefined"
                              disabled
                            >
                              -- Select to restrict Continent --
                            </b-form-select-option>
                          </template>
                        </b-form-select>
                      </b-form-group>
                      <b-form-group
                        v-if="allowedGeolocations[`selectedContinent${n}`] && allowedGeolocations[`selectedContinent${n}`] !== 'ALL'"
                        label-cols="3"
                        label-cols-lg="1"
                        :label="`Country - ${n}`"
                        label-for="Country"
                      >
                        <b-form-select
                          id="country"
                          v-model="allowedGeolocations[`selectedCountry${n}`]"
                          :options="countriesOptions(allowedGeolocations[`selectedContinent${n}`], false)"
                          @change="adjustMaxInstancesPossible()"
                        >
                          <template #first>
                            <b-form-select-option
                              :value="undefined"
                              disabled
                            >
                              -- Select to restrict Country --
                            </b-form-select-option>
                          </template>
                        </b-form-select>
                      </b-form-group>
                      <b-form-group
                        v-if="allowedGeolocations[`selectedContinent${n}`] && allowedGeolocations[`selectedContinent${n}`] !== 'ALL' && allowedGeolocations[`selectedCountry${n}`] && allowedGeolocations[`selectedCountry${n}`] !== 'ALL'"
                        label-cols="3"
                        label-cols-lg="1"
                        :label="`Region - ${n}`"
                        label-for="Region"
                      >
                        <b-form-select
                          id="Region"
                          v-model="allowedGeolocations[`selectedRegion${n}`]"
                          :options="regionsOptions(allowedGeolocations[`selectedContinent${n}`], allowedGeolocations[`selectedCountry${n}`], false)"
                          @change="adjustMaxInstancesPossible()"
                        >
                          <template #first>
                            <b-form-select-option
                              :value="undefined"
                              disabled
                            >
                              -- Select to restrict Region --
                            </b-form-select-option>
                          </template>
                        </b-form-select>
                      </b-form-group>
                    </div>
                    <div class="text-center">
                      <b-button
                        v-if="numberOfGeolocations > 1"
                        v-b-tooltip.hover.bottom="'Remove Allowed Geolocation Restriction'"
                        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                        variant="outline-secondary"
                        size="sm"
                        class="m-1"
                        @click="numberOfGeolocations = numberOfGeolocations - 1; adjustMaxInstancesPossible()"
                      >
                        <v-icon name="minus" />
                      </b-button>
                      <b-button
                        v-if="numberOfGeolocations < 5"
                        v-b-tooltip.hover.bottom="'Add Allowed Geolocation Restriction'"
                        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                        variant="outline-secondary"
                        size="sm"
                        class="m-1"
                        @click="numberOfGeolocations = numberOfGeolocations + 1; adjustMaxInstancesPossible()"
                      >
                        <v-icon name="plus" />
                      </b-button>
                    </div>
                  </div>
                  <br><br>
                  <div v-if="appUpdateSpecification.version >= 5">
                    <h4>Forbidden Geolocation</h4>
                    <div
                      v-for="n in numberOfNegativeGeolocations"
                      :key="`${n}posB`"
                    >
                      <b-form-group
                        label-cols="3"
                        label-cols-lg="1"
                        :label="`Continent - ${n}`"
                        label-for="Continent"
                      >
                        <b-form-select
                          id="Continent"
                          v-model="forbiddenGeolocations[`selectedContinent${n}`]"
                          :options="continentsOptions(true)"
                        >
                          <template #first>
                            <b-form-select-option
                              :value="undefined"
                              disabled
                            >
                              -- Select to ban Continent --
                            </b-form-select-option>
                          </template>
                        </b-form-select>
                      </b-form-group>
                      <b-form-group
                        v-if="forbiddenGeolocations[`selectedContinent${n}`] && forbiddenGeolocations[`selectedContinent${n}`] !== 'NONE'"
                        label-cols="3"
                        label-cols-lg="1"
                        :label="`Country - ${n}`"
                        label-for="Country"
                      >
                        <b-form-select
                          id="country"
                          v-model="forbiddenGeolocations[`selectedCountry${n}`]"
                          :options="countriesOptions(forbiddenGeolocations[`selectedContinent${n}`], true)"
                        >
                          <template #first>
                            <b-form-select-option
                              :value="undefined"
                              disabled
                            >
                              -- Select to ban Country --
                            </b-form-select-option>
                          </template>
                        </b-form-select>
                      </b-form-group>
                      <b-form-group
                        v-if="forbiddenGeolocations[`selectedContinent${n}`] && forbiddenGeolocations[`selectedContinent${n}`] !== 'NONE' && forbiddenGeolocations[`selectedCountry${n}`] && forbiddenGeolocations[`selectedCountry${n}`] !== 'ALL'"
                        label-cols="3"
                        label-cols-lg="1"
                        :label="`Region - ${n}`"
                        label-for="Region"
                      >
                        <b-form-select
                          id="Region"
                          v-model="forbiddenGeolocations[`selectedRegion${n}`]"
                          :options="regionsOptions(forbiddenGeolocations[`selectedContinent${n}`], forbiddenGeolocations[`selectedCountry${n}`], true)"
                        >
                          <template #first>
                            <b-form-select-option
                              :value="undefined"
                              disabled
                            >
                              -- Select to ban Region --
                            </b-form-select-option>
                          </template>
                        </b-form-select>
                      </b-form-group>
                    </div>
                    <div class="text-center">
                      <b-button
                        v-if="numberOfNegativeGeolocations > 1"
                        v-b-tooltip.hover.bottom="'Remove Forbidden Geolocation Restriction'"
                        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                        variant="outline-secondary"
                        size="sm"
                        class="m-1"
                        @click="numberOfNegativeGeolocations = numberOfNegativeGeolocations - 1"
                      >
                        <v-icon name="minus" />
                      </b-button>
                      <b-button
                        v-if="numberOfNegativeGeolocations < 5"
                        v-b-tooltip.hover.bottom="'Add Forbidden Geolocation Restriction'"
                        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                        variant="outline-secondary"
                        size="sm"
                        class="m-1"
                        @click="numberOfNegativeGeolocations = numberOfNegativeGeolocations + 1"
                      >
                        <v-icon name="plus" />
                      </b-button>
                    </div>
                  </div>
                  <br>
                  <b-form-group
                    v-if="appUpdateSpecification.version >= 3"
                    label-cols="2"
                    label-cols-lg="1"
                    label="Instances"
                    label-for="instances"
                  >
                    <div class="mx-1">
                      {{ appUpdateSpecification.instances }}
                    </div>
                    <b-form-input
                      id="instances"
                      v-model="appUpdateSpecification.instances"
                      placeholder="Minimum number of application instances to be spawned"
                      type="range"
                      min="3"
                      :max="maxInstances"
                      step="1"
                    />
                  </b-form-group>
                  <div
                    v-if="appUpdateSpecification.version >= 7"
                    class="form-row form-group"
                  >
                    <label class="col-form-label">
                      Static IP
                      <v-icon
                        v-b-tooltip.hover.top="'Select if your application strictly requires static IP address'"
                        name="info-circle"
                        class="mr-1"
                      />
                    </label>
                    <div class="col">
                      <b-form-checkbox
                        id="staticip"
                        v-model="appUpdateSpecification.staticip"
                        switch
                        class="custom-control-primary inline"
                      />
                    </div>
                  </div>
                  <br>
                  <div
                    v-if="appUpdateSpecification.version >= 7"
                    class="form-row form-group"
                  >
                    <label class="col-form-label">
                      Enterprise Application
                      <v-icon
                        v-b-tooltip.hover.top="'Select if your application requires private image, secrets or if you want to target specific nodes on which application can run. Geolocation targetting is not possible in this case.'"
                        name="info-circle"
                        class="mr-1"
                      />
                    </label>
                    <div class="col">
                      <b-form-checkbox
                        id="enterpriseapp"
                        v-model="isPrivateApp"
                        switch
                        class="custom-control-primary inline"
                      />
                    </div>
                  </div>
                </b-card>
              </b-col>
            </b-row>
            <b-card
              v-for="(component, index) in appUpdateSpecification.compose"
              :key="index"
            >
              <b-card-title>
                Component {{ component.name }}
              </b-card-title>
              <b-row class="match-height">
                <b-col
                  xs="12"
                  xl="6"
                >
                  <b-card>
                    <b-card-title>
                      General
                    </b-card-title>
                    <div class="form-row form-group">
                      <label class="col-3 col-form-label">
                        Name
                        <v-icon
                          v-b-tooltip.hover.top="'Name of Application Component'"
                          name="info-circle"
                          class="mr-1"
                        />
                      </label>
                      <div class="col">
                        <b-form-input
                          :id="`repo-${component.name}_${appUpdateSpecification.name}`"
                          v-model="component.name"
                          placeholder="Component name"
                          readonly
                        />
                      </div>
                    </div>
                    <div class="form-row form-group">
                      <label class="col-3 col-form-label">
                        Description
                        <v-icon
                          v-b-tooltip.hover.top="'Description of Application Component'"
                          name="info-circle"
                          class="mr-1"
                        />
                      </label>
                      <div class="col">
                        <b-form-input
                          :id="`repo-${component.name}_${appUpdateSpecification.name}`"
                          v-model="component.description"
                          placeholder="Component description"
                        />
                      </div>
                    </div>
                    <div class="form-row form-group">
                      <label class="col-3 col-form-label">
                        Repository
                        <v-icon
                          v-b-tooltip.hover.top="'Docker image namespace/repository:tag for component'"
                          name="info-circle"
                          class="mr-1"
                        />
                      </label>
                      <div class="col">
                        <b-form-input
                          :id="`repo-${component.name}_${appUpdateSpecification.name}`"
                          v-model="component.repotag"
                          placeholder="Docker image namespace/repository:tag"
                        />
                      </div>
                    </div>
                    <div
                      v-if="appUpdateSpecification.version >= 7 && isPrivateApp"
                      class="form-row form-group"
                    >
                      <label class="col-3 col-form-label">
                        Repository Authentication
                        <v-icon
                          v-b-tooltip.hover.top="'Docker image authentication for private images in the format of username:apikey. This field will be encrypted and accessible to selected enterprise nodes only.'"
                          name="info-circle"
                          class="mr-1"
                        />
                      </label>
                      <div class="col">
                        <b-form-input
                          :id="`repoauth-${component.name}_${appUpdateSpecification.name}`"
                          v-model="component.repoauth"
                          placeholder="Docker authentication username:apikey"
                        />
                      </div>
                    </div>
                    <br>
                    <b-card-title>
                      Connectivity
                    </b-card-title>
                    <div class="form-row form-group">
                      <label class="col-3 col-form-label">
                        Ports
                        <v-icon
                          v-b-tooltip.hover.top="'Array of Ports on which application will be available'"
                          name="info-circle"
                          class="mr-1"
                        />
                      </label>
                      <div class="col">
                        <b-form-input
                          :id="`ports-${component.name}_${appUpdateSpecification.name}`"
                          v-model="component.ports"
                        />
                      </div>
                    </div>
                    <div class="form-row form-group">
                      <label class="col-3 col-form-label">
                        Domains
                        <v-icon
                          v-b-tooltip.hover.top="'Array of strings of Domains managed by Flux Domain Manager (FDM). Length must correspond to available ports. Use empty strings for no domains'"
                          name="info-circle"
                          class="mr-1"
                        />
                      </label>
                      <div class="col">
                        <b-form-input
                          :id="`domains-${component.name}_${appUpdateSpecification.name}`"
                          v-model="component.domains"
                        />
                      </div>
                    </div>
                    <div class="form-row form-group">
                      <label class="col-3 col-form-label">
                        Cont. Ports
                        <v-icon
                          v-b-tooltip.hover.top="'Container Ports - Array of ports which your container has'"
                          name="info-circle"
                          class="mr-1"
                        />
                      </label>
                      <div class="col">
                        <b-form-input
                          :id="`containerPorts-${component.name}_${appUpdateSpecification.name}`"
                          v-model="component.containerPorts"
                        />
                      </div>
                    </div>
                  </b-card>
                </b-col>
                <b-col
                  xs="12"
                  xl="6"
                >
                  <b-card>
                    <b-card-title>
                      Environment
                    </b-card-title>
                    <div class="form-row form-group">
                      <label class="col-3 col-form-label">
                        Environment
                        <v-icon
                          v-b-tooltip.hover.top="'Array of strings of Environmental Parameters'"
                          name="info-circle"
                          class="mr-1"
                        />
                      </label>
                      <div class="col">
                        <b-form-input
                          :id="`environmentParameters-${component.name}_${appUpdateSpecification.name}`"
                          v-model="component.environmentParameters"
                        />
                      </div>
                      <div class="col-0">
                        <b-button
                          id="upload-env"
                          v-b-tooltip.hover.top="
                            'Uploads Enviornment to Flux Storage. Environment parameters will be replaced with a link to Flux Storage instead. This increases maximum allowed size of Env. parameters while adding basic privacy - instead of parameters, link to Flux Storage will be visible.'
                          "
                          variant="outline-primary"
                        >
                          <v-icon name="cloud-upload-alt" />
                        </b-button>
                        <confirm-dialog
                          target="upload-env"
                          confirm-button="Upload Environment Parameters"
                          :width="600"
                          @confirm="uploadEnvToFluxStorage(index)"
                        />
                      </div>
                    </div>
                    <div class="form-row form-group">
                      <label class="col-3 col-form-label">
                        Commands
                        <v-icon
                          v-b-tooltip.hover.top="'Array of strings of Commands'"
                          name="info-circle"
                          class="mr-1"
                        />
                      </label>
                      <div class="col">
                        <b-form-input
                          :id="`commands-${component.name}_${appUpdateSpecification.name}`"
                          v-model="component.commands"
                        />
                      </div>
                      <div class="col-0">
                        <b-button
                          id="upload-cmd"
                          v-b-tooltip.hover.top="'Uploads Commands to Flux Storage. Commands will be replaced with a link to Flux Storage instead. This increases maximum allowed size of Commands while adding basic privacy - instead of commands, link to Flux Storage will be visible.'"
                          variant="outline-primary"
                        >
                          <v-icon name="cloud-upload-alt" />
                        </b-button>
                        <confirm-dialog
                          target="upload-cmd"
                          confirm-button="Upload Commands"
                          :width="600"
                          @confirm="uploadCmdToFluxStorage(index)"
                        />
                      </div>
                    </div>
                    <div class="form-row form-group">
                      <label class="col-3 col-form-label">
                        Cont. Data
                        <v-icon
                          v-b-tooltip.hover.top="'Data folder that is shared by application to App volume. Prepend with r: for synced data between instances. Ex. r:/data. Prepend with g: for synced data and primary/standby solution. Ex. g:/data'"
                          name="info-circle"
                          class="mr-1"
                        />
                      </label>
                      <div class="col">
                        <b-form-input
                          :id="`containerData-${component.name}_${appUpdateSpecification.name}`"
                          v-model="component.containerData"
                        />
                      </div>
                    </div>
                    <div
                      v-if="appUpdateSpecification.version >= 7 && isPrivateApp"
                      class="form-row form-group"
                    >
                      <label class="col-3 col-form-label">
                        Secrets
                        <v-icon
                          v-b-tooltip.hover.top="'Array of strings of Secret Environmental Parameters. This will be encrypted and accessible to selected Enterprise Nodes only'"
                          name="info-circle"
                          class="mr-1"
                        />
                      </label>
                      <div class="col">
                        <b-form-input
                          :id="`secrets-${component.name}_${appUpdateSpecification.name}`"
                          v-model="component.secrets"
                          placeholder="[]"
                        />
                      </div>
                    </div>
                    <br>
                    <b-card-title>
                      Resources &nbsp;&nbsp;&nbsp;<h6 class="inline text-small">
                        Tiered:
                        <b-form-checkbox
                          id="tiered"
                          v-model="component.tiered"
                          switch
                          class="custom-control-primary inline"
                        />
                      </h6>
                    </b-card-title>
                    <b-form-group
                      v-if="!component.tiered"
                      label-cols="3"
                      label-cols-lg="2"
                      label="CPU"
                      label-for="cpu"
                    >
                      <div class="mx-1">
                        {{ component.cpu }}
                      </div>
                      <b-form-input
                        :id="`cpu-${component.name}_${appUpdateSpecification.name}`"
                        v-model="component.cpu"
                        placeholder="CPU cores to use by default"
                        type="range"
                        min="0.1"
                        max="15"
                        step="0.1"
                      />
                    </b-form-group>
                    <b-form-group
                      v-if="!component.tiered"
                      label-cols="3"
                      label-cols-lg="2"
                      label="RAM"
                      label-for="ram"
                    >
                      <div class="mx-1">
                        {{ component.ram }}
                      </div>
                      <b-form-input
                        :id="`ram-${component.name}_${appUpdateSpecification.name}`"
                        v-model="component.ram"
                        placeholder="RAM in MB value to use by default"
                        type="range"
                        min="100"
                        max="59000"
                        step="100"
                      />
                    </b-form-group>
                    <b-form-group
                      v-if="!component.tiered"
                      label-cols="3"
                      label-cols-lg="2"
                      label="SSD"
                      label-for="ssd"
                    >
                      <div class="mx-1">
                        {{ component.hdd }}
                      </div>
                      <b-form-input
                        :id="`ssd-${component.name}_${appUpdateSpecification.name}`"
                        v-model="component.hdd"
                        placeholder="SSD in GB value to use by default"
                        type="range"
                        min="1"
                        max="820"
                        step="1"
                      />
                    </b-form-group>
                  </b-card>
                </b-col>
              </b-row>
              <b-row v-if="component.tiered">
                <b-col
                  xs="12"
                  md="6"
                  lg="4"
                >
                  <b-card title="Cumulus">
                    <div>
                      CPU: {{ component.cpubasic }}
                    </div>
                    <b-form-input
                      v-model="component.cpubasic"
                      type="range"
                      min="0.1"
                      max="3"
                      step="0.1"
                    />
                    <div>
                      RAM: {{ component.rambasic }}
                    </div>
                    <b-form-input
                      v-model="component.rambasic"
                      type="range"
                      min="100"
                      max="5000"
                      step="100"
                    />
                    <div>
                      SSD: {{ component.hddbasic }}
                    </div>
                    <b-form-input
                      v-model="component.hddbasic"
                      type="range"
                      min="1"
                      max="180"
                      step="1"
                    />
                  </b-card>
                </b-col>
                <b-col
                  xs="12"
                  md="6"
                  lg="4"
                >
                  <b-card title="Nimbus">
                    <div>
                      CPU: {{ component.cpusuper }}
                    </div>
                    <b-form-input
                      v-model="component.cpusuper"
                      type="range"
                      min="0.1"
                      max="7"
                      step="0.1"
                    />
                    <div>
                      RAM: {{ component.ramsuper }}
                    </div>
                    <b-form-input
                      v-model="component.ramsuper"
                      type="range"
                      min="100"
                      max="28000"
                      step="100"
                    />
                    <div>
                      SSD: {{ component.hddsuper }}
                    </div>
                    <b-form-input
                      v-model="component.hddsuper"
                      type="range"
                      min="1"
                      max="400"
                      step="1"
                    />
                  </b-card>
                </b-col>
                <b-col
                  xs="12"
                  lg="4"
                >
                  <b-card title="Stratus">
                    <div>
                      CPU: {{ component.cpubamf }}
                    </div>
                    <b-form-input
                      v-model="component.cpubamf"
                      type="range"
                      min="0.1"
                      max="15"
                      step="0.1"
                    />
                    <div>
                      RAM: {{ component.rambamf }}
                    </div>
                    <b-form-input
                      v-model="component.rambamf"
                      type="range"
                      min="100"
                      max="59000"
                      step="100"
                    />
                    <div>
                      SSD: {{ component.hddbamf }}
                    </div>
                    <b-form-input
                      v-model="component.hddbamf"
                      type="range"
                      min="1"
                      max="820"
                      step="1"
                    />
                  </b-card>
                </b-col>
              </b-row>
            </b-card>
            <b-card
              v-if="appUpdateSpecification.version >= 7 && isPrivateApp"
              title="Enterprise Nodes"
            >
              Only these selected enterprise nodes will be able to run your application and are used for encryption. Only these nodes are able to access your private image and secrets.<br>
              Changing the node list after the message is computed and encrypted will result in a failure to run. Secrets and Repository Authentication would need to be adjusted again.<br>
              The score determines how reputable a node and node operator are. The higher the score, the higher the reputation on the network.<br>
              Secrets and Repository Authentication need to be set again if this node list changes.<br>
              The more nodes can run your application, the more stable it is. On the other hand, more nodes will have access to your private data!<br>
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
                      v-model="entNodesTable.perPage"
                      size="sm"
                      :options="entNodesTable.pageOptions"
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
                        v-model="entNodesTable.filter"
                        type="search"
                        placeholder="Type to Search"
                      />
                      <b-input-group-append>
                        <b-button
                          :disabled="!entNodesTable.filter"
                          @click="entNodesTable.filter = ''"
                        >
                          Clear
                        </b-button>
                      </b-input-group-append>
                    </b-input-group>
                  </b-form-group>
                </b-col>

                <b-col cols="12">
                  <b-table
                    class="app-enterprise-nodes-table"
                    striped
                    hover
                    responsive
                    :per-page="entNodesTable.perPage"
                    :current-page="entNodesTable.currentPage"
                    :items="selectedEnterpriseNodes"
                    :fields="entNodesTable.fields"
                    :sort-by.sync="entNodesTable.sortBy"
                    :sort-desc.sync="entNodesTable.sortDesc"
                    :sort-direction="entNodesTable.sortDirection"
                    :filter="entNodesTable.filter"
                    :filter-included-fields="entNodesTable.filterOn"
                    show-empty
                    :empty-text="'No Enterprise Nodes selected'"
                  >
                    <template #cell(show_details)="row">
                      <a @click="row.toggleDetails">
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
                      <b-card class="">
                        <list-entry
                          v-if="row.item.ip"
                          title="IP Address"
                          :data="row.item.ip"
                        />
                        <list-entry
                          title="Public Key"
                          :data="row.item.pubkey"
                        />
                        <list-entry
                          title="Node Address"
                          :data="row.item.payment_address"
                        />
                        <list-entry
                          title="Collateral"
                          :data="`${row.item.txhash}:${row.item.outidx}`"
                        />
                        <list-entry
                          title="Tier"
                          :data="row.item.tier"
                        />
                        <list-entry
                          title="Overall Score"
                          :data="row.item.score.toString()"
                        />
                        <list-entry
                          title="Collateral Score"
                          :data="row.item.collateralPoints.toString()"
                        />
                        <list-entry
                          title="Maturity Score"
                          :data="row.item.maturityPoints.toString()"
                        />
                        <list-entry
                          title="Public Key Score"
                          :data="row.item.pubKeyPoints.toString()"
                        />
                        <list-entry
                          title="Enterprise Apps Assigned"
                          :data="row.item.enterpriseApps.toString()"
                        />
                        <div>
                          <b-button
                            size="sm"
                            class="mr-0"
                            variant="primary"
                            @click="openNodeFluxOS(row.item.ip.split(':')[0], row.item.ip.split(':')[1] ? +row.item.ip.split(':')[1] - 1 : 16126)"
                          >
                            Visit FluxNode
                          </b-button>
                        </div>
                      </b-card>
                    </template>
                    <template #cell(ip)="row">
                      {{ row.item.ip }}
                    </template>
                    <template #cell(payment_address)="row">
                      {{ row.item.payment_address.slice(0, 8) }}...{{ row.item.payment_address.slice(row.item.payment_address.length - 8, row.item.payment_address.length) }}
                    </template>
                    <template #cell(tier)="row">
                      {{ row.item.tier }}
                    </template>
                    <template #cell(score)="row">
                      {{ row.item.score }}
                    </template>
                    <template #cell(actions)="locationRow">
                      <b-button
                        :id="`remove-${locationRow.item.ip}`"
                        size="sm"
                        class="mr-1 mb-1"
                        variant="danger"
                      >
                        Remove
                      </b-button>
                      <confirm-dialog
                        :target="`remove-${locationRow.item.ip}`"
                        confirm-button="Remove FluxNode"
                        @confirm="removeFluxNode(locationRow.item.ip)"
                      />
                      <b-button
                        size="sm"
                        class="mr-1 mb-1"
                        variant="primary"
                        @click="openNodeFluxOS(locationRow.item.ip.split(':')[0], locationRow.item.ip.split(':')[1] ? +locationRow.item.ip.split(':')[1] - 1 : 16126)"
                      >
                        Visit
                      </b-button>
                    </template>
                  </b-table>
                </b-col>
                <b-col cols="12">
                  <b-pagination
                    v-model="entNodesTable.currentPage"
                    :total-rows="selectedEnterpriseNodes.length"
                    :per-page="entNodesTable.perPage"
                    align="center"
                    size="sm"
                    class="my-0"
                  />
                  <span class="table-total">Total: {{ selectedEnterpriseNodes.length }}</span>
                </b-col>
              </b-row>
              <br>
              <br>
              <div class="text-center">
                <b-button
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="primary"
                  aria-label="Auto Select Enterprise Nodes"
                  class="mb-2 mr-2"
                  @click="autoSelectNodes"
                >
                  Auto Select Enterprise Nodes
                </b-button>
                <b-button
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="primary"
                  aria-label="Choose Enterprise Nodes"
                  class="mb-2 mr-2"
                  @click="chooseEnterpriseDialog = true"
                >
                  Choose Enterprise Nodes
                </b-button>
              </div>
            </b-card>
          </div>
          <div v-else>
            <b-row class="match-height">
              <b-col
                xs="12"
                xl="6"
              >
                <b-card title="Details">
                  <b-form-group
                    label-cols="2"
                    label="Version"
                    label-for="version"
                  >
                    <b-form-input
                      id="version"
                      v-model="appUpdateSpecification.version"
                      :placeholder="appUpdateSpecification.version.toString()"
                      readonly
                    />
                  </b-form-group>
                  <b-form-group
                    label-cols="2"
                    label="Name"
                    label-for="name"
                  >
                    <b-form-input
                      id="name"
                      v-model="appUpdateSpecification.name"
                      placeholder="App Name"
                      readonly
                    />
                  </b-form-group>
                  <b-form-group
                    label-cols="2"
                    label="Desc."
                    label-for="desc"
                  >
                    <b-form-textarea
                      id="desc"
                      v-model="appUpdateSpecification.description"
                      placeholder="Description"
                      rows="3"
                    />
                  </b-form-group>
                  <b-form-group
                    label-cols="2"
                    label="Repo"
                    label-for="repo"
                  >
                    <b-form-input
                      id="repo"
                      v-model="appUpdateSpecification.repotag"
                      placeholder="Docker image namespace/repository:tag"
                      readonly
                    />
                  </b-form-group>
                  <b-form-group
                    label-cols="2"
                    label="Owner"
                    label-for="owner"
                  >
                    <b-form-input
                      id="owner"
                      v-model="appUpdateSpecification.owner"
                      placeholder="ZelID of Application Owner"
                    />
                  </b-form-group>
                  <br>
                  <b-form-group
                    v-if="appUpdateSpecification.version >= 3"
                    label-cols="2"
                    label-cols-lg="1"
                    label="Instances"
                    label-for="instances"
                  >
                    <div class="mx-1">
                      {{ appUpdateSpecification.instances }}
                    </div>
                    <b-form-input
                      id="instances"
                      v-model="appUpdateSpecification.instances"
                      placeholder="Minimum number of application instances to be spawned"
                      type="range"
                      min="3"
                      :max="maxInstances"
                      step="1"
                    />
                  </b-form-group>
                  <br>
                  <b-form-group
                    v-if="appUpdateSpecification.version >= 6"
                    label-cols="2"
                    label-cols-lg="1"
                    label="Period"
                    label-for="period"
                  >
                    <div class="mx-1">
                      {{ getExpireLabel || (appUpdateSpecification.expire ? `${appUpdateSpecification.expire} blocks` : '1 month') }}
                    </div>
                    <b-form-input
                      id="period"
                      v-model="expirePosition"
                      placeholder="How long an application will live on Flux network"
                      type="range"
                      :min="0"
                      :max="5"
                      :step="1"
                    />
                  </b-form-group>
                </b-card>
              </b-col>
              <b-col
                xs="12"
                xl="6"
              >
                <b-card title="Environment">
                  <div class="form-row form-group">
                    <label class="col-3 col-form-label">
                      Ports
                      <v-icon
                        v-b-tooltip.hover.top="'Array of Ports on which application will be available'"
                        name="info-circle"
                        class="mr-1"
                      />
                    </label>
                    <div class="col">
                      <b-form-input
                        id="ports"
                        v-model="appUpdateSpecification.ports"
                      />
                    </div>
                  </div>
                  <div class="form-row form-group">
                    <label class="col-3 col-form-label">
                      Domains
                      <v-icon
                        v-b-tooltip.hover.top="'Array of strings of Domains managed by Flux Domain Manager (FDM). Length must correspond to available ports. Use empty strings for no domains'"
                        name="info-circle"
                        class="mr-1"
                      />
                    </label>
                    <div class="col">
                      <b-form-input
                        id="domains"
                        v-model="appUpdateSpecification.domains"
                      />
                    </div>
                  </div>
                  <div class="form-row form-group">
                    <label class="col-3 col-form-label">
                      Environment
                      <v-icon
                        v-b-tooltip.hover.top="'Array of strings of Environmental Parameters'"
                        name="info-circle"
                        class="mr-1"
                      />
                    </label>
                    <div class="col">
                      <b-form-input
                        id="environmentParameters"
                        v-model="appUpdateSpecification.enviromentParameters"
                      />
                    </div>
                  </div>
                  <div class="form-row form-group">
                    <label class="col-3 col-form-label">
                      Commands
                      <v-icon
                        v-b-tooltip.hover.top="'Array of strings of Commands'"
                        name="info-circle"
                        class="mr-1"
                      />
                    </label>
                    <div class="col">
                      <b-form-input
                        id="commands"
                        v-model="appUpdateSpecification.commands"
                      />
                    </div>
                  </div>
                  <div class="form-row form-group">
                    <label class="col-3 col-form-label">
                      Cont. Ports
                      <v-icon
                        v-b-tooltip.hover.top="'Container Ports - Array of ports which your container has'"
                        name="info-circle"
                        class="mr-1"
                      />
                    </label>
                    <div class="col">
                      <b-form-input
                        id="containerPorts"
                        v-model="appUpdateSpecification.containerPorts"
                      />
                    </div>
                  </div>
                  <div class="form-row form-group">
                    <label class="col-3 col-form-label">
                      Cont. Data
                      <v-icon
                        v-b-tooltip.hover.top="'Data folder that is shared by application to App volume. Prepend with r: for synced data between instances. Ex. r:/data. Prepend with g: for synced data and primary/standby solution. Ex. g:/data'"
                        name="info-circle"
                        class="mr-1"
                      />
                    </label>
                    <div class="col">
                      <b-form-input
                        id="containerData"
                        v-model="appUpdateSpecification.containerData"
                      />
                    </div>
                  </div>
                </b-card>
              </b-col>
            </b-row>
            <b-row class="match-height">
              <b-col xs="12">
                <b-card>
                  <b-card-title>
                    Resources &nbsp;&nbsp;&nbsp;<h6 class="inline etext-small">
                      Tiered:
                      <b-form-checkbox
                        id="tiered"
                        v-model="appUpdateSpecification.tiered"
                        switch
                        class="custom-control-primary inline"
                      />
                    </h6>
                  </b-card-title>
                  <b-form-group
                    v-if="!appUpdateSpecification.tiered"
                    label-cols="2"
                    label-cols-lg="1"
                    label="CPU"
                    label-for="cpu"
                  >
                    <div class="mx-1">
                      {{ appUpdateSpecification.cpu }}
                    </div>
                    <b-form-input
                      id="cpu"
                      v-model="appUpdateSpecification.cpu"
                      placeholder="CPU cores to use by default"
                      type="range"
                      min="0.1"
                      max="15"
                      step="0.1"
                    />
                  </b-form-group>
                  <b-form-group
                    v-if="!appUpdateSpecification.tiered"
                    label-cols="2"
                    label-cols-lg="1"
                    label="RAM"
                    label-for="ram"
                  >
                    <div class="mx-1">
                      {{ appUpdateSpecification.ram }}
                    </div>
                    <b-form-input
                      id="ram"
                      v-model="appUpdateSpecification.ram"
                      placeholder="RAM in MB value to use by default"
                      type="range"
                      min="100"
                      max="59000"
                      step="100"
                    />
                  </b-form-group>
                  <b-form-group
                    v-if="!appUpdateSpecification.tiered"
                    label-cols="2"
                    label-cols-lg="1"
                    label="SSD"
                    label-for="ssd"
                  >
                    <div class="mx-1">
                      {{ appUpdateSpecification.hdd }}
                    </div>
                    <b-form-input
                      id="ssd"
                      v-model="appUpdateSpecification.hdd"
                      placeholder="SSD in GB value to use by default"
                      type="range"
                      min="1"
                      max="820"
                      step="1"
                    />
                  </b-form-group>
                </b-card>
              </b-col>
            </b-row>
            <b-row v-if="appUpdateSpecification.tiered">
              <b-col
                xs="12"
                md="6"
                lg="4"
              >
                <b-card title="Cumulus">
                  <div>
                    CPU: {{ appUpdateSpecification.cpubasic }}
                  </div>
                  <b-form-input
                    v-model="appUpdateSpecification.cpubasic"
                    type="range"
                    min="0.1"
                    max="3"
                    step="0.1"
                  />
                  <div>
                    RAM: {{ appUpdateSpecification.rambasic }}
                  </div>
                  <b-form-input
                    v-model="appUpdateSpecification.rambasic"
                    type="range"
                    min="100"
                    max="5000"
                    step="100"
                  />
                  <div>
                    SSD: {{ appUpdateSpecification.hddbasic }}
                  </div>
                  <b-form-input
                    v-model="appUpdateSpecification.hddbasic"
                    type="range"
                    min="1"
                    max="180"
                    step="1"
                  />
                </b-card>
              </b-col>
              <b-col
                xs="12"
                md="6"
                lg="4"
              >
                <b-card title="Nimbus">
                  <div>
                    CPU: {{ appUpdateSpecification.cpusuper }}
                  </div>
                  <b-form-input
                    v-model="appUpdateSpecification.cpusuper"
                    type="range"
                    min="0.1"
                    max="7"
                    step="0.1"
                  />
                  <div>
                    RAM: {{ appUpdateSpecification.ramsuper }}
                  </div>
                  <b-form-input
                    v-model="appUpdateSpecification.ramsuper"
                    type="range"
                    min="100"
                    max="28000"
                    step="100"
                  />
                  <div>
                    SSD: {{ appUpdateSpecification.hddsuper }}
                  </div>
                  <b-form-input
                    v-model="appUpdateSpecification.hddsuper"
                    type="range"
                    min="1"
                    max="400"
                    step="1"
                  />
                </b-card>
              </b-col>
              <b-col
                xs="12"
                lg="4"
              >
                <b-card title="Stratus">
                  <div>
                    CPU: {{ appUpdateSpecification.cpubamf }}
                  </div>
                  <b-form-input
                    v-model="appUpdateSpecification.cpubamf"
                    type="range"
                    min="0.1"
                    max="15"
                    step="0.1"
                  />
                  <div>
                    RAM: {{ appUpdateSpecification.rambamf }}
                  </div>
                  <b-form-input
                    v-model="appUpdateSpecification.rambamf"
                    type="range"
                    min="100"
                    max="59000"
                    step="100"
                  />
                  <div>
                    SSD: {{ appUpdateSpecification.hddbamf }}
                  </div>
                  <b-form-input
                    v-model="appUpdateSpecification.hddbamf"
                    type="range"
                    min="1"
                    max="820"
                    step="1"
                  />
                </b-card>
              </b-col>
            </b-row>
          </div>
        </div>
        <div
          v-if="appUpdateSpecification.version >= 6"
          class="form-row form-group d-flex align-items-center"
        >
          <b-input-group>
            <b-input-group-prepend>
              <b-input-group-text>
                <b-icon
                  class="mr-1"
                  icon="clock-history"
                />
                Extend Subscription
                <v-icon
                  v-b-tooltip.hover.top="'Select if you want to extend or change your subscription period'"
                  name="info-circle"
                  class="ml-1"
                />&nbsp; &nbsp;
              </b-input-group-text>
            </b-input-group-prepend>
            <b-input-group-append is-text>
              <b-form-checkbox
                id="extendSubscription"
                v-model="extendSubscription"
                switch
                class="custom-control-primary"
              />
            </b-input-group-append>
          </b-input-group>
        </div>
        <div
          v-if="extendSubscription && appUpdateSpecification.version >= 6"
          class="form-row form-group"
        >
          <label class="col-form-label">
            Period
            <v-icon
              v-b-tooltip.hover.top="'Time your application will be subscribed for from today'"
              name="info-circle"
              class="mr-2"
            />
            <kbd class="bg-primary mr-1"><b>{{ getExpireLabel || (appUpdateSpecification.expire ? `${appUpdateSpecification.expire} blocks` : '1 month') }}</b></kbd>
          </label>
          <div
            class="w-100"
            style="flex: 1; padding: 10px;"
          >
            <input
              id="period"
              v-model="expirePosition"
              type="range"
              class="form-control-range"
              style="width: 100%; outline: none;"
              :min="0"
              :max="5"
              :step="1"
            />
          </div>
        </div>
        <div>
          Currently your application is subscribed until <b>{{ new Date(appRunningTill.current).toLocaleString('en-GB', timeoptions.shortDate) }}</b>.
          <span v-if="extendSubscription">
            <br>
            Your new adjusted subscription end on <b>{{ new Date(appRunningTill.new).toLocaleString('en-GB', timeoptions.shortDate) }}</b>.
          </span>
          <span v-if="appRunningTill.new < appRunningTill.current" style="color: red">
            <br>
            <b>WARNING: Your selected subscription period will decrease the current subscription time!</b>
          </span>
        </div>
        <br>
        <div class="flex ">
          <b-form-checkbox
            id="tos"
            v-model="tosAgreed"
            switch
            class="custom-control-primary inline"
          /> I agree with
          <a
            href="https://cdn.runonflux.io/Flux_Terms_of_Service.pdf"
            target="_blank"
            rel="noopener noreferrer"
          >
            &nbsp;<b>Terms of Service</b>
          </a>
          <br><br>
        </div>
        <div>
          <b-button
            v-ripple.400="'rgba(255, 255, 255, 0.15)'"
            variant="outline-success"
            aria-label="Compute Update Message"
            class="mb-2 w-100"
            :disabled="tosAgreed === false"
            @click="checkFluxUpdateSpecificationsAndFormatMessage"
          >
            Compute Update Message
          </b-button>
        </div>
        <div v-if="dataToSign">
          <b-form-group
            label-cols="3"
            label-cols-lg="2"
            label="Update Message"
            label-for="updatemessage"
          >
            <div class="text-wrap">
              <b-form-textarea
                id="updatemessage"
                v-model="dataToSign"
                rows="6"
                readonly
              />
              <b-icon
                ref="copyButtonRef"
                v-b-tooltip="tooltipText"
                class="clipboard icon"
                scale="1.5"
                icon="clipboard"
                @click="copyMessageToSign"
              />
            </div>
          </b-form-group>
          <b-form-group
            label-cols="3"
            label-cols-lg="2"
            label="Signature"
            label-for="updatesignature"
          >
            <b-form-input
              id="updatesignature"
              v-model="signature"
            />
          </b-form-group>
          <b-row class="match-height">
            <b-col
              xs="6"
              lg="8"
            >
              <b-card>
                <br>
                <div class="text-center">
                  <h4>
                    <b-icon
                      class="mr-1"
                      scale="1.4"
                      icon="chat-right"
                    />
                    Data has to be signed by the last application owner
                  </h4>
                </div>
                <!-- <h4 class="text-center">
                  <kbd class="alert-info no-wrap" style="border-radius: 15px; font-weight: 700 !important;"> <b-icon scale="1.2" icon="chat-right" />&nbsp;&nbsp;Data has to be signed by the last application owner&nbsp; </kbd>
                </h4> -->
                <b-card-text v-if="!freeUpdate">
                  <br>
                  <div class="text-center my-3">
                    <h4>
                      <b-icon
                        class="mr-1"
                        scale="1.4"
                        icon="cash-coin"
                      /><b>{{ appPricePerSpecsUSD }} USD + VAT</b>
                    </h4>
                  </div>
                </b-card-text>
                <br>
                <b-button
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="outline-success"
                  aria-label="Update Flux App"
                  class="w-100"
                  @click="update"
                >
                  Update Application
                </b-button>
              </b-card>
            </b-col>
            <b-col
              xs="6"
              lg="4"
            >
              <b-card class="text-center" title="Sign with">
                <div class="loginRow">
                  <a
                    :href="`zel:?action=sign&message=${dataToSign}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${callbackValue}`"
                    @click="initiateSignWSUpdate"
                  >
                    <img
                      class="walletIcon"
                      src="@/assets/images/zelID.svg"
                      alt="Zel ID"
                      height="100%"
                      width="100%"
                    >
                  </a>
                  <a @click="initSSP">
                    <img
                      class="walletIcon"
                      :src="skin === 'dark' ? require('@/assets/images/ssp-logo-white.svg') : require('@/assets/images/ssp-logo-black.svg')"
                      alt="SSP"
                      height="100%"
                      width="100%"
                    >
                  </a>
                </div>
                <div class="loginRow">
                  <a @click="initWalletConnect">
                    <img
                      class="walletIcon"
                      src="@/assets/images/walletconnect.svg"
                      alt="WalletConnect"
                      height="100%"
                      width="100%"
                    >
                  </a>
                  <a @click="initMetamask">
                    <img
                      class="walletIcon"
                      src="@/assets/images/metamask.svg"
                      alt="Metamask"
                      height="100%"
                      width="100%"
                    >
                  </a>
                </div>
                <div class="loginRow">
                  <b-button
                    v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                    variant="primary"
                    aria-label="Flux Single Sign On"
                    class="my-1"
                    style="width: 250px"
                    @click="initSignFluxSSO"
                  >
                    Flux Single Sign On (SSO)
                  </b-button>
                </div>
              </b-card>
            </b-col>
          </b-row>
          <b-row
            v-if="updateHash && !freeUpdate"
            class="match-height"
          >
            <b-col
              xs="6"
              lg="8"
            >
              <b-card>
                <b-card-text>
                  <b>Everything is ready, your payment option links, both for fiat and flux, are valid for the next 30 minutes.</b>
                </b-card-text>
                <br>
                The application will be subscribed until <b>{{ new Date(subscribedTill).toLocaleString('en-GB', timeoptions.shortDate) }}</b>
                <br>
                To finish the application update/renew, pay your application with your prefered payment method or check below how to pay with Flux crypto currency.
              </b-card>
            </b-col>
            <b-col
              xs="6"
              lg="4"
            >
              <b-card class="text-center" title="Pay with Stripe/PayPal">
                <div class="loginRow">
                  <a @click="initStripePay(updateHash, appUpdateSpecification.name, appPricePerSpecsUSD, appUpdateSpecification.description)">
                    <img
                      class="stripePay"
                      src="@/assets/images/Stripe.svg"
                      alt="Stripe"
                      height="100%"
                      width="100%"
                    >
                  </a>
                  <a @click="initPaypalPay(updateHash, appUpdateSpecification.name, appPricePerSpecsUSD, appUpdateSpecification.description)">
                    <img
                      class="paypalPay"
                      src="@/assets/images/PayPal.png"
                      alt="PayPal"
                      height="100%"
                      width="100%"
                    >
                  </a>
                </div>
                <div v-if="checkoutLoading" className="loginRow">
                  <b-spinner variant="primary" />
                  <div class="text-center">
                    Checkout Loading ...
                  </div>
                </div>
                <div v-if="fiatCheckoutURL" className="loginRow">
                  <a :href="fiatCheckoutURL" target="_blank" rel="noopener noreferrer">
                    Click here for checkout if not redirected
                  </a>
                </div>
              </b-card>
            </b-col>
          </b-row>
          <b-row
            v-if="updateHash && !applicationPriceFluxError && !freeUpdate"
            class="match-height"
          >
            <b-col
              xs="6"
              lg="8"
            >
              <b-card>
                <b-card-text>
                  To pay in FLUX, please make a transaction of <b>{{ appPricePerSpecs }} FLUX</b> to address
                  <b>'{{ deploymentAddress }}'</b>
                  with the following message:
                  <b>'{{ updateHash }}'</b>
                </b-card-text>
              </b-card>
            </b-col>
            <b-col
              xs="6"
              lg="4"
            >
              <b-card>
                <h4 v-if="applicationPriceFluxDiscount > 0">
                  <kbd class="d-flex justify-content-center bg-primary mb-2">Discount - {{ applicationPriceFluxDiscount }}%</kbd>
                </h4>
                <h4 class="text-center mb-2">
                  Pay with Zelcore/SSP
                </h4>
                <div class="loginRow">
                  <a :href="`zel:?action=pay&coin=zelcash&address=${deploymentAddress}&amount=${appPricePerSpecs}&message=${updateHash}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png`">
                    <img
                      class="walletIcon"
                      src="@/assets/images/zelID.svg"
                      alt="Zel ID"
                      height="100%"
                      width="100%"
                    >
                  </a>
                  <a @click="initSSPpay">
                    <img
                      class="walletIcon"
                      :src="skin === 'dark' ? require('@/assets/images/ssp-logo-white.svg') : require('@/assets/images/ssp-logo-black.svg')"
                      alt="SSP"
                      height="100%"
                      width="100%"
                    >
                  </a>
                </div>
              </b-card>
            </b-col>
          </b-row>
          <b-row
            v-if="updateHash && freeUpdate"
            class="match-height"
          >
            <b-card>
              <b-card-text>
                Everything is ready, your application update should be effective automatically in less than 30 minutes.
              </b-card-text>
            </b-card>
          </b-row>
        </div>
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
    <div>
      <br>
      By managing an application I agree with
      <a
        href="https://cdn.runonflux.io/Flux_Terms_of_Service.pdf"
        target="_blank"
        rel="noopener noreferrer"
      >
        Terms of Service
      </a>
    </div>
    <b-modal
      v-model="chooseEnterpriseDialog"
      title="Select Enterprise Nodes"
      size="xl"
      centered
      button-size="sm"
      ok-only
      ok-title="Done"
    >
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
              v-model="entNodesSelectTable.perPage"
              size="sm"
              :options="entNodesSelectTable.pageOptions"
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
                v-model="entNodesSelectTable.filter"
                type="search"
                placeholder="Type to Search"
              />
              <b-input-group-append>
                <b-button
                  :disabled="!entNodesSelectTable.filter"
                  @click="entNodesSelectTable.filter = ''"
                >
                  Clear
                </b-button>
              </b-input-group-append>
            </b-input-group>
          </b-form-group>
        </b-col>

        <b-col cols="12">
          <b-table
            class="app-enterprise-nodes-table"
            striped
            hover
            responsive
            :per-page="entNodesSelectTable.perPage"
            :current-page="entNodesSelectTable.currentPage"
            :items="enterpriseNodes"
            :fields="entNodesSelectTable.fields"
            :sort-by.sync="entNodesSelectTable.sortBy"
            :sort-desc.sync="entNodesSelectTable.sortDesc"
            :sort-direction="entNodesSelectTable.sortDirection"
            :filter="entNodesSelectTable.filter"
            :filter-included-fields="entNodesSelectTable.filterOn"
            show-empty
            :empty-text="'No Enterprise Nodes For Addition Found'"
          >
            <template #cell(show_details)="row">
              <a @click="row.toggleDetails">
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
              <b-card class="">
                <list-entry
                  title="IP Address"
                  :data="row.item.ip"
                />
                <list-entry
                  title="Public Key"
                  :data="row.item.pubkey"
                />
                <list-entry
                  title="Node Address"
                  :data="row.item.payment_address"
                />
                <list-entry
                  title="Collateral"
                  :data="`${row.item.txhash}:${row.item.outidx}`"
                />
                <list-entry
                  title="Tier"
                  :data="row.item.tier"
                />
                <list-entry
                  title="Overall Score"
                  :data="row.item.score.toString()"
                />
                <list-entry
                  title="Collateral Score"
                  :data="row.item.collateralPoints.toString()"
                />
                <list-entry
                  title="Maturity Score"
                  :data="row.item.maturityPoints.toString()"
                />
                <list-entry
                  title="Public Key Score"
                  :data="row.item.pubKeyPoints.toString()"
                />
                <list-entry
                  title="Enterprise Apps Assigned"
                  :data="row.item.enterpriseApps.toString()"
                />
                <div>
                  <b-button
                    size="sm"
                    class="mr-0"
                    variant="primary"
                    @click="openNodeFluxOS(locationRow.item.ip.split(':')[0], locationRow.item.ip.split(':')[1] ? +locationRow.item.ip.split(':')[1] - 1 : 16126)"
                  >
                    Visit FluxNode
                  </b-button>
                </div>
              </b-card>
            </template>
            <template #cell(ip)="row">
              {{ row.item.ip }}
            </template>
            <template #cell(payment_address)="row">
              {{ row.item.payment_address.slice(0, 8) }}...{{ row.item.payment_address.slice(row.item.payment_address.length - 8, row.item.payment_address.length) }}
            </template>
            <template #cell(tier)="row">
              {{ row.item.tier }}
            </template>
            <template #cell(score)="row">
              {{ row.item.score }}
            </template>
            <template #cell(actions)="locationRow">
              <b-button
                size="sm"
                class="mr-1 mb-1"
                variant="primary"
                @click="openNodeFluxOS(locationRow.item.ip.split(':')[0], locationRow.item.ip.split(':')[1] ? +locationRow.item.ip.split(':')[1] - 1 : 16126)"
              >
                Visit
              </b-button>
              <b-button
                v-if="!selectedEnterpriseNodes.find((node) => node.ip === locationRow.item.ip)"
                :id="`add-${locationRow.item.ip}`"
                size="sm"
                class="mr-1 mb-1"
                variant="success"
                @click="addFluxNode(locationRow.item.ip)"
              >
                Add
              </b-button>
              <b-button
                v-if="selectedEnterpriseNodes.find((node) => node.ip === locationRow.item.ip)"
                :id="`add-${locationRow.item.ip}`"
                size="sm"
                class="mr-1 mb-1"
                variant="danger"
                @click="removeFluxNode(locationRow.item.ip)"
              >
                Remove
              </b-button>
            </template>
          </b-table>
        </b-col>
        <b-col cols="12">
          <b-pagination
            v-model="entNodesSelectTable.currentPage"
            :total-rows="entNodesSelectTable.totalRows"
            :per-page="entNodesSelectTable.perPage"
            align="center"
            size="sm"
            class="my-0"
          />
          <span class="table-total">Total: {{ entNodesSelectTable.totalRows }}</span>
        </b-col>
      </b-row>
    </b-modal>
  </div>
</template>

<script>
import {
  BAlert,
  BTabs,
  BTab,
  BTable,
  BTd,
  BTr,
  BDropdown,
  BDropdownItem,
  BFormTag,
  BFormTags,
  BIcon,
  BInputGroup,
  BInputGroupPrepend,
  BInputGroupAppend,
  BCol,
  BCard,
  BCardText,
  BCardTitle,
  BCardGroup,
  BRow,
  BButton,
  BSpinner,
  BFormRadioGroup,
  BFormTextarea,
  BFormGroup,
  BFormInput,
  BFormCheckbox,
  BFormSelect,
  BFormSelectOption,
  BPagination,
  BProgress,
  BProgressBar,
  VBTooltip,
} from 'bootstrap-vue';

import VueApexCharts from 'vue-apexcharts';
import Ripple from 'vue-ripple-directive';
import { mapState } from 'vuex';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';
import ListEntry from '@/views/components/ListEntry.vue';
import JsonViewer from 'vue-json-viewer';
import FileUpload from '@/views/components/FileUpload.vue';
import { useClipboard } from '@vueuse/core';
import { getUser } from '@/libs/firebase';

import AppsService from '@/services/AppsService';
import DaemonService from '@/services/DaemonService';

import SignClient from '@walletconnect/sign-client';
import { MetaMaskSDK } from '@metamask/sdk';
import 'xterm/css/xterm.css';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { Unicode11Addon } from 'xterm-addon-unicode11';
import { SerializeAddon } from 'xterm-addon-serialize';
import io from 'socket.io-client';
import useAppConfig from '@core/app-config/useAppConfig';

const projectId = 'df787edc6839c7de49d527bba9199eaa';
const paymentBridge = 'https://fiatpaymentsbridge.runonflux.io';

const walletConnectOptions = {
  projectId,
  metadata: {
    name: 'Flux Cloud',
    description: 'Flux, Your Gateway to a Decentralized World',
    url: 'https://home.runonflux.io',
    icons: ['https://home.runonflux.io/img/logo.png'],
  },
};

const metamaskOptions = {
  enableDebug: true,
};

const MMSDK = new MetaMaskSDK(metamaskOptions);
let ethereum;

const axios = require('axios');
const qs = require('qs');
const store = require('store');
const openpgp = require('openpgp');
const timeoptions = require('@/libs/dateFormat');
const splitargs = require('splitargs');
const geolocations = require('../../libs/geolocation');

export default {
  components: {
    FileUpload,
    JsonViewer,
    BAlert,
    BTabs,
    BTab,
    BTable,
    BTd,
    BTr,
    BDropdown,
    BDropdownItem,
    BFormTag,
    BFormTags,
    BIcon,
    BInputGroup,
    BInputGroupPrepend,
    BInputGroupAppend,
    BCol,
    BCard,
    BCardText,
    BCardTitle,
    BCardGroup,
    BRow,
    BButton,
    BSpinner,
    BFormRadioGroup,
    BFormTextarea,
    BFormGroup,
    BFormInput,
    BFormCheckbox,
    BFormSelect,
    BFormSelectOption,
    BPagination,
    // eslint-disable-next-line vue/no-unused-components
    BProgress,
    // eslint-disable-next-line vue/no-unused-components
    BProgressBar,
    ConfirmDialog,
    ListEntry,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
    // eslint-disable-next-line vue/no-unused-components
    VueApexCharts,
  },
  directives: {
    'b-tooltip': VBTooltip,
    Ripple,
  },
  props: {
    appName: {
      type: String,
      required: true,
    },
    global: {
      type: Boolean,
      required: true,
    },
    installedApps: {
      type: Array,
      required: true,
    },
  },
  data() {
    return {
      appInfoObject: [],
      tooltipText: 'Copy to clipboard',
      tableBackup: 0,
      tableKey: 0,
      isBusy: false,
      inputPathValue: '',
      fields: [
        { key: 'name', label: 'Name', sortable: true },
        // eslint-disable-next-line object-curly-newline
        { key: 'size', label: 'Size', sortable: true, thStyle: { width: '10%' } },
        // eslint-disable-next-line object-curly-newline
        { key: 'modifiedAt', label: 'Last modification', sortable: true, thStyle: { width: '15%' } },
        // { key: 'type', label: 'Type', sortable: true },
        // eslint-disable-next-line object-curly-newline
        { key: 'actions', label: 'Actions', sortable: false, thStyle: { width: '10%' } },
      ],
      timeoptions: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
      loadingFolder: false,
      folderView: [],
      currentFolder: '',
      uploadFilesDialog: false,
      filterFolder: '',
      createDirectoryDialogVisible: false,
      renameDialogVisible: false,
      newName: '',
      fileRenaming: '',
      newDirName: '',
      abortToken: {},
      downloaded: '',
      total: '',
      timeStamp: {},
      working: false,
      storage: {
        used: 0,
        total: 2,
        available: 2,
      },
      customColors: [
        { color: '#6f7ad3', percentage: 20 },
        { color: '#1989fa', percentage: 40 },
        { color: '#5cb87a', percentage: 60 },
        { color: '#e6a23c', percentage: 80 },
        { color: '#f56c6c', percentage: 100 },
      ],
      uploadTotal: '',
      uploadUploaded: '',
      uploadTimeStart: '',
      currentUploadTime: '',
      uploadFiles: [],
      fileProgressVolume: [],
      windowWidth: window.innerWidth,
      showTopUpload: false,
      showTopRemote: false,
      showTopFluxDrive: false,
      alertMessage: '',
      alertVariant: '',
      restoreFromUpload: false,
      restoreFromUploadStatus: '',
      restoreFromRemoteURLStatus: '',
      restoreFromFluxDriveStatus: '',
      downloadingFromUrl: false,
      restoringFromFluxDrive: false,
      files: [],
      backupProgress: false,
      uploadProgress: false,
      tarProgress: '',
      fileProgress: [],
      fileProgressFD: [],
      fluxDriveUploadStatus: '',
      showFluxDriveProgressBar: false,
      showProgressBar: false,
      showUploadProgressBar: false,
      uploadStatus: '',
      restoreOptions: [
        {
          value: 'FluxDrive',
          text: 'FluxDrive',
          disabled: false,
        },
        {
          value: 'Remote URL',
          text: 'Remote URL',
          disabled: false,
        },
        {
          value: 'Upload File',
          text: 'Upload File',
          disabled: false,
        },
      ],
      storageMethod: [
        {
          value: 'flux',
          disabled: false,
          text: 'FluxDrive',
        },
        {
          value: 'google',
          disabled: true,
          text: 'GoogleDrive',
        },
        {
          value: 'as3',
          disabled: true,
          text: 'AS3Storage',
        },
      ],
      components: [],
      selectedRestoreOption: null,
      selectedStorageMethod: null,
      selectedBackupComponents: [],
      items: [],
      items1: [],
      checkpoints: [],
      sigInPrivilage: true,
      backupList: [],
      backupToUpload: [],
      restoreRemoteUrl: '',
      restoreRemoteFile: null,
      restoreRemoteUrlComponent: null,
      restoreRemoteUrlItems: [],
      newComponents: [],
      itemKey: [],
      expandedDetails: [],
      itemValue: [],
      sortbackupTableKey: 'timestamp',
      sortbackupTableDesc: true,
      nestedTableFilter: '',
      backupTableFields: [
        { key: 'timestamp', label: 'Name', thStyle: { width: '65%' } },
        { key: 'time', label: 'Time' },
        {
          key: 'actions', label: 'Actions', thStyle: { width: '118px' }, class: 'text-center',
        },
      ],
      restoreComponents: [
        { value: '', text: 'all' },
        { value: 'lime', text: 'lime' },
        { value: 'orange', text: 'orange' },
      ],
      localBackupTableFields: [
        {
          key: 'isActive', label: '', thStyle: { width: '5%' }, class: 'text-center',
        },
        { key: 'component', label: 'Component Name', thStyle: { width: '40%' } },
        { key: 'create', label: 'CreateAt', thStyle: { width: '17%' } },
        { key: 'expire', label: 'ExpireAt', thStyle: { width: '17%' } },
        { key: 'file_size', label: 'Size', thStyle: { width: '8%' } },
      ],
      newComponentsTableFields: [
        { key: 'component', label: 'Component Name', thStyle: { width: '25%' } },
        { key: 'file_url', label: 'URL', thStyle: { width: '55%' } },
        { key: 'timestamp', label: 'Timestamp', thStyle: { width: '6%' } },
        { key: 'file_size', label: 'Size', thStyle: { width: '9%' } },
      ],
      componentsTable() {
        return [
          { key: 'component', label: 'Component Name', thStyle: { width: '20%' } },
          { key: 'file_url', label: 'URL', thStyle: { width: '55%' } },
          { key: 'file_size', label: 'Size', thStyle: { width: '20%' } },
          {
            key: 'actions', label: 'Actions', thStyle: { width: '5%' }, class: 'text-center',
          },
        ];
      },
      socket: null,
      terminal: null,
      selectedCmd: null,
      selectedApp: null,
      selectedAppVolume: null,
      enableUser: false,
      userInputValue: '',
      customValue: '',
      envInputValue: '',
      enableEnvironment: false,
      isVisible: false,
      isConnecting: false,
      options: [
        {
          label: 'Linux',
          options: [
            '/bin/bash',
            '/bin/ash',
            '/bin/sh',
          ],
        },
        {
          label: 'Other',
          options: [
            'Custom',
          ],
        },
      ],
      output: '',
      fluxCommunication: false,
      commandExecuting: false,
      getAllAppsResponse: {
        status: '',
        data: [],
      },
      updatetype: 'fluxappupdate',
      version: 1,
      dataForAppUpdate: {},
      dataToSign: '',
      timestamp: '',
      signature: '',
      updateHash: '',
      websocket: null,
      selectedAppOwner: '',
      appSpecification: {},
      callResponse: { // general
        status: '',
        data: '',
      },
      callBResponse: { // general B
        status: '',
        data: [],
      },
      appExec: {
        cmd: '',
        env: '',
      },
      appUpdateSpecification: {
        version: 3,
        name: '',
        description: '',
        repotag: '',
        owner: '',
        ports: '', // []
        domains: '', // []
        enviromentParameters: '', // []
        commands: '', // []
        containerPorts: '', // []
        containerData: '',
        instances: 3,
        cpu: null,
        ram: null,
        hdd: null,
        tiered: false,
        cpubasic: null,
        rambasic: null,
        hddbasic: null,
        cpusuper: null,
        ramsuper: null,
        hddsuper: null,
        cpubamf: null,
        rambamf: null,
        hddbamf: null,
      },
      instances: {
        data: [],
        fields: [
          { key: 'show_details', label: '' },
          { key: 'ip', label: 'IP Address', sortable: true },
          { key: 'continent', label: 'Continent', sortable: true },
          { key: 'country', label: 'Country', sortable: true },
          // eslint-disable-next-line object-curly-newline
          { key: 'region', label: 'Region', sortable: true, thStyle: { width: '20%' } },
          { key: 'visit', label: 'Visit', thStyle: { width: '10%' } },
        ],
        perPage: 10,
        pageOptions: [10, 25, 50, 100],
        sortBy: '',
        sortDesc: false,
        sortDirection: 'asc',
        filter: '',
        filterOn: [],
        totalRows: 1,
        currentPage: 1,
      },
      downloadedSize: '',
      deploymentAddress: '',
      appPricePerSpecs: 0,
      appPricePerSpecsUSD: 0,
      applicationPriceFluxDiscount: '',
      applicationPriceFluxError: false,
      maxInstances: 100,
      minInstances: 3,
      globalZelidAuthorized: false,
      monitoringStream: {},
      statsFields: [
        { key: 'timestamp', label: 'Date' },
        { key: 'cpu', label: 'CPU' },
        { key: 'memory', label: 'RAM' },
        { key: 'disk', label: 'DISK' },
        { key: 'net', label: 'NET I/O' },
        { key: 'block', label: 'BLOCK I/O' },
        { key: 'pids', label: 'PIDS' },
      ],
      possibleLocations: [],
      allowedGeolocations: {},
      forbiddenGeolocations: {},
      numberOfGeolocations: 1,
      numberOfNegativeGeolocations: 1,
      minExpire: 5000,
      maxExpire: 264000,
      extendSubscription: true,
      updateSpecifications: false,
      daemonBlockCount: -1,
      expirePosition: 2,
      minutesRemaining: 0,
      expireOptions: [
        {
          value: 5000,
          label: '1 week',
          time: 7 * 24 * 60 * 60 * 1000,
        },
        {
          value: 11000,
          label: '2 weeks',
          time: 14 * 24 * 60 * 60 * 1000,
        },
        {
          value: 22000,
          label: '1 month',
          time: 30 * 24 * 60 * 60 * 1000,
        },
        {
          value: 66000,
          label: '3 months',
          time: 90 * 24 * 60 * 60 * 1000,
        },
        {
          value: 132000,
          label: '6 months',
          time: 180 * 24 * 60 * 60 * 1000,
        },
        {
          value: 264000,
          label: '1 year',
          time: 365 * 24 * 60 * 60 * 1000,
        },
      ],
      tosAgreed: false,
      marketPlaceApps: [],
      generalMultiplier: 1,
      enterpriseNodes: [],
      selectedEnterpriseNodes: [],
      enterprisePublicKeys: [], // {nodeip, nodekey}
      maximumEnterpriseNodes: 120,
      entNodesTable: {
        fields: [
          { key: 'show_details', label: '' },
          { key: 'ip', label: 'IP Address', sortable: true },
          { key: 'payment_address', label: 'Node Address', sortable: true },
          { key: 'tier', label: 'Tier', sortable: true },
          { key: 'score', label: 'Score', sortable: true },
          { key: 'actions', label: 'Actions' },
        ],
        perPage: 10,
        pageOptions: [5, 10, 25, 50, 100],
        sortBy: '',
        sortDesc: false,
        sortDirection: 'asc',
        filter: '',
        filterOn: [],
        currentPage: 1,
      },
      entNodesSelectTable: {
        fields: [
          { key: 'show_details', label: '' },
          { key: 'ip', label: 'IP Address', sortable: true },
          { key: 'payment_address', label: 'Node Address', sortable: true },
          { key: 'tier', label: 'Tier', sortable: true },
          { key: 'score', label: 'Enterprise Score', sortable: true },
          { key: 'actions', label: 'Actions' },
        ],
        perPage: 25,
        pageOptions: [5, 10, 25, 50, 100],
        sortBy: '',
        sortDesc: false,
        sortDirection: 'asc',
        filter: '',
        filterOn: [],
        currentPage: 1,
        totalRows: 1,
      },
      chooseEnterpriseDialog: false,
      isPrivateApp: false,
      signClient: null,
      masterIP: '',
      selectedIp: null,
      masterSlaveApp: false,
      applicationManagementAndStatus: '',
      fiatCheckoutURL: '',
      checkoutLoading: false,
      isMarketplaceApp: false,
      ipAccess: false,
    };
  },
  computed: {
    appRunningTill() {
      const blockTime = 2 * 60 * 1000;
      const expires = this.callBResponse.data.expire || 22000;
      const blocksToExpire = this.callBResponse.data.height + expires - this.daemonBlockCount;
      const currentExpire = Math.ceil(blocksToExpire / 1000) * 1000;
      let newExpire = currentExpire;
      if (this.extendSubscription) {
        newExpire = this.expireOptions[this.expirePosition].value;
      }

      const now = this.timestamp || Date.now();

      let currentExpireTime = Math.floor((currentExpire * blockTime + now) / 1000000) * 1000000;
      const timeFoundA = this.expireOptions.find((option) => option.value === currentExpire);
      if (timeFoundA) {
        const expTime = Math.floor((now + timeFoundA.time) / 1000000) * 1000000;
        currentExpireTime = expTime;
      }

      let newExpireTime = Math.floor((newExpire * blockTime + now) / 1000000) * 1000000;
      const timeFoundB = this.expireOptions.find((option) => option.value === newExpire);
      if (timeFoundB) {
        const expTime = Math.floor((now + timeFoundB.time) / 1000000) * 1000000;
        newExpireTime = expTime;
      }

      const runningTill = {
        current: currentExpireTime,
        new: newExpireTime,
      };

      return runningTill;
    },
    skin() {
      return useAppConfig().skin.value;
    },
    zelidHeader() {
      const zelidauth = localStorage.getItem('zelidauth');
      const headers = {
        zelidauth,
      };
      return headers;
    },
    ipAddress() {
      const backendURL = store.get('backendURL');
      if (backendURL) {
        return `${store.get('backendURL').split(':')[0]}:${store.get('backendURL').split(':')[1]}`;
      }
      const { hostname } = window.location;
      return `${hostname}`;
    },
    filesToUpload() {
      return this.files.length > 0 && this.files.some((file) => !file.uploading && !file.uploaded && file.progress === 0);
    },
    computedFileProgress() {
      return this.fileProgress;
    },
    computedFileProgressFD() {
      return this.fileProgressFD;
    },
    computedFileProgressVolume() {
      return this.fileProgressVolume;
    },
    folderContentFilter() {
      const filteredFolder = this.folderView.filter((data) => JSON.stringify(data.name).toLowerCase().includes(this.filterFolder.toLowerCase()));
      const upButton = this.currentFolder ? { name: '..', symLink: true, isUpButton: true } : null;
      const filteredResults = [upButton, ...filteredFolder.filter((data) => data.name !== '.gitkeep')].filter(Boolean);
      return filteredResults;
    },
    downloadLabel() {
      // eslint-disable-next-line vue/no-side-effects-in-computed-properties
      this.totalMB = this.backupList.reduce((acc, backup) => acc + parseFloat(backup.file_size), 2);
      const progressMB = (this.downloadedSize / (1024 * 1024)).toFixed(2);
      // const totalMB = (this.total / (1024 * 1024)).toFixed(2);
      if (progressMB === this.totalMB) {
        // eslint-disable-next-line vue/no-async-in-computed-properties
        setTimeout(() => {
          this.showProgressBar = false;
        }, 5000);
      }
      return `${progressMB} / ${this.totalMB} MB`;
    },
    isValidUrl() {
      const urlRegex = /^(http|https):\/\/[^\s]+$/;
      const urlParts = this.restoreRemoteUrl.split('?');
      const firstPart = urlParts[0];
      // eslint-disable-next-line no-mixed-operators
      return this.restoreRemoteUrl === '' || (firstPart.endsWith('.tar.gz') && urlRegex.test(firstPart));
    },
    urlValidationState() {
      return this.isValidUrl ? null : false;
    },
    urlValidationMessage() {
      return this.isValidUrl ? null : 'Please enter a valid URL ending with .tar.gz';
    },
    computedRestoreRemoteURLFields() {
      return this.RestoreTableBuilder('URL');
    },
    computedRestoreUploadFileFields() {
      return this.RestoreTableBuilder('File_name');
    },
    checkpointsTable() {
      return [
        { key: 'name', label: 'Name', thStyle: { width: '70%' } },
        { key: 'date', label: 'Date', thStyle: { width: '20%' } },
        { key: 'action', label: 'Action', thStyle: { width: '5%' } },
      ];
    },
    componentsTable1() {
      return [
        { key: 'component', label: 'Component Name', thStyle: { width: '200px' } },
        { key: 'file_url', label: 'URL' },
        { key: 'file_size', label: 'Size', thStyle: { width: '100px' } },
        {
          key: 'actions',
          label: 'Actions',
          thStyle: { width: '117px' },
          class: 'text-center',
        },
      ];
    },
    componentAvailableOptions() {
      if (this.components.length === 1) {
        // eslint-disable-next-line vue/no-side-effects-in-computed-properties
        this.selectedBackupComponents = this.components;
      }
      return this.components.filter((opt) => this.selectedBackupComponents.indexOf(opt) === -1);
    },
    remoteFileComponents() {
      if (this.components.length === 1) {
        // eslint-disable-next-line vue/no-side-effects-in-computed-properties
        this.restoreRemoteFile = this.components[0];
        return true;
      }
      return false;
    },
    remoteUrlComponents() {
      if (this.components.length === 1) {
        // eslint-disable-next-line vue/no-side-effects-in-computed-properties
        this.restoreRemoteUrlComponent = this.components[0];
        return true;
      }
      return false;
    },
    isComposeSingle() {
      if (this.appSpecification.version <= 3) {
        return true;
      }
      return this.appSpecification.compose?.length === 1;
    },
    selectedOptionText() {
      const selectedOption = this.options
        .flatMap((group) => group.options)
        .find((option) => option === this.selectedCmd);
      return selectedOption || '';
    },
    selectedOptionTextStyle() {
      return {
        color: 'red',
        backgroundColor: 'rgba(128, 128, 128, 0.1)',
        fontWeight: 'bold',
        padding: '4px 8px',
        borderRadius: '4px',
        marginRight: '10px',
        marginLeft: '10px',
      };
    },
    ...mapState('flux', [
      'config',
      'privilege',
    ]),
    instancesLocked() {
      try {
        if (this.appUpdateSpecification.name && this.marketPlaceApps.length) {
          const marketPlaceApp = this.marketPlaceApps.find((app) => this.appUpdateSpecification.name.toLowerCase().startsWith(app.name.toLowerCase()));
          if (marketPlaceApp) {
            if (marketPlaceApp.lockedValues && marketPlaceApp.lockedValues.includes('instances')) {
              return true;
            }
          }
        }
        return false;
      } catch (error) {
        console.log(error);
        return false;
      }
    },
    priceMultiplier() {
      try {
        if (this.appUpdateSpecification.name && this.marketPlaceApps.length) {
          const marketPlaceApp = this.marketPlaceApps.find((app) => this.appUpdateSpecification.name.toLowerCase().startsWith(app.name.toLowerCase()));
          if (marketPlaceApp) {
            if (marketPlaceApp.multiplier > 1) {
              return marketPlaceApp.multiplier * this.generalMultiplier;
            }
          }
        }
        return this.generalMultiplier;
      } catch (error) {
        console.log(error);
        return this.generalMultiplier;
      }
    },
    callbackValue() {
      const { protocol, hostname, port } = window.location;
      let mybackend = '';
      mybackend += protocol;
      mybackend += '//';
      const regex = /[A-Za-z]/g;
      if (hostname.split('-')[4]) { // node specific domain
        const splitted = hostname.split('-');
        const names = splitted[4].split('.');
        const adjP = +names[0] + 1;
        names[0] = adjP.toString();
        names[2] = 'api';
        splitted[4] = '';
        mybackend += splitted.join('-');
        mybackend += names.join('.');
      } else if (hostname.match(regex)) { // home.runonflux.io -> api.runonflux.io
        const names = hostname.split('.');
        names[0] = 'api';
        mybackend += names.join('.');
      } else {
        if (typeof hostname === 'string') {
          this.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          this.$store.commit('flux/setFluxPort', apiPort);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += this.config.apiPort;
      }
      const backendURL = store.get('backendURL') || mybackend;
      const url = `${backendURL}/id/providesign`;
      return encodeURI(url);
    },
    isAppOwner() {
      const zelidauth = localStorage.getItem('zelidauth');
      const zelidHeader = qs.parse(zelidauth);
      if (zelidauth && zelidHeader && zelidHeader.zelid && this.selectedAppOwner === zelidHeader.zelid) {
        return true;
      }
      return false;
    },
    validTill() {
      const expTime = this.timestamp + 60 * 60 * 1000; // 1 hour
      return expTime;
    },
    subscribedTill() {
      if (this.appUpdateSpecification.expire) {
        const timeFound = this.expireOptions.find((option) => option.value === this.appUpdateSpecification.expire);
        if (timeFound) {
          const expTime = Math.floor((this.timestamp + timeFound.time) / 1000000) * 1000000;
          return expTime;
        }
        const blocks = this.appUpdateSpecification.expire;
        const blockTime = 2 * 60 * 1000;
        const validTime = blocks * blockTime;
        const expTime = Math.floor((this.timestamp + validTime) / 1000000) * 1000000;
        return expTime;
      }
      const expTime = Math.floor((this.timestamp + 30 * 24 * 60 * 60 * 1000) / 1000000) * 1000000; // 1 month
      return expTime;
    },
    isApplicationInstalledLocally() {
      if (this.installedApps) {
        const installed = this.installedApps.find((app) => app.name === this.appName);
        if (installed) {
          return true;
        }
        return false;
      }
      return false;
    },
    constructAutomaticDomainsGlobal() {
      if (!this.callBResponse.data) {
        return 'loading...';
      }

      console.log(this.callBResponse.data);

      if (!this.callBResponse.data.name) {
        return 'loading...';
      }

      const appName = this.callBResponse.data.name;

      const lowerCaseName = appName.toLowerCase();

      if (!this.callBResponse.data.compose) {
        const ports = JSON.parse(JSON.stringify(this.callBResponse.data.ports));
        const domains = [`${lowerCaseName}.app.runonflux.io`];
        // flux specs dont allow more than 10 ports so domainString is enough
        for (let i = 0; i < ports.length; i += 1) {
          const portDomain = `${lowerCaseName}_${ports[i]}.app.runonflux.io`;
          domains.push(portDomain);
        }
        return domains;
      }
      const domains = [`${lowerCaseName}.app.runonflux.io`];
      this.callBResponse.data.compose.forEach((component) => {
        for (let i = 0; i < component.ports.length; i += 1) {
          const portDomain = `${lowerCaseName}_${component.ports[i]}.app.runonflux.io`;
          domains.push(portDomain);
        }
      });
      return domains;
    },
    getExpireLabel() {
      if (this.expireOptions[this.expirePosition]) {
        return this.expireOptions[this.expirePosition].label;
      }
      return null;
    },
    minutesToString() {
      let value = this.minutesRemaining * 60;
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
    getNewExpireLabel() {
      if (this.daemonBlockCount === -1) {
        return 'Not possible to calculate expiration';
      }
      const expires = this.callBResponse.data.expire || 22000;
      const blocksToExpire = this.callBResponse.data.height + expires - this.daemonBlockCount;
      if (blocksToExpire < 1) {
        return 'Application Expired';
      }
      // eslint-disable-next-line vue/no-side-effects-in-computed-properties
      this.minutesRemaining = blocksToExpire * 2;
      const result = this.minutesToString;
      if (result.length > 2) {
        return `${result[0]}, ${result[1]}, ${result[2]}`;
      }
      if (result.length > 1) {
        return `${result[0]}, ${result[1]}`;
      }
      return `${result[0]}`;
    },
  },
  watch: {
    isComposeSingle(value) {
      if (value) {
        if (this.appSpecification.version >= 4) {
          this.selectedApp = this.appSpecification.compose[0].name;
          this.selectedAppVolume = this.appSpecification.compose[0].name;
        }
      }
    },
    appUpdateSpecification: {
      handler() {
        this.dataToSign = '';
        this.signature = '';
        this.timestamp = null;
        this.dataForAppUpdate = {};
        this.updateHash = '';
        if (this.websocket !== null) {
          this.websocket.close();
          this.websocket = null;
        }
      },
      deep: true,
    },
    expirePosition: {
      handler() {
        this.dataToSign = '';
        this.signature = '';
        this.timestamp = null;
        this.dataForAppUpdate = {};
        this.updateHash = '';
        if (this.websocket !== null) {
          this.websocket.close();
          this.websocket = null;
        }
      },
    },
    isPrivateApp(value) {
      if (this.appUpdateSpecification.version >= 7 && value === false) {
        this.appUpdateSpecification.nodes = [];
        this.appUpdateSpecification.compose.forEach((component) => {
          // eslint-disable-next-line no-param-reassign
          component.secrets = '';
          // eslint-disable-next-line no-param-reassign
          component.repoauth = '';
        });
        this.selectedEnterpriseNodes = [];
      }
      // remove any geolocation
      this.allowedGeolocations = {};
      this.forbiddenGeolocations = {};
      this.dataToSign = '';
      this.signature = '';
      this.timestamp = null;
      this.dataForAppUpdate = {};
      this.updateHash = '';
      if (this.websocket !== null) {
        this.websocket.close();
        this.websocket = null;
      }
    },
  },
  created() {
    this.fluxDriveUploadTask = [];
    this.fluxDriveEndPoint = 'https://mws.fluxdrive.runonflux.io';
  },
  mounted() {
    const { hostname } = window.location;
    const regex = /[A-Za-z]/g;
    if (hostname.match(regex)) {
      this.ipAccess = false;
    } else {
      this.ipAccess = true;
    }
    const self = this;
    this.$nextTick(() => {
      window.addEventListener('resize', self.onResize);
    });
    this.initMMSDK();
    this.callBResponse.data = '';
    this.callBResponse.status = '';
    this.appSpecification = {};
    this.callResponse.data = '';
    this.callResponse.status = '';
    this.monitoringStream = {};
    this.appExec.cmd = '';
    this.appExec.env = '';
    this.checkFluxCommunication();
    this.getAppOwner();
    this.getGlobalApplicationSpecifics();
    this.appsDeploymentInformation();
    this.getGeolocationData();
    this.getMarketPlace();
    this.getMultiplier();
    this.getEnterpriseNodes();
    this.getDaemonBlockCount();
  },
  beforeDestroy() {
    window.removeEventListener('resize', this.onResize);
  },
  methods: {
    async refreshInfo() {
      this.$refs.BackendRefresh.blur();
      await this.getInstancesForDropDown();
      this.selectedIpChanged();
      this.getApplicationLocations().catch(() => {
        this.isBusy = false;
        this.showToast('danger', 'Error loading application locations');
      });
    },
    copyMessageToSign() {
      const { copy } = useClipboard({ source: this.dataToSign, legacy: true });
      copy();
      this.tooltipText = 'Copied!';
      setTimeout(() => {
        if (this.$refs.copyButtonRef) {
          this.$refs.copyButtonRef.blur();
          this.tooltipText = '';
        }
      }, 1000);
      setTimeout(() => {
        this.tooltipText = 'Copy to clipboard';
      }, 1500);
    },
    getIconName(used, total) {
      const percentage = (used / total) * 100;
      let icon;
      if (percentage <= 60) {
        icon = 'battery-full';
      } else if (percentage > 60 && percentage <= 80) {
        icon = 'battery-half';
      } else {
        icon = 'battery';
      }
      return icon;
    },
    getIconColorStyle(used, total) {
      const percentage = (used / total) * 100;
      let color;
      if (percentage <= 60) {
        color = 'green';
      } else if (percentage > 60 && percentage <= 80) {
        color = 'yellow';
      } else {
        color = 'red';
      }
      return { color };
    },
    sortNameFolder(a, b) {
      return (a.isDirectory ? `..${a.name}` : a.name).localeCompare(b.isDirectory ? `..${b.name}` : b.name);
    },
    sortTypeFolder(a, b) {
      if (a.isDirectory && b.isFile) return -1;
      if (a.isFile && b.isDirectory) return 1;
      return 0;
    },
    sort(a, b, key, sortDesc) {
      if (key === 'name') {
        return this.sortNameFolder(a, b, sortDesc);
      }
      if (key === 'type') {
        return this.sortTypeFolder(a, b, sortDesc);
      }
      if (key === 'modifiedAt') {
        if (a.modifiedAt > b.modifiedAt) return -1;
        if (a.modifiedAt < b.modifiedAt) return 1;
        return 0;
      }
      if (key === 'size') {
        if (a.size > b.size) return -1;
        if (a.size < b.size) return 1;
        return 0;
      }
      return 0;
    },
    async storageStats() {
      try {
        this.volumeInfo = await this.executeLocalCommand(`/backup/getvolumedataofcomponent/${this.appName}/${this.selectedAppVolume}/${'GB'}/${2}/${'used,size'}`);
        this.volumePath = this.volumeInfo.data?.data;
        if (this.volumeInfo.data.status === 'success') {
          this.storage.total = this.volumeInfo.data.data.size;
          this.storage.used = this.volumeInfo.data.data.used;
        } else {
          this.showToast('danger', this.volumeInfo.data.data.message || this.volumeInfo.data.data);
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    changeFolder(name) {
      if (name === '..') {
        const folderArrray = this.currentFolder.split('/');
        folderArrray.pop();
        this.currentFolder = folderArrray.join('/');
      } else if (this.currentFolder === '') {
        this.currentFolder = name;
      } else {
        this.currentFolder = `${this.currentFolder}/${name}`;
      }
      const segments = this.currentFolder.split('/').filter((segment) => segment !== '');
      const transformedPath = segments.map((segment) => `  ${segment}  `).join('/');
      this.inputPathValue = `/${transformedPath}`;
      this.loadFolder(this.currentFolder);
    },
    async loadFolder(path, soft = false) {
      try {
        this.filterFolder = '';
        if (!soft) {
          this.folderView = [];
        }
        this.loadingFolder = true;
        const response = await this.executeLocalCommand(`/apps/getfolderinfo/${this.appName}/${this.selectedAppVolume}/${encodeURIComponent(path)}`);
        this.loadingFolder = false;
        if (response.data.status === 'success') {
          this.folderView = response.data.data;
          console.log(this.folderView);
        } else {
          this.showToast('danger', response.data.data.message || response.data.data);
        }
      } catch (error) {
        this.loadingFolder = false;
        console.log(error.message);
        this.showToast('danger', error.message || error);
      }
    },
    async createFolder(path) {
      try {
        let folderPath = path;
        if (this.currentFolder !== '') {
          folderPath = `${this.currentFolder}/${path}`;
        }
        const response = await this.executeLocalCommand(`/apps/createfolder/${this.appName}/${this.selectedAppVolume}/${encodeURIComponent(folderPath)}`);
        if (response.data.status === 'error') {
          if (response.data.data.code === 'EEXIST') {
            this.showToast('danger', `Folder ${path} already exists`);
          } else {
            this.showToast('danger', response.data.data.message || response.data.data);
          }
        } else {
          this.loadFolder(this.currentFolder, true);
          this.createDirectoryDialogVisible = false;
        }
      } catch (error) {
        this.loadingFolder = false;
        console.log(error.message);
        this.showToast('danger', error.message || error);
      }
      this.newDirName = '';
    },
    cancelDownload(name) {
      this.abortToken[name].cancel(`Download of ${name} cancelled`);
      this.downloaded[name] = '';
      this.total[name] = '';
    },
    async download(name, isFolder = false) {
      try {
        const self = this;
        const folder = this.currentFolder;
        const fileName = folder ? `${folder}/${name}` : name;
        const axiosConfig = {
          headers: this.zelidHeader,
          responseType: 'blob',
          onDownloadProgress(progressEvent) {
            const { loaded, total } = progressEvent;
            // const decodedUrl = decodeURIComponent(target.responseURL);
            const currentFileProgress = (loaded / total) * 100;
            console.log(progressEvent);
            // const currentFileName = decodedUrl.split('/').pop();
            if (isFolder) {
              self.updateFileProgressVolume(`${name}.zip`, currentFileProgress);
            } else {
              self.updateFileProgressVolume(name, currentFileProgress);
            }
          },
        };
        let response;
        if (isFolder) {
          this.showToast('info', 'Directory download initiated. Please wait...');
          response = await this.executeLocalCommand(`/apps/downloadfolder/${this.appName}/${this.selectedAppVolume}/${encodeURIComponent(fileName)}`, null, axiosConfig);
        } else {
          response = await this.executeLocalCommand(`/apps/downloadfile/${this.appName}/${this.selectedAppVolume}/${encodeURIComponent(fileName)}`, null, axiosConfig);
        }
        console.log(response);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          const url = window.URL.createObjectURL(new Blob([response.data]));
          const link = document.createElement('a');
          link.href = url;
          if (isFolder) {
            link.setAttribute('download', `${name}.zip`);
          } else {
            link.setAttribute('download', name);
          }

          document.body.appendChild(link);
          link.click();
        }
      } catch (error) {
        console.log(error.message);
        if (error.message) {
          if (!error.message.startsWith('Download')) {
            this.showToast('danger', error.message);
          }
        } else {
          this.showToast('danger', error);
        }
      }
    },
    beautifyValue(valueInText) {
      const str = valueInText.split('.');
      if (str[0].length >= 4) {
        str[0] = str[0].replace(/(\d)(?=(\d{3})+$)/g, '$1,');
      }
      return str.join('.');
    },
    refreshFolder() {
      const segments = this.currentFolder.split('/').filter((segment) => segment !== '');
      const transformedPath = segments.map((segment) => `  ${segment}  `).join('/');
      this.inputPathValue = `/${transformedPath}`;
      this.loadFolder(this.currentFolder, true);
      this.storageStats();
    },
    refreshFolderSwitch() {
      this.currentFolder = '';
      const segments = this.currentFolder.split('/').filter((segment) => segment !== '');
      const transformedPath = segments.map((segment) => `  ${segment}  `).join('/');
      this.inputPathValue = `/${transformedPath}`;
      this.loadFolder(this.currentFolder, true);
      this.storageStats();
    },
    async deleteFile(name) {
      try {
        const folder = this.currentFolder;
        const fileName = folder ? `${folder}/${name}` : name;
        const response = await this.executeLocalCommand(`/apps/removeobject/${this.appName}/${this.selectedAppVolume}/${encodeURIComponent(fileName)}`);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          this.refreshFolder();
          this.showToast('success', `${name} deleted`);
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    rename(name) {
      this.renameDialogVisible = true;
      let folderPath = name;
      if (this.currentFolder !== '') {
        folderPath = `${this.currentFolder}/${name}`;
      }
      this.fileRenaming = folderPath;
      this.newName = name;
    },
    async confirmRename() {
      this.renameDialogVisible = false;
      try {
        const oldpath = this.fileRenaming;
        const newname = this.newName;
        const response = await this.executeLocalCommand(`/apps/renameobject/${this.appName}/${this.selectedAppVolume}/${encodeURIComponent(oldpath)}/${newname}`);
        console.log(response);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          if (oldpath.includes('/')) {
            this.showToast('success', `${oldpath.split('/').pop()} renamed to ${newname}`);
          } else {
            this.showToast('success', `${oldpath} renamed to ${newname}`);
          }
          this.loadFolder(this.currentFolder, true);
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    upFolder() {
      this.changeFolder('..');
    },
    onResize() {
      this.windowWidth = window.innerWidth;
    },
    handleRadioClick() {
      if (this.selectedRestoreOption === 'Upload File') {
        this.loadBackupList(this.appName, 'upload', 'files');
      }
      if (this.selectedRestoreOption === 'FluxDrive') {
        this.getFluxDriveBackupList();
      }
      console.log('Radio button clicked. Selected option:', this.selectedOption);
    },
    // eslint-disable-next-line consistent-return
    getUploadFolder() {
      if (this.selectedIp) {
        const ip = this.selectedIp.split(':')[0];
        const port = this.selectedIp.split(':')[1] || 16127;
        if (this.currentFolder) {
          const folder = encodeURIComponent(this.currentFolder);
          if (this.ipAccess) {
            return `http://${ip}:${port}/ioutils/fileupload/volume/${this.appName}/${this.selectedAppVolume}/${folder}`;
          }
          return `https://${ip.replace(/\./g, '-')}-${port}.node.api.runonflux.io/ioutils/fileupload/volume/${this.appName}/${this.selectedAppVolume}/${folder}`;
        }
        if (this.ipAccess) {
          return `http://${ip}:${port}/ioutils/fileupload/volume/${this.appName}/${this.selectedAppVolume}`;
        }
        return `https://${ip.replace(/\./g, '-')}-${port}.node.api.runonflux.io/ioutils/fileupload/volume/${this.appName}/${this.selectedAppVolume}`;
      }
    },
    getUploadFolderBackup(saveAs) {
      const ip = this.selectedIp.split(':')[0];
      const port = this.selectedIp.split(':')[1] || 16127;
      const filename = encodeURIComponent(saveAs);
      if (this.ipAccess) {
        return `http://${ip}:${port}/ioutils/fileupload/backup/${this.appName}/${this.restoreRemoteFile}/null/${filename}`;
      }
      return `https://${ip.replace(/\./g, '-')}-${port}.node.api.runonflux.io/ioutils/fileupload/backup/${this.appName}/${this.restoreRemoteFile}/null/${filename}`;
    },
    addAndConvertFileSizes(sizes, targetUnit = 'auto', decimal = 2) {
      const multiplierMap = {
        B: 1,
        KB: 1024,
        MB: 1024 * 1024,
        GB: 1024 * 1024 * 1024,
      };
      const getSizeWithMultiplier = (size, multiplier) => size / multiplierMap[multiplier.toUpperCase()];
      const formatResult = (result, unit) => {
        const formattedResult = unit === 'B' ? result.toFixed(0) : result.toFixed(decimal);
        return `${formattedResult} ${unit}`;
      };
      let totalSizeInBytes;
      if (Array.isArray(sizes) && sizes.length > 0) {
        totalSizeInBytes = +sizes.reduce((total, fileInfo) => total + (fileInfo.file_size || 0), 0);
      } else if (typeof +sizes === 'number') {
        totalSizeInBytes = +sizes;
      } else {
        console.error('Invalid sizes parameter');
        return 'N/A';
      }
      // eslint-disable-next-line no-restricted-globals
      if (isNaN(totalSizeInBytes)) {
        console.error('Total size is not a valid number');
        return 'N/A';
      }
      if (targetUnit === 'auto') {
        let bestMatchUnit;
        let bestMatchResult = totalSizeInBytes;
        Object.keys(multiplierMap).forEach((unit) => {
          const result = getSizeWithMultiplier(totalSizeInBytes, unit);
          if (result >= 1 && (bestMatchResult === undefined || result < bestMatchResult)) {
            bestMatchResult = result;
            bestMatchUnit = unit;
          }
        });
        bestMatchUnit = bestMatchUnit || 'B';
        return formatResult(bestMatchResult, bestMatchUnit);
        // eslint-disable-next-line no-else-return
      } else {
        const result = getSizeWithMultiplier(totalSizeInBytes, targetUnit);
        return formatResult(result, targetUnit);
      }
    },
    selectFiles() {
      this.$refs.fileselector.value = '';
      this.$refs.fileselector.click();
    },
    handleFiles(ev) {
      if (this.restoreRemoteFile === null) {
        this.showToast('warning', 'Select component');
        return;
      }
      const { files } = ev.target;
      if (!files) return;
      this.addFiles(([...files]));
    },
    addFile(e) {
      const droppedFiles = e.dataTransfer.files;
      if (!droppedFiles) return;
      this.addFiles(([...droppedFiles]));
    },
    async addFiles(filesToAdd) {
      // eslint-disable-next-line no-restricted-syntax
      for (const f of filesToAdd) {
        // eslint-disable-next-line no-await-in-loop
        this.volumeInfo = await this.executeLocalCommand(`/backup/getvolumedataofcomponent/${this.appName}/${this.restoreRemoteFile}/${'B'}/${0}/${'mount,available,size'}`);
        this.volumePath = this.volumeInfo.data?.data?.mount;

        const existingFile = this.files.findIndex(
          (item) => item.file_name === filesToAdd[0].name && item.component !== this.restoreRemoteFile,
        );
        if (existingFile !== -1) {
          this.showToast('warning', `'${f.name}' is already in the upload queue for other component.`);
          return false;
        }
        const existingComponent = this.files.findIndex(
          (item) => item.component === this.restoreRemoteFile,
        );
        if (existingComponent !== -1) {
          this.$set(this.files, existingComponent, {
            selected_file: f,
            uploading: false,
            uploaded: false,
            progress: 0,
            path: `${this.volumePath}/backup/upload`,
            component: this.restoreRemoteFile,
            file_name: `backup_${this.restoreRemoteFile.toLowerCase()}.tar.gz`,
            file_size: f.size,
          });
        } else {
          this.files.push({
            selected_file: f,
            uploading: false,
            uploaded: false,
            progress: 0,
            path: `${this.volumePath}/backup/upload`,
            component: this.restoreRemoteFile,
            file_name: `backup_${this.restoreRemoteFile.toLowerCase()}.tar.gz`,
            file_size: f.size,
          });
        }
      }
      return true;
    },
    removeFile(file) {
      // eslint-disable-next-line camelcase
      this.files = this.files.filter((selected_file) => selected_file.selected_file.name !== file.selected_file.name);
    },
    async processChunks(chunks, type) {
      const typeToPropertyMap = {
        restore_upload: 'restoreFromUploadStatus',
        restore_remote: 'restoreFromRemoteURLStatus',
        backup: 'tarProgress',
        restore_fluxdrive: 'restoreFromFluxDriveStatus',
      };
      // eslint-disable-next-line no-restricted-syntax
      for (const chunk of chunks) {
        if (chunk !== '') {
          const propertyName = typeToPropertyMap[type];
          if (propertyName) {
            this[propertyName] = chunk;
            if (type === 'restore_upload' && chunk.includes('Error:')) {
              console.log(chunk);
              this.changeAlert('danger', chunk, 'showTopUpload', true);
            } else if (type === 'restore_upload' && chunk.includes('Finalizing')) {
              setTimeout(() => {
                this.changeAlert('success', 'Restore completed successfully', 'showTopUpload', true);
              }, 5000);
            } else if (type === 'restore_remote' && chunk.includes('Error:')) {
              this.changeAlert('danger', chunk, 'showTopRemote', true);
            } else if (type === 'restore_remote' && chunk.includes('Finalizing')) {
              setTimeout(() => {
                this.changeAlert('success', 'Restore completed successfully', 'showTopRemote', true);
                this.restoreRemoteUrlItems = [];
              }, 5000);
            } else if (type === 'restore_fluxdrive' && chunk.includes('Error:')) {
              this.changeAlert('danger', chunk, 'showTopFluxDrive', true);
            } else if (type === 'restore_fluxdrive' && chunk.includes('Finalizing')) {
              setTimeout(() => {
                this.changeAlert('success', 'Restore completed successfully', 'showTopFluxDrive', true);
                this.restoreRemoteUrlItems = [];
              }, 5000);
            }
          }
        }
      }
    },
    changeAlert(variant, text, element, state) {
      // Change variant and text through a function
      this.alertVariant = variant; // Change variant to 'danger' or any other desired variant
      this.alertMessage = text; // Change text to a new message
      this[element] = state; // Show the alert
    },
    startUpload() {
      this.showTopUpload = false;
      const self = this;
      // eslint-disable-next-line no-async-promise-executor
      return new Promise(async (resolve, reject) => {
        try {
          this.restoreFromUpload = true;
          this.restoreFromUploadStatus = 'Uploading...';
          // eslint-disable-next-line no-async-promise-executor
          const uploadPromises = this.files.map((f) => new Promise(async (resolveFile, rejectFile) => {
            if (!f.uploaded && !f.uploading && f.selected_file) {
              try {
                await this.upload(f);
                resolveFile();
              } catch (error) {
                rejectFile(error);
              }
            } else {
              resolveFile();
            }
          }));
          await Promise.all(uploadPromises);
          this.files.forEach((entry) => {
            entry.uploading = false;
            entry.uploaded = false;
            entry.progress = 0;
          });
          this.restoreFromUploadStatus = 'Initializing restore jobs...';
          const postLayout = this.buildPostBody(this.appSpecification, 'restore', 'upload');
          let postRestoreData;
          // eslint-disable-next-line no-restricted-syntax
          for (const componentName of this.files) {
            postRestoreData = this.updateJobStatus(postLayout, componentName.component, 'restore');
          }
          const zelidauth = localStorage.getItem('zelidauth');
          const headers = {
            zelidauth,
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            Connection: 'keep-alive',
          };
          const url = this.selectedIp.split(':')[0];
          const urlPort = this.selectedIp.split(':')[1] || 16127;
          let queryUrl = `https://${url.replace(/\./g, '-')}-${urlPort}.node.api.runonflux.io/apps/appendrestoretask`;
          if (this.ipAccess) {
            queryUrl = `http://${url}:${urlPort}/apps/appendrestoretask`;
          }
          const response = await fetch(queryUrl, {
            method: 'POST',
            body: JSON.stringify(postRestoreData),
            headers,
          });
          const reader = response.body.getReader();
          // eslint-disable-next-line no-unused-vars
          await new Promise((streamResolve, streamReject) => {
            function push() {
              reader.read().then(async ({ done, value }) => {
                if (done) {
                  streamResolve();
                  return;
                }
                const chunkText = new TextDecoder('utf-8').decode(value);
                const chunks = chunkText.split('\n');
                // eslint-disable-next-line no-restricted-globals
                await self.processChunks(chunks, 'restore_upload');
                push();
              });
            }
            push();
          });
          this.restoreFromUpload = false;
          this.restoreFromUploadStatus = '';
          this.loadBackupList(this.appName, 'upload', 'files');
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    },
    /* eslint no-param-reassign: ["error", { "props": false }] */
    async upload(file) {
      // await this.splitAndUploadChunks(file);
      return new Promise((resolve, reject) => {
        const self = this;
        if (typeof XMLHttpRequest === 'undefined') {
          // eslint-disable-next-line prefer-promise-reject-errors
          reject('XMLHttpRequest is not supported.');
          return;
        }
        const xhr = new XMLHttpRequest();
        const action = this.getUploadFolderBackup(file.file_name);
        if (xhr.upload) {
          xhr.upload.onprogress = function progress(e) {
            if (e.total > 0) {
              e.percent = (e.loaded / e.total) * 100;
            }
            file.progress = e.percent;
          };
        }
        const formData = new FormData();
        formData.append(file.selected_file.name, file.selected_file);
        file.uploading = true;
        xhr.onerror = function error(e) {
          self.restoreFromUpload = false;
          self.restoreFromUploadStatus = '';
          self.files.forEach((entry) => {
            entry.uploading = false;
            entry.uploaded = false;
            entry.progress = 0;
          });
          self.showToast('danger', `An error occurred while uploading ${file.selected_file.name}, try to relogin`);
          reject(e);
        };
        xhr.onload = function onload() {
          if (xhr.status < 200 || xhr.status >= 300) {
            console.error(xhr.status);
            self.restoreFromUpload = false;
            self.restoreFromUploadStatus = '';
            self.files.forEach((entry) => {
              entry.uploading = false;
              entry.uploaded = false;
              entry.progress = 0;
            });
            self.showToast('danger', `An error occurred while uploading '${file.selected_file.name}' - Status code: ${xhr.status}`);
            reject(xhr.status);

            return;
          }
          file.uploaded = true;
          file.uploading = false;
          self.$emit('complete');
          resolve();
        };
        xhr.open('post', action, true);
        const headers = this.zelidHeader || {};
        const headerKeys = Object.keys(headers);
        for (let i = 0; i < headerKeys.length; i += 1) {
          const item = headerKeys[i];
          if (Object.prototype.hasOwnProperty.call(headers, item) && headers[item] !== null) {
            xhr.setRequestHeader(item, headers[item]);
          }
        }
        xhr.setRequestHeader('Access-Control-Allow-Origin', '*');
        xhr.send(formData);
      });
    },
    removeAllBackup() {
      this.backupList = [];
      this.backupToUpload = [];
    },
    totalArchiveFileSize(item) {
      return item.reduce((total, component) => total + parseFloat(component.file_size), 0);
    },
    RestoreTableBuilder(value) {
      const labelValue = value.toString();
      const labelWithoutUnderscore = labelValue.split('_')[0];
      return [
        { key: 'component', label: 'Component Name', thStyle: { width: '25%' } },
        { key: value.toString().toLowerCase(), label: labelWithoutUnderscore, thStyle: { width: '70%' } },
        { key: 'file_size', label: 'Size', thStyle: { width: '10%' } },
        { key: 'actions', label: 'Action', thStyle: { width: '5%' } },
      ];
    },
    addAllTags() {
      this.selectedBackupComponents = [...this.selectedBackupComponents, ...this.components];
    },
    clearSelected() {
      this.$refs.selectableTable.clearSelected();
    },
    selectAllRows() {
      this.$refs.selectableTable.selectAllRows();
    },
    selectStorageOption(value) {
      this.selectedStorageMethod = value;
    },
    buildPostBody(appSpecification, jobType, restoreType = '') {
      const updatedObject = {
        appname: appSpecification.name,
        ...(jobType === 'restore' ? { type: restoreType } : {}),
        [jobType]: appSpecification.compose.map((item) => ({
          component: item.name,
          [jobType]: false,
          ...(jobType === 'restore' && restoreType === 'remote' ? { url: '' } : {}),
        })),
      };
      return updatedObject;
    },
    updateJobStatus(appConfig, component, jobType, urlInfoArray = []) {
      const targetComponent = appConfig[jobType].find((item) => item.component === component);
      if (targetComponent) {
        targetComponent[jobType] = true;
        if (jobType === 'restore' && appConfig?.type === 'remote') {
          const urlInfo = urlInfoArray.find((info) => info.component === component);
          if (urlInfo) {
            targetComponent.url = urlInfo.url || ''; // Set default value if url doesn't exist
            console.log(`${urlInfo.url}`);
          } else {
            console.log(`URL info not found for component ${component}.`);
          }
        }
        console.log(`Status for ${component} set to true for ${jobType}.`);
      } else {
        console.log(`Component ${component} not found in the ${jobType} array.`);
      }
      return appConfig;
    },
    async createBackup(appname, componentNames) {
      if (this.selectedBackupComponents?.length === 0) {
        return;
      }
      this.backupProgress = true;
      this.tarProgress = 'Initializing backup jobs...';
      const zelidauth = localStorage.getItem('zelidauth');
      // eslint-disable-next-line no-unused-vars
      const headers = {
        zelidauth,
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        Connection: 'keep-alive',
      };
      const postLayout = this.buildPostBody(this.appSpecification, 'backup');
      let postBackupData;
      // eslint-disable-next-line no-restricted-syntax
      for (const componentName of componentNames) {
        postBackupData = this.updateJobStatus(postLayout, componentName, 'backup');
      }
      const url = this.selectedIp.split(':')[0];
      const urlPort = this.selectedIp.split(':')[1] || 16127;
      let queryUrl = `https://${url.replace(/\./g, '-')}-${urlPort}.node.api.runonflux.io/apps/appendbackuptask`;
      if (this.ipAccess) {
        queryUrl = `http://${url}:${urlPort}/apps/appendbackuptask`;
      }
      const response = await fetch(queryUrl, {
        method: 'POST',
        body: JSON.stringify(postBackupData),
        headers,
      });
      const self = this;
      const reader = response.body.getReader();
      // eslint-disable-next-line no-unused-vars
      await new Promise((streamResolve, streamReject) => {
        function push() {
          reader.read().then(async ({ done, value }) => {
            if (done) {
              streamResolve();
              return;
            }
            const chunkText = new TextDecoder('utf-8').decode(value);
            const chunks = chunkText.split('\n');
            await self.processChunks(chunks, 'backup');
            push();
          });
        }
        push();
      });
      setTimeout(() => {
        this.backupProgress = false;
      }, 5000);
      this.loadBackupList();
    },
    onRowSelected(itemOnRow) {
      this.backupToUpload = itemOnRow.map((item) => {
        const selectedComponentName = item.component;
        const selectedFile = this.backupList.find((file) => file.component === selectedComponentName);
        return {
          component: selectedComponentName,
          file: selectedFile ? selectedFile.file : null,
          file_size: selectedFile ? selectedFile.file_size : null,
          file_name: selectedFile ? selectedFile.file_name : null,
          create: selectedFile ? selectedFile.create : null,
        };
      }).filter((item) => item.file !== null);
    },
    applyFilter() {
      this.$nextTick(() => {
        this.checkpoints.forEach((row) => {
          // eslint-disable-next-line no-underscore-dangle, no-param-reassign
          row._showDetails = true;
        });
      });
      console.log(this.appSpecification.compose);
      this.components = this.appSpecification.compose.map((container) => container.name);
    },
    onFilteredBackup(filteredItems) {
      this.totalRows = filteredItems.length;
      this.currentPage = 1;
    },
    addAllBackupComponents(timestamp) {
      const checkpoint = this.checkpoints.find((cp) => cp.timestamp === timestamp);
      const filteredComponents = checkpoint.components.map((component) => ({
        component: component.component,
        file_url: component.file_url,
        timestamp: checkpoint.timestamp,
        file_size: component.file_size,
      }));
      this.newComponents = filteredComponents;
    },
    addComponent(selected, timestamp) {
      const existingIndex = this.newComponents.findIndex(
        (item) => item.component === selected.component,
      );
      if (existingIndex !== -1) {
        this.$set(this.newComponents, existingIndex, {
          timestamp,
          component: selected.component,
          file_url: selected.file_url,
          file_size: selected.file_size,
        });
      } else {
        this.newComponents.push({
          component: selected.component,
          timestamp,
          file_url: selected.file_url,
          file_size: selected.file_size,
        });
      }
    },
    formatName(checkpoint) {
      return `backup_${checkpoint.timestamp}`;
    },
    formatDateTime(timestamp, add24Hours = false) {
      const isMilliseconds = timestamp > 1e12;
      const date = isMilliseconds ? new Date(timestamp) : new Date(timestamp * 1000);
      if (add24Hours) {
        date.setHours(date.getHours() + 24);
      }
      return date.toLocaleString();
    },
    addRemoteFile() {
      this.selectFiles();
    },

    async restoreFromRemoteFile() {
      const zelidauth = localStorage.getItem('zelidauth');
      this.showTopRemote = false;
      this.downloadingFromUrl = true;
      this.restoreFromRemoteURLStatus = 'Initializing restore jobs...';
      // eslint-disable-next-line no-unused-vars
      const headers = {
        zelidauth,
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        Connection: 'keep-alive',
      };
      const postLayout = this.buildPostBody(this.appSpecification, 'restore', 'remote');
      let postBackupData;
      // eslint-disable-next-line no-restricted-syntax
      for (const componentName of this.restoreRemoteUrlItems) {
        postBackupData = this.updateJobStatus(postLayout, componentName.component, 'restore', this.restoreRemoteUrlItems);
      }
      const url = this.selectedIp.split(':')[0];
      const urlPort = this.selectedIp.split(':')[1] || 16127;
      let queryUrl = `https://${url.replace(/\./g, '-')}-${urlPort}.node.api.runonflux.io/apps/appendrestoretask`;
      if (this.ipAccess) {
        queryUrl = `http://${url}:${urlPort}/apps/appendrestoretask`;
      }
      const response = await fetch(queryUrl, {
        method: 'POST',
        body: JSON.stringify(postBackupData),
        headers,
      });
      const self = this;
      const reader = response.body.getReader();
      // eslint-disable-next-line no-unused-vars
      await new Promise((streamResolve, streamReject) => {
        function push() {
          reader.read().then(async ({ done, value }) => {
            if (done) {
              streamResolve(); // Resolve the stream promise when the response stream is complete
              return;
            }
            // Process each chunk of data separately
            const chunkText = new TextDecoder('utf-8').decode(value);
            const chunks = chunkText.split('\n');
            // eslint-disable-next-line no-restricted-globals
            await self.processChunks(chunks, 'restore_remote');
            // Check for new data immediately after processing each chunk
            push();
          });
        }
        push();
      });
      this.downloadingFromUrl = false;
      this.restoreFromRemoteURLStatus = '';
    },
    async addRemoteUrlItem(appname, component, fludDrive = false) {
      if (!fludDrive && !this.isValidUrl) {
        return;
      }
      if (this.restoreRemoteUrl.trim() !== '' && this.restoreRemoteUrlComponent !== null) {
        this.remoteFileSizeResponse = await this.executeLocalCommand(`/backup/getremotefilesize/${encodeURIComponent(this.restoreRemoteUrl.trim())}/${'B'}/${0}/${true}/${this.appName}`);
        if (this.remoteFileSizeResponse.data?.status !== 'success') {
          this.showToast('danger', this.remoteFileSizeResponse.data?.data.message || this.remoteFileSizeResponse.data?.massage);
          return;
        }
        this.volumeInfoResponse = await this.executeLocalCommand(`/backup/getvolumedataofcomponent/${appname}/${component}/${'B'}/${0}/${'size,available,mount'}`);
        if (this.volumeInfoResponse.data?.status !== 'success') {
          this.showToast('danger', this.volumeInfoResponse.data?.data.message || this.volumeInfoResponse.data?.data);
          return;
        }
        if (this.remoteFileSizeResponse.data.data > this.volumeInfoResponse.data.data.available) {
          this.showToast('danger', `File is too large (${this.addAndConvertFileSizes(this.remoteFileSizeResponse.data.data)})...`);
          return;
        }
        const existingURL = this.restoreRemoteUrlItems.findIndex((item) => item.url === this.restoreRemoteUrl);
        if (existingURL !== -1) {
          this.showToast('warning', `'${this.restoreRemoteUrl}' is already in the download queue for other component.`);
          return;
        }
        const existingItemIndex = this.restoreRemoteUrlItems.findIndex(
          (item) => item.component === this.restoreRemoteUrlComponent,
        );
        if (this.remoteFileSizeResponse.data.data === 0 || this.remoteFileSizeResponse.data.data === null) {
          return;
        }
        if (existingItemIndex !== -1) {
          this.restoreRemoteUrlItems[existingItemIndex].url = this.restoreRemoteUrl;
          this.restoreRemoteUrlItems[existingItemIndex].file_size = this.remoteFileSizeResponse.data.data;
        } else {
          this.restoreRemoteUrlItems.push({
            url: this.restoreRemoteUrl,
            component: this.restoreRemoteUrlComponent,
            file_size: this.remoteFileSizeResponse.data.data,
          });
        }
      }
    },
    async deleteItem(index, item, file = '', type = '') {
      const elementIndex = item.findIndex((obj) => obj.file === file);
      if (elementIndex !== -1) {
        if (!item[elementIndex]?.selected_file && type === 'upload') {
          console.log(item[elementIndex].file);
          await this.executeLocalCommand(`/backup/removebackupfile/${encodeURIComponent(item[elementIndex].file)}/${this.appName}`);
        }
      }
      item.splice(index, 1);
    },
    async loadBackupList(name = this.appName, type = 'local', itemsList = 'backupList') {
      const backupListTmp = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const componentItem of this.components) {
        // eslint-disable-next-line no-await-in-loop
        this.volumeInfo = await this.executeLocalCommand(`/backup/getvolumedataofcomponent/${name}/${componentItem}/${'B'}/${0}/${'mount'}`);
        this.volumePath = this.volumeInfo.data?.data;
        // eslint-disable-next-line no-await-in-loop
        this.backupFile = await this.executeLocalCommand(`/backup/getlocalbackuplist/${encodeURIComponent(`${this.volumePath.mount}/backup/${type}`)}/${'B'}/${0}/${true}/${name}`);
        this.backupItem = this.backupFile.data?.data;
        if (Array.isArray(this.backupItem)) {
          this.BackupItem = {
            isActive: false,
            component: componentItem,
            create: +this.backupItem[0].create,
            file_size: this.backupItem[0].size,
            file: `${this.volumePath.mount}/backup/${type}/${this.backupItem[0].name}`,
            file_name: `${this.backupItem[0].name}`,
          };
          backupListTmp.push(this.BackupItem);
        }
      }
      console.log(JSON.stringify(itemsList));
      // eslint-disable-next-line no-param-reassign, no-unused-vars
      this[itemsList] = backupListTmp;
    },
    allDownloadsCompleted() {
      return this.computedFileProgress.every((item) => item.progress === 100);
    },
    allDownloadsCompletedVolume() {
      if (this.computedFileProgressVolume.every((item) => item.progress === 100)) {
        setTimeout(() => {
          this.fileProgressVolume = this.fileProgressVolume.filter((item) => item.progress !== 100.00);
        }, 5000);
      }
      return this.computedFileProgressVolume.every((item) => item.progress === 100);
    },
    updateFileProgress(currentFileName, currentFileProgress, loaded, total, name) {
      this.$nextTick(() => {
        const currentIndex = this.fileProgress.findIndex((entry) => entry.fileName === name);
        if (currentIndex !== -1) {
          this.$set(this.fileProgress, currentIndex, { fileName: name, progress: currentFileProgress });
        } else {
          this.fileProgress.push({ fileName: name, progress: currentFileProgress });
        }
      });
    },
    updateFileProgressFD(currentFileName, currentFileProgress, loaded, total, name) {
      this.$nextTick(() => {
        const currentIndex = this.fileProgressFD.findIndex((entry) => entry.fileName === name);
        if (currentIndex !== -1) {
          this.$set(this.fileProgressFD, currentIndex, { fileName: name, progress: currentFileProgress });
        } else {
          this.fileProgressFD.push({ fileName: name, progress: currentFileProgress });
        }
      });
    },
    updateFileProgressVolume(currentFileName, currentFileProgress) {
      this.$nextTick(() => {
        const currentIndex = this.fileProgressVolume.findIndex((entry) => entry.fileName === currentFileName);
        if (currentIndex !== -1) {
          this.$set(this.fileProgressVolume, currentIndex, { fileName: currentFileName, progress: currentFileProgress });
        } else {
          this.fileProgressVolume.push({ fileName: currentFileName, progress: currentFileProgress });
        }
      });
    },
    rowClassFluxDriveBackups(item, type) {
      if (!item || type !== 'row') return 'table-no-padding';
      return '';
    },
    async deleteRestoreBackup(name, restoreItem, timestamp = 0) {
      if (timestamp !== 0) {
        this.newComponents = this.newComponents.filter((item) => item.timestamp !== timestamp);
        try {
          const zelidauth = localStorage.getItem('zelidauth');
          const axiosConfig = {
            headers: {
              zelidauth,
            },
          };
          const data = {
            appname: this.appName,
            timestamp,
          };
          const response = await axios.post(`${this.fluxDriveEndPoint}/removeCheckpoint`, data, axiosConfig);
          console.error(response.data);
          if (response && response.data && response.data.status === 'success') {
            const backupIndex = restoreItem.findIndex((item) => item.timestamp === timestamp);
            restoreItem.splice(backupIndex, 1);
            this.showToast('success', 'Checkpoint backup removed successfully.');
            return true;
          }
          this.showToast('danger', response.data.data.message);
          return false;
        } catch (error) {
          console.error('Error removing checkpoint', error);
          this.showToast('Error removing checkpoint');
        }
      }
      return false;
    },
    async deleteLocalBackup(name, restoreItem, filepath = 0) {
      if (filepath === 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const fileData of restoreItem) {
          const filePath = fileData.file;
          // eslint-disable-next-line no-await-in-loop
          await this.executeLocalCommand(`/backup/removebackupfile/${encodeURIComponent(filePath)}/${this.appName}`);
        }
        this.backupList = [];
        this.backupToUpload = [];
      } else {
        this.status = await this.executeLocalCommand(`/backup/removebackupfile/${encodeURIComponent(filepath)}/${this.appName}`);
        const backupIndex = restoreItem.findIndex((item) => item.component === name);
        restoreItem.splice(backupIndex, 1);
      }
    },
    async downloadAllBackupFiles(backupList) {
      try {
        this.showProgressBar = true;
        const zelidauth = localStorage.getItem('zelidauth');
        const self = this;
        const axiosConfig = {
          headers: {
            zelidauth,
          },
          responseType: 'blob',
          onDownloadProgress(progressEvent) {
            const { loaded, total, target } = progressEvent;
            const decodedUrl = decodeURIComponent(target.responseURL);
            const lastSlashIndex = decodedUrl.lastIndexOf('/');
            const normalizedUrl = lastSlashIndex !== -1 ? decodedUrl.slice(0, lastSlashIndex) : decodedUrl;
            const currentFileName = normalizedUrl.split('/').pop();
            const currentFileProgress = (loaded / total) * 100;
            const foundFile = self.backupList.find((file) => file.file.endsWith(currentFileName));
            self.updateFileProgress(currentFileName, currentFileProgress, loaded, total, foundFile.component);
          },
        };

        // eslint-disable-next-line no-restricted-syntax
        const downloadPromises = backupList.map(async (backup) => {
          try {
            const { file } = backup;
            const fileNameArray = file.split('/');
            const fileName = fileNameArray[fileNameArray.length - 1];
            const response = await this.executeLocalCommand(`/backup/downloadlocalfile/${encodeURIComponent(file)}/${self.appName}`, null, axiosConfig);
            const blob = new Blob([response.data]);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', fileName);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            return true;
          } catch (error) {
            console.error('Error downloading file:', error);
            return false;
          }
        });

        const downloadResults = await Promise.all(downloadPromises);
        // Check if all downloads were successful
        if (downloadResults.every((result) => result)) {
          console.log('All downloads completed successfully');
        } else {
          console.error('Some downloads failed. Check the console for details.');
        }
      } catch (error) {
        console.error('Error downloading files:', error);
        // Handle the error appropriately
      } finally {
        setTimeout(() => {
          this.showProgressBar = false;
          this.fileProgress = [];
        }, 5000);
      }
    },
    async checkFluxDriveUploadProgress() {
      const zelidauth = localStorage.getItem('zelidauth');
      const axiosConfig = {
        headers: {
          zelidauth,
        },
      };
      const fluxDriveUploadTaskTmp = [];
      let errorInStatusCheck = false;
      // eslint-disable-next-line no-restricted-syntax
      for (const task of this.fluxDriveUploadTask) {
        try {
          // eslint-disable-next-line no-restricted-syntax, no-await-in-loop
          const response = await axios.get(`${this.fluxDriveEndPoint}/gettaskstatus?taskId=${task.taskId}`, axiosConfig);
          if (response && response.data && response.data.status === 'success') {
            task.status = response.data.data.status.state;
            if (task.status === 'downloading') {
              task.progress = response.data.data.status.progress / 2;
            } else if (task.status === 'uploading') {
              task.progress = 50 + response.data.data.status.progress / 2;
            } else {
              task.progress = response.data.data.status.progress;
            }
            task.message = response.data.data.status.message;
            this.updateFileProgressFD(task.filename, task.progress, 0, 0, task.component);
            this.fluxDriveUploadStatus = response.data.data.status.message;
            if (task.status === 'finished') {
              this.showToast('success', `${task.component} backup uploaded to FluxDrive successfully.`);
            } else if (task.status === 'failed') {
              this.showToast('danger', `failed to upload ${task.component} backup to FluxDrive.${this.fluxDriveUploadStatus}`);
            } else {
              fluxDriveUploadTaskTmp.push(task);
            }
          } else {
            errorInStatusCheck = true;
          }
        } catch (error) {
          errorInStatusCheck = true;
          console.log('error fetching upload status');
        }
      }
      if (!errorInStatusCheck) this.fluxDriveUploadTask = fluxDriveUploadTaskTmp;
      if (this.fluxDriveUploadTask.length > 0) {
        setTimeout(() => {
          this.checkFluxDriveUploadProgress();
        }, 2000);
      } else {
        this.uploadProgress = false;
        this.showFluxDriveProgressBar = false;
        this.fluxDriveUploadStatus = '';
        this.fileProgressFD = [];
      }
    },
    async uploadToFluxDrive() {
      try {
        this.uploadProgress = true;
        const zelidauth = localStorage.getItem('zelidauth');
        const self = this;
        const axiosConfig = {
          headers: {
            zelidauth,
          },
        };
        let prevoiusTimestamp = 0;
        const uploadPromises = this.backupToUpload.map(async (backup) => {
          try {
            const { file } = backup;
            const { component } = backup;
            const { file_size } = backup;
            const { file_name } = backup;
            const { create } = backup;
            let timestamp = create;
            if (Math.abs(timestamp - prevoiusTimestamp) > 1000 * 60 * 60) {
              prevoiusTimestamp = timestamp;
            } else {
              timestamp = prevoiusTimestamp;
            }
            const url = this.selectedIp.split(':')[0];
            const urlPort = this.selectedIp.split(':')[1] || 16127;
            const hostUrl = `https://${url.replace(/\./g, '-')}-${urlPort}.node.api.runonflux.io/backup/downloadlocalfile/${encodeURIComponent(file)}/${self.appName}`;
            const data = {
              appname: self.appName,
              component,
              // eslint-disable-next-line camelcase
              filename: file_name,
              timestamp,
              host: hostUrl,
              // eslint-disable-next-line camelcase
              filesize: file_size,
            };
            const response = await axios.post(`${this.fluxDriveEndPoint}/registerbackupfile`, data, axiosConfig);
            if (response && response.data && response.data.status === 'success') {
              this.fluxDriveUploadTask.push({
                // eslint-disable-next-line camelcase
                taskId: response.data.data.taskId, filename: file_name, component, status: 'in queue', progress: 0,
              });
            } else {
              console.error(response.data);
              this.showToast('danger', response.data.data.message);
              return false;
            }

            return true;
          } catch (error) {
            console.error('Error registering file:', error);
            this.showToast('danger', 'Error registering file(s) for upload.');
            return false;
          }
        });

        const uploadResults = await Promise.all(uploadPromises);
        // Check if all downloads were successful
        if (uploadResults.every((result) => result)) {
          console.log('All uploads registered successfully');
          this.showFluxDriveProgressBar = true;
        } else {
          console.error('Some uploads failed. Check the console for details.');
        }
      } catch (error) {
        console.error('Error registering files:', error);
        this.showToast('danger', 'Error registering file(s) for upload.');
      } finally {
        setTimeout(() => {
          this.checkFluxDriveUploadProgress();
        }, 2000);
      }
    },
    async restoreFromFluxDrive(newComponents) {
      const restoreItems = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const item of newComponents) {
        // eslint-disable-next-line no-await-in-loop
        restoreItems.push({ component: item.component, file_size: item.file_size, url: item.file_url });
      }
      const zelidauth = localStorage.getItem('zelidauth');
      this.showTopFluxDrive = false;
      this.restoringFromFluxDrive = true;
      this.restoreFromFluxDriveStatus = 'Initializing restore jobs...';
      // eslint-disable-next-line no-unused-vars
      const headers = {
        zelidauth,
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        Connection: 'keep-alive',
      };
      const postLayout = this.buildPostBody(this.appSpecification, 'restore', 'remote');
      let postBackupData;
      // eslint-disable-next-line no-restricted-syntax
      for (const componentName of restoreItems) {
        postBackupData = this.updateJobStatus(postLayout, componentName.component, 'restore', restoreItems);
      }
      const url = this.selectedIp.split(':')[0];
      const urlPort = this.selectedIp.split(':')[1] || 16127;
      let queryUrl = `https://${url.replace(/\./g, '-')}-${urlPort}.node.api.runonflux.io/apps/appendrestoretask`;
      if (this.ipAccess) {
        queryUrl = `http://${url}:${urlPort}/apps/appendrestoretask`;
      }
      const response = await fetch(queryUrl, {
        method: 'POST',
        body: JSON.stringify(postBackupData),
        headers,
      });
      const self = this;
      const reader = response.body.getReader();
      // eslint-disable-next-line no-unused-vars
      await new Promise((streamResolve, streamReject) => {
        function push() {
          reader.read().then(async ({ done, value }) => {
            if (done) {
              streamResolve(); // Resolve the stream promise when the response stream is complete
              return;
            }
            // Process each chunk of data separately
            const chunkText = new TextDecoder('utf-8').decode(value);
            const chunks = chunkText.split('\n');
            // eslint-disable-next-line no-restricted-globals
            await self.processChunks(chunks, 'restore_fluxdrive');
            // Check for new data immediately after processing each chunk
            push();
          });
        }
        push();
      });
      this.restoringFromFluxDrive = false;
      this.restoreFromFluxDriveStatus = '';
    },
    async getFluxDriveBackupList() {
      try {
        const zelidauth = localStorage.getItem('zelidauth');
        const axiosConfig = {
          headers: {
            zelidauth,
          },
        };
        const response = await axios.get(`${this.fluxDriveEndPoint}/getbackuplist?appname=${this.appName}`, axiosConfig);
        if (response.data && response.data.status === 'success') {
          console.log(JSON.stringify(response.data.checkpoints));
          this.tableBackup += 1;
          const uniqueComponents = response.data.checkpoints.reduce((acc, { components }) => {
            components.forEach((component) => acc.add(component.component));
            return acc;
          }, new Set());
          const restoreComponentsTmp = [{ value: '', text: 'all' }];
          // eslint-disable-next-line no-restricted-syntax
          for (const item of uniqueComponents) {
            restoreComponentsTmp.push({ value: item, text: item });
          }
          this.restoreComponents = restoreComponentsTmp;
          this.applyFilter();
          this.checkpoints = response.data.checkpoints;
        } else if (response.data && response.data.status === 'error') this.showToast('danger', response.data.data.message);
      } catch (error) {
        console.error('Error receiving FluxDrive backup list', error);
        this.showToast('danger', 'Error receiving FluxDrive backup list');
      }
    },
    async initMMSDK() {
      try {
        await MMSDK.init();
        ethereum = MMSDK.getProvider();
      } catch (error) {
        console.log(error);
      }
    },
    connectTerminal(name) {
      if (this.appSpecification.version >= 4) {
        const composeValues = Object.values(this.appSpecification.compose);
        const foundInName = composeValues.some((obj) => obj.name === this.selectedApp);
        if (!foundInName) {
          this.showToast('danger', 'Please select an container app before connecting.');
          return;
        }
      }
      let consoleInit = 0;
      if (this.selectedApp || this.appSpecification.version <= 3) {
        if (this.selectedCmd === null) {
          this.showToast('danger', 'No command selected.');
          return;
        }
        if (this.selectedCmd === 'Custom') {
          if (this.customValue) {
            console.log(`Custom command: ${this.customValue}`);
            console.log(`App name: ${name}`);
          } else {
            this.showToast('danger', 'Please enter a custom command.');
            return;
          }
        } else {
          console.log(`Selected command: ${this.selectedCmd}`);
          console.log(`App name: ${name}`);
        }
      } else {
        this.showToast('danger', 'Please select an container app before connecting.');
        return;
      }

      this.isConnecting = true;

      this.terminal = new Terminal({
        allowProposedApi: true,
        cursorBlink: true,
        theme: {
          foreground: 'white',
          background: 'black',
        },
      });

      const url = this.selectedIp.split(':')[0];
      const urlPort = this.selectedIp.split(':')[1] || 16127;
      const zelidauth = localStorage.getItem('zelidauth');
      let queryUrl = `https://${url.replace(/\./g, '-')}-${urlPort}.node.api.runonflux.io`;
      if (this.ipAccess) {
        queryUrl = `http://${url}:${urlPort}`;
      }
      this.socket = io.connect(queryUrl);

      let userValue = '';
      if (this.enableUser) {
        userValue = this.userInputValue;
      }

      if (this.customValue) {
        this.socket.emit('exec', zelidauth, name, this.customValue, this.envInputValue, userValue);
      } else {
        this.socket.emit('exec', zelidauth, name, this.selectedCmd, this.envInputValue, userValue);
      }

      this.terminal.open(this.$refs.terminalElement);
      const fitAddon = new FitAddon();
      this.terminal.loadAddon(fitAddon);
      const webLinksAddon = new WebLinksAddon();
      this.terminal.loadAddon(webLinksAddon);
      const unicode11Addon = new Unicode11Addon();
      this.terminal.loadAddon(unicode11Addon);
      const serializeAddon = new SerializeAddon();
      this.terminal.loadAddon(serializeAddon);
      // eslint-disable-next-line no-underscore-dangle
      this.terminal._initialized = true;

      this.terminal.onResize((event) => {
        const { cols, rows } = event;
        console.log('Resizing to', { cols, rows });
        this.socket.emit('resize', { cols, rows });
      });

      this.terminal.onTitleChange((event) => {
        console.log(event);
      });

      window.onresize = () => {
        fitAddon.fit();
      };

      this.terminal.onData((data) => {
        this.socket.emit('cmd', data);
      });

      this.socket.on('error', (error) => {
        this.showToast('danger', error);
        this.disconnectTerminal();
      });

      this.socket.on('show', (data) => {
        if (consoleInit === 0) {
          /* eslint-disable quotes */
          consoleInit = 1;
          if (!this.customValue) {
            this.socket.emit('cmd', "export TERM=xterm\n");
            if (this.selectedCmd === '/bin/bash') {
              this.socket.emit('cmd', "PS1=\"\\[\\033[01;31m\\]\\u\\[\\033[01;33m\\]@\\[\\033[01;36m\\]\\h \\[\\033[01;33m\\]\\w \\[\\033[01;35m\\]\\$ \\[\\033[00m\\]\"\n");
            }
            this.socket.emit('cmd', "alias ls='ls --color'\n");
            this.socket.emit('cmd', "alias ll='ls -alF'\n");
            this.socket.emit('cmd', "clear\n");
          }
          /* eslint-disable quotes */
          setTimeout(() => {
            this.isConnecting = false;
            this.isVisible = true;
            this.$nextTick(() => {
              setTimeout(() => {
                this.terminal.focus();
                fitAddon.fit();
              }, 500);
            });
          }, 1400);
        }
        this.terminal.write(data);
      });

      this.socket.on('end', () => {
        this.disconnectTerminal();
      });
    },
    disconnectTerminal() {
      if (this.socket) {
        this.socket.disconnect();
      }
      if (this.terminal) {
        this.terminal.dispose();
      }
      this.isVisible = false;
      this.isConnecting = false;
    },
    onSelectChangeCmd() {
      if (this.selectedCmd !== 'Custom') {
        this.customValue = '';
      }
    },
    onSelectChangeEnv() {
      if (!this.enableEnvironment) {
        this.envInputValue = '';
      }
    },
    onSelectChangeUser() {
      if (!this.enableUser) {
        this.userInputValue = '';
      }
    },
    onFilteredSelection(filteredItems) {
      // Trigger pagination to update the number of buttons/pages due to filtering
      this.entNodesSelectTable.totalRows = filteredItems.length;
      this.entNodesSelectTable.currentPage = 1;
    },
    async getMarketPlace() {
      try {
        const response = await axios.get('https://stats.runonflux.io/marketplace/listapps');
        if (response.data.status === 'success') {
          this.marketPlaceApps = response.data.data;
        }
      } catch (error) {
        console.log(error);
      }
    },
    async getMultiplier() {
      try {
        const response = await axios.get('https://stats.runonflux.io/apps/multiplier');
        if (response.data.status === 'success') {
          if (typeof response.data.data === 'number' && response.data.data >= 1) {
            this.generalMultiplier = response.data.data;
          }
        }
      } catch (error) {
        this.generalMultiplier = 10;
        console.log(error);
      }
    },
    async appsDeploymentInformation() {
      const response = await AppsService.appsDeploymentInformation();
      const { data } = response.data;
      if (response.data.status === 'success') {
        this.deploymentAddress = data.address;
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
    },
    async updateManagementTab(index) {
      this.callResponse.data = '';
      this.callResponse.status = '';
      // do not reset global application specifics obtained
      this.appExec.cmd = '';
      this.appExec.env = '';
      this.output = '';
      this.backupToUpload = [];
      if (index !== 11) {
        this.disconnectTerminal();
      }
      if (!this.selectedIp) {
        await this.getInstancesForDropDown();
        await this.getInstalledApplicationSpecifics();
        this.getApplicationLocations().catch(() => {
          this.isBusy = false;
          this.showToast('danger', 'Error loading application locations');
        });
      }
      this.getApplicationManagementAndStatus();
      switch (index) {
        case 1:
          // this.getInstancesForDropDown();
          this.getInstalledApplicationSpecifics();
          this.getGlobalApplicationSpecifics();
          break;
        case 2:
          this.getApplicationInspect();
          break;
        case 3:
          this.getApplicationStats();
          break;
        case 4:
          this.getApplicationMonitoring();
          // this.getApplicationMonitoringStream(); // TODO UI with graphs
          break;
        case 5:
          this.getApplicationChanges();
          break;
        case 6:
          this.getApplicationProcesses();
          break;
        case 7:
          this.getApplicationLogs();
          break;
        case 10:
          this.applyFilter();
          this.loadBackupList();
          break;
        case 11:
          if (!this.appSpecification?.compose || this.appSpecification?.compose?.length === 1) {
            this.refreshFolder();
          }
          break;
        case 15:
          this.getZelidAuthority();
          break;
        default:
          break;
      }
    },
    async appsGetListAllApps() {
      const response = await this.executeLocalCommand('/apps/listallapps');
      console.log(response);
      this.getAllAppsResponse.status = response.data.status;
      this.getAllAppsResponse.data = response.data.data;
    },
    goBackToApps() {
      this.$emit('back');
    },
    async initSignFluxSSO() {
      try {
        const message = this.dataToSign;
        const firebaseUser = getUser();
        if (!firebaseUser) {
          this.showToast('warning', 'Not logged in as SSO. Login with SSO or use different signing method.');
          return;
        }
        const token = firebaseUser.auth.currentUser.accessToken;
        const headers = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        };
        const signSSO = await axios.post('https://service.fluxcore.ai/api/signMessage', { message }, { headers });
        if (signSSO.data?.status !== 'success' && signSSO.data?.signature) {
          this.showToast('warning', 'Failed to sign message, please try again.');
          return;
        }
        this.signature = signSSO.data.signature;
      } catch (error) {
        this.showToast('warning', 'Failed to sign message, please try again.');
      }
    },
    async initiateSignWSUpdate() {
      if (this.dataToSign.length > 1800) {
        const message = this.dataToSign;
        // upload to flux storage
        const data = {
          publicid: Math.floor((Math.random() * 999999999999999)).toString(),
          public: message,
        };
        await axios.post(
          'https://storage.runonflux.io/v1/public',
          data,
        );
        const zelProtocol = `zel:?action=sign&message=FLUX_URL=https://storage.runonflux.io/v1/public/${data.publicid}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${this.callbackValue}`;
        window.location.href = zelProtocol;
      } else {
        window.location.href = `zel:?action=sign&message=${this.dataToSign}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${this.callbackValue}`;
      }
      const self = this;
      const { protocol, hostname, port } = window.location;
      let mybackend = '';
      mybackend += protocol;
      mybackend += '//';
      const regex = /[A-Za-z]/g;
      if (hostname.split('-')[4]) { // node specific domain
        const splitted = hostname.split('-');
        const names = splitted[4].split('.');
        const adjP = +names[0] + 1;
        names[0] = adjP.toString();
        names[2] = 'api';
        splitted[4] = '';
        mybackend += splitted.join('-');
        mybackend += names.join('.');
      } else if (hostname.match(regex)) { // home.runonflux.io -> api.runonflux.io
        const names = hostname.split('.');
        names[0] = 'api';
        mybackend += names.join('.');
      } else {
        if (typeof hostname === 'string') {
          this.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          this.$store.commit('flux/setFluxPort', apiPort);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += this.config.apiPort;
      }
      let backendURL = store.get('backendURL') || mybackend;
      backendURL = backendURL.replace('https://', 'wss://');
      backendURL = backendURL.replace('http://', 'ws://');
      const signatureMessage = this.appUpdateSpecification.owner + this.timestamp;
      const wsuri = `${backendURL}/ws/sign/${signatureMessage}`;
      const websocket = new WebSocket(wsuri);
      this.websocket = websocket;

      websocket.onopen = (evt) => { self.onOpen(evt); };
      websocket.onclose = (evt) => { self.onClose(evt); };
      websocket.onmessage = (evt) => { self.onMessage(evt); };
      websocket.onerror = (evt) => { self.onError(evt); };
    },
    onError(evt) {
      console.log(evt);
    },
    onMessage(evt) {
      const data = qs.parse(evt.data);
      if (data.status === 'success' && data.data) {
        // user is now signed. Store their values
        this.signature = data.data.signature;
      }
      console.log(data);
      console.log(evt);
    },
    onClose(evt) {
      console.log(evt);
    },
    onOpen(evt) {
      console.log(evt);
    },

    async getInstalledApplicationSpecifics() {
      const response = await this.executeLocalCommand(`/apps/installedapps/${this.appName}`);
      console.log(response);
      if (response) {
        if (response.data.status === 'error' || !response.data.data[0]) {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          this.callResponse.status = response.data.status;
          this.callResponse.data = response.data.data[0];
          this.appSpecification = response.data.data[0];
          // /* eslint-disable no-restricted-syntax */
          // if (this.apps.length === 1) {
          // this.apps = this.appSpecification.compose.map((component) => component.name); // Update apps array
          // }
        }
      }
    },
    getExpirePosition(value) {
      const position = this.expireOptions.findIndex((opt) => opt.value === value);
      if (position || position === 0) {
        return position;
      }
      return 2;
    },
    async getGlobalApplicationSpecifics() {
      const response = await AppsService.getAppSpecifics(this.appName);
      console.log(response);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
        this.callBResponse.status = response.data.status;
      } else {
        this.callBResponse.status = response.data.status;
        this.callBResponse.data = response.data.data;
        const specs = response.data.data;
        console.log(specs);
        this.appUpdateSpecification = JSON.parse(JSON.stringify(specs));
        this.appUpdateSpecification.instances = specs.instances || 3;
        if (this.instancesLocked) {
          this.maxInstances = this.appUpdateSpecification.instances;
        }
        if (this.appUpdateSpecification.version <= 3) {
          this.appUpdateSpecification.version = 3; // enforce specs version 3
          this.appUpdateSpecification.ports = specs.port || this.ensureString(specs.ports); // v1 compatibility
          this.appUpdateSpecification.domains = this.ensureString(specs.domains);
          this.appUpdateSpecification.enviromentParameters = this.ensureString(specs.enviromentParameters);
          this.appUpdateSpecification.commands = this.ensureString(specs.commands);
          this.appUpdateSpecification.containerPorts = specs.containerPort || this.ensureString(specs.containerPorts); // v1 compatibility
        } else {
          if (this.appUpdateSpecification.version > 3 && this.appUpdateSpecification.compose.find((comp) => comp.containerData.includes('g:'))) {
            this.masterSlaveApp = true;
          }
          if (this.appUpdateSpecification.version <= 7) {
            this.appUpdateSpecification.version = 7;
          }
          this.appUpdateSpecification.contacts = this.ensureString([]);
          this.appUpdateSpecification.geolocation = this.ensureString([]);
          if (this.appUpdateSpecification.version >= 5) {
            this.appUpdateSpecification.contacts = this.ensureString(specs.contacts || []);
            this.appUpdateSpecification.geolocation = this.ensureString(specs.geolocation || []);
            try {
              this.decodeGeolocation(specs.geolocation || []);
            } catch (error) {
              console.log(error);
              this.appUpdateSpecification.geolocation = this.ensureString([]);
            }
          }
          this.appUpdateSpecification.compose.forEach((component) => {
            // eslint-disable-next-line no-param-reassign
            component.ports = this.ensureString(component.ports);
            // eslint-disable-next-line no-param-reassign
            component.domains = this.ensureString(component.domains);
            // eslint-disable-next-line no-param-reassign
            component.environmentParameters = this.ensureString(component.environmentParameters);
            // eslint-disable-next-line no-param-reassign
            component.commands = this.ensureString(component.commands);
            // eslint-disable-next-line no-param-reassign
            component.containerPorts = this.ensureString(component.containerPorts);
            // eslint-disable-next-line no-param-reassign
            component.secrets = this.ensureString(component.secrets || '');
            // eslint-disable-next-line no-param-reassign
            component.repoauth = this.ensureString(component.repoauth || '');
          });
          if (this.appUpdateSpecification.version >= 6) {
            const expireOption = this.expireOptions.find((opt) => opt.value >= (specs.expire || 22000));
            this.appUpdateSpecification.expire = this.ensureNumber(expireOption.value);
            this.expirePosition = this.getExpirePosition(this.appUpdateSpecification.expire);
          }
          if (this.appUpdateSpecification.version >= 7) {
            this.appUpdateSpecification.staticip = this.appUpdateSpecification.staticip ?? false;
            this.appUpdateSpecification.nodes = this.appUpdateSpecification.nodes || [];
            if (this.appUpdateSpecification.nodes && this.appUpdateSpecification.nodes.length) {
              this.isPrivateApp = true;
            }
            // fetch information about enterprise nodes, pgp keys
            this.appUpdateSpecification.nodes.forEach(async (node) => {
              // fetch pgp key
              const keyExists = this.enterprisePublicKeys.find((key) => key.nodeip === node);
              if (!keyExists) {
                const pgpKey = await this.fetchEnterpriseKey(node);
                if (pgpKey) {
                  const pair = {
                    nodeip: node.ip,
                    nodekey: pgpKey,
                  };
                  const keyExistsB = this.enterprisePublicKeys.find((key) => key.nodeip === node);
                  if (!keyExistsB) {
                    this.enterprisePublicKeys.push(pair);
                  }
                }
              }
            });
            if (!this.enterpriseNodes) {
              await this.getEnterpriseNodes();
            }
            this.selectedEnterpriseNodes = [];
            this.appUpdateSpecification.nodes.forEach((node) => {
              // add to selected node list
              if (this.enterpriseNodes) {
                const nodeFound = this.enterpriseNodes.find((entNode) => entNode.ip === node || node === `${entNode.txhash}:${entNode.outidx}`);
                if (nodeFound) {
                  this.selectedEnterpriseNodes.push(nodeFound);
                }
              } else {
                this.showToast('danger', 'Failed to load Enterprise Node List');
              }
            });
          }
        }
      }
    },

    async update() {
      const zelidauth = localStorage.getItem('zelidauth');
      const data = {
        type: this.updatetype,
        version: this.version,
        appSpecification: this.dataForAppUpdate,
        timestamp: this.timestamp,
        signature: this.signature,
      };
      this.showToast('info', 'Propagating message accross Flux network...');
      const response = await AppsService.updateApp(zelidauth, data).catch((error) => {
        this.showToast('danger', error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        this.updateHash = response.data.data;
        console.log(this.updateHash);
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
    },
    async checkFluxCommunication() {
      const response = await AppsService.checkCommunication();
      if (response.data.status === 'success') {
        this.fluxCommunication = true;
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
    },
    convertExpire() {
      if (!this.extendSubscription) {
        const expires = this.callBResponse.data.expire || 22000;
        const blocksToExpire = this.callBResponse.data.height + expires - this.daemonBlockCount;
        if (blocksToExpire < 5000) {
          throw new Error('Your application will expire in less than one week, you need to extend subscription to be able to update specifications');
        } else {
          return Math.ceil(blocksToExpire / 1000) * 1000;
        }
      }
      if (this.expireOptions[this.expirePosition]) {
        return this.expireOptions[this.expirePosition].value;
      }
      return 22000;
    },
    async checkFluxUpdateSpecificationsAndFormatMessage() {
      try {
        if (!this.tosAgreed) {
          throw new Error('Please agree to Terms of Service');
        }
        const appSpecification = this.appUpdateSpecification;
        let secretsPresent = false;
        if (appSpecification.version >= 7) {
          // construct nodes
          this.constructNodes();
          // encryption
          // if we have secrets or repoauth
          this.appUpdateSpecification.compose.forEach((component) => {
            if (component.repoauth || component.secrets) {
              secretsPresent = true;
              // we must have some nodes
              if (!this.appUpdateSpecification.nodes.length) {
                throw new Error('Private repositories and secrets can only run on Enterprise Nodes');
              }
            }
          });
        }
        if (secretsPresent) { // we do encryption
          this.showToast('info', 'Encrypting specifications, this will take a while...');
          const fetchedKeys = [];
          // eslint-disable-next-line no-restricted-syntax
          for (const node of this.appUpdateSpecification.nodes) {
            const keyExists = this.enterprisePublicKeys.find((key) => key.nodeip === node);
            if (keyExists) {
              fetchedKeys.push(keyExists.nodekey);
            } else {
              // eslint-disable-next-line no-await-in-loop
              const pgpKey = await this.fetchEnterpriseKey(node);
              if (pgpKey) {
                const pair = {
                  nodeip: node.ip,
                  nodekey: pgpKey,
                };
                const keyExistsB = this.enterprisePublicKeys.find((key) => key.nodeip === node.ip);
                if (!keyExistsB) {
                  this.enterprisePublicKeys.push(pair);
                }
                fetchedKeys.push(pgpKey);
              } // else silently fail
            }
          }
          // time to encrypt
          // eslint-disable-next-line no-restricted-syntax
          for (const component of this.appUpdateSpecification.compose) {
            component.environmentParameters = component.environmentParameters.replace('\\“', '\\"');
            component.commands = component.commands.replace('\\“', '\\"');
            component.domains = component.domains.replace('\\“', '\\"');
            if (component.secrets && !component.secrets.startsWith('-----BEGIN PGP MESSAGE')) {
              // need encryption
              // eslint-disable-next-line no-await-in-loop
              const encryptedMessage = await this.encryptMessage(component.secrets, fetchedKeys);
              if (!encryptedMessage) {
                return;
              }
              component.secrets = encryptedMessage;
            }
            if (component.repoauth && !component.repoauth.startsWith('-----BEGIN PGP MESSAGE')) {
              // need encryption
              // eslint-disable-next-line no-await-in-loop
              const encryptedMessage = await this.encryptMessage(component.repoauth, fetchedKeys);
              if (!encryptedMessage) {
                return;
              }
              component.repoauth = encryptedMessage;
            }
          }
        }
        // recheck if encryption ok
        if (secretsPresent) {
          this.appUpdateSpecification.compose.forEach((component) => {
            if (component.secrets && !component.secrets.startsWith('-----BEGIN PGP MESSAGE')) {
              throw new Error('Encryption failed');
            }
            if (component.repoauth && !component.repoauth.startsWith('-----BEGIN PGP MESSAGE')) {
              throw new Error('Encryption failed');
            }
          });
        }
        if (appSpecification.version >= 5) {
          appSpecification.geolocation = this.generateGeolocations();
        }
        if (appSpecification.version >= 6) {
          await this.getDaemonBlockCount();
          appSpecification.expire = this.convertExpire();
        }
        // call api for verification of app registration specifications that returns formatted specs
        const responseAppSpecs = await AppsService.appUpdateVerification(appSpecification);
        if (responseAppSpecs.data.status === 'error') {
          throw new Error(responseAppSpecs.data.data.message || responseAppSpecs.data.data);
        }
        const appSpecFormatted = responseAppSpecs.data.data;
        this.appPricePerSpecs = 0;
        this.appPricePerSpecsUSD = 0;
        this.applicationPriceFluxDiscount = '';
        this.applicationPriceFluxError = false;
        this.freeUpdate = false;

        const response = await AppsService.appPriceUSDandFlux(appSpecFormatted);
        if (response.data.status === 'error') {
          throw new Error(response.data.data.message || response.data.data);
        }
        this.appPricePerSpecsUSD = +response.data.data.usd;
        console.log(response.data.data);
        if (!this.extendSubscription && this.appPricePerSpecsUSD <= 0.50) {
          this.freeUpdate = true;
        } else if (Number.isNaN(+response.data.data.fluxDiscount)) {
          this.applicationPriceFluxError = true;
          this.showToast('danger', 'Not possible to complete payment with Flux crypto currency');
        } else {
          this.appPricePerSpecs = +response.data.data.flux;
          this.applicationPriceFluxDiscount = +response.data.data.fluxDiscount;
        }

        const marketPlaceApp = this.marketPlaceApps.find((app) => this.appUpdateSpecification.name.toLowerCase().startsWith(app.name.toLowerCase()));
        if (marketPlaceApp) {
          this.isMarketplaceApp = true;
        }
        this.timestamp = Date.now();
        this.dataForAppUpdate = appSpecFormatted;
        this.dataToSign = this.updatetype + this.version + JSON.stringify(appSpecFormatted) + this.timestamp;
      } catch (error) {
        console.log(error.message);
        console.error(error);
        this.showToast('danger', error.message || error);
      }
    },

    async appExecute(name = this.appSpecification.name) {
      try {
        if (!this.appExec.cmd) {
          this.showToast('danger', 'No commands specified');
          return;
        }
        const env = this.appExec.env ? this.appExec.env : '[]';
        const { cmd } = this.appExec;
        this.commandExecuting = true;
        console.log('here');
        const data = {
          appname: name,
          cmd: splitargs(cmd),
          env: JSON.parse(env),
        };
        const response = await this.executeLocalCommand('/apps/appexec/', data);
        console.log(response);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          this.commandExecuting = false;
          this.callResponse.status = response.status;
          if (!name.includes('_')) {
            this.callResponse.data = response.data;
          } else {
            if (!this.callResponse.data) {
              this.callResponse.data = [];
            } else if (!Array.isArray(this.callResponse.data)) {
              this.callResponse.data = [];
            }
            this.callResponse.data.unshift({
              name,
              data: response.data,
            });
          }
        }
      } catch (error) {
        this.commandExecuting = false;
        console.log(error);
        this.showToast('danger', error.message || error);
      }
    },
    async downloadApplicationLog(appName) {
      const self = this;
      this.downloaded = '';
      this.total = '';
      this.abortToken = DaemonService.cancelToken();
      const zelidauth = localStorage.getItem('zelidauth');
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        responseType: 'blob',
        onDownloadProgress(progressEvent) {
          self.downloaded = progressEvent.loaded;
          self.total = progressEvent.total;
          if (self.downloaded === self.total) {
            setTimeout(() => {
              self.downloaded = '';
              self.total = '';
            }, 5000);
          }
        },
        // cancelToken: self.abortToken.token,
      };
      const response = await DaemonService.justAPI().get(`/apps/applog/${appName}`, axiosConfig);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'app.log');
      document.body.appendChild(link);
      link.click();
    },

    getAppIdentifier(appName = this.appName) {
      // this id is used for volumes, docker names so we know it reall belongs to flux
      if (appName && appName.startsWith('zel')) {
        return appName;
      }
      if (appName && appName.startsWith('flux')) {
        return appName;
      }
      if (appName === 'KadenaChainWebNode' || appName === 'FoldingAtHomeB') {
        return `zel${appName}`;
      }
      return `flux${appName}`;
    },
    getAppDockerNameIdentifier(appName) {
      // this id is used for volumes, docker names so we know it reall belongs to flux
      const name = this.getAppIdentifier(appName);
      if (name && name.startsWith('/')) {
        return name;
      }
      return `/${name}`;
    },

    async getApplicationInspect() {
      const callData = [];
      this.commandExecuting = true;
      if (this.appSpecification.version >= 4) {
        // compose
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          // eslint-disable-next-line no-await-in-loop
          const response = await this.executeLocalCommand(`/apps/appinspect/${component.name}_${this.appSpecification.name}`);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            const appComponentInspect = {
              name: component.name,
              callData: response.data.data,
            };
            callData.push(appComponentInspect);
          }
        }
      } else {
        const response = await this.executeLocalCommand(`/apps/appinspect/${this.appName}`);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          const appComponentInspect = {
            name: this.appSpecification.name,
            callData: response.data.data,
          };
          callData.push(appComponentInspect);
        }
        console.log(response);
      }
      this.commandExecuting = false;
      this.callResponse.status = 'success';
      this.callResponse.data = callData;
    },
    async getApplicationStats() {
      const callData = [];
      this.commandExecuting = true;
      if (this.appSpecification.version >= 4) {
        // compose
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          // eslint-disable-next-line no-await-in-loop
          const response = await this.executeLocalCommand(`/apps/appstats/${component.name}_${this.appSpecification.name}`);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            const appComponentInspect = {
              name: component.name,
              callData: response.data.data,
            };
            callData.push(appComponentInspect);
          }
        }
      } else {
        const response = await this.executeLocalCommand(`/apps/appstats/${this.appName}`);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          const appComponentInspect = {
            name: this.appSpecification.name,
            callData: response.data.data,
          };
          callData.push(appComponentInspect);
        }
        console.log(response);
      }
      this.commandExecuting = false;
      this.callResponse.status = 'success';
      this.callResponse.data = callData;
    },
    async getApplicationMonitoring() {
      const callData = [];
      if (this.appSpecification.version >= 4) {
        // compose
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          // eslint-disable-next-line no-await-in-loop
          const response = await this.executeLocalCommand(`/apps/appmonitor/${component.name}_${this.appSpecification.name}`);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            const appComponentInspect = {
              name: component.name,
              callData: response.data.data,
            };
            callData.push(appComponentInspect);
          }
        }
      } else {
        const response = await this.executeLocalCommand(`/apps/appmonitor/${this.appName}`);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          const appComponentInspect = {
            name: this.appSpecification.name,
            callData: response.data.data,
          };
          callData.push(appComponentInspect);
        }
        console.log(response);
      }
      this.callResponse.status = 'success';
      this.callResponse.data = callData;
    },
    async getApplicationMonitoringStream() {
      const self = this;
      const zelidauth = localStorage.getItem('zelidauth');
      if (this.appSpecification.version >= 4) {
        // compose
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          const axiosConfig = {
            headers: {
              zelidauth,
            },
            onDownloadProgress(progressEvent) {
              self.monitoringStream[`${component.name}_${self.appSpecification.name}`] = JSON.parse(`[${progressEvent.target.response.replace(/}{"read/g, '},{"read')}]`);
            },
          };
          // eslint-disable-next-line no-await-in-loop
          const response = await AppsService.justAPI().get(`/apps/appmonitorstream/${component.name}_${this.appSpecification.name}`, axiosConfig);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          }
        }
      } else {
        const axiosConfig = {
          headers: {
            zelidauth,
          },
          onDownloadProgress(progressEvent) {
            console.log(progressEvent.target.response);
            self.monitoringStream[self.appName] = JSON.parse(`[${progressEvent.target.response.replace(/}{/g, '},{')}]`);
          },
        };
        // eslint-disable-next-line no-await-in-loop
        const response = await AppsService.justAPI().get(`/apps/appmonitorstream/${this.appName}`, axiosConfig);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        }
      }
    },
    async stopMonitoring(appName, deleteData = false) {
      this.output = '';
      this.showToast('warning', `Stopping Monitoring of ${appName}`);
      let response;
      if (deleteData) {
        response = await this.executeLocalCommand(`/apps/stopmonitoring/${appName}/true`);
      } else {
        response = await this.executeLocalCommand(`/apps/stopmonitoring/${appName}`);
      }
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      console.log(response);
    },
    async startMonitoring(appName) {
      this.output = '';
      this.showToast('warning', `Starting Monitoring of ${appName}`);
      const response = await this.executeLocalCommand(`/apps/startmonitoring/${appName}`);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      console.log(response);
    },
    async getApplicationChanges() {
      const callData = [];
      this.commandExecuting = true;
      if (this.appSpecification.version >= 4) {
        // compose
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          // eslint-disable-next-line no-await-in-loop
          const response = await this.executeLocalCommand(`/apps/appchanges/${component.name}_${this.appSpecification.name}`);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            const appComponentInspect = {
              name: component.name,
              callData: response.data.data,
            };
            callData.push(appComponentInspect);
          }
        }
      } else {
        const response = await this.executeLocalCommand(`/apps/appchanges/${this.appName}`);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          const appComponentInspect = {
            name: this.appSpecification.name,
            callData: response.data.data,
          };
          callData.push(appComponentInspect);
        }
        console.log(response);
      }
      this.commandExecuting = false;
      this.callResponse.status = 'success';
      this.callResponse.data = callData;
    },
    async getApplicationProcesses() {
      const callData = [];
      this.commandExecuting = true;
      if (this.appSpecification.version >= 4) {
        // compose
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          // eslint-disable-next-line no-await-in-loop
          const response = await this.executeLocalCommand(`/apps/apptop/${component.name}_${this.appSpecification.name}`);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            const appComponentInspect = {
              name: component.name,
              callData: response.data.data,
            };
            callData.push(appComponentInspect);
          }
        }
      } else {
        const response = await this.executeLocalCommand(`/apps/apptop/${this.appName}`);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          const appComponentInspect = {
            name: this.appSpecification.name,
            callData: response.data.data,
          };
          callData.push(appComponentInspect);
        }
        console.log(response);
      }
      this.commandExecuting = false;
      this.callResponse.status = 'success';
      this.callResponse.data = callData;
    },
    async getApplicationLogs() {
      const callData = [];
      if (this.appSpecification.version >= 4) {
        // compose
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          // eslint-disable-next-line no-await-in-loop
          const response = await this.executeLocalCommand(`/apps/applog/${component.name}_${this.appSpecification.name}/100`);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            const appComponentInspect = {
              name: component.name,
              callData: response.data.data,
            };
            callData.push(appComponentInspect);
          }
        }
      } else {
        const response = await this.executeLocalCommand(`/apps/applog/${this.appName}/100`);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          const appComponentInspect = {
            name: this.appSpecification.name,
            callData: response.data.data,
          };
          callData.push(appComponentInspect);
        }
        console.log(response);
      }
      this.callResponse.status = 'success';
      this.callResponse.data = callData;
    },
    async getInstancesForDropDown() {
      const response = await AppsService.getAppLocation(this.appName);
      this.selectedIp = null;
      console.log(response);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.masterIP = null;
        this.instances.data = [];
        this.instances.data = response.data.data;
        if (this.masterSlaveApp) {
          const url = `https://${this.appName}.app.runonflux.io/fluxstatistics?scope=${this.appName};json;norefresh`;
          let errorFdm = false;
          let fdmData = await axios.get(url).catch((error) => {
            errorFdm = true;
            console.log(`UImasterSlave: Failed to reach FDM with error: ${error}`);
            this.masterIP = 'Failed to Check';
          });
          if (errorFdm) {
            return;
          }
          fdmData = fdmData.data;
          if (fdmData && fdmData.length > 0) {
            console.log('FDM_Data_Received');
            const ipElement = fdmData[0].find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'svname');
            if (ipElement) {
              this.masterIP = ipElement.value.value.split(':')[0];
              if (!this.selectedIp) {
                if (ipElement.value.value.split(':')[1] === '16127') {
                  this.selectedIp = ipElement.value.value.split(':')[0];
                } else {
                  this.selectedIp = ipElement.value.value;
                }
              }
              return;
            }
          }
          if (!this.selectedIp) {
            this.selectedIp = this.instances.data[0].ip;
          }
          this.masterIP = 'Defining New Primary In Progress';
        } else if (!this.selectedIp) {
          this.selectedIp = this.instances.data[0].ip;
        }
        console.log(this.ipAccess);
        if (this.ipAccess) {
          const withoutProtocol = this.ipAddress.replace('http://', '');
          const desiredIP = this.config.apiPort === 16127 ? withoutProtocol : `${withoutProtocol}:${this.config.apiPort}`;
          const matchingInstances = this.instances.data.filter((instance) => instance.ip === desiredIP);
          if (matchingInstances.length > 0) {
            this.selectedIp = desiredIP;
          }
        } else {
          const regex = /https:\/\/(\d+-\d+-\d+-\d+)-(\d+)/;
          const match = this.ipAddress.match(regex);
          if (match) {
            const ip = match[1].replace(/-/g, '.');
            const desiredIP = this.config.apiPort === 16127 ? ip : `${ip}:${this.config.apiPort}`;
            const matchingInstances = this.instances.data.filter((instance) => instance.ip === desiredIP);
            if (matchingInstances.length > 0) {
              this.selectedIp = desiredIP;
            }
          }
        }
        this.instances.totalRows = this.instances.data.length;
      }
    },
    async getApplicationLocations() {
      this.isBusy = true;
      const response = await AppsService.getAppLocation(this.appName);
      console.log(response);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.masterIP = null;
        this.instances.data = [];
        this.instances.data = response.data.data;
        // eslint-disable-next-line no-restricted-syntax
        for (const node of this.instances.data) {
          const ip = node.ip.split(':')[0];
          const port = node.ip.split(':')[1] || 16127;
          let url = `https://${ip.replace(/\./g, '-')}-${port}.node.api.runonflux.io/flux/geolocation`;
          if (this.ipAccess) {
            url = `http://${ip}:${port}/flux/geolocation`;
          }
          let errorFluxOs = false;
          // eslint-disable-next-line no-await-in-loop
          const fluxGeo = await axios.get(url).catch((error) => {
            errorFluxOs = true;
            console.log(`Error geting geolocation from ${ip}:${port} : ${error}`);
            node.continent = 'N/A';
            node.country = 'N/A';
            node.region = 'N/A';
          });
          if (!errorFluxOs && fluxGeo.data?.status === 'success' && fluxGeo.data.data?.continent) {
            node.continent = fluxGeo.data.data.continent;
            node.country = fluxGeo.data.data.country;
            node.region = fluxGeo.data.data.regionName;
          } else {
            node.continent = 'N/A';
            node.country = 'N/A';
            node.region = 'N/A';
          }
        }
        this.instances.totalRows = this.instances.data.length;
        this.tableKey += 1;
        this.isBusy = false;
      }
    },
    async getAppOwner() {
      const response = await AppsService.getAppOwner(this.appName);
      console.log(response);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      this.selectedAppOwner = response.data.data;
    },

    async stopApp(app) {
      this.output = '';
      this.showToast('warning', `Stopping ${app}`);
      const response = await this.executeLocalCommand(`/apps/appstop/${app}`);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      this.appsGetListAllApps();
      console.log(response);
    },
    async startApp(app) {
      this.output = '';
      this.showToast('warning', `Starting ${app}`);
      const response = await this.executeLocalCommand(`/apps/appstart/${app}`);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      this.appsGetListAllApps();
      console.log(response);
    },
    async restartApp(app) {
      this.output = '';
      this.showToast('warning', `Restarting ${app}`);
      const response = await this.executeLocalCommand(`/apps/apprestart/${app}`);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      this.appsGetListAllApps();
      console.log(response);
    },
    async pauseApp(app) {
      this.output = '';
      this.showToast('warning', `Pausing ${app}`);
      const response = await this.executeLocalCommand(`/apps/apppause/${app}`);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      this.appsGetListAllApps();
      console.log(response);
    },
    async unpauseApp(app) {
      this.output = '';
      this.showToast('warning', `Unpausing ${app}`);
      const response = await this.executeLocalCommand(`/apps/appunpause/${app}`);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      this.appsGetListAllApps();
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
      this.showToast('warning', `Redeploying ${app}`);
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
      const response = await this.executeLocalCommand(`/apps/redeploy/${app}/${force}`, null, axiosConfig);
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
      const self = this;
      this.output = '';
      this.showToast('warning', `Removing ${app}`);
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
      const response = await this.executeLocalCommand(`/apps/appremove/${app}`, null, axiosConfig);
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
          self.managedApplication = '';
        }, 5000);
      }
    },
    getZelidAuthority() {
      const zelidauth = localStorage.getItem('zelidauth');
      this.globalZelidAuthorized = false;
      const auth = qs.parse(zelidauth);
      const timestamp = Date.now();
      const maxHours = 1.5 * 60 * 60 * 1000;
      const mesTime = auth.loginPhrase.substring(0, 13);
      if (+mesTime < (timestamp - maxHours)) {
        this.globalZelidAuthorized = false;
      } else {
        this.globalZelidAuthorized = true;
      }
    },
    async delay(ms) {
      return new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    },
    async executeLocalCommand(command, postObject, axiosConfigAux) {
      try {
        const zelidauth = localStorage.getItem('zelidauth');
        let axiosConfig = axiosConfigAux;
        if (!axiosConfig) {
          axiosConfig = {
            headers: {
              zelidauth,
            },
          };
        }
        this.getZelidAuthority();
        if (!this.globalZelidAuthorized) {
          throw new Error('Session expired. Please log into FluxOS again');
        }

        const url = this.selectedIp.split(':')[0];
        const urlPort = this.selectedIp.split(':')[1] || 16127;
        let response = null;
        let queryUrl = `https://${url.replace(/\./g, '-')}-${urlPort}.node.api.runonflux.io${command}`;
        if (this.ipAccess) {
          queryUrl = `http://${url}:${urlPort}${command}`;
        }
        if (postObject) {
          response = await axios.post(queryUrl, postObject, axiosConfig);
        } else {
          response = await axios.get(queryUrl, axiosConfig);
        }
        return response;
      } catch (error) {
        this.showToast('danger', error.message || error);
        return null;
      }
    },
    async executeCommand(app, command, warningText, parameter) {
      try {
        const zelidauth = localStorage.getItem('zelidauth');
        const axiosConfig = {
          headers: {
            zelidauth,
          },
        };
        this.getZelidAuthority();
        if (!this.globalZelidAuthorized) {
          throw new Error('Session expired. Please log into FluxOS again');
        }

        // get app instances
        this.showToast('warning', warningText);
        let urlPath = `/apps/${command}/${app}`;
        if (parameter) {
          urlPath += `/${parameter}`;
        }
        urlPath += '/true'; // global deploy
        const response = await AppsService.justAPI().get(urlPath, axiosConfig);
        await this.delay(500);
        if (response.data.status === 'success') {
          this.showToast('success', response.data.data.message || response.data.data);
        } else {
          this.showToast('danger', response.data.data.message || response.data.data);
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    async stopAppGlobally(app) {
      this.executeCommand(app, 'appstop', `Stopping ${app} globally. This will take a while...`);
    },
    async startAppGlobally(app) {
      this.executeCommand(app, 'appstart', `Starting ${app} globally. This will take a while...`);
    },
    async restartAppGlobally(app) {
      this.executeCommand(app, 'apprestart', `Restarting ${app} globally. This will take a while...`);
    },
    async pauseAppGlobally(app) {
      this.executeCommand(app, 'apppause', `Pausing ${app} globally. This will take a while...`);
    },
    async unpauseAppGlobally(app) {
      this.executeCommand(app, 'appunpause', `Unpausing ${app} globally. This will take a while...`);
    },
    async redeployAppSoftGlobally(app) {
      this.executeCommand(app, 'redeploy', `Soft redeploying ${app} globally. This will take a while...`, 'false');
    },
    async redeployAppHardGlobally(app) {
      this.executeCommand(app, 'redeploy', `Hard redeploying ${app} globally. This will take a while...`, 'true');
    },
    async removeAppGlobally(app) {
      this.executeCommand(app, 'appremove', `Reinstalling ${app} globally. This will take a while...`, 'true');
    },
    openApp(name, _ip, _port) {
      console.log(name, _ip, _port);
      if ((_port && _ip)) {
        const ip = _ip;
        const port = _port;
        const url = `http://${ip}:${port}`;
        this.openSite(url);
      } else {
        this.showToast('danger', 'Unable to open App :(, App does not have a port.');
      }
    },
    getProperPort(appSpecs = this.appUpdateSpecification) {
      if (appSpecs.port) {
        return appSpecs.port;
      }
      if (appSpecs.ports) {
        const ports = typeof appSpecs.ports === 'string' ? JSON.parse(appSpecs.ports) : appSpecs.ports;
        return ports[0];
      }
      for (let i = 0; i < appSpecs.compose.length; i += 1) {
        for (let j = 0; j < appSpecs.compose[i].ports.length; j += 1) {
          const ports = typeof appSpecs.compose[i].ports === 'string' ? JSON.parse(appSpecs.compose[i].ports) : appSpecs.compose[i].ports;
          if (ports[j]) return ports[j];
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
        this.showToast('danger', 'Unable to open App :(');
      }
    },
    openSite(url) {
      const win = window.open(url, '_blank');
      win.focus();
    },

    ensureBoolean(parameter) {
      let param;
      if (parameter === 'false' || parameter === 0 || parameter === '0' || parameter === false) {
        param = false;
      }
      if (parameter === 'true' || parameter === 1 || parameter === '1' || parameter === true) {
        param = true;
      }
      return param;
    },
    ensureNumber(parameter) {
      return typeof parameter === 'number' ? parameter : Number(parameter);
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
    ensureString(parameter) {
      return typeof parameter === 'string' ? parameter : JSON.stringify(parameter);
    },

    stringOutput() {
      let string = '';
      this.output.forEach((output) => {
        string += `${JSON.stringify(output)}\r\n`;
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

    decodeAsciiResponse(data) {
      if (typeof data === 'string') {
        return data.replace(/[^\x20-\x7E\t\r\n\v\f]/g, '');
      }
      return '';
    },
    getContinent(item) {
      const objItem = this.ensureObject(item);
      const appContinent = objItem.find((x) => x.startsWith('a'));
      if (appContinent) {
        const appContinentAux = this.continentsOptions.find((x) => x.value === appContinent.slice(1));
        if (appContinentAux) {
          return appContinentAux.text;
        }
        return 'All';
      }
      return 'All';
    },
    getCountry(item) {
      const objItem = this.ensureObject(item);
      const appCountry = objItem.find((x) => x.startsWith('b'));
      if (appCountry) {
        const appCountryAux = this.countriesOptions.find((x) => x.value === appCountry.slice(1));
        if (appCountryAux) {
          return appCountryAux.text;
        }
        return 'All';
      }
      return 'All';
    },
    continentChanged() {
      this.selectedCountry = null;
      if (this.selectedContinent) {
        const continent = this.continentsOptions.find((x) => x.value === this.selectedContinent);
        this.maxInstances = continent.maxInstances;
        if (this.appUpdateSpecification.instances > this.maxInstances) {
          this.appUpdateSpecification.instances = this.maxInstances;
        }
        this.showToast('warning', `The node type may fluctuate based upon system requirements for your application. For better results in ${continent.text}, please consider specifications more suited to ${continent.nodeTier} hardware.`);
      } else {
        this.maxInstances = this.appUpdateSpecificationv5template.maxInstances;
        this.showToast('info', 'No geolocation set you can define up to maximum of 100 instances and up to the maximum hardware specs available on Flux network to your app.');
      }
      if (this.instancesLocked) {
        this.maxInstances = this.appUpdateSpecification.instances;
      }
    },
    countryChanged() {
      if (this.selectedCountry) {
        const country = this.countriesOptions.find((x) => x.value === this.selectedCountry);
        this.maxInstances = country.maxInstances;
        if (this.appUpdateSpecification.instances > this.maxInstances) {
          this.appUpdateSpecification.instances = this.maxInstances;
        }
        this.showToast('warning', `The node type may fluctuate based upon system requirements for your application. For better results in ${country.text}, please consider specifications more suited to ${country.nodeTier} hardware.`);
      } else {
        const continent = this.continentsOptions.find((x) => x.value === this.selectedContinent);
        this.maxInstances = continent.maxInstances;
        if (this.appUpdateSpecification.instances > this.maxInstances) {
          this.appUpdateSpecification.instances = this.maxInstances;
        }
        this.showToast('warning', `The node type may fluctuate based upon system requirements for your application. For better results in ${continent.text}, please consider specifications more suited to ${continent.nodeTier} hardware.`);
      }
      if (this.instancesLocked) {
        this.maxInstances = this.appUpdateSpecification.instances;
      }
    },
    generateStatsTableItems(statsData, specifications) {
      // { key: 'timestamp', label: 'DATE' },
      // { key: 'cpu', label: 'CPU' },
      // { key: 'memory', label: 'RAM' },
      // { key: 'disk', label: 'SSD' },
      // { key: 'net', label: 'NET I/O' },
      // { key: 'block', label: 'BLOCK I/O' },
      // { key: 'pids', label: 'PIDS' },
      console.log(statsData);
      if (!statsData || !Array.isArray(statsData)) {
        return [];
      }
      const statsItems = [];
      statsData.forEach((entry) => {
        const cpuMultiplier = entry.data.cpu_stats.online_cpus / specifications.cpu;
        const cpu = `${(((entry.data.cpu_stats.cpu_usage.total_usage - entry.data.precpu_stats.cpu_usage.total_usage) / (entry.data.cpu_stats.system_cpu_usage - entry.data.precpu_stats.system_cpu_usage)) * 100 * cpuMultiplier).toFixed(2)}%`;
        const memory = `${(entry.data.memory_stats.usage / 1e9).toFixed(2)} / ${(specifications.ram / 1e3).toFixed(2)} GB, ${((entry.data.memory_stats.usage / (specifications.ram * 1e6)) * 100).toFixed(2)}%`;
        let net = '0 / 0 GB';
        if (entry.data.networks.eth0) {
          net = `${(entry.data.networks.eth0.rx_bytes / 1e9).toFixed(2)} / ${(entry.data.networks.eth0.tx_bytes / 1e9).toFixed(2)} GB`;
        }
        let block = '0.00 / 0.00 GB';
        if (Array.isArray(entry.data.blkio_stats.io_service_bytes_recursive) && entry.data.blkio_stats.io_service_bytes_recursive.length !== 0) {
          block = `${(entry.data.blkio_stats.io_service_bytes_recursive.find((x) => x.op.toLowerCase() === 'read').value / 1e9).toFixed(2)} / ${(entry.data.blkio_stats.io_service_bytes_recursive.find((x) => x.op.toLowerCase() === 'write').value / 1e9).toFixed(2)} GB`;
        }
        let disk = '0 / 0 GB';
        if (entry.data.disk_stats) {
          disk = `${(entry.data.disk_stats.used / 1e9).toFixed(2)} / ${(specifications.hdd).toFixed(2)} GB, ${((entry.data.disk_stats.used / (specifications.hdd * 1e9)) * 100).toFixed(2)}%`;
        }
        const pids = entry.data.pids_stats.current;
        const point = {
          timestamp: new Date(entry.timestamp).toLocaleString('en-GB', timeoptions.shortDate),
          cpu,
          memory,
          net,
          block,
          disk,
          pids,
        };
        statsItems.push(point);
      });
      return statsItems;
    },
    getCpuPercentage(statsData) {
      console.log(statsData);
      const percentages = [];
      statsData.forEach((data) => {
        const onePercentage = `${((data.data.cpu_stats.cpu_usage.total_usage / data.data.cpu_stats.cpu_usage.system_cpu_usage) * 100).toFixed(2)}%`;
        percentages.push(onePercentage);
      });
      return percentages;
    },
    getTimestamps(statsData) {
      const timestamps = [];
      statsData.forEach((data) => {
        timestamps.push(data.timestamp);
      });
      return timestamps;
    },
    chartOptions(timestamps) {
      const chartOptions = {
        chart: {
          height: 350,
          type: 'area',
        },
        dataLabels: {
          enabled: false,
        },
        stroke: {
          curve: 'smooth',
        },
        xaxis: {
          type: 'timestamp',
          categories: timestamps,
        },
        tooltip: {
          x: {
            format: 'dd/MM/yy HH:mm',
          },
        },
      };
      return chartOptions;
    },
    decodeGeolocation(existingGeolocation) {
      // decode geolocation and push it properly numberOfGeolocations, numberOfNegativeGeolocations
      // selectedContinent1, selectedCountry1, selectedRegion1
      // existingGeolocation is an array that can contain older specs of a, b OR can contain new specs of ac (a!c);
      let isOldSpecs = false;
      existingGeolocation.forEach((location) => {
        if (location.startsWith('b')) {
          isOldSpecs = true;
        }
        if (location.startsWith('a') && location.startsWith('ac') && location.startsWith('a!c')) {
          isOldSpecs = true;
        }
      });
      let updatedNewSpecGeo = existingGeolocation;
      if (isOldSpecs) {
        const continentEncoded = existingGeolocation.find((location) => location.startsWith('a') && location.startsWith('ac') && location.startsWith('a!c'));
        const countryEncoded = existingGeolocation.find((location) => location.startsWith('b'));
        let newSpecLocation = `ac${continentEncoded.slice(1)}`;
        if (countryEncoded) {
          newSpecLocation += `_${countryEncoded.slice(1)}`;
        }
        updatedNewSpecGeo = [newSpecLocation];
      }
      // updatedNewSpecGeo is now geolocation according to new specs
      const allowedLocations = updatedNewSpecGeo.filter((locations) => locations.startsWith('ac'));
      const forbiddenLocations = updatedNewSpecGeo.filter((locations) => locations.startsWith('a!c'));
      for (let i = 1; i < allowedLocations.length + 1; i += 1) {
        this.numberOfGeolocations = i;
        const specifiedLocation = allowedLocations[i - 1].slice(2);
        const locations = specifiedLocation.split('_');
        const continentCode = locations[0];
        const countryCode = locations[1];
        const regionName = locations[2];
        this.allowedGeolocations[`selectedContinent${i}`] = continentCode;
        this.allowedGeolocations[`selectedCountry${i}`] = countryCode || 'ALL';
        this.allowedGeolocations[`selectedRegion${i}`] = regionName || 'ALL';
      }
      for (let i = 1; i < forbiddenLocations.length + 1; i += 1) {
        this.numberOfNegativeGeolocations = i;
        const specifiedLocation = forbiddenLocations[i - 1].slice(3);
        const locations = specifiedLocation.split('_');
        const continentCode = locations[0];
        const countryCode = locations[1];
        const regionName = locations[2];
        this.forbiddenGeolocations[`selectedContinent${i}`] = continentCode;
        this.forbiddenGeolocations[`selectedCountry${i}`] = countryCode || 'NONE';
        this.forbiddenGeolocations[`selectedRegion${i}`] = regionName || 'NONE';
      }
    },
    async getGeolocationData() {
      let possibleLocations = [];
      try {
        // go through our geolocations that are stored as available and construct, no restrictions on instances
        geolocations.continents.forEach((continent) => {
          possibleLocations.push({
            value: continent.code,
            instances: continent.available ? 100 : 0,
          });
        });
        geolocations.countries.forEach((country) => {
          possibleLocations.push({
            value: `${country.continent}_${country.code}`,
            instances: country.available ? 100 : 0,
          });
        });

        // fetch locations from stats
        const response = await axios.get('https://stats.runonflux.io/fluxinfo?projection=geo');
        if (response.data.status === 'success') {
          const geoData = response.data.data;
          if (geoData.length > 5000) { // all went well
            possibleLocations = [];
            geoData.forEach((flux) => {
              if (flux.geolocation && flux.geolocation.continentCode && flux.geolocation.regionName && flux.geolocation.countryCode) {
                const continentLocation = flux.geolocation.continentCode;
                const countryLocation = `${continentLocation}_${flux.geolocation.countryCode}`;
                const regionLocation = `${countryLocation}_${flux.geolocation.regionName}`;
                const continentLocationExists = possibleLocations.find((location) => location.value === continentLocation);
                if (continentLocationExists) {
                  continentLocationExists.instances += 1;
                } else {
                  possibleLocations.push({
                    value: continentLocation,
                    instances: 1,
                  });
                }
                const countryLocationExists = possibleLocations.find((location) => location.value === countryLocation);
                if (countryLocationExists) {
                  countryLocationExists.instances += 1;
                } else {
                  possibleLocations.push({
                    value: countryLocation,
                    instances: 1,
                  });
                }
                const regionLocationExists = possibleLocations.find((location) => location.value === regionLocation);
                if (regionLocationExists) {
                  regionLocationExists.instances += 1;
                } else {
                  possibleLocations.push({
                    value: regionLocation,
                    instances: 1,
                  });
                }
              }
            });
          }
        } else {
          this.showToast('info', 'Failed to get geolocation data from FluxStats, Using stored locations');
        }
      } catch (error) {
        console.log(error);
        this.showToast('info', 'Failed to get geolocation data from FluxStats, Using stored locations');
      }
      this.possibleLocations = possibleLocations;
    },
    continentsOptions(isNegative) {
      const continents = [{ value: isNegative ? 'NONE' : 'ALL', text: isNegative ? 'NONE' : 'ALL' }];
      this.possibleLocations.filter((options) => options.instances > (isNegative ? -1 : 3)).forEach((location) => {
        if (!location.value.includes('_')) {
          const existingContinent = geolocations.continents.find((continent) => continent.code === location.value);
          continents.push({ value: location.value, text: existingContinent ? existingContinent.name : location.value });
        }
      });
      return continents;
    },
    countriesOptions(continentCode, isNegative) {
      const countries = [{ value: isNegative ? 'ALL' : 'ALL', text: isNegative ? 'ALL' : 'ALL' }];
      this.possibleLocations.filter((options) => options.instances > (isNegative ? -1 : 3)).forEach((location) => {
        if (!location.value.split('_')[2] && location.value.startsWith(`${continentCode}_`)) {
          const existingCountry = geolocations.countries.find((country) => country.code === location.value.split('_')[1]);
          countries.push({ value: location.value.split('_')[1], text: existingCountry ? existingCountry.name : location.value.split('_')[1] });
        }
      });
      return countries;
    },
    regionsOptions(continentCode, countryCode, isNegative) {
      const regions = [{ value: isNegative ? 'ALL' : 'ALL', text: isNegative ? 'ALL' : 'ALL' }];
      this.possibleLocations.filter((options) => options.instances > (isNegative ? -1 : 3)).forEach((location) => {
        if (location.value.startsWith(`${continentCode}_${countryCode}_`)) {
          regions.push({ value: location.value.split('_')[2], text: location.value.split('_')[2] });
        }
      });
      return regions;
    },
    generateGeolocations() {
      const geo = [];
      for (let i = 1; i < this.numberOfGeolocations + 1; i += 1) {
        const continent = this.allowedGeolocations[`selectedContinent${i}`];
        const country = this.allowedGeolocations[`selectedCountry${i}`];
        const region = this.allowedGeolocations[`selectedRegion${i}`];
        if (continent && continent !== 'ALL') {
          let geolocation = `ac${continent}`;
          if (country && country !== 'ALL') {
            geolocation += `_${country}`;
            if (region && region !== 'ALL') {
              geolocation += `_${region}`;
            }
          }
          geo.push(geolocation);
        }
      }
      for (let i = 1; i < this.numberOfNegativeGeolocations + 1; i += 1) {
        const continent = this.forbiddenGeolocations[`selectedContinent${i}`];
        const country = this.forbiddenGeolocations[`selectedCountry${i}`];
        const region = this.forbiddenGeolocations[`selectedRegion${i}`];
        if (continent && continent !== 'NONE') {
          let geolocation = `a!c${continent}`;
          if (country && country !== 'ALL') {
            geolocation += `_${country}`;
            if (region && region !== 'ALL') {
              geolocation += `_${region}`;
            }
          }
          geo.push(geolocation);
        }
      }
      return geo;
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
    adjustMaxInstancesPossible() {
      const currentGeolocations = this.generateGeolocations();
      const positiveLocations = currentGeolocations.filter((location) => location.startsWith('ac'));
      console.log(currentGeolocations);
      let instances = 0;
      positiveLocations.forEach((location) => {
        const locFound = this.possibleLocations.find((l) => l.value === location.slice(2));
        if (locFound) {
          instances += locFound.instances;
        }
        if (location === 'ALL') {
          instances += 100;
        }
      });
      if (!positiveLocations.length) {
        instances += 100;
      }
      console.log(instances);
      instances = instances > 3 ? instances : 3;
      const maxInstances = instances > 100 ? 100 : instances;
      this.maxInstances = maxInstances;
      if (this.instancesLocked) {
        this.maxInstances = this.appUpdateSpecification.instances;
      }
    },
    constructAutomaticDomains(appPorts, appName, index = 0) {
      const ports = JSON.parse(JSON.stringify(appPorts));
      const lowerCaseName = appName.toLowerCase();
      if (index === 0) {
        const domains = [`${lowerCaseName}.app.runonflux.io`];
        // flux specs dont allow more than 10 ports so domainString is enough
        for (let i = 0; i < ports.length; i += 1) {
          const portDomain = `${lowerCaseName}_${ports[i]}.app.runonflux.io`;
          domains.push(portDomain);
        }
        return domains;
      }
      const domains = [];
      // flux specs dont allow more than 10 ports so domainString is enough
      for (let i = 0; i < ports.length; i += 1) {
        const portDomain = `${lowerCaseName}_${ports[i]}.app.runonflux.io`;
        domains.push(portDomain);
      }
      return domains;
    },
    async uploadEnvToFluxStorage(componentIndex) {
      try {
        const envid = Math.floor((Math.random() * 999999999999999)).toString();
        if (this.appUpdateSpecification.compose[componentIndex].environmentParameters.toString().includes('F_S_ENV=')) {
          this.showToast('warning', 'Environment parameters are already in Flux Storage');
          return;
        }
        const data = {
          envid,
          env: JSON.parse(this.appUpdateSpecification.compose[componentIndex].environmentParameters),
        };
        const resp = await axios.post('https://storage.runonflux.io/v1/env', data);
        if (resp.data.status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          this.showToast('success', 'Successful upload of Environment to Flux Storage');
          this.appUpdateSpecification.compose[componentIndex].environmentParameters = `["F_S_ENV=https://storage.runonflux.io/v1/env/${envid}"]`;
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    async uploadCmdToFluxStorage(componentIndex) {
      try {
        const cmdid = Math.floor((Math.random() * 999999999999999)).toString();
        if (this.appUpdateSpecification.compose[componentIndex].commands.toString().includes('F_S_CMD=')) {
          this.showToast('warning', 'Commands are already in Flux Storage');
          return;
        }
        const data = {
          cmdid,
          cmd: JSON.parse(this.appUpdateSpecification.compose[componentIndex].commands),
        };
        const resp = await axios.post('https://storage.runonflux.io/v1/cmd', data);
        if (resp.data.status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          this.showToast('success', 'Successful upload of Commands to Flux Storage');
          this.appUpdateSpecification.compose[componentIndex].commands = `["F_S_CMD=https://storage.runonflux.io/v1/cmd/${cmdid}"]`;
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    async uploadContactsToFluxStorage() {
      try {
        const contactsid = Math.floor((Math.random() * 999999999999999)).toString();
        if (this.appUpdateSpecification.contacts.toString().includes('F_S_CONTACTS=')) {
          this.showToast('warning', 'Contacts are already in Flux Storage');
          return;
        }
        const data = {
          contactsid,
          contacts: JSON.parse(this.appUpdateSpecification.contacts),
        };
        const resp = await axios.post('https://storage.runonflux.io/v1/contacts', data);
        if (resp.data.status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          this.showToast('success', 'Successful upload of Contacts to Flux Storage');
          this.appUpdateSpecification.contacts = `["F_S_CONTACTS=https://storage.runonflux.io/v1/contacts/${contactsid}"]`;
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    removeFluxNode(ip) {
      const nodeExists = this.selectedEnterpriseNodes.findIndex((node) => node.ip === ip);
      if (nodeExists > -1) {
        this.selectedEnterpriseNodes.splice(nodeExists, 1);
      }
    },
    async addFluxNode(ip) {
      try {
        const nodeExists = this.selectedEnterpriseNodes.find((node) => node.ip === ip);
        console.log(ip);
        if (!nodeExists) {
          const nodeToAdd = this.enterpriseNodes.find((node) => node.ip === ip);
          this.selectedEnterpriseNodes.push(nodeToAdd);
          console.log(this.selectedEnterpriseNodes);
          // fetch pgp key
          const keyExists = this.enterprisePublicKeys.find((key) => key.nodeip === ip);
          if (!keyExists) {
            const pgpKey = await this.fetchEnterpriseKey(ip);
            if (pgpKey) {
              const pair = {
                nodeip: ip,
                nodekey: pgpKey,
              };
              const keyExistsB = this.enterprisePublicKeys.find((key) => key.nodeip === ip);
              if (!keyExistsB) {
                this.enterprisePublicKeys.push(pair);
              }
            }
          }
        }
      } catch (error) {
        console.log(error);
      }
    },
    async autoSelectNodes() {
      const { instances } = this.appUpdateSpecification;
      const maxSamePubKeyNodes = +instances + 3;
      const maxNumberOfNodes = +instances + Math.ceil(Math.max(7, +instances * 0.15));
      const notSelectedEnterpriseNodes = this.enterpriseNodes.filter((node) => !this.selectedEnterpriseNodes.includes(node));
      const nodesToSelect = [];
      const kycNodes = notSelectedEnterpriseNodes.filter((x) => x.enterprisePoints > 0 && x.score > 1000); // allows to install multiple apps 3 to 4 only in kyc nodes
      for (let i = 0; i < kycNodes.length; i += 1) {
        // todo here check if max same pub key is satisfied
        const alreadySelectedPubKeyOccurances = this.selectedEnterpriseNodes.filter((node) => node.pubkey === kycNodes[i].pubkey).length;
        const toSelectPubKeyOccurances = nodesToSelect.filter((node) => node.pubkey === kycNodes[i].pubkey).length;
        if (alreadySelectedPubKeyOccurances + toSelectPubKeyOccurances < maxSamePubKeyNodes) {
          nodesToSelect.push(kycNodes[i]);
        }
        if (nodesToSelect.length + this.selectedEnterpriseNodes.length >= maxNumberOfNodes) {
          break;
        }
      }
      if (nodesToSelect.length < maxNumberOfNodes) {
        throw new Error('Not enough kyc nodes available to run your enterprise app.');
      }
      nodesToSelect.forEach(async (node) => {
        const nodeExists = this.selectedEnterpriseNodes.find((existingNode) => existingNode.ip === node.ip);
        if (!nodeExists) {
          this.selectedEnterpriseNodes.push(node);
          // fetch pgp key
          const keyExists = this.enterprisePublicKeys.find((key) => key.nodeip === node.ip);
          if (!keyExists) {
            const pgpKey = await this.fetchEnterpriseKey(node.ip);
            if (pgpKey) {
              const pair = {
                nodeip: node.ip,
                nodekey: pgpKey,
              };
              const keyExistsB = this.enterprisePublicKeys.find((key) => key.nodeip === node.ip);
              if (!keyExistsB) {
                this.enterprisePublicKeys.push(pair);
              }
            }
          }
        }
      });
    },
    constructNodes() {
      this.appUpdateSpecification.nodes = [];
      this.selectedEnterpriseNodes.forEach((node) => {
        this.appUpdateSpecification.nodes.push(node.ip);
      });
      if (this.appUpdateSpecification.nodes.length > this.maximumEnterpriseNodes) {
        throw new Error('Maximum of 120 Enterprise Nodes allowed');
      }
    },
    async getEnterpriseNodes() {
      const enterpriseList = sessionStorage.getItem('flux_enterprise_nodes');
      if (enterpriseList) {
        this.enterpriseNodes = JSON.parse(enterpriseList);
        this.entNodesSelectTable.totalRows = this.enterpriseNodes.length;
      }
      try {
        const entList = await AppsService.getEnterpriseNodes();
        if (entList.data.status === 'error') {
          this.showToast('danger', entList.data.data.message || entList.data.data);
        } else {
          this.enterpriseNodes = entList.data.data;
          this.entNodesSelectTable.totalRows = this.enterpriseNodes.length;
          sessionStorage.setItem('flux_enterprise_nodes', JSON.stringify(this.enterpriseNodes));
        }
      } catch (error) {
        console.log(error);
      }
    },
    async getDaemonBlockCount() {
      const response = await DaemonService.getBlockCount();
      if (response.data.status === 'success') {
        this.daemonBlockCount = response.data.data;
      }
    },
    async fetchEnterpriseKey(nodeip) { // we must have at least +5 nodes or up to 10% of spare keys
      try {
        const node = nodeip.split(':')[0];
        const port = Number(nodeip.split(':')[1] || 16127);
        // const agent = new https.Agent({
        //   rejectUnauthorized: false,
        // });
        let queryUrl = `https://${node.replace(/\./g, '-')}-${port}.node.api.runonflux.io/flux/pgp`;
        if (this.ipAccess) {
          queryUrl = `http://${node}:${port}/flux/pgp`;
        }
        const response = await axios.get(queryUrl); // ip with port
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          const pgpKey = response.data.data;
          return pgpKey;
        }
        return null;
      } catch (error) {
        console.log(error);
        return null;
      }
    },
    /**
     * To encrypt a message with an array of encryption public keys
     * @param {string} message Message to encrypt
     * @param {array} encryptionKeys Armored version of array of public key
     * @returns {string} Return armored version of encrypted message
     */
    async encryptMessage(message, encryptionKeys) {
      try {
        const publicKeys = await Promise.all(encryptionKeys.map((armoredKey) => openpgp.readKey({ armoredKey })));
        console.log(encryptionKeys);
        console.log(message);
        const pgpMessage = await openpgp.createMessage({ text: message });
        const encryptedMessage = await openpgp.encrypt({
          message: pgpMessage, // input as Message object
          encryptionKeys: publicKeys,
        });
        // '-----BEGIN PGP MESSAGE ... END PGP MESSAGE-----'
        return encryptedMessage;
      } catch (error) {
        this.showToast('danger', 'Data encryption failed');
        return null;
      }
    },
    async onSessionConnect(session) {
      console.log(session);
      // const msg = `0x${Buffer.from(this.loginPhrase, 'utf8').toString('hex')}`;
      const result = await this.signClient.request({
        topic: session.topic,
        chainId: 'eip155:1',
        request: {
          method: 'personal_sign',
          params: [
            this.dataToSign,
            session.namespaces.eip155.accounts[0].split(':')[2],
          ],
        },
      });
      console.log(result);
      this.signature = result;
    },
    async initWalletConnect() {
      try {
        const signClient = await SignClient.init(walletConnectOptions);
        this.signClient = signClient;
        const lastKeyIndex = signClient.session.getAll().length - 1;
        const lastSession = signClient.session.getAll()[lastKeyIndex];
        if (lastSession) {
          this.onSessionConnect(lastSession);
        } else {
          throw new Error('WalletConnect session expired. Please log into FluxOS again');
        }
      } catch (error) {
        console.error(error);
        this.showToast('danger', error.message);
      }
    },
    async siwe(siweMessage, from) {
      try {
        const msg = `0x${Buffer.from(siweMessage, 'utf8').toString('hex')}`;
        const sign = await ethereum.request({
          method: 'personal_sign',
          params: [msg, from],
        });
        console.log(sign); // this is signature
        this.signature = sign;
      } catch (error) {
        console.error(error); // rejection occured
        this.showToast('danger', error.message);
      }
    },
    async initMetamask() {
      try {
        if (!ethereum) {
          this.showToast('danger', 'Metamask not detected');
          return;
        }
        let account;
        if (ethereum && !ethereum.selectedAddress) {
          const accounts = await ethereum.request({ method: 'eth_requestAccounts', params: [] });
          console.log(accounts);
          account = accounts[0];
        } else {
          account = ethereum.selectedAddress;
        }
        this.siwe(this.dataToSign, account);
      } catch (error) {
        this.showToast('danger', error.message);
      }
    },
    async initSSP() {
      try {
        if (!window.ssp) {
          this.showToast('danger', 'SSP Wallet not installed');
          return;
        }
        const responseData = await window.ssp.request('sspwid_sign_message', { message: this.dataToSign });
        if (responseData.status === 'ERROR') {
          throw new Error(responseData.data || responseData.result);
        }
        this.signature = responseData.signature;
      } catch (error) {
        this.showToast('danger', error.message);
      }
    },
    async initSSPpay() {
      try {
        if (!window.ssp) {
          this.showToast('danger', 'SSP Wallet not installed');
          return;
        }
        const data = {
          message: this.updateHash,
          amount: (+this.appPricePerSpecs || 0).toString(),
          address: this.deploymentAddress,
          chain: 'flux',
        };
        const responseData = await window.ssp.request('pay', data);
        if (responseData.status === 'ERROR') {
          throw new Error(responseData.data || responseData.result);
        } else {
          this.showToast('success', `${responseData.data}: ${responseData.txid}`);
        }
      } catch (error) {
        this.showToast('danger', error.message);
      }
    },
    async initStripePay(hash, name, price, description) {
      try {
        this.fiatCheckoutURL = '';
        this.checkoutLoading = true;
        const zelidauth = localStorage.getItem('zelidauth');
        const auth = qs.parse(zelidauth);
        const data = {
          zelid: auth.zelid,
          signature: auth.signature,
          loginPhrase: auth.loginPhrase,
          details: {
            name,
            description,
            hash,
            price,
            productName: name,
            success_url: 'https://home.runonflux.io/successcheckout',
            cancel_url: 'https://home.runonflux.io',
            kpi: {
              origin: 'FluxOS',
              marketplace: this.isMarketplaceApp,
              registration: false,
            },
          },
        };
        const checkoutURL = await axios.post(`${paymentBridge}/api/v1/stripe/checkout/create`, data);
        if (checkoutURL.data.status === 'error') {
          this.showToast('error', 'Failed to create stripe checkout');
          this.checkoutLoading = false;
          return;
        }
        this.fiatCheckoutURL = checkoutURL.data.data;
        this.checkoutLoading = false;
        this.openSite(checkoutURL.data.data);
      } catch (error) {
        this.showToast('error', 'Failed to create stripe checkout');
        this.checkoutLoading = false;
      }
    },
    async initPaypalPay(hash, name, price, description) {
      try {
        this.fiatCheckoutURL = '';
        this.checkoutLoading = true;
        const zelidauth = localStorage.getItem('zelidauth');
        const auth = qs.parse(zelidauth);
        const data = {
          zelid: auth.zelid,
          signature: auth.signature,
          loginPhrase: auth.loginPhrase,
          details: {
            name,
            description,
            hash,
            price,
            productName: name,
            return_url: 'home.runonflux.io/successcheckout',
            cancel_url: 'home.runonflux.io',
            kpi: {
              origin: 'FluxOS',
              marketplace: this.isMarketplaceApp,
              registration: false,
            },
          },
        };
        const checkoutURL = await axios.post(`${paymentBridge}/api/v1/paypal/checkout/create`, data);
        if (checkoutURL.data.status === 'error') {
          this.showToast('error', 'Failed to create PayPal checkout');
          this.checkoutLoading = false;
          return;
        }
        this.fiatCheckoutURL = checkoutURL.data.data;
        this.checkoutLoading = false;
        this.openSite(checkoutURL.data.data);
      } catch (error) {
        this.showToast('error', 'Failed to create PayPal checkout');
        this.checkoutLoading = false;
      }
    },
    async getApplicationManagementAndStatus() {
      if (this.selectedIp) {
        await this.appsGetListAllApps();
        console.log(this.getAllAppsResponse);
        const foundAppInfo = this.getAllAppsResponse.data.find((app) => app.Names[0] === this.getAppDockerNameIdentifier()) || {};
        const appInfo = {
          name: this.appName,
          state: foundAppInfo.State || 'Unknown state',
          status: foundAppInfo.Status || 'Unknown status',
        };
        this.appInfoObject.push(appInfo);
        appInfo.state = appInfo.state.charAt(0).toUpperCase() + appInfo.state.slice(1);
        appInfo.status = appInfo.status.charAt(0).toUpperCase() + appInfo.status.slice(1);
        let niceString = `${appInfo.name} - ${appInfo.state} - ${appInfo.status}`;
        if (this.appSpecification) {
          if (this.appSpecification.version >= 4) {
            niceString = `${this.appSpecification.name}:`;
            // eslint-disable-next-line no-restricted-syntax
            for (const component of this.appSpecification.compose) {
              const foundAppInfoComponent = this.getAllAppsResponse.data.find((app) => app.Names[0] === this.getAppDockerNameIdentifier(`${component.name}_${this.appSpecification.name}`)) || {};
              const appInfoComponent = {
                name: component.name,
                state: foundAppInfoComponent.State || 'Unknown state',
                status: foundAppInfoComponent.Status || 'Unknown status',
              };
              this.appInfoObject.push(appInfoComponent);
              appInfoComponent.state = appInfoComponent.state.charAt(0).toUpperCase() + appInfoComponent.state.slice(1);
              appInfoComponent.status = appInfoComponent.status.charAt(0).toUpperCase() + appInfoComponent.status.slice(1);
              const niceStringComponent = ` ${appInfoComponent.name} - ${appInfoComponent.state} - ${appInfoComponent.status},`;
              niceString += niceStringComponent;
            }
            niceString = niceString.substring(0, niceString.length - 1);
            niceString += ` - ${this.selectedIp}`;
          }
        }
        this.applicationManagementAndStatus = niceString;
      }
    },
    selectedIpChanged() {
      this.getApplicationManagementAndStatus();
      this.getInstalledApplicationSpecifics();
    },
  },
};
</script>

<style>
#updatemessage {
  padding-right: 25px !important;
}
.text-wrap {
  position: relative;
  padding: 0em;
}
.clipboard.icon {
  position: absolute;
  top: 0.4em;
  right: 2em;
  margin-top: 4px;
  margin-left: 4px;
  width: 12px;
  height: 12px;
  border: solid 1px #333333;
  border-top: none;
  border-radius: 1px;
  cursor: pointer;
}
.no-wrap {
  white-space: nowrap !important;
}
.custom-button {
  width: 15px !important;
  height: 25px !important;
}
.button-cell {
  display: flex;
  align-items: center;
  min-width: 150px;
}
.xterm {
  padding: 10px;
}
.spin-icon {
  animation: spin 2s linear infinite;
}
@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.app-instances-table td:nth-child(1) {
  padding: 0 0 0 5px;
}
.app-instances-table th:nth-child(1) {
  padding: 0 0 0 5px;
}
.app-instances-table td:nth-child(5) {
  width: 105px;
}
.app-instances-table th:nth-child(5) {
  width: 105px;
}
.loginRow {
  display: flex;
  flex-direction: row;
  justify-content: space-around;
  align-items: center;
  margin-bottom: 10px;
}
.walletIcon {
  height: 90px;
  width: 90px;
  padding: 10px;
}
.walletIcon img {
  -webkit-app-region: no-drag;
  transition: 0.1s;
}
.fluxSSO {
  height: 90px;
  padding: 10px;
  margin-left: 5px;
}
.fluxSSO img {
  -webkit-app-region: no-drag;
  transition: 0.1s;
}
.stripePay {
  margin-left: 5px;
  height: 90px;
  padding: 10px;
}
.stripePay img {
  -webkit-app-region: no-drag;
  transition: 0.1s;
}
.paypalPay {
  margin-left: 5px;
  height: 90px;
  padding: 10px;
}
.paypalPay img {
  -webkit-app-region: no-drag;
  transition: 0.1s;
}

a img {
  transition: all 0.05s ease-in-out;
}

a:hover img {
  filter: opacity(70%);
  transform: scale(1.1);
}

.flex {
  display: flex;
}
</style>

<style lang="scss">
.anchor {
  display: block;
  height: 100px;
  margin-top: -100px;
  visibility: hidden;
}
.v-toast__text {
  font-family: "Roboto", sans-serif !important;
}
.jv-dark {
  background: none;
  white-space: nowrap;
  font-size: 14px;
  font-family: Consolas, Menlo, Courier, monospace;
  margin-bottom: 25px;
}
.jv-button {
  color: #49b3ff !important;
}
.jv-dark .jv-key {
  color: #999 !important;
}
.jv-dark .jv-array {
  color: #999 !important;
}
.jv-boolean {
  color: #fc1e70 !important;
}
.jv-function {
  color: #067bca !important;
}
.jv-number {
  color: #fc1e70 !important;
}
.jv-number-float {
  color: #fc1e70 !important;
}
.jv-number-integer {
  color: #fc1e70 !important;
}
.jv-dark .jv-object {
  color: #999 !important;
}
.jv-undefined {
  color: #e08331 !important;
}
.jv-string {
  color: #42b983 !important;
  word-break: break-word;
  white-space: normal;
}
.card-body {
  padding: 1rem;
}
.table-no-padding > td {
  padding: 0 !important;
}

.backups-table td {
  position: relative;
}
td .ellipsis-wrapper {
  position: absolute;
  max-width: calc(100% - 1rem);
  line-height: calc(3rem - 8px);
  top: 0;
  left: 1rem;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
</style>
