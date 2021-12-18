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
              :number="callResponse.data.height + 22000"
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
                  :data="constructAutomaticDomains"
                />
                <list-entry
                  title="Ports"
                  :data="callResponse.data.ports.toString()"
                />
                <list-entry
                  title="Container Ports"
                  :data="callResponse.data.containerPorts.toString()"
                />
                <list-entry
                  title="Container Data"
                  :data="callResponse.data.containerData"
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
                  :data="constructAutomaticDomains[index]"
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
              :number="callBResponse.data.height + 22000"
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
                  :data="constructAutomaticDomainsGlobal"
                />
                <list-entry
                  title="Ports"
                  :data="callBResponse.data.ports.toString()"
                />
                <list-entry
                  title="Container Ports"
                  :data="callBResponse.data.containerPorts.toString()"
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
                  :data="constructAutomaticDomainsGlobal[index]"
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
                  @confirm="stopAll(appName)"
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
        </b-row>
        <b-row class="match-height">
          <b-col xs="6">
            <b-card title="Redeploy">
              <b-card-text class="mb-2">
                The Pause command suspends all processes in the specified App.
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
                    @confirm="stopAll(`${component.name}_${appSpecification.name}`)"
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
              @click="appExecute"
            >
              Execute Commands
            </b-button>
            <div v-if="commandExecuting">
              <v-icon name="spinner" />
            </div>
            <b-form-textarea
              v-if="callResponse.data && callResponse.data[0]"
              plaintext
              no-resize
              rows="15"
              :value="decodeAsciiResponse(callResponse.data[0].data)"
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
              :number="callBResponse.data.height + 22000"
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
                :data="constructAutomaticDomainsGlobal"
              />
              <list-entry
                title="Ports"
                :data="callBResponse.data.ports.toString()"
              />
              <list-entry
                title="Container Ports"
                :data="callBResponse.data.containerPorts.toString()"
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
                :data="constructAutomaticDomainsGlobal[index]"
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
          </b-card>
        </div>
        <div v-else-if="callBResponse.status === 'error'">
          Global specifications not found!
        </div>
        <div v-else>
          Global Specifications loading...
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
              <template #cell(visit)="row">
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
      <b-tab title="Update Specifications">
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
                  </div>
                  <div class="form-row form-group">
                    <label class="col-3 col-form-label">
                      Cont. Data
                      <v-icon
                        v-b-tooltip.hover.top="'Data folder that is shared by application to App volume'"
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
                      max="7"
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
                      max="28000"
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
                      max="565"
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
                    max="1"
                    step="0.1"
                  />
                  <div>
                    RAM: {{ component.rambasic }}
                  </div>
                  <b-form-input
                    v-model="component.rambasic"
                    type="range"
                    min="100"
                    max="1000"
                    step="100"
                  />
                  <div>
                    SSD: {{ component.hddbasic }}
                  </div>
                  <b-form-input
                    v-model="component.hddbasic"
                    type="range"
                    min="1"
                    max="15"
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
                    max="3"
                    step="0.1"
                  />
                  <div>
                    RAM: {{ component.ramsuper }}
                  </div>
                  <b-form-input
                    v-model="component.ramsuper"
                    type="range"
                    min="100"
                    max="5000"
                    step="100"
                  />
                  <div>
                    SSD: {{ component.hddsuper }}
                  </div>
                  <b-form-input
                    v-model="component.hddsuper"
                    type="range"
                    min="1"
                    max="115"
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
                    max="7"
                    step="0.1"
                  />
                  <div>
                    RAM: {{ component.rambamf }}
                  </div>
                  <b-form-input
                    v-model="component.rambamf"
                    type="range"
                    min="100"
                    max="28000"
                    step="100"
                  />
                  <div>
                    SSD: {{ component.hddbamf }}
                  </div>
                  <b-form-input
                    v-model="component.hddbamf"
                    type="range"
                    min="1"
                    max="565"
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
                      v-b-tooltip.hover.top="'Data folder that is shared by application to App volume'"
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
                  Resources &nbsp;&nbsp;&nbsp;<h6 class="inline text-small">
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
                    max="100"
                    step="1"
                  />
                </b-form-group>
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
                    max="7"
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
                    max="28000"
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
                    max="565"
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
                  max="1"
                  step="0.1"
                />
                <div>
                  RAM: {{ appUpdateSpecification.rambasic }}
                </div>
                <b-form-input
                  v-model="appUpdateSpecification.rambasic"
                  type="range"
                  min="100"
                  max="1000"
                  step="100"
                />
                <div>
                  SSD: {{ appUpdateSpecification.hddbasic }}
                </div>
                <b-form-input
                  v-model="appUpdateSpecification.hddbasic"
                  type="range"
                  min="1"
                  max="15"
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
                  max="3"
                  step="0.1"
                />
                <div>
                  RAM: {{ appUpdateSpecification.ramsuper }}
                </div>
                <b-form-input
                  v-model="appUpdateSpecification.ramsuper"
                  type="range"
                  min="100"
                  max="5000"
                  step="100"
                />
                <div>
                  SSD: {{ appUpdateSpecification.hddsuper }}
                </div>
                <b-form-input
                  v-model="appUpdateSpecification.hddsuper"
                  type="range"
                  min="1"
                  max="115"
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
                  max="7"
                  step="0.1"
                />
                <div>
                  RAM: {{ appUpdateSpecification.rambamf }}
                </div>
                <b-form-input
                  v-model="appUpdateSpecification.rambamf"
                  type="range"
                  min="100"
                  max="28000"
                  step="100"
                />
                <div>
                  SSD: {{ appUpdateSpecification.hddbamf }}
                </div>
                <b-form-input
                  v-model="appUpdateSpecification.hddbamf"
                  type="range"
                  min="1"
                  max="565"
                  step="1"
                />
              </b-card>
            </b-col>
          </b-row>
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
                  Price per Month: {{ appPricePerMonthForUpdate }} FLUX
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
                  To finish the application update, please make a transaction of {{ appPricePerMonthForUpdate }} FLUX to address
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
                <a :href="'zel:?action=pay&coin=zelcash&address=' + deploymentAddress + '&amount=' + appPricePerMonthForUpdate + '&message=' + updateHash + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png'">
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
  BInputGroup,
  BInputGroupAppend,
  BPagination,
  VBTooltip,
} from 'bootstrap-vue';

import Ripple from 'vue-ripple-directive';
import { mapState } from 'vuex';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';
import ListEntry from '@/views/components/ListEntry.vue';

import AppsService from '@/services/AppsService';
import DaemonService from '@/services/DaemonService';

const qs = require('qs');
const store = require('store');
const timeoptions = require('@/libs/dateFormat');

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
    BInputGroup,
    BInputGroupAppend,
    BPagination,
    ConfirmDialog,
    ListEntry,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
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
      appPricePerMonthForUpdate: 0,
    };
  },
  computed: {
    ...mapState('flux', [
      'config',
      'privilege',
    ]),
    callbackValue() {
      const { protocol, hostname } = window.location;
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
        mybackend += hostname;
        mybackend += ':';
        mybackend += this.config.apiPort;
      }
      const backendURL = store.get('backendURL') || mybackend;
      const url = `${backendURL}/id/providesign`;
      return encodeURI(url);
    },
    validTill() {
      const expTime = this.timestamp + 60 * 60 * 1000; // 1 hour
      return expTime;
    },
    subscribedTill() {
      const expTime = this.timestamp + 30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000; // 1 month
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
    constructAutomaticDomains() {
      const domainString = 'abcdefghijklmno'; // enough
      const appName = this.appSpecification.name;
      if (!appName) {
        return 'loading...';
      }
      const lowerCaseName = appName.toLowerCase();

      if (!this.appSpecification.compose) {
        const ports = JSON.parse(this.callBResponse.data.ports);
        const domains = [`${lowerCaseName}.app.runonflux.io`];
        // flux specs dont allow more than 10 ports so domainString is enough
        for (let i = 0; i < ports.length; i += 1) {
          const portDomain = `${domainString[i]}.${lowerCaseName}.app.runonflux.io`;
          domains.push(portDomain);
        }
        return JSON.stringify(domains);
      }
      const domains = [];
      this.appSpecification.compose.forEach((component) => {
        const componentName = component.name;
        const lowerCaseCopmonentName = componentName.toLowerCase();
        const domainsComponent = [`${lowerCaseName}.app.runonflux.io`, `${lowerCaseCopmonentName}.${lowerCaseName}.app.runonflux.io`];
        for (let i = 0; i < JSON.parse(component.ports).length; i += 1) {
          const portDomain = `${domainString[i]}.${lowerCaseCopmonentName}.${lowerCaseName}.app.runonflux.io`;
          domainsComponent.push(portDomain);
        }
        domains.push(JSON.stringify(domainsComponent));
      });
      return domains;
    },
    constructAutomaticDomainsGlobal() {
      const domainString = 'abcdefghijklmno'; // enough
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
        const ports = JSON.parse(this.callBResponse.data.ports);
        const domains = [`${lowerCaseName}.app.runonflux.io`];
        // flux specs dont allow more than 10 ports so domainString is enough
        for (let i = 0; i < ports.length; i += 1) {
          const portDomain = `${domainString[i]}.${lowerCaseName}.app.runonflux.io`;
          domains.push(portDomain);
        }
        return JSON.stringify(domains);
      }
      const domains = [];
      this.callBResponse.data.compose.forEach((component) => {
        const componentName = component.name;
        const lowerCaseCopmonentName = componentName.toLowerCase();
        const domainsComponent = [`${lowerCaseName}.app.runonflux.io`, `${lowerCaseCopmonentName}.${lowerCaseName}.app.runonflux.io`];
        for (let i = 0; i < JSON.parse(component.ports).length; i += 1) {
          const portDomain = `${domainString[i]}.${lowerCaseCopmonentName}.${lowerCaseName}.app.runonflux.io`;
          domainsComponent.push(portDomain);
        }
        domains.push(JSON.stringify(domainsComponent));
      });
      return domains;
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
  },
  mounted() {
    this.callBResponse.data = '';
    this.callBResponse.status = '';
    this.appSpecification = {};
    this.callResponse.data = '';
    this.callResponse.status = '';
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
  },
  methods: {
    async appsDeploymentInformation() {
      const response = await AppsService.appsRegInformation();
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
          this.getApplicationChanges();
          break;
        case 5:
          this.getApplicationProcesses();
          break;
        case 6:
          this.getApplicationLogs();
          break;
        case 10:
          this.getGlobalApplicationSpecifics();
          break;
        case 11:
          this.getApplicationLocations();
          break;
        case 12:
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
      const { protocol, hostname } = window.location;
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
        this.appUpdateSpecification = specs;
        this.appUpdateSpecification.instances = specs.instances || 3;
        if (this.appUpdateSpecification.version <= 3) {
          this.appUpdateSpecification.ports = specs.port || this.ensureString(specs.ports); // v1 compatibility
          this.appUpdateSpecification.domains = this.ensureString(specs.domains);
          this.appUpdateSpecification.enviromentParameters = this.ensureString(specs.enviromentParameters);
          this.appUpdateSpecification.commands = this.ensureString(specs.commands);
          this.appUpdateSpecification.containerPorts = specs.containerPort || this.ensureString(specs.containerPorts); // v1 compatibility
        } else {
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
        }
        if (this.appUpdateSpecification.version <= 3) { // fork height for spec v3
          this.appUpdateSpecification.version = 3; // enforce specs version 3
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

    async checkFluxUpdateSpecificationsAndFormatMessage() {
      try {
        const appSpecification = this.appUpdateSpecification;
        // call api for verification of app registration specifications that returns formatted specs
        const responseAppSpecs = await AppsService.appUpdateVerification(appSpecification);
        if (responseAppSpecs.data.status === 'error') {
          throw new Error(responseAppSpecs.data.data.message || responseAppSpecs.data.data);
        }
        const appSpecFormatted = responseAppSpecs.data.data;
        const response = await AppsService.appPrice(appSpecFormatted);
        this.appPricePerMonthForUpdate = 0;
        if (response.data.status === 'error') {
          throw new Error(response.data.data.message || response.data.data);
        }
        this.appPricePerMonthForUpdate = response.data.data;
        this.timestamp = new Date().getTime();
        this.dataForAppUpdate = appSpecFormatted;
        this.dataToSign = this.updatetype + this.version + JSON.stringify(appSpecFormatted) + this.timestamp;
      } catch (error) {
        console.log(error.message);
        console.error(error);
        this.showToast('danger', error.message || error);
      }
    },

    async appExecute(name = this.appName) {
      try {
        const zelidauth = localStorage.getItem('zelidauth');
        if (!this.appExec.cmd) {
          this.showToast('danger', 'No commands specified');
          return;
        }
        const env = this.appExec.env ? this.appExec.env : '[]';
        const { cmd } = this.appExec;
        this.commandExecuting = true;
        const response = await AppsService.getAppExec(zelidauth, name, cmd, env);
        console.log(response);
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
        console.log(this.callResponse);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
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

    async stopAll(app) {
      this.output = '';
      this.showToast('warning', `Stopping ${app}`);
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.stopAll(zelidauth, app);
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
        } else {
          this.showToast('success', this.output[this.output.length - 1].status);
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
        } else {
          this.showToast('success', this.output[this.output.length - 1].status);
        }
        setTimeout(() => {
          self.managedApplication = '';
        }, 5000);
      }
    },
    openApp(name, _ip, _port) {
      console.log(name, _ip, _port);
      if ((_port && _ip)) {
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
</style>
