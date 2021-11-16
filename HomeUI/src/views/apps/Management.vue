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
          <list-entry
            title="Name"
            :data="callResponse.data.name"
            classes="mb-0"
          />
          <list-entry
            title="Description"
            :data="callResponse.data.description"
            classes="mb-0"
          />
          <list-entry
            v-if="callResponse.data.domains"
            title="Domains"
            :data="callResponse.data.domains.toString()"
            classes="mb-0"
          />
          <list-entry
            title="Specifications Hash"
            :data="callResponse.data.hash"
            classes="mb-0"
          />
          <list-entry
            title="Repository"
            :data="callResponse.data.repotag"
            classes="mb-0"
          />
          <list-entry
            title="Owner"
            :data="callResponse.data.owner"
            classes="mb-0"
          />
          <list-entry
            title="Registered on Blockheight"
            :number="callResponse.data.height"
            classes="mb-0"
          />
          <list-entry
            v-if="callResponse.data.hash && callResponse.data.hash.length === 64"
            title="Expires on Blockheight"
            :number="callResponse.data.height + 22000"
            classes="mb-0"
          />
          <list-entry
            title="Specifications version"
            :number="callResponse.data.version"
            classes="mb-0"
          />
          <list-entry
            v-if="callResponse.data.port || callResponse.data.ports"
            title="Public Ports"
            :data="(callResponse.data.port || callResponse.data.ports).toString()"
            classes="mb-0"
          />
          <list-entry
            v-if="callResponse.data.containerPort || callResponse.data.containerPorts"
            title="Forwarded Ports"
            :data="(callResponse.data.containerPort || callResponse.data.containerPorts).toString()"
            classes="mb-0"
          />
          <list-entry
            title="Application Data"
            :data="callResponse.data.containerData"
            classes="mb-0"
          />
          <list-entry
            v-if="callResponse.data.enviromentParameters"
            title="Application Enviroment"
            :data="callResponse.data.enviromentParameters.toString()"
            classes="mb-0"
          />
          <list-entry
            v-if="callResponse.data.commands"
            title="Application Commands"
            :data="callResponse.data.commands.toString()"
            classes="mb-0"
          />
          <list-entry
            v-if="callResponse.data.instances"
            title="Number of Instances"
            :data="callResponse.data.instances.toString()"
            classes="mb-0"
          />
          <list-entry
            v-if="callResponse.data.tiered"
            title="Tiered Specifications"
            :data="callResponse.data.tiered.toString()"
            classes="mb-0"
          />
          <div v-if="callResponse.data.tiered">
            <list-entry
              title=" - Stratus CPU"
              :data="`${callResponse.data.cpubamf} Cores`"
              classes="mb-0"
            />
            <list-entry
              title=" - Stratus RAM"
              :data="`${callResponse.data.rambamf} MB`"
              classes="mb-0"
            />
            <list-entry
              title=" - Stratus SSD"
              :data="`${callResponse.data.hddbamf} GB`"
              classes="mb-0"
            />
            <list-entry
              title=" - Nimbus CPU"
              :data="`${callResponse.data.cpusuper} Cores`"
              classes="mb-0"
            />
            <list-entry
              title=" - Nimbus RAM"
              :data="`${callResponse.data.ramsuper} MB`"
              classes="mb-0"
            />
            <list-entry
              title=" - Nimbus SSD"
              :data="`${callResponse.data.hddsuper} GB`"
              classes="mb-0"
            />
            <list-entry
              title=" - Cumulus CPU"
              :data="`${callResponse.data.cpubasic} Cores`"
              classes="mb-0"
            />
            <list-entry
              title=" - Cumulus RAM"
              :data="`${callResponse.data.rambasic} MB`"
              classes="mb-0"
            />
            <list-entry
              title=" - Cumulus SSD"
              :data="`${callResponse.data.hddbasic} GB`"
              classes="mb-0"
            />
          </div>
          <div v-else>
            <list-entry
              title="CPU"
              :data="`${callResponse.data.cpu} Cores`"
              classes="mb-0"
            />
            <list-entry
              title="RAM"
              :data="`${callResponse.data.ram} MB`"
              classes="mb-0"
            />
            <list-entry
              title="SSD"
              :data="`${callResponse.data.hdd} GB`"
              classes="mb-0"
            />
          </div>
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
          <list-entry
            title="Name"
            :data="callBResponse.data.name"
            classes="mb-0"
          />
          <list-entry
            title="Description"
            :data="callBResponse.data.description"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.domains"
            title="Domains"
            :data="callBResponse.data.domains.toString()"
            classes="mb-0"
          />
          <list-entry
            title="Specifications Hash"
            :data="callBResponse.data.hash"
            classes="mb-0"
          />
          <list-entry
            title="Repository"
            :data="callBResponse.data.repotag"
            classes="mb-0"
          />
          <list-entry
            title="Owner"
            :data="callBResponse.data.owner"
            classes="mb-0"
          />
          <list-entry
            title="Registered on Blockheight"
            :number="callBResponse.data.height"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.hash && callBResponse.data.hash.length === 64"
            title="Expires on Blockheight"
            :number="callBResponse.data.height + 22000"
            classes="mb-0"
          />
          <list-entry
            title="Specifications version"
            :number="callBResponse.data.version"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.port || callBResponse.data.ports"
            title="Public Ports"
            :data="(callBResponse.data.port || callBResponse.data.ports).toString()"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.containerPort || callBResponse.data.containerPorts"
            title="Forwarded Ports"
            :data="(callBResponse.data.containerPort || callBResponse.data.containerPorts).toString()"
            classes="mb-0"
          />
          <list-entry
            title="Application Data"
            :data="callBResponse.data.containerData"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.enviromentParameters"
            title="Application Enviroment"
            :data="callBResponse.data.enviromentParameters.toString()"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.commands"
            title="Application Commands"
            :data="callBResponse.data.commands.toString()"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.instances"
            title="Number of Instances"
            :data="callBResponse.data.instances.toString()"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.tiered"
            title="Tiered Specifications"
            :data="callBResponse.data.tiered.toString()"
            classes="mb-0"
          />
          <div v-if="callBResponse.data.tiered">
            <list-entry
              title=" - Stratus CPU"
              :data="`${callBResponse.data.cpubamf} Cores`"
              classes="mb-0"
            />
            <list-entry
              title=" - Stratus RAM"
              :data="`${callBResponse.data.rambamf} MB`"
              classes="mb-0"
            />
            <list-entry
              title=" - Stratus SSD"
              :data="`${callBResponse.data.hddbamf} GB`"
              classes="mb-0"
            />
            <list-entry
              title=" - Nimbus CPU"
              :data="`${callBResponse.data.cpusuper} Cores`"
              classes="mb-0"
            />
            <list-entry
              title=" - Nimbus RAM"
              :data="`${callBResponse.data.ramsuper} MB`"
              classes="mb-0"
            />
            <list-entry
              title=" - Nimbus SSD"
              :data="`${callBResponse.data.hddsuper} GB`"
              classes="mb-0"
            />
            <list-entry
              title=" - Cumulus CPU"
              :data="`${callBResponse.data.cpubasic} Cores`"
              classes="mb-0"
            />
            <list-entry
              title=" - Cumulus RAM"
              :data="`${callBResponse.data.rambasic} MB`"
              classes="mb-0"
            />
            <list-entry
              title=" - Cumulus SSD"
              :data="`${callBResponse.data.hddbasic} GB`"
              classes="mb-0"
            />
          </div>
          <div v-else>
            <list-entry
              title="CPU"
              :data="`${callBResponse.data.cpu} Cores`"
              classes="mb-0"
            />
            <list-entry
              title="RAM"
              :data="`${callBResponse.data.ram} MB`"
              classes="mb-0"
            />
            <list-entry
              title="SSD"
              :data="`${callBResponse.data.hdd} GB`"
              classes="mb-0"
            />
          </div>
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
        <b-form-textarea
          v-if="callResponse.data"
          plaintext
          no-resize
          rows="30"
          :value="JSON.stringify(callResponse.data, null, 4)"
        />
      </b-tab>
      <b-tab
        title="Resources"
        :disabled="!isApplicationInstalledLocally"
      >
        <b-form-textarea
          v-if="callResponse.data"
          plaintext
          no-resize
          rows="30"
          :value="stringifiedResponse"
        />
      </b-tab>
      <b-tab
        title="File Changes"
        :disabled="!isApplicationInstalledLocally"
      >
        <b-form-textarea
          v-if="callResponse.data"
          plaintext
          no-resize
          rows="30"
          :value="JSON.stringify(callResponse.data, null, 4)"
        />
      </b-tab>
      <b-tab
        title="Processes"
        :disabled="!isApplicationInstalledLocally"
      >
        <b-form-textarea
          v-if="callResponse.data"
          plaintext
          no-resize
          rows="30"
          :value="JSON.stringify(callResponse.data, null, 4)"
        />
      </b-tab>
      <b-tab
        title="Log File"
        :disabled="!isApplicationInstalledLocally"
      >
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
              @confirm="downloadApplicationLog()"
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
              v-if="callResponse.data"
              plaintext
              no-resize
              rows="30"
              :value="asciiResponse"
              class="mt-1"
            />
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
        title="Execute Commands"
        :disabled="!isApplicationInstalledLocally"
      >
        <div class="text-center">
          <h6>Here you can execute some commands with a set of enviroment variables on this local application instance. Both are array of strings. Useful especially for testing and tweaking purposes.</h6>
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
            v-if="callResponse.data"
            plaintext
            no-resize
            rows="30"
            :value="asciiResponse"
            class="mt-1"
          />
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
          <list-entry
            title="Name"
            :data="callBResponse.data.name"
            classes="mb-0"
          />
          <list-entry
            title="Description"
            :data="callBResponse.data.description"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.domains"
            title="Domains"
            :data="callBResponse.data.domains.toString()"
            classes="mb-0"
          />
          <list-entry
            title="Specifications Hash"
            :data="callBResponse.data.hash"
            classes="mb-0"
          />
          <list-entry
            title="Repository"
            :data="callBResponse.data.repotag"
            classes="mb-0"
          />
          <list-entry
            title="Owner"
            :data="callBResponse.data.owner"
            classes="mb-0"
          />
          <list-entry
            title="Registered on Blockheight"
            :number="callBResponse.data.height"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.hash && callBResponse.data.hash.length === 64"
            title="Expires on Blockheight"
            :number="callBResponse.data.height + 22000"
            classes="mb-0"
          />
          <list-entry
            title="Specifications version"
            :number="callBResponse.data.version"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.port || callBResponse.data.ports"
            title="Public Ports"
            :data="(callBResponse.data.port || callBResponse.data.ports).toString()"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.containerPort || callBResponse.data.containerPorts"
            title="Forwarded Ports"
            :data="(callBResponse.data.containerPort || callBResponse.data.containerPorts).toString()"
            classes="mb-0"
          />
          <list-entry
            title="Application Data"
            :data="callBResponse.data.containerData"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.enviromentParameters"
            title="Application Enviroment"
            :data="callBResponse.data.enviromentParameters.toString()"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.commands"
            title="Application Commands"
            :data="callBResponse.data.commands.toString()"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.instances"
            title="Number of Instances"
            :data="callBResponse.data.instances.toString()"
            classes="mb-0"
          />
          <list-entry
            v-if="callBResponse.data.tiered"
            title="Tiered Specifications"
            :data="callBResponse.data.tiered.toString()"
            classes="mb-0"
          />
          <div v-if="callBResponse.data.tiered">
            <list-entry
              title=" - Stratus CPU"
              :data="`${callBResponse.data.cpubamf} Cores`"
              classes="mb-0"
            />
            <list-entry
              title=" - Stratus RAM"
              :data="`${callBResponse.data.rambamf} MB`"
              classes="mb-0"
            />
            <list-entry
              title=" - Stratus SSD"
              :data="`${callBResponse.data.hddbamf} GB`"
              classes="mb-0"
            />
            <list-entry
              title=" - Nimbus CPU"
              :data="`${callBResponse.data.cpusuper} Cores`"
              classes="mb-0"
            />
            <list-entry
              title=" - Nimbus RAM"
              :data="`${callBResponse.data.ramsuper} MB`"
              classes="mb-0"
            />
            <list-entry
              title=" - Nimbus SSD"
              :data="`${callBResponse.data.hddsuper} GB`"
              classes="mb-0"
            />
            <list-entry
              title=" - Cumulus CPU"
              :data="`${callBResponse.data.cpubasic} Cores`"
              classes="mb-0"
            />
            <list-entry
              title=" - Cumulus RAM"
              :data="`${callBResponse.data.rambasic} MB`"
              classes="mb-0"
            />
            <list-entry
              title=" - Cumulus SSD"
              :data="`${callBResponse.data.hddbasic} GB`"
              classes="mb-0"
            />
          </div>
          <div v-else>
            <list-entry
              title="CPU"
              :data="`${callBResponse.data.cpu} Cores`"
              classes="mb-0"
            />
            <list-entry
              title="RAM"
              :data="`${callBResponse.data.ram} MB`"
              classes="mb-0"
            />
            <list-entry
              title="SSD"
              :data="`${callBResponse.data.hdd} GB`"
              classes="mb-0"
            />
          </div>
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
                  @click="openApp(row.item.name, row.item.ip, callBResponse.data.port || callBResponse.data.ports[0])"
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
        <b-form>
          <b-form-group
            label-cols="2"
            label-cols-lg="1"
            label="Version"
            label-for="version"
          >
            <b-form-input
              id="version"
              v-model="appUpdateSpecification.version"
              placeholder="App Version"
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
              placeholder="App name"
              readonly
            />
          </b-form-group>
          <b-form-group
            label-cols="2"
            label-cols-lg="1"
            label="Description"
            label-for="description"
          >
            <b-form-textarea
              id="description"
              v-model="appUpdateSpecification.description"
              rows="3"
            />
          </b-form-group>
          <b-form-group
            label-cols="2"
            label-cols-lg="1"
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
            label-cols-lg="1"
            label="Owner"
            label-for="owner"
          >
            <b-form-input
              id="owner"
              v-model="appUpdateSpecification.owner"
              placeholder="ZelID of application owner"
            />
          </b-form-group>
          <b-form-group
            label-cols="2"
            label-cols-lg="1"
            label="Ports"
            label-for="ports"
          >
            <b-form-input
              id="ports"
              v-model="appUpdateSpecification.ports"
              placeholder="Array of Ports on which application will be available"
            />
          </b-form-group>
          <b-form-group
            label-cols="2"
            label-cols-lg="1"
            label="Domains"
            label-for="domains"
          >
            <b-form-input
              id="domains"
              v-model="appUpdateSpecification.domains"
              placeholder="Array of strings of Domains managed by Flux Domain Manager (FDM). Length has to corresponds to available ports. Use empty strings for no domains"
            />
          </b-form-group>
          <b-form-group
            label-cols="2"
            label-cols-lg="1"
            label="Enviroment"
            label-for="enviromentParameters"
          >
            <b-form-input
              id="enviromentParameters"
              v-model="appUpdateSpecification.enviromentParameters"
              placeholder="Array of strings of Enviromental Parameters"
            />
          </b-form-group>
          <b-form-group
            label-cols="2"
            label-cols-lg="1"
            label="Commands"
            label-for="commands"
          >
            <b-form-input
              id="commands"
              v-model="appUpdateSpecification.commands"
              placeholder="Array of strings of Commands"
            />
          </b-form-group>
          <b-form-group
            label-cols="2"
            label-cols-lg="1"
            label="Cont. Ports"
            label-for="containerPorts"
          >
            <b-form-input
              id="containerPorts"
              v-model="appUpdateSpecification.containerPorts"
              placeholder="Container Ports - array of ports on which your container has"
            />
          </b-form-group>
          <b-form-group
            label-cols="2"
            label-cols-lg="1"
            label="Cont. Data"
            label-for="containerData"
          >
            <b-form-input
              id="containerData"
              v-model="appUpdateSpecification.containerData"
              placeholder="Data folder that is shared by application to App volume"
            />
          </b-form-group>
          <b-form-group
            label-cols="2"
            label-cols-lg="1"
            label="Tiered"
            label-for="tiered"
          >
            <b-form-checkbox
              id="tiered"
              v-model="appUpdateSpecification.tiered"
              switch
              class="custom-control-primary"
            />
          </b-form-group>
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
              min="0"
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
              min="0"
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
              min="0"
              max="565"
              step="1"
            />
          </b-form-group>
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
                  min="0"
                  max="1"
                  step="0.1"
                />
                <div>
                  RAM: {{ appUpdateSpecification.rambasic }}
                </div>
                <b-form-input
                  v-model="appUpdateSpecification.rambasic"
                  type="range"
                  min="0"
                  max="1000"
                  step="100"
                />
                <div>
                  SSD: {{ appUpdateSpecification.hddbasic }}
                </div>
                <b-form-input
                  v-model="appUpdateSpecification.hddbasic"
                  type="range"
                  min="0"
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
                  min="0"
                  max="3"
                  step="0.1"
                />
                <div>
                  RAM: {{ appUpdateSpecification.ramsuper }}
                </div>
                <b-form-input
                  v-model="appUpdateSpecification.ramsuper"
                  type="range"
                  min="0"
                  max="5000"
                  step="100"
                />
                <div>
                  SSD: {{ appUpdateSpecification.hddsuper }}
                </div>
                <b-form-input
                  v-model="appUpdateSpecification.hddsuper"
                  type="range"
                  min="0"
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
                  min="0"
                  max="7"
                  step="0.1"
                />
                <div>
                  RAM: {{ appUpdateSpecification.rambamf }}
                </div>
                <b-form-input
                  v-model="appUpdateSpecification.rambamf"
                  type="range"
                  min="0"
                  max="28000"
                  step="100"
                />
                <div>
                  SSD: {{ appUpdateSpecification.hddbamf }}
                </div>
                <b-form-input
                  v-model="appUpdateSpecification.hddbamf"
                  type="range"
                  min="0"
                  max="565"
                  step="1"
                />
              </b-card>
            </b-col>
          </b-row>
        </b-form>
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
              <b-card title="Sign with ZelCore">
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
              <b-card title="Pay with ZelCore">
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
  BRow,
  BButton,
  BForm,
  BFormTextarea,
  BFormGroup,
  BFormInput,
  BFormCheckbox,
  BFormSelect,
  BInputGroup,
  BInputGroupAppend,
  BPagination,
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
    BRow,
    BButton,
    BForm,
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
      currentHeight: 0,
      selectedAppOwner: '',
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
      const url = `${backendURL}/zelid/providesign`;
      return encodeURI(url);
    },
    stringifiedResponse() {
      if (!this.callResponse || !this.callResponse.data) {
        return '';
      }
      const json = JSON.stringify(this.callResponse.data, null, 4);
      return json;
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
      const niceString = `${appInfo.name} - ${appInfo.state} - ${appInfo.status}`;
      return niceString;
    },
    asciiResponse() {
      if (typeof this.callResponse.data === 'string') {
        return this.callResponse.data.replace(/[^\x20-\x7E\t\r\n\v\f]/g, '');
      }
      return '';
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
    this.callResponse.data = '';
    this.callResponse.status = '';
    this.appExec.cmd = '';
    this.appExec.env = '';
    this.checkFluxCommunication();
    this.getAppOwner();
    this.getDaemonInfo();
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
          this.getDaemonInfo();
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
        this.appUpdateSpecification.version = specs.version;
        this.appUpdateSpecification.name = specs.name;
        this.appUpdateSpecification.description = specs.description;
        this.appUpdateSpecification.repotag = specs.repotag;
        this.appUpdateSpecification.owner = specs.owner;
        this.appUpdateSpecification.ports = specs.port || this.ensureString(specs.ports); // v1 compatibility
        this.appUpdateSpecification.domains = this.ensureString(specs.domains);
        this.appUpdateSpecification.enviromentParameters = this.ensureString(specs.enviromentParameters);
        this.appUpdateSpecification.commands = this.ensureString(specs.commands);
        this.appUpdateSpecification.containerPorts = specs.containerPort || this.ensureString(specs.containerPorts); // v1 compatibility
        this.appUpdateSpecification.containerData = specs.containerData;
        this.appUpdateSpecification.instances = specs.instances || 3;
        this.appUpdateSpecification.cpu = specs.cpu;
        this.appUpdateSpecification.ram = specs.ram;
        this.appUpdateSpecification.hdd = specs.hdd;
        this.appUpdateSpecification.tiered = specs.tiered;
        this.appUpdateSpecification.cpubasic = specs.cpubasic;
        this.appUpdateSpecification.rambasic = specs.rambasic;
        this.appUpdateSpecification.hddbasic = specs.hddbasic;
        this.appUpdateSpecification.cpusuper = specs.cpusuper;
        this.appUpdateSpecification.ramsuper = specs.ramsuper;
        this.appUpdateSpecification.hddsuper = specs.hddsuper;
        this.appUpdateSpecification.cpubamf = specs.cpubamf;
        this.appUpdateSpecification.rambamf = specs.rambamf;
        this.appUpdateSpecification.hddbamf = specs.hddbamf;
        if (this.currentHeight > 983000) { // fork height for spec v3
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
        const responseAppSpecs = await AppsService.appUpdateVerification(this.zelidHeader.zelidauth, { appSpecification });
        if (responseAppSpecs.data.status === 'error') {
          throw new Error(responseAppSpecs.data.data);
        }
        const appSpecFormatted = responseAppSpecs.data.data;
        const response = await AppsService.appPrice(this.zelidHeader.zelidauth, { appSpecification: appSpecFormatted });
        this.appPricePerMonthForUpdate = 0;
        if (response.data.status === 'error') {
          throw new Error(response.data.data);
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

    async appExecute() {
      const zelidauth = localStorage.getItem('zelidauth');
      if (!this.appExec.cmd) {
        this.showToast('danger', 'No commands specified');
        return;
      }
      const env = this.appExec.env ? this.appExec.env : '[]';
      const { cmd } = this.appExec;
      this.commandExecuting = true;
      const response = await AppsService.getAppExec(zelidauth, this.appName, cmd, env);
      console.log(response);
      this.commandExecuting = false;
      this.callResponse.status = response.status;
      this.callResponse.data = response.data;
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
    },

    cancelDownload() {
      this.abortToken.cancel('User download cancelled');
      this.downloaded = '';
      this.total = '';
    },
    async downloadApplicationLog() {
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
      const response = await DaemonService.justAPI().get(`/apps/applog/${this.appName}`, axiosConfig);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'app.log');
      document.body.appendChild(link);
      link.click();
    },

    getAppIdentifier() {
      // this id is used for volumes, docker names so we know it reall belongs to flux
      if (this.appName && this.appName.startsWith('zel')) {
        return this.appName;
      }
      if (this.appName && this.appName.startsWith('flux')) {
        return this.appName;
      }
      if (this.appName === 'KadenaChainWebNode' || this.appName === 'FoldingAtHomeB') {
        return `zel${this.appName}`;
      }
      return `flux${this.appName}`;
    },
    getAppDockerNameIdentifier() {
      // this id is used for volumes, docker names so we know it reall belongs to flux
      const name = this.getAppIdentifier();
      if (name && name.startsWith('/')) {
        return name;
      }
      return `/${name}`;
    },

    async getApplicationInspect() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.getAppInspect(zelidauth, this.appName);
      console.log(response);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async getApplicationStats() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.getAppStats(zelidauth, this.appName);
      console.log(response);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async getApplicationChanges() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.getAppChanges(zelidauth, this.appName);
      console.log(response);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async getApplicationProcesses() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.getAppTop(zelidauth, this.appName);
      console.log(response);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async getApplicationLogs() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.getAppLogsTail(zelidauth, this.appName);
      console.log(response);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
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
    async getDaemonInfo() {
      const daemonGetInfo = await DaemonService.getInfo();
      if (daemonGetInfo.data.status === 'error') {
        this.showToast('danger', daemonGetInfo.data.data.message || daemonGetInfo.data.data);
      } else {
        this.currentHeight = daemonGetInfo.data.data.blocks;
        if (this.currentHeight < 983000) { // fork height for spec v3
          this.appUpdateSpecification.version = 2;
        }
      }
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
        } else {
          this.showToast('success', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
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
