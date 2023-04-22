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
      vertical
      lazy
      @input="index => updateManagementTab(index)"
    >
      <b-tab
        title="Local App Management"
        disabled
      />
      <b-tab
        title="Specifications"
        :active="!global"
        :disabled="!isApplicationInstalledLocally"
      >
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
          style="text-align: left"
        >
          <b-card class="mx-2">
            <list-entry
              title="Description"
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
              title="Period"
              :data="getExpireLabel || (callResponse.data.expire ? callResponse.data.expire + ' blocks' : '1 month')"
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
                    :data="callResponse.data.cpubasic + ' vCore'"
                  />
                  <list-entry
                    title="CPU Nimbus"
                    :data="callResponse.data.cpusuper + ' vCore'"
                  />
                  <list-entry
                    title="CPU Stratus"
                    :data="callResponse.data.cpubamf + ' vCore'"
                  />
                  <list-entry
                    title="RAM Cumulus"
                    :data="callResponse.data.rambasic + ' MB'"
                  />
                  <list-entry
                    title="RAM Nimbus"
                    :data="callResponse.data.ramsuper + ' MB'"
                  />
                  <list-entry
                    title="RAM Stratus"
                    :data="callResponse.data.rambamf + ' MB'"
                  />
                  <list-entry
                    title="SSD Cumulus"
                    :data="callResponse.data.hddbasic + ' GB'"
                  />
                  <list-entry
                    title="SSD Nimbus"
                    :data="callResponse.data.hddsuper + ' GB'"
                  />
                  <list-entry
                    title="SSD Stratus"
                    :data="callResponse.data.hddbamf + ' GB'"
                  />
                </div>
                <div v-else>
                  <list-entry
                    title="CPU"
                    :data="callResponse.data.cpu + ' vCore'"
                  />
                  <list-entry
                    title="RAM"
                    :data="callResponse.data.ram + ' MB'"
                  />
                  <list-entry
                    title="SSD"
                    :data="callResponse.data.hdd + ' GB'"
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
        </div>
        <div v-else>
          Local Specifications loading...
        </div>
        <h2 class="mt-2">
          Global Specifications
        </h2>
        <div
          v-if="callBResponse.data"
          style="text-align: left"
        >
          <b-card class="mx-2">
            <list-entry
              title="Description"
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
              title="Period"
              :data="getExpireLabel || (callBResponse.data.expire ? callBResponse.data.expire + ' blocks' : '1 month')"
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
                    :data="callBResponse.data.cpubasic + ' vCore'"
                  />
                  <list-entry
                    title="CPU Nimbus"
                    :data="callBResponse.data.cpusuper + ' vCore'"
                  />
                  <list-entry
                    title="CPU Stratus"
                    :data="callBResponse.data.cpubamf + ' vCore'"
                  />
                  <list-entry
                    title="RAM Cumulus"
                    :data="callBResponse.data.rambasic + ' MB'"
                  />
                  <list-entry
                    title="RAM Nimbus"
                    :data="callBResponse.data.ramsuper + ' MB'"
                  />
                  <list-entry
                    title="RAM Stratus"
                    :data="callBResponse.data.rambamf + ' MB'"
                  />
                  <list-entry
                    title="SSD Cumulus"
                    :data="callBResponse.data.hddbasic + ' GB'"
                  />
                  <list-entry
                    title="SSD Nimbus"
                    :data="callBResponse.data.hddsuper + ' GB'"
                  />
                  <list-entry
                    title="SSD Stratus"
                    :data="callBResponse.data.hddbamf + ' GB'"
                  />
                </div>
                <div v-else>
                  <list-entry
                    title="CPU"
                    :data="callBResponse.data.cpu + ' vCore'"
                  />
                  <list-entry
                    title="RAM"
                    :data="callBResponse.data.ram + ' MB'"
                  />
                  <list-entry
                    title="SSD"
                    :data="callBResponse.data.hdd + ' GB'"
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
        </div>
        <div v-else-if="callBResponse.status === 'error'">
          Global specifications not found!
        </div>
        <div v-else>
          Global Specifications loading...
        </div>
      </b-tab>
      <b-tab
        title="Information"
        :disabled="!isApplicationInstalledLocally"
      >
        <h3>{{ appSpecification.name }}</h3>
        <div v-if="appSpecification.version >= 4">
          <div
            v-for="(component, index) in callResponse.data"
            :key="index"
          >
            <h4>{{ component.name }} Component</h4>
            <b-form-textarea
              v-if="component.callData"
              plaintext
              no-resize
              rows="15"
              :value="JSON.stringify(component.callData, null, 4)"
            />
          </div>
        </div>
        <div v-else>
          <b-form-textarea
            v-if="callResponse.data && callResponse.data[0]"
            plaintext
            no-resize
            rows="15"
            :value="JSON.stringify(callResponse.data[0].callData, null, 4)"
          />
        </div>
      </b-tab>
      <b-tab
        title="Resources"
        :disabled="!isApplicationInstalledLocally"
      >
        <h3>{{ appSpecification.name }}</h3>
        <div v-if="appSpecification.version >= 4">
          <div
            v-for="(component, index) in callResponse.data"
            :key="index"
          >
            <h4>{{ component.name }} Component</h4>
            <b-form-textarea
              v-if="component.callData"
              plaintext
              no-resize
              rows="15"
              :value="JSON.stringify(component.callData, null, 4)"
            />
          </div>
        </div>
        <div v-else>
          <b-form-textarea
            v-if="callResponse.data && callResponse.data[0]"
            plaintext
            no-resize
            rows="15"
            :value="JSON.stringify(callResponse.data[0].callData, null, 4)"
          />
        </div>
      </b-tab>
      <b-tab
        title="Monitoring"
        :disabled="!isApplicationInstalledLocally"
      >
        <h3>{{ appSpecification.name }} History Statistics 1 hour</h3>
        <div v-if="appSpecification.version >= 4">
          <div
            v-for="(component, index) in callResponse.data"
            :key="index"
          >
            <h4>{{ component.name }} Component</h4>
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
        <h3>{{ appSpecification.name }} History Statistics 24 hours</h3>
        <div v-if="appSpecification.version >= 4">
          <div
            v-for="(component, index) in callResponse.data"
            :key="index"
          >
            <h4>{{ component.name }} Component</h4>
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
      <b-tab
        title="File Changes"
        :disabled="!isApplicationInstalledLocally"
      >
        <h3>{{ appSpecification.name }}</h3>
        <div v-if="appSpecification.version >= 4">
          <div
            v-for="(component, index) in callResponse.data"
            :key="index"
          >
            <h4>{{ component.name }} Component</h4>
            <b-form-textarea
              v-if="component.callData"
              plaintext
              no-resize
              rows="15"
              :value="JSON.stringify(component.callData, null, 4)"
            />
          </div>
        </div>
        <div v-else>
          <b-form-textarea
            v-if="callResponse.data && callResponse.data[0]"
            plaintext
            no-resize
            rows="15"
            :value="JSON.stringify(callResponse.data[0].callData, null, 4)"
          />
        </div>
      </b-tab>
      <b-tab
        title="Processes"
        :disabled="!isApplicationInstalledLocally"
      >
        <h3>{{ appSpecification.name }}</h3>
        <div v-if="appSpecification.version >= 4">
          <div
            v-for="(component, index) in callResponse.data"
            :key="index"
          >
            <h4>{{ component.name }} Component</h4>
            <b-form-textarea
              v-if="component.callData"
              plaintext
              no-resize
              rows="15"
              :value="JSON.stringify(component.callData, null, 4)"
            />
          </div>
        </div>
        <div v-else>
          <b-form-textarea
            v-if="callResponse.data && callResponse.data[0]"
            plaintext
            no-resize
            rows="15"
            :value="JSON.stringify(callResponse.data[0].callData, null, 4)"
          />
        </div>
      </b-tab>
      <b-tab
        title="Log File"
        :disabled="!isApplicationInstalledLocally"
      >
        <h3>{{ appSpecification.name }}</h3>
        <div v-if="appSpecification.version >= 4">
          <div
            v-for="(component, index) in callResponse.data"
            :key="index"
          >
            <h4>{{ component.name }} Component</h4>
            <div class="text-center">
              <h6>
                Click the 'Download Log File' button to download the Log file from your Application debug file. This may take a few minutes depending on file size.
              </h6>
              <div>
                <b-button
                  :id="`start-download-log-${component.name}_${appSpecification.name}`"
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="outline-primary"
                  size="md"
                  class="mt-2"
                >
                  Download Debug File
                </b-button>
                <confirm-dialog
                  :target="`start-download-log-${component.name}_${appSpecification.name}`"
                  confirm-button="Download Log"
                  @confirm="downloadApplicationLog(`${component.name}_${appSpecification.name}`)"
                />
              </div>
              <div>
                <b-card-text v-if="total && downloaded">
                  {{ (downloaded / 1e6).toFixed(2) + " / " + (total / 1e6).toFixed(2) }} MB - {{ ((downloaded / total) * 100).toFixed(2) + "%" }}
                </b-card-text>
                <h6 class="mb-1 mt-2">
                  Last 100 lines of the log file
                </h6>
                <b-form-textarea
                  v-if="component.callData"
                  plaintext
                  no-resize
                  rows="15"
                  :value="decodeAsciiResponse(component.callData)"
                  class="mt-1"
                />
              </div>
            </div>
          </div>
        </div>
        <div v-else>
          <div class="text-center">
            <h6>
              Click the 'Download Log File' button to download the Log file from your Application debug file. This may take a few minutes depending on file size.
            </h6>
            <div>
              <b-button
                id="start-download-log"
                v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                variant="outline-primary"
                size="md"
                class="mt-2"
              >
                Download Debug File
              </b-button>
              <confirm-dialog
                target="start-download-log"
                confirm-button="Download Log"
                @confirm="downloadApplicationLog(appSpecification.name)"
              />
            </div>
            <div>
              <b-card-text v-if="total && downloaded">
                {{ (downloaded / 1e6).toFixed(2) + " / " + (total / 1e6).toFixed(2) }} MB - {{ ((downloaded / total) * 100).toFixed(2) + "%" }}
              </b-card-text>
              <h6 class="mb-1 mt-2">
                Last 100 lines of the log file
              </h6>
              <b-form-textarea
                v-if="callResponse.data && callResponse.data[0]"
                plaintext
                no-resize
                rows="15"
                :value="decodeAsciiResponse(callResponse.data[0].callData)"
                class="mt-1"
              />
            </div>
          </div>
        </div>
      </b-tab>
      <b-tab
        title="Control"
        :disabled="!isApplicationInstalledLocally"
      >
        <b-row class="match-height">
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
        <b-row class="match-height">
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
        title="Execute Commands"
        :disabled="!isApplicationInstalledLocally"
      >
        <div class="text-center">
          <h3>{{ appSpecification.name }}</h3>
          <h6>Here you can execute some commands with a set of environment variables on this local application instance. Both are array of strings. Useful especially for testing and tweaking purposes.</h6>
          <div class="mb-2" />
          <div v-if="appSpecification.compose">
            <div
              v-for="(component, index) in appSpecification.compose"
              :key="index"
            >
              <h4>{{ component.name }} Component</h4>
              <b-form-group
                label-cols="4"
                label-cols-lg="2"
                label="Commands"
                label-for="commandInput"
                class="mt-2"
              >
                <b-form-input
                  id="`commandInput-${component.name}_${appSpecification.name}`"
                  v-model="appExec.cmd"
                  placeholder="Array of strings of Commands"
                />
              </b-form-group>
              <b-form-group
                label-cols="4"
                label-cols-lg="2"
                label="Environment"
                label-for="environmentInput"
              >
                <b-form-input
                  :id="`environmentInput-${component.name}_${appSpecification.name}`"
                  v-model="appExec.env"
                  placeholder="Array of strings of Environment Parameters"
                />
              </b-form-group>
              <b-button
                :id="`execute-commands-${component.name}_${appSpecification.name}`"
                v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                variant="success"
                aria-label="Execute Commands"
                class="mx-1 my-1"
                @click="appExecute(`${component.name}_${appSpecification.name}`)"
              >
                Execute Commands
              </b-button>
              <div v-if="commandExecuting">
                <v-icon name="spinner" />
              </div>
              <b-form-textarea
                v-if="callResponse.data && callResponse.data[0] && callResponse.data.find((d) => d.name === `${component.name}_${appSpecification.name}`)"
                plaintext
                no-resize
                rows="15"
                :value="decodeAsciiResponse(callResponse.data.find((d) => d.name === `${component.name}_${appSpecification.name}`).data)"
                class="mt-1"
              />
              <div class="mb-5" />
            </div>
          </div>
          <div v-else>
            <b-form-group
              label-cols="4"
              label-cols-lg="2"
              label="Commands"
              label-for="commandInput"
              class="mt-2"
            >
              <b-form-input
                id="commandInput"
                v-model="appExec.cmd"
                placeholder="Array of strings of Commands"
              />
            </b-form-group>
            <b-form-group
              label-cols="4"
              label-cols-lg="2"
              label="Environment"
              label-for="environmentInput"
            >
              <b-form-input
                id="environmentInput"
                v-model="appExec.env"
                placeholder="Array of strings of Environment Parameters"
              />
            </b-form-group>
            <b-button
              id="execute-commands"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Execute Commands"
              class="mx-1 my-1"
              @click="appExecute(appSpecification.name)"
            >
              Execute Commands
            </b-button>
            <div v-if="commandExecuting">
              <v-icon name="spinner" />
            </div>
            <b-form-textarea
              v-if="callResponse.data"
              plaintext
              no-resize
              rows="15"
              :value="decodeAsciiResponse(callResponse.data)"
              class="mt-1"
            />
          </div>
        </div>
      </b-tab>
      <b-tab
        title="Global App Management"
        disabled
      />
      <b-tab
        title="Global Specifications"
        :active="global"
      >
        <h2 class="mt-2">
          Global Specifications
        </h2>
        <div
          v-if="callBResponse.data"
          style="text-align: left"
        >
          <b-card class="mx-2">
            <list-entry
              title="Description"
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
              <list-entry
                title="Contacts"
                :data="callBResponse.data.contacts.toString() || 'none'"
              />
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
              title="Period"
              :data="getExpireLabel || (callBResponse.data.expire ? callBResponse.data.expire + ' blocks' : '1 month')"
            />
            <h4>Composition</h4>
            <b-card v-if="callBResponse.data.version <= 3">
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
                  :data="callBResponse.data.cpubasic + ' vCore'"
                />
                <list-entry
                  title="CPU Nimbus"
                  :data="callBResponse.data.cpusuper + ' vCore'"
                />
                <list-entry
                  title="CPU Stratus"
                  :data="callBResponse.data.cpubamf + ' vCore'"
                />
                <list-entry
                  title="RAM Cumulus"
                  :data="callBResponse.data.rambasic + ' MB'"
                />
                <list-entry
                  title="RAM Nimbus"
                  :data="callBResponse.data.ramsuper + ' MB'"
                />
                <list-entry
                  title="RAM Stratus"
                  :data="callBResponse.data.rambamf + ' MB'"
                />
                <list-entry
                  title="SSD Cumulus"
                  :data="callBResponse.data.hddbasic + ' GB'"
                />
                <list-entry
                  title="SSD Nimbus"
                  :data="callBResponse.data.hddsuper + ' GB'"
                />
                <list-entry
                  title="SSD Stratus"
                  :data="callBResponse.data.hddbamf + ' GB'"
                />
              </div>
              <div v-else>
                <list-entry
                  title="CPU"
                  :data="callBResponse.data.cpu + ' vCore'"
                />
                <list-entry
                  title="RAM"
                  :data="callBResponse.data.ram + ' MB'"
                />
                <list-entry
                  title="SSD"
                  :data="callBResponse.data.hdd + ' GB'"
                />
              </div>
            </b-card>
            <b-card
              v-for="(component, index) in callBResponse.data.compose"
              v-else
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
          </b-card>
        </div>
        <div v-else-if="callBResponse.status === 'error'">
          Global specifications not found!
        </div>
        <div v-else>
          Global Specifications loading...
        </div>
      </b-tab>
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
                  {{ isAppOwner ? 'Redeployes all instances of your application. Hard redeploy removes persistant data storage.' : 'Redeployes instances of selected application running on all of your nodes. Hard redeploy removes persistant data storage.' }}
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
              class="app-instances-table"
              striped
              hover
              responsive
              :per-page="instances.perPage"
              :current-page="instances.currentPage"
              :items="instances.data"
              :fields="instances.fields"
              :sort-by.sync="instances.sortBy"
              :sort-desc.sync="instances.sortDesc"
              :sort-direction="instances.sortDirection"
              :filter="instances.filter"
              :filter-included-fields="instances.filterOn"
              show-empty
              :empty-text="`No instances of ${appName}`"
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
                <b-card class="mx-2">
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
                <b-button
                  size="sm"
                  class="mr-1"
                  variant="danger"
                  @click="openApp(locationRow.item.name, locationRow.item.ip.split(':')[0], getProperPort())"
                >
                  Visit App
                </b-button>
                <b-button
                  size="sm"
                  class="mr-0"
                  variant="danger"
                  @click="openNodeFluxOS(locationRow.item.ip.split(':')[0], locationRow.item.ip.split(':')[1] ? +locationRow.item.ip.split(':')[1] - 1 : 16126)"
                >
                  Visit FluxNode
                </b-button>
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
            <span class="table-total">Total: {{ instances.totalRows }}</span>
          </b-col>
        </b-row>
      </b-tab>
      <b-tab
        title="Update Specifications"
        :disabled="!isAppOwner"
      >
        <div
          v-if="!fluxCommunication"
          class="text-danger"
        >
          Warning: Connected Flux is not communicating properly with Flux network
        </div>
        <h2 class="mb-2">
          Update Application Specifications
        </h2>

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
                <div v-if="appUpdateSpecification.version >= 5">
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
                <div v-if="appUpdateSpecification.version >= 5">
                  <h4>Allowed Geolocation</h4>
                  <div
                    v-for="n in numberOfGeolocations"
                    :key="n + 'pos'"
                  >
                    <b-form-group
                      label-cols="3"
                      label-cols-lg="1"
                      :label="'Continent - ' + n"
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
                            -- Select to restrict Continent  --
                          </b-form-select-option>
                        </template>
                      </b-form-select>
                    </b-form-group>
                    <b-form-group
                      v-if="allowedGeolocations[`selectedContinent${n}`] && allowedGeolocations[`selectedContinent${n}`] !== 'ALL'"
                      label-cols="3"
                      label-cols-lg="1"
                      :label="'Country - ' + n"
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
                      :label="'Region - ' + n"
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
                    :key="n + 'posB'"
                  >
                    <b-form-group
                      label-cols="3"
                      label-cols-lg="1"
                      :label="'Continent - ' + n"
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
                            -- Select to ban Continent  --
                          </b-form-select-option>
                        </template>
                      </b-form-select>
                    </b-form-group>
                    <b-form-group
                      v-if="forbiddenGeolocations[`selectedContinent${n}`] && forbiddenGeolocations[`selectedContinent${n}`] !== 'NONE'"
                      label-cols="3"
                      label-cols-lg="1"
                      :label="'Country - ' + n"
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
                      :label="'Region - ' + n"
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
                    :min="minInstances"
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
                    {{ getExpireLabel || (appUpdateSpecification.expire ? appUpdateSpecification.expire + ' blocks' : '1 month') }}
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
                        v-b-tooltip.hover.top="'Docker Hub image namespace/repository:tag for component'"
                        name="info-circle"
                        class="mr-1"
                      />
                    </label>
                    <div class="col">
                      <b-form-input
                        :id="`repo-${component.name}_${appUpdateSpecification.name}`"
                        v-model="component.repotag"
                        placeholder="Docker Hub namespace/repository:tag"
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
                        v-b-tooltip.hover.top="'Data folder that is shared by application to App volume. Prepend with s: for synced data between instances. Eg. s:/data'"
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
                      max="840"
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
                    max="840"
                    step="1"
                  />
                </b-card>
              </b-col>
            </b-row>
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
                    placeholder="Docker Hub namespace/repository:tag"
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
                    :min="minInstances"
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
                    {{ getExpireLabel || (appUpdateSpecification.expire ? appUpdateSpecification.expire + ' blocks' : '1 month') }}
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
                      v-b-tooltip.hover.top="'Data folder that is shared by application to App volume. Prepend with s: for synced data between instances. Eg. s:/data'"
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
                    max="840"
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
                  max="840"
                  step="1"
                />
              </b-card>
            </b-col>
          </b-row>
        </div>
        <div class="flex">
          <b-form-checkbox
            id="tos"
            v-model="tosAgreed"
            switch
            class="custom-control-primary inline"
          /> I agree with
          <a
            href="https://cdn.runonflux.io/Flux_Terms_of_Service.pdf"
            target="_blank"
          >
            Terms of Service
          </a>
          <br><br>
        </div>
        <div>
          <b-button
            v-ripple.400="'rgba(255, 255, 255, 0.15)'"
            variant="success"
            aria-label="Compute Update Message"
            class="mb-2"
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
            <b-form-textarea
              id="updatemessage"
              v-model="dataToSign"
              rows="6"
              readonly
            />
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
                <h4>
                  Note: Data has to be signed by the last application owner
                </h4>
                <b-card-text>
                  Price: {{ appPricePerSpecs }} FLUX
                </b-card-text>
                <b-button
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="success"
                  aria-label="Update Flux App"
                  class="my-1"
                  @click="update"
                >
                  Update Flux App
                </b-button>
              </b-card>
            </b-col>
            <b-col
              xs="6"
              lg="4"
            >
              <b-card title="Sign with Zelcore">
                <a
                  :href="'zel:?action=sign&message=' + dataToSign + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=' + callbackValue"
                  @click="initiateSignWSUpdate"
                >
                  <img
                    class="zelidLogin"
                    src="@/assets/images/zelID.svg"
                    alt="Zel ID"
                    height="100%"
                    width="100%"
                  >
                </a>
              </b-card>
            </b-col>
          </b-row>
          <b-row
            v-if="updateHash"
            class="match-height"
          >
            <b-col
              xs="6"
              lg="8"
            >
              <b-card>
                <b-card-text>
                  To finish the application update, please make a transaction of {{ appPricePerSpecs }} FLUX to address
                  '{{ deploymentAddress }}'
                  with the following message:
                  '{{ updateHash }}'
                </b-card-text>
                <br>
                The transaction must be mined by {{ new Date(validTill).toLocaleString('en-GB', timeoptions.shortDate) }}
                <br><br>
                The application will be subscribed until {{ new Date(subscribedTill).toLocaleString('en-GB', timeoptions.shortDate) }}
              </b-card>
            </b-col>
            <b-col
              xs="6"
              lg="4"
            >
              <b-card title="Pay with Zelcore">
                <a :href="'zel:?action=pay&coin=zelcash&address=' + deploymentAddress + '&amount=' + appPricePerSpecs + '&message=' + updateHash + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png'">
                  <img
                    class="zelidLogin"
                    src="@/assets/images/zelID.svg"
                    alt="Zel ID"
                    height="100%"
                    width="100%"
                  >
                </a>
              </b-card>
            </b-col>
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
      >
        Terms of Service
      </a>
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
  BCardText,
  BCardTitle,
  BRow,
  BButton,
  BFormTextarea,
  BFormGroup,
  BFormInput,
  BFormCheckbox,
  BFormSelect,
  BFormSelectOption,
  BInputGroup,
  BInputGroupAppend,
  BPagination,
  VBTooltip,
} from 'bootstrap-vue';

import VueApexCharts from 'vue-apexcharts';
import Ripple from 'vue-ripple-directive';
import { mapState } from 'vuex';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';
import ListEntry from '@/views/components/ListEntry.vue';

import AppsService from '@/services/AppsService';
import DaemonService from '@/services/DaemonService';

const axios = require('axios');
const qs = require('qs');
const store = require('store');
const timeoptions = require('@/libs/dateFormat');

const geolocations = require('../../libs/geolocation');

export default {
  components: {
    BTabs,
    BTab,
    BTable,
    BCol,
    BCard,
    BCardText,
    BCardTitle,
    BRow,
    BButton,
    BFormTextarea,
    BFormGroup,
    BFormInput,
    BFormCheckbox,
    BFormSelect,
    BFormSelectOption,
    BInputGroup,
    BInputGroupAppend,
    BPagination,
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
      timeoptions,
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
        data: '',
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
          { key: 'name', label: 'Name', sortable: true },
          { key: 'ip', label: 'IP Address', sortable: true },
          { key: 'hash', label: 'Hash', sortable: true },
          { key: 'visit', label: 'Visit' },
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
      total: '',
      downloaded: '',
      abortToken: {},
      deploymentAddress: '',
      appPricePerSpecs: 0,
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
      expirePosition: 2,
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
    };
  },
  computed: {
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
    originalInstances() {
      try {
        if (this.appUpdateSpecification.name && this.marketPlaceApps.length) {
          const marketPlaceApp = this.marketPlaceApps.find((app) => this.appUpdateSpecification.name.toLowerCase().startsWith(app.name.toLowerCase()));
          if (marketPlaceApp && marketPlaceApp.instances) {
            return marketPlaceApp.instances;
          }
        }
        return this.minInstances;
      } catch (error) {
        console.log(error);
        return this.minInstances;
      }
    },
    priceMultiplier() {
      try {
        if (this.appUpdateSpecification.name && this.marketPlaceApps.length) {
          const marketPlaceApp = this.marketPlaceApps.find((app) => this.appUpdateSpecification.name.toLowerCase().startsWith(app.name.toLowerCase()));
          if (marketPlaceApp) {
            if (marketPlaceApp.multiplier > 1) {
              return marketPlaceApp.multiplier;
            }
          }
        }
        return 1;
      } catch (error) {
        console.log(error);
        return 1;
      }
    },
    callbackValue() {
      const { protocol, hostname, port } = window.location;
      let mybackend = '';
      mybackend += protocol;
      mybackend += '//';
      const regex = /[A-Za-z]/g;
      if (hostname.match(regex)) {
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
          const expTime = this.timestamp + timeFound.time;
          return expTime;
        }
        const blocks = this.appUpdateSpecification.expire;
        const blockTime = 2 * 60 * 1000;
        const validTime = blocks * blockTime;
        const expTime = this.timestamp + validTime;
        return expTime;
      }
      const expTime = this.timestamp + 30 * 24 * 60 * 60 * 1000; // 1 month
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
    applicationManagementAndStatus() {
      console.log(this.getAllAppsResponse);
      const foundAppInfo = this.getAllAppsResponse.data.find((app) => app.Names[0] === this.getAppDockerNameIdentifier()) || {};
      const appInfo = {
        name: this.appName,
        state: foundAppInfo.State || 'Unknown state',
        status: foundAppInfo.Status || 'Unknown status',
      };
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
            appInfoComponent.state = appInfoComponent.state.charAt(0).toUpperCase() + appInfoComponent.state.slice(1);
            appInfoComponent.status = appInfoComponent.status.charAt(0).toUpperCase() + appInfoComponent.status.slice(1);
            const niceStringComponent = ` ${appInfoComponent.name} - ${appInfoComponent.state} - ${appInfoComponent.status},`;
            niceString += niceStringComponent;
          }
          niceString = niceString.substring(0, niceString.length - 1);
        }
      }
      return niceString;
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
  },
  watch: {
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
  },
  mounted() {
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
    this.appsGetListAllApps();
    if (!global) {
      this.getInstalledApplicationSpecifics();
    }
    this.appsDeploymentInformation();
    this.getGeolocationData();
    this.getMarketPlace();
  },
  methods: {
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
    async appsDeploymentInformation() {
      const response = await AppsService.appsDeploymentInformation();
      const { data } = response.data;
      if (response.data.status === 'success') {
        this.deploymentAddress = data.address;
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
    },
    updateManagementTab(index) {
      this.callResponse.data = '';
      this.callResponse.status = '';
      // do not reset global application specifics obtained
      this.appExec.cmd = '';
      this.appExec.env = '';
      this.output = '';
      switch (index) {
        case 1:
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
        case 12:
          this.getGlobalApplicationSpecifics();
          break;
        case 13:
          this.getZelidAuthority();
          break;
        case 14:
          this.getApplicationLocations();
          break;
        case 15:
          this.getGlobalApplicationSpecifics();
          break;
        default:
          break;
      }
    },
    async appsGetListAllApps() {
      const response = await AppsService.listAllApps();
      console.log(response);
      this.getAllAppsResponse.status = response.data.status;
      this.getAllAppsResponse.data = response.data.data;
    },
    goBackToApps() {
      this.$emit('back');
    },
    initiateSignWSUpdate() {
      const self = this;
      const { protocol, hostname, port } = window.location;
      let mybackend = '';
      mybackend += protocol;
      mybackend += '//';
      const regex = /[A-Za-z]/g;
      if (hostname.match(regex)) {
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
      const response = await AppsService.getInstalledAppSpecifics(this.appName);
      console.log(response);
      if (response.data.status === 'error' || !response.data.data[0]) {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data[0];
        this.appSpecification = response.data.data[0];
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
          this.maxInstances = this.originalInstances;
          this.minInstances = this.originalInstances;
          this.appUpdateSpecification.instances = this.originalInstances;
        }
        if (this.appUpdateSpecification.version <= 3) {
          this.appUpdateSpecification.version = 3; // enforce specs version 3
          this.appUpdateSpecification.ports = specs.port || this.ensureString(specs.ports); // v1 compatibility
          this.appUpdateSpecification.domains = this.ensureString(specs.domains);
          this.appUpdateSpecification.enviromentParameters = this.ensureString(specs.enviromentParameters);
          this.appUpdateSpecification.commands = this.ensureString(specs.commands);
          this.appUpdateSpecification.containerPorts = specs.containerPort || this.ensureString(specs.containerPorts); // v1 compatibility
        } else {
          if (this.appUpdateSpecification.version <= 6) {
            this.appUpdateSpecification.version = 6;
          }
          this.appUpdateSpecification.contacts = this.ensureString([]);
          this.appUpdateSpecification.geolocation = this.ensureString([]);
          if (this.appUpdateSpecification.version >= 5) {
            this.appUpdateSpecification.contacts = this.ensureString(specs.contacts || []);
            this.decodeGeolocation(specs.geolocation);
            this.appUpdateSpecification.geolocation = this.ensureString(specs.geolocation || []);
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
          });
          if (this.appUpdateSpecification.version >= 6) {
            this.appUpdateSpecification.expire = this.ensureNumber(specs.expire || 22000);
            this.expirePosition = this.getExpirePosition(this.appUpdateSpecification.expire);
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
        if (appSpecification.version >= 5) {
          appSpecification.geolocation = this.generateGeolocations();
        }
        if (appSpecification.version >= 6) {
          appSpecification.expire = this.convertExpire();
        }
        // call api for verification of app registration specifications that returns formatted specs
        const responseAppSpecs = await AppsService.appUpdateVerification(appSpecification);
        if (responseAppSpecs.data.status === 'error') {
          throw new Error(responseAppSpecs.data.data.message || responseAppSpecs.data.data);
        }
        const appSpecFormatted = responseAppSpecs.data.data;
        const response = await AppsService.appPrice(appSpecFormatted);
        this.appPricePerSpecs = 0;
        if (response.data.status === 'error') {
          throw new Error(response.data.data.message || response.data.data);
        }
        this.appPricePerSpecs = (Math.ceil(((+response.data.data * this.priceMultiplier) * 100))) / 100;
        this.timestamp = new Date().getTime();
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
        const zelidauth = localStorage.getItem('zelidauth');
        if (!this.appExec.cmd) {
          this.showToast('danger', 'No commands specified');
          return;
        }
        const env = this.appExec.env ? this.appExec.env : '[]';
        const { cmd } = this.appExec;
        this.commandExecuting = true;
        console.log('here');
        const response = await AppsService.getAppExec(zelidauth, name, cmd, env);
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
            this.callResponse.data.push({
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

    cancelDownload() {
      this.abortToken.cancel('User download cancelled');
      this.downloaded = '';
      this.total = '';
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
      const zelidauth = localStorage.getItem('zelidauth');
      const callData = [];
      if (this.appSpecification.version >= 4) {
        // compose
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          // eslint-disable-next-line no-await-in-loop
          const response = await AppsService.getAppInspect(zelidauth, `${component.name}_${this.appSpecification.name}`);
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
        const response = await AppsService.getAppInspect(zelidauth, this.appName);
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
    async getApplicationStats() {
      const zelidauth = localStorage.getItem('zelidauth');
      const callData = [];
      if (this.appSpecification.version >= 4) {
        // compose
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          // eslint-disable-next-line no-await-in-loop
          const response = await AppsService.getAppStats(zelidauth, `${component.name}_${this.appSpecification.name}`);
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
        const response = await AppsService.getAppStats(zelidauth, this.appName);
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
    async getApplicationMonitoring() {
      const zelidauth = localStorage.getItem('zelidauth');
      const callData = [];
      if (this.appSpecification.version >= 4) {
        // compose
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          // eslint-disable-next-line no-await-in-loop
          const response = await AppsService.getAppMonitoring(zelidauth, `${component.name}_${this.appSpecification.name}`);
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
        const response = await AppsService.getAppMonitoring(zelidauth, this.appName);
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
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.stopAppMonitoring(zelidauth, appName, deleteData);
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
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.startAppMonitoring(zelidauth, appName);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      console.log(response);
    },
    async getApplicationChanges() {
      const zelidauth = localStorage.getItem('zelidauth');
      const callData = [];
      if (this.appSpecification.version >= 4) {
        // compose
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          // eslint-disable-next-line no-await-in-loop
          const response = await AppsService.getAppChanges(zelidauth, `${component.name}_${this.appSpecification.name}`);
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
        const response = await AppsService.getAppChanges(zelidauth, this.appName);
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
    async getApplicationProcesses() {
      const zelidauth = localStorage.getItem('zelidauth');
      const callData = [];
      if (this.appSpecification.version >= 4) {
        // compose
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          // eslint-disable-next-line no-await-in-loop
          const response = await AppsService.getAppTop(zelidauth, `${component.name}_${this.appSpecification.name}`);
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
        const response = await AppsService.getAppTop(zelidauth, this.appName);
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
    async getApplicationLogs() {
      const zelidauth = localStorage.getItem('zelidauth');
      const callData = [];
      if (this.appSpecification.version >= 4) {
        // compose
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          // eslint-disable-next-line no-await-in-loop
          const response = await AppsService.getAppLogsTail(zelidauth, `${component.name}_${this.appSpecification.name}`);
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
        const response = await AppsService.getAppLogsTail(zelidauth, this.appName);
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
    async getApplicationLocations() {
      const response = await AppsService.getAppLocation(this.appName);
      console.log(response);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.instances.data = response.data.data;
        this.instances.totalRows = this.instances.data.length;
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
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.stopApp(zelidauth, app);
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
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.startApp(zelidauth, app);
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
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.restartApp(zelidauth, app);
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
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.pauseApp(zelidauth, app);
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
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.unpauseApp(zelidauth, app);
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
          self.managedApplication = '';
        }, 5000);
      }
    },
    getZelidAuthority() {
      const zelidauth = localStorage.getItem('zelidauth');
      this.globalZelidAuthorized = false;
      const auth = qs.parse(zelidauth);
      const timestamp = new Date().getTime();
      const maxHours = 1.5 * 60 * 60 * 1000;
      const mesTime = auth.loginPhrase.substring(0, 13);
      if (+mesTime < (timestamp - maxHours)) {
        this.globalZelidAuthorized = false;
      } else {
        this.globalZelidAuthorized = true;
      }
    },
    async delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
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
      this.executeCommand(app, 'appremove', `Reinstalling ${app} globally. This will take a while...`);
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
          return ports[j];
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
        this.maxInstances = this.originalInstances;
        this.minInstances = this.originalInstances;
        this.appUpdateSpecification.instances = this.originalInstances;
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
        this.maxInstances = this.originalInstances;
        this.minInstances = this.originalInstances;
        this.appUpdateSpecification.instances = this.originalInstances;
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
        const block = `${(entry.data.blkio_stats.io_service_bytes_recursive.find((x) => x.op === 'Read').value / 1e9).toFixed(2)} / ${(entry.data.blkio_stats.io_service_bytes_recursive.find((x) => x.op === 'Write').value / 1e9).toFixed(2)} GB`;
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
        const response = await axios.get('https://stats.runonflux.io/fluxinfo?projection=geolocation');
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
        this.maxInstances = this.originalInstances;
        this.minInstances = this.originalInstances;
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
  },
};
</script>

<style>
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
.zelidLogin {
  height: 100px;
}
.zelidLogin img {
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
