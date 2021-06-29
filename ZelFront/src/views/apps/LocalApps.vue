<template>
  <div>
    <div
      v-if="!managedApplication"
    >
      <b-tabs>
        <b-tab
          active
          title="Running"
        >
          <b-card>
            <b-row>
              <b-col cols="12">
                <b-table
                  class="apps-running-table"
                  striped
                  hover
                  responsive
                  :items="config.running.apps"
                  :fields="isLoggedIn() ? config.running.loggedInFields : config.running.fields"
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
        </b-tab>
        <b-tab
          title="Installed"
        >
          <b-card>
            <b-row>
              <b-col cols="12">
                <b-table
                  class="apps-installed-table"
                  striped
                  hover
                  responsive
                  :items="config.installed.apps"
                  :fields="isLoggedIn() ? config.installed.loggedInFields : config.installed.fields"
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
        </b-tab>
        <b-tab
          title="Available"
        >
          <b-card>
            <b-row>
              <b-col cols="12">
                <b-table
                  class="apps-available-table"
                  striped
                  hover
                  responsive
                  :items="config.available.apps"
                  :fields="isLoggedIn() ? config.available.loggedInFields : config.available.fields"
                  show-empty
                  empty-text="No Flux Apps available"
                >
                  <template #cell(show_details)="row">
                    <a @click="showLocations(row, config.available.apps)">
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
                            @click="openApp(row.item.name, locationRow.item.ip, row.item.port || row.item.ports[0])"
                          >
                            Visit
                          </b-button>
                        </template>
                      </b-table>
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
        </b-tab>
        <b-tab
          title="My Local Apps"
        >
          <b-card>
            <b-row>
              <b-col cols="12">
                <b-table
                  class="apps-local-table"
                  striped
                  hover
                  responsive
                  :items="config.local.apps"
                  :fields="config.local.fields"
                  show-empty
                  empty-text="No Local Apps owned"
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
            </b-row>
          </b-card>
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
          active
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
          class="text-center"
        >
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
            <b-card-text
              v-if="total && downloaded"
            >
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
        </b-tab>
        <b-tab
          title="Control"
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
                    @confirm="startApp(managedApplication)"
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
                    @confirm="stopAll(managedApplication)"
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
                    @confirm="restartApp(managedApplication)"
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
                    @confirm="pauseApp(managedApplication)"
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
                    @confirm="unpauseApp(managedApplication)"
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
                    @confirm="redeployAppSoft(managedApplication)"
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
                    @confirm="redeployAppHard(managedApplication)"
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
                    @confirm="removeApp(managedApplication)"
                  />
                </div>
              </b-card>
            </b-col>
          </b-row>
        </b-tab>
        <b-tab
          title="Execute Commands"
          class="text-center"
        >
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
        </b-tab>
        <b-tab
          title="Global App Management"
          disabled
        />
        <b-tab
          title="Global Specifications"
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
          title="Running Instances"
        >
          <b-table
            class="app-instances-table"
            striped
            hover
            responsive
            :items="config.instances.data"
            :fields="config.instances.fields"
            show-empty
            :empty-text="`No instances of ${managedApplication}`"
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
                  title="Broadcasted"
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
        </b-tab>
        <b-tab
          title="Update Specifications"
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
                max="570"
                step="1"
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
            <b-row
              v-if="appUpdateSpecification.tiered"
            >
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
                    max="20"
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
                    max="120"
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
                    max="570"
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
                    :href="'zel:?action=sign&message=' + dataToSign + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FZelFront%2Fsrc%2Fassets%2Fimg%2FzelID.svg&callback=' + callbackValue"
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
                    To finish the application update, please make a transaction of {{ appPricePerMonthForUpdate }} to address
                    '{{ apps.address }}'
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
                  <a :href="'zel:?action=pay&coin=zelcash&address=' + apps.address + '&amount=' + appPricePerMonthForUpdate + '&message=' + updateHash + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FZelFront%2Fsrc%2Fassets%2Fimg%2Fflux_banner.png'">
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
} from 'bootstrap-vue'

import Ripple from 'vue-ripple-directive'
import { mapState } from 'vuex'
import AppsService from '@/services/AppsService'
import DaemonService from '@/services/DaemonService'
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue'
import ConfirmDialog from '@/views/components/ConfirmDialog.vue'
import ListEntry from '@/views/components/ListEntry.vue'

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
    BCardText,
    BRow,
    BButton,
    BForm,
    BFormTextarea,
    BFormGroup,
    BFormInput,
    BFormCheckbox,
    ConfirmDialog,
    ListEntry,
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
      updatetype: 'fluxappupdate',
      version: 1,
      dataForAppUpdate: {},
      dataToSign: '',
      timestamp: '',
      signature: '',
      updateHash: '',
      websocket: null,
      managedApplication: '',
      managementMenuItem: '',
      getAllAppsResponse: {
        status: '',
        data: [],
      },
      fluxSpecifics: {
        cpu: {
          basic: 20, // 10 available for apps
          super: 40, // 30 available for apps
          bamf: 80, // 70 available for apps
        },
        ram: {
          basic: 3000, // 1000 available for apps
          super: 7000, // 5000 available for apps
          bamf: 30000, // available 28000 for apps
        },
        hdd: {
          basic: 50, // 20 for apps
          super: 150, // 120 for apps
          bamf: 600, // 570 for apps
        },
        collateral: {
          basic: 10000,
          super: 25000,
          bamf: 100000,
        },
      },
      lockedSystemResources: {
        cpu: 10, // 1 cpu core
        ram: 2000, // 2000mb
        hdd: 30, // 30gb // this value is likely to rise
      },
      apps: {
        // in flux per month
        price: {
          cpu: 3, // per 0.1 cpu core,
          ram: 1, // per 100mb,
          hdd: 0.5, // per 1gb,
        },
        address: 't1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6', // apps registration address
        epochstart: 694000, // apps epoch blockheight start
        portMin: 31000, // originally should have been from 30000 but we got temporary folding there
        portMax: 39999,
      },
      config: {
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
        { key: 'ip', label: 'IP Address' },
        { key: 'visit', label: '' },
      ],
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
        version: 2,
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
      currentHeight: 0,
      selectedAppOwner: '',
      fluxCommunication: false,
      commandExecuting: false,
      total: '',
      downloaded: '',
      abortToken: {},
    }
  },
  computed: {
    ...mapState('flux', [
      'userconfig',
      'privilege',
    ]),
    callbackValue() {
      const { protocol, hostname } = window.location
      let mybackend = ''
      mybackend += protocol
      mybackend += '//'
      const regex = /[A-Za-z]/g
      if (hostname.match(regex)) {
        const names = hostname.split('.')
        names[0] = 'api'
        mybackend += names.join('.')
      } else {
        mybackend += this.userconfig.externalip
        mybackend += ':'
        mybackend += this.config.apiPort
      }
      const backendURL = store.get('backendURL') || mybackend
      const url = `${backendURL}/zelid/providesign`
      return encodeURI(url)
    },
    stringifiedResponse() {
      if (!this.callResponse || !this.callResponse.data) {
        return ''
      }
      const json = JSON.stringify(this.callResponse.data, null, 4)
      return json
    },
    asciiResponse() {
      if (typeof this.callResponse.data === 'string') {
        return this.callResponse.data.replace(/[^\x20-\x7E\t\r\n\v\f]/g, '')
      }
      return ''
    },
    applicationManagementAndStatus() {
      console.log(this.getAllAppsResponse)
      const foundAppInfo = this.getAllAppsResponse.data.find(app => app.Names[0] === this.getAppDockerNameIdentifier()) || {}
      const appInfo = {
        name: this.managedApplication,
        state: foundAppInfo.State || 'Unknown state',
        status: foundAppInfo.Status || 'Unknown status',
      }
      appInfo.state = appInfo.state.charAt(0).toUpperCase() + appInfo.state.slice(1)
      appInfo.status = appInfo.status.charAt(0).toUpperCase() + appInfo.status.slice(1)
      const niceString = `${appInfo.name} - ${appInfo.state} - ${appInfo.status}`
      return niceString
    },
    appPricePerMonthForUpdate() {
      const appInfo = this.callBResponse.data
      let actualPriceToPay = this.appPricePerMonthMethod(this.dataForAppUpdate)
      console.log(actualPriceToPay)
      if (appInfo) {
        const previousSpecsPrice = this.appPricePerMonthMethod(appInfo)
        console.log(previousSpecsPrice)
        // what is the height difference
        const daemonHeight = this.currentHeight
        const heightDifference = daemonHeight - appInfo.height // has to be lower than 22000
        const perc = (22000 - heightDifference) / 22000
        if (perc > 0) {
          actualPriceToPay -= (perc * previousSpecsPrice)
        }
      }
      if (actualPriceToPay < 1) {
        actualPriceToPay = 1
      }
      actualPriceToPay = Number(Math.ceil(actualPriceToPay * 100) / 100)
      return actualPriceToPay
    },
    validTill() {
      const expTime = this.timestamp + 60 * 60 * 1000 // 1 hour
      return expTime
    },
    subscribedTill() {
      const expTime = this.timestamp + 30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000 // 1 month
      return expTime
    },
    isApplicationInstalledLocally() {
      if (this.config.installed.apps) {
        const installed = this.config.installed.apps.find(app => app.name === this.managedApplication)
        if (installed) {
          return true
        }
        return false
      }
      return false
    },
  },
  watch: {
    appUpdateSpecification: {
      handler(val, oldVal) {
        console.log(val, oldVal)
        this.dataToSign = ''
        this.signature = ''
        this.timestamp = null
        this.dataForAppUpdate = {}
        this.updateHash = ''
        if (this.websocket !== null) {
          this.websocket.close()
          this.websocket = null
        }
      },
      deep: true,
    },
  },
  mounted() {
    this.getZelNodeStatus()
    this.appsGetListAllApps()
    this.appsGetInstalledApps()
    this.appsGetListRunningApps()
    this.appsGetAvailableApps()
  },
  methods: {
    async getZelNodeStatus() {
      const response = await DaemonService.getZelNodeStatus()
      if (response.data.status === 'success') {
        this.tier = response.data.data.tier
      }
    },
    async appsGetInstalledApps() {
      const response = await AppsService.installedApps()
      console.log(response)
      this.config.installed.status = response.data.status
      this.config.installed.apps = response.data.data
    },
    async appsGetListRunningApps() {
      const response = await AppsService.listRunningApps()
      console.log(response)
      this.config.running.status = response.data.status
      this.config.running.apps = response.data.data
    },
    async appsGetAvailableApps() {
      const response = await AppsService.availableApps()
      console.log(response)
      this.config.available.status = response.data.status
      this.config.available.apps = response.data.data
    },
    async appsGetListAllApps() {
      const response = await AppsService.listAllApps()
      console.log(response)
      this.getAllAppsResponse.status = response.data.status
      this.getAllAppsResponse.data = response.data.data
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
      return this.config.installed.apps.find(app => app.name === appName)
    },
    openSite(url) {
      const win = window.open(url, '_blank')
      win.focus()
    },
    async stopAll(app) {
      this.output = ''
      this.showToast('warning', `Stopping ${app}`)
      const zelidauth = localStorage.getItem('zelidauth')
      const response = await AppsService.stopAll(zelidauth, app)
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data)
      } else {
        this.showToast('danger', response.data.data.message || response.data.data)
      }
      this.appsGetListAllApps()
      this.appsGetListRunningApps()
      console.log(response)
    },
    async startApp(app) {
      this.output = ''
      this.showToast('warning', `Starting ${app}`)
      const zelidauth = localStorage.getItem('zelidauth')
      const response = await AppsService.startApp(zelidauth, app)
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data)
      } else {
        this.showToast('danger', response.data.data.message || response.data.data)
      }
      this.appsGetListRunningApps()
      this.appsGetListAllApps()
      console.log(response)
    },
    async restartApp(app) {
      this.output = ''
      this.showToast('warning', `Restarting ${app}`)
      const zelidauth = localStorage.getItem('zelidauth')
      const response = await AppsService.restartApp(zelidauth, app)
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data)
      } else {
        this.showToast('danger', response.data.data.message || response.data.data)
      }
      this.appsGetListAllApps()
      this.appsGetListRunningApps()
      console.log(response)
    },
    async pauseApp(app) {
      this.output = ''
      this.showToast('warning', `Pausing ${app}`)
      const zelidauth = localStorage.getItem('zelidauth')
      const response = await AppsService.pauseApp(zelidauth, app)
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data)
      } else {
        this.showToast('danger', response.data.data.message || response.data.data)
      }
      this.appsGetListAllApps()
      console.log(response)
    },
    async unpauseApp(app) {
      this.output = ''
      this.showToast('warning', `Unpausing ${app}`)
      const zelidauth = localStorage.getItem('zelidauth')
      const response = await AppsService.unpauseApp(zelidauth, app)
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data)
      } else {
        this.showToast('danger', response.data.data.message || response.data.data)
      }
      this.appsGetListAllApps()
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
      this.showToast('warning', `Redeploying ${app}`)
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
      this.showToast('warning', `Removing ${app}`)
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
      this.showToast('warning', `Installing ${appName}`)
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
    initiateSignWSUpdate() {
      const self = this
      const { protocol, hostname } = window.location
      let mybackend = ''
      mybackend += protocol
      mybackend += '//'
      const regex = /[A-Za-z]/g
      if (hostname.match(regex)) {
        const names = hostname.split('.')
        names[0] = 'api'
        mybackend += names.join('.')
      } else {
        mybackend += this.userconfig.externalip
        mybackend += ':'
        mybackend += this.config.apiPort
      }
      let backendURL = store.get('backendURL') || mybackend
      backendURL = backendURL.replace('https://', 'wss://')
      backendURL = backendURL.replace('http://', 'ws://')
      const signatureMessage = this.appUpdateSpecification.owner + this.timestamp
      const wsuri = `${backendURL}/ws/sign/${signatureMessage}`
      const websocket = new WebSocket(wsuri)
      this.websocket = websocket

      websocket.onopen = evt => { self.onOpen(evt) }
      websocket.onclose = evt => { self.onClose(evt) }
      websocket.onmessage = evt => { self.onMessage(evt) }
      websocket.onerror = evt => { self.onError(evt) }
    },
    onError(evt) {
      console.log(evt)
    },
    onMessage(evt) {
      const data = qs.parse(evt.data)
      if (data.status === 'success' && data.data) {
        // user is now signed. Store their values
        this.signature = data.data.signature
      }
      console.log(data)
      console.log(evt)
    },
    onClose(evt) {
      console.log(evt)
    },
    onOpen(evt) {
      console.log(evt)
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
      }
    },
    openAppManagement(appName, global) {
      console.log(appName)
      console.log(global)
      this.callBResponse.data = ''
      this.callBResponse.status = ''
      this.callResponse.data = ''
      this.callResponse.status = ''
      this.appExec.cmd = ''
      this.appExec.env = ''
      this.managedApplication = appName
      this.checkFluxCommunication()
      this.getAppOwner()
      this.getDaemonInfo()
      this.getGlobalApplicationSpecifics()
      if (global) {
        this.managementMenuItem = 'globalappspecifics'
      } else {
        this.getInstalledApplicationSpecifics()
        this.managementMenuItem = 'appspecifics'
      }
    },
    goBackToApps() {
      this.managedApplication = ''
    },
    updateManagementTab(index) {
      this.callResponse.data = ''
      this.callResponse.status = ''
      // do not reset global application specifics obtained
      this.appExec.cmd = ''
      this.appExec.env = ''
      this.output = ''
      console.log(index)
      switch (index) {
        case 1:
          this.getInstalledApplicationSpecifics()
          this.getGlobalApplicationSpecifics()
          break
        case 2:
          this.getApplicationInspect()
          break
        case 3:
          this.getApplicationStats()
          break
        case 4:
          this.getApplicationChanges()
          break
        case 5:
          this.getApplicationProcesses()
          break
        case 6:
          this.getApplicationLogs()
          break
        case 10:
          this.getGlobalApplicationSpecifics()
          break
        case 11:
          this.getApplicationLocations()
          break
        case 12:
          this.getGlobalApplicationSpecifics()
          this.getDaemonInfo()
          break
        default:
          break
      }
    },
    async update() {
      const zelidauth = localStorage.getItem('zelidauth')
      const data = {
        type: this.updatetype,
        version: this.version,
        appSpecification: this.dataForAppUpdate,
        timestamp: this.timestamp,
        signature: this.signature,
      }
      const response = await AppsService.updateApp(zelidauth, data).catch(error => {
        this.showToast('danger', error.message || error)
      })
      console.log(response)
      if (response.data.status === 'success') {
        this.updateHash = response.data.data
        console.log(this.updateHash)
        this.showToast('success', response.data.data.message || response.data.data)
      } else {
        this.showToast('danger', response.data.data.message || response.data.data)
      }
    },
    async checkFluxCommunication() {
      const response = await AppsService.checkCommunication()
      if (response.data.status === 'success') {
        this.fluxCommunication = true
      } else {
        this.showToast('danger', response.data.data.message || response.data.data)
      }
    },
    async getAppOwner() {
      const response = await AppsService.getAppOwner(this.managedApplication)
      console.log(response)
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data)
      }
      this.selectedAppOwner = response.data.data
    },
    async getDaemonInfo() {
      const daemonGetInfo = await DaemonService.getInfo()
      if (daemonGetInfo.data.status === 'error') {
        this.showToast('danger', daemonGetInfo.data.data.message || daemonGetInfo.data.data)
      } else {
        this.currentHeight = daemonGetInfo.data.data.blocks
      }
    },
    async getInstalledApplicationSpecifics() {
      const response = await AppsService.getInstalledAppSpecifics(this.managedApplication)
      console.log(response)
      if (response.data.status === 'error' || !response.data.data[0]) {
        this.showToast('danger', response.data.data.message || response.data.data)
      } else {
        this.callResponse.status = response.data.status
        this.callResponse.data = response.data.data[0]
      }
    },
    async getGlobalApplicationSpecifics() {
      const response = await AppsService.getAppSpecifics(this.managedApplication)
      console.log(response)
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data)
        this.callBResponse.status = response.data.status
      } else {
        this.callBResponse.status = response.data.status
        this.callBResponse.data = response.data.data
        const specs = response.data.data
        console.log(specs)
        this.appUpdateSpecification.version = specs.version
        this.appUpdateSpecification.name = specs.name
        this.appUpdateSpecification.description = specs.description
        this.appUpdateSpecification.repotag = specs.repotag
        this.appUpdateSpecification.owner = specs.owner
        this.appUpdateSpecification.ports = specs.port || this.ensureString(specs.ports) // v1 compatibility
        this.appUpdateSpecification.domains = this.ensureString(specs.domains)
        this.appUpdateSpecification.enviromentParameters = this.ensureString(specs.enviromentParameters)
        this.appUpdateSpecification.commands = this.ensureString(specs.commands)
        this.appUpdateSpecification.containerPorts = specs.containerPort || this.ensureString(specs.containerPorts) // v1 compatibility
        this.appUpdateSpecification.containerData = specs.containerData
        this.appUpdateSpecification.cpu = specs.cpu
        this.appUpdateSpecification.ram = specs.ram
        this.appUpdateSpecification.hdd = specs.hdd
        this.appUpdateSpecification.tiered = specs.tiered
        this.appUpdateSpecification.cpubasic = specs.cpubasic
        this.appUpdateSpecification.rambasic = specs.rambasic
        this.appUpdateSpecification.hddbasic = specs.hddbasic
        this.appUpdateSpecification.cpusuper = specs.cpusuper
        this.appUpdateSpecification.ramsuper = specs.ramsuper
        this.appUpdateSpecification.hddsuper = specs.hddsuper
        this.appUpdateSpecification.cpubamf = specs.cpubamf
        this.appUpdateSpecification.rambamf = specs.rambamf
        this.appUpdateSpecification.hddbamf = specs.hddbamf
      }
    },
    async checkFluxUpdateSpecificationsAndFormatMessage() {
      try {
        let appSpecification = this.appUpdateSpecification
        console.log(appSpecification)
        appSpecification = this.ensureObject(appSpecification)
        let { version } = appSpecification // shall be 2
        let { name } = appSpecification
        let { description } = appSpecification
        let { repotag } = appSpecification
        let { owner } = appSpecification
        let { ports } = appSpecification
        let { domains } = appSpecification
        let { enviromentParameters } = appSpecification
        let { commands } = appSpecification
        let { containerPorts } = appSpecification
        let { containerData } = appSpecification
        let { cpu } = appSpecification
        let { ram } = appSpecification
        let { hdd } = appSpecification
        const { tiered } = appSpecification
        // check if signature of received data is correct
        if (!version || !name || !description || !repotag || !owner || !ports || !domains || !enviromentParameters || !commands || !containerPorts || !containerData || !cpu || !ram || !hdd) {
          throw new Error('Missing App specification parameter')
        }
        version = this.ensureNumber(version)
        name = this.ensureString(name)
        description = this.ensureString(description)
        repotag = this.ensureString(repotag)
        owner = this.ensureString(owner)
        ports = this.ensureObject(ports)
        ports = this.ensureObject(ports)
        const portsCorrect = []
        if (Array.isArray(ports)) {
          ports.forEach(parameter => {
            const param = this.ensureString(parameter) // todo ensureNumber
            portsCorrect.push(param)
          })
        } else {
          throw new Error('Ports parameters for App are invalid')
        }
        domains = this.ensureObject(domains)
        const domainsCorrect = []
        if (Array.isArray(domains)) {
          domains.forEach(parameter => {
            const param = this.ensureString(parameter)
            domainsCorrect.push(param)
          })
        } else {
          throw new Error('Enviromental parameters for App are invalid')
        }
        enviromentParameters = this.ensureObject(enviromentParameters)
        const envParamsCorrected = []
        if (Array.isArray(enviromentParameters)) {
          enviromentParameters.forEach(parameter => {
            const param = this.ensureString(parameter)
            envParamsCorrected.push(param)
          })
        } else {
          throw new Error('Enviromental parameters for App are invalid')
        }
        commands = this.ensureObject(commands)
        const commandsCorrected = []
        if (Array.isArray(commands)) {
          commands.forEach(command => {
            const cmm = this.ensureString(command)
            commandsCorrected.push(cmm)
          })
        } else {
          throw new Error('App commands are invalid')
        }
        containerPorts = this.ensureObject(containerPorts)
        const containerportsCorrect = []
        if (Array.isArray(containerPorts)) {
          containerPorts.forEach(parameter => {
            const param = this.ensureString(parameter) // todo ensureNumber
            containerportsCorrect.push(param)
          })
        } else {
          throw new Error('Container Ports parameters for App are invalid')
        }
        containerData = this.ensureString(containerData)
        cpu = this.ensureNumber(cpu)
        ram = this.ensureNumber(ram)
        hdd = this.ensureNumber(hdd)
        if (typeof tiered !== 'boolean') {
          throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.')
        }

        // finalised parameters that will get stored in global database
        const appSpecFormatted = {
          version, // integer
          name, // string
          description, // string
          repotag, // string
          owner, // zelid string
          ports: portsCorrect, // array of integers
          domains: domainsCorrect, // array of strings
          enviromentParameters: envParamsCorrected, // array of strings
          commands: commandsCorrected, // array of strings
          containerPorts: containerportsCorrect, // array of integers
          containerData, // string
          cpu, // float 0.1 step
          ram, // integer 100 step (mb)
          hdd, // integer 1 step
          tiered, // boolean
        }

        if (tiered) {
          let { cpubasic } = appSpecification
          let { cpusuper } = appSpecification
          let { cpubamf } = appSpecification
          let { rambasic } = appSpecification
          let { ramsuper } = appSpecification
          let { rambamf } = appSpecification
          let { hddbasic } = appSpecification
          let { hddsuper } = appSpecification
          let { hddbamf } = appSpecification
          if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
            throw new Error('App was requested as tiered setup but specifications are missing')
          }
          cpubasic = this.ensureNumber(cpubasic)
          cpusuper = this.ensureNumber(cpusuper)
          cpubamf = this.ensureNumber(cpubamf)
          rambasic = this.ensureNumber(rambasic)
          ramsuper = this.ensureNumber(ramsuper)
          rambamf = this.ensureNumber(rambamf)
          hddbasic = this.ensureNumber(hddbasic)
          hddsuper = this.ensureNumber(hddsuper)
          hddbamf = this.ensureNumber(hddbamf)

          appSpecFormatted.cpubasic = cpubasic
          appSpecFormatted.cpusuper = cpusuper
          appSpecFormatted.cpubamf = cpubamf
          appSpecFormatted.rambasic = rambasic
          appSpecFormatted.ramsuper = ramsuper
          appSpecFormatted.rambamf = rambamf
          appSpecFormatted.hddbasic = hddbasic
          appSpecFormatted.hddsuper = hddsuper
          appSpecFormatted.hddbamf = hddbamf
        }
        // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
        if (version !== 2) {
          throw new Error('App message version specification is invalid')
        }
        if (name.length > 32) {
          throw new Error('App name is too long')
        }
        // furthermore name cannot contain any special character
        if (!name.match(/^[a-zA-Z0-9]+$/)) {
          throw new Error('App name contains special characters. Only a-z, A-Z and 0-9 are allowed')
        }
        if (name.startsWith('zel')) {
          throw new Error('App name can not start with zel')
        }
        if (name.startsWith('flux')) {
          throw new Error('App name can not start with flux')
        }
        if (name !== this.callBResponse.data.name) {
          throw new Error('App name can not be changed')
        }
        if (repotag !== this.callBResponse.data.repotag) {
          throw new Error('Repository can not be changed')
        }
        if (description.length > 256) {
          throw new Error('Description is too long. Maximum of 256 characters is allowed')
        }
        const parameters = this.checkHWParameters(appSpecFormatted)
        if (parameters !== true) {
          const errorMessage = parameters
          throw new Error(errorMessage)
        }

        // check ports is within range
        appSpecFormatted.ports.forEach(port => {
          if (port < this.apps.portMin || port > this.apps.portMax) {
            throw new Error(`Assigned port ${port} is not within Apps range ${this.apps.portMin}-${this.apps.portMax}`)
          }
        })

        // check if containerPorts makes sense
        appSpecFormatted.containerPorts.forEach(port => {
          if (port < 0 || port > 65535) {
            throw new Error(`Container Port ${port} is not within system limits 0-65535`)
          }
        })

        if (appSpecFormatted.containerPorts.length !== appSpecFormatted.ports.length) {
          throw new Error('Ports specifications do not match')
        }

        if (appSpecFormatted.domains.length !== appSpecFormatted.ports.length) {
          throw new Error('Domains specifications do not match available ports')
        }

        if (appSpecFormatted.ports.length > 5) {
          throw new Error('Too many ports defined. Maximum of 5 allowed.')
        }

        // check wheter shared Folder is not root
        if (containerData.length < 2) {
          throw new Error('App container data folder not specified. If no data folder is required, use /tmp')
        }

        // check repotag if available for download
        const splittedRepo = appSpecFormatted.repotag.split(':')
        if (splittedRepo[0] && splittedRepo[1] && !splittedRepo[2]) {
          const zelidauth = localStorage.getItem('zelidauth')
          const data = {
            repotag: appSpecFormatted.repotag,
          }
          const resDocker = await AppsService.checkDockerExistance(zelidauth, data).catch(error => {
            this.showToast('danger', error.message || error)
          })
          console.log(resDocker)
          if (resDocker.data.status === 'error') {
            throw resDocker.data.data
          }
        } else {
          throw new Error('Repository is not in valid format namespace/repository:tag')
        }
        this.timestamp = new Date().getTime()
        this.dataForAppUpdate = appSpecFormatted
        this.dataToSign = this.updatetype + this.version + JSON.stringify(appSpecFormatted) + this.timestamp
      } catch (error) {
        console.log(error.message)
        console.error(error)
        this.showToast('danger', error.message || error)
      }
    },
    async getApplicationLocations() {
      const response = await AppsService.getAppLocation(this.managedApplication)
      console.log(response)
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data)
      } else {
        this.config.instances.data = response.data.data
      }
    },
    async getApplicationInspect() {
      const zelidauth = localStorage.getItem('zelidauth')
      const response = await AppsService.getAppInspect(zelidauth, this.managedApplication)
      console.log(response)
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data)
      } else {
        this.callResponse.status = response.data.status
        this.callResponse.data = response.data.data
      }
    },
    async getApplicationStats() {
      const zelidauth = localStorage.getItem('zelidauth')
      const response = await AppsService.getAppStats(zelidauth, this.managedApplication)
      console.log(response)
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data)
      } else {
        this.callResponse.status = response.data.status
        this.callResponse.data = response.data.data
      }
    },
    async appExecute() {
      const zelidauth = localStorage.getItem('zelidauth')
      if (!this.appExec.cmd) {
        this.showToast('danger', 'No commands specified')
        return
      }
      const env = this.appExec.env ? this.appExec.env : '[]'
      const { cmd } = this.appExec
      this.commandExecuting = true
      const response = await AppsService.getAppExec(zelidauth, this.managedApplication, cmd, env)
      console.log(response)
      this.commandExecuting = false
      this.callResponse.status = response.status
      this.callResponse.data = response.data
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data)
      }
    },
    async getApplicationChanges() {
      const zelidauth = localStorage.getItem('zelidauth')
      const response = await AppsService.getAppChanges(zelidauth, this.managedApplication)
      console.log(response)
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data)
      } else {
        this.callResponse.status = response.data.status
        this.callResponse.data = response.data.data
      }
    },
    async getApplicationProcesses() {
      const zelidauth = localStorage.getItem('zelidauth')
      const response = await AppsService.getAppTop(zelidauth, this.managedApplication)
      console.log(response)
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data)
      } else {
        this.callResponse.status = response.data.status
        this.callResponse.data = response.data.data
      }
    },
    async getApplicationLogs() {
      const zelidauth = localStorage.getItem('zelidauth')
      const response = await AppsService.getAppLogsTail(zelidauth, this.managedApplication)
      console.log(response)
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data)
      } else {
        this.callResponse.status = response.data.status
        this.callResponse.data = response.data.data
      }
    },
    getAppIdentifier() {
      // this id is used for volumes, docker names so we know it reall belongs to flux
      if (this.managedApplication && this.managedApplication.startsWith('zel')) {
        return this.managedApplication
      }
      if (this.managedApplication && this.managedApplication.startsWith('flux')) {
        return this.managedApplication
      }
      if (this.managedApplication === 'KadenaChainWebNode' || this.managedApplication === 'FoldingAtHomeB') {
        return `zel${this.managedApplication}`
      }
      return `flux${this.managedApplication}`
    },
    getAppDockerNameIdentifier() {
      // this id is used for volumes, docker names so we know it reall belongs to flux
      const name = this.getAppIdentifier()
      if (name && name.startsWith('/')) {
        return name
      }
      return `/${name}`
    },
    appPricePerMonthMethod(specifications) {
      let price
      if (specifications.tiered) {
        const cpuTotalCount = specifications.cpubasic + specifications.cpusuper + specifications.cpubamf
        const cpuPrice = cpuTotalCount * this.apps.price.cpu * 10 // 0.1 core cost cpu price
        const cpuTotal = cpuPrice / 3
        const ramTotalCount = specifications.rambasic + specifications.ramsuper + specifications.rambamf
        const ramPrice = (ramTotalCount * this.apps.price.ram) / 100
        const ramTotal = ramPrice / 3
        const hddTotalCount = specifications.hddbasic + specifications.hddsuper + specifications.hddbamf
        const hddPrice = hddTotalCount * this.apps.price.hdd
        const hddTotal = hddPrice / 3
        const totalPrice = cpuTotal + ramTotal + hddTotal
        price = Number(Math.ceil(totalPrice * 100) / 100)
        if (price < 1) {
          price = 1
        }
        return price
      }
      const cpuTotal = specifications.cpu * this.apps.price.cpu * 10
      const ramTotal = (specifications.ram * this.apps.price.ram) / 100
      const hddTotal = specifications.hdd * this.apps.price.hdd
      const totalPrice = cpuTotal + ramTotal + hddTotal
      price = Number(Math.ceil(totalPrice * 100) / 100)
      if (price < 1) {
        price = 1
      }
      return price
    },
    stringOutput() {
      let string = ''
      this.output.forEach(output => {
        string += `${JSON.stringify(output)}\r\n`
      })
      return string
    },
    checkHWParameters(appSpecs) {
      // check specs parameters. JS precision
      if ((appSpecs.cpu * 10) % 1 !== 0 || (appSpecs.cpu * 10) > (this.fluxSpecifics.cpu.bamf - this.lockedSystemResources.cpu) || appSpecs.cpu < 0.1) {
        return new Error('CPU badly assigned')
      }
      if (appSpecs.ram % 100 !== 0 || appSpecs.ram > (this.fluxSpecifics.ram.bamf - this.lockedSystemResources.ram) || appSpecs.ram < 100) {
        return new Error('RAM badly assigned')
      }
      if (appSpecs.hdd % 1 !== 0 || appSpecs.hdd > (this.fluxSpecifics.hdd.bamf - this.lockedSystemResources.hdd) || appSpecs.hdd < 1) {
        return new Error('SSD badly assigned')
      }
      if (appSpecs.tiered) {
        if ((appSpecs.cpubasic * 10) % 1 !== 0 || (appSpecs.cpubasic * 10) > (this.fluxSpecifics.cpu.basic - this.lockedSystemResources.cpu) || appSpecs.cpubasic < 0.1) {
          return new Error('CPU for Cumulus badly assigned')
        }
        if (appSpecs.rambasic % 100 !== 0 || appSpecs.rambasic > (this.fluxSpecifics.ram.basic - this.lockedSystemResources.ram) || appSpecs.rambasic < 100) {
          return new Error('RAM for Cumulus badly assigned')
        }
        if (appSpecs.hddbasic % 1 !== 0 || appSpecs.hddbasic > (this.fluxSpecifics.hdd.basic - this.lockedSystemResources.hdd) || appSpecs.hddbasic < 1) {
          return new Error('SSD for Cumulus badly assigned')
        }
        if ((appSpecs.cpusuper * 10) % 1 !== 0 || (appSpecs.cpusuper * 10) > (this.fluxSpecifics.cpu.super - this.lockedSystemResources.cpu) || appSpecs.cpusuper < 0.1) {
          return new Error('CPU for Nimbus badly assigned')
        }
        if (appSpecs.ramsuper % 100 !== 0 || appSpecs.ramsuper > (this.fluxSpecifics.ram.super - this.lockedSystemResources.ram) || appSpecs.ramsuper < 100) {
          return new Error('RAM for Nimbus badly assigned')
        }
        if (appSpecs.hddsuper % 1 !== 0 || appSpecs.hddsuper > (this.fluxSpecifics.hdd.super - this.lockedSystemResources.hdd) || appSpecs.hddsuper < 1) {
          return new Error('SSD for Nimbus badly assigned')
        }
        if ((appSpecs.cpubamf * 10) % 1 !== 0 || (appSpecs.cpubamf * 10) > (this.fluxSpecifics.cpu.bamf - this.lockedSystemResources.cpu) || appSpecs.cpubamf < 0.1) {
          return new Error('CPU for Stratus badly assigned')
        }
        if (appSpecs.rambamf % 100 !== 0 || appSpecs.rambamf > (this.fluxSpecifics.ram.bamf - this.lockedSystemResources.ram) || appSpecs.rambamf < 100) {
          return new Error('RAM for Stratus badly assigned')
        }
        if (appSpecs.hddbamf % 1 !== 0 || appSpecs.hddbamf > (this.fluxSpecifics.hdd.bamf - this.lockedSystemResources.hdd) || appSpecs.hddbamf < 1) {
          return new Error('SSD for Stratus badly assigned')
        }
      }
      return true
    },
    ensureBoolean(parameter) {
      let param
      if (parameter === 'false' || parameter === 0 || parameter === '0' || parameter === false) {
        param = false
      }
      if (parameter === 'true' || parameter === 1 || parameter === '1' || parameter === true) {
        param = true
      }
      return param
    },
    ensureNumber(parameter) {
      return typeof parameter === 'number' ? parameter : Number(parameter)
    },
    ensureObject(parameter) {
      if (typeof parameter === 'object') {
        return parameter
      }
      let param
      try {
        param = JSON.parse(parameter)
      } catch (e) {
        param = qs.parse(parameter)
      }
      return param
    },
    ensureString(parameter) {
      return typeof parameter === 'string' ? parameter : JSON.stringify(parameter)
    },
    cancelDownload() {
      this.abortToken.cancel('User download cancelled')
      this.downloaded = ''
      this.total = ''
    },
    async downloadApplicationLog() {
      const self = this
      this.downloaded = ''
      this.total = ''
      this.abortToken = DaemonService.cancelToken()
      const zelidauth = localStorage.getItem('zelidauth')
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        responseType: 'blob',
        onDownloadProgress(progressEvent) {
          self.downloaded = progressEvent.loaded
          self.total = progressEvent.total
        },
        // cancelToken: self.abortToken.token,
      }
      const response = await DaemonService.justAPI().get(`/apps/applog/${this.managedApplication}`, axiosConfig)
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', 'app.log')
      document.body.appendChild(link)
      link.click()
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
.locations-table td:nth-child(1) {
  width: 105px;
}
.locations-table th:nth-child(1) {
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
