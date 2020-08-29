<template>
  <div>
    <div v-if="zelAppsSection === 'localzelapps'">
      <el-tabs
        v-if="!managedApplication"
        v-model="activeName"
      >
        <el-tab-pane
          label="Running"
          name="running"
        >
          <el-table
            :data="getRunningZelAppsResponse.data"
            empty-text="No ZelApp running"
            style="width: 100%"
          >
            <el-table-column
              label="Name"
              prop="Names"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.Names[0].substr(4, scope.row.Names[0].length) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Image"
              prop="Image"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="Visit"
              prop="visit"
              sortable
            >
              <template slot-scope="scope">
                <ElButton @click="openZelApp(scope.row.Names[0].substr(4, scope.row.Names[0].length))">
                  Visit
                </ElButton>
              </template>
            </el-table-column>
            <el-table-column
              v-if="privilage === 'zelteam' || privilage === 'admin'"
              label="Actions"
              prop="actions"
              sortable
            >
              <template slot-scope="scope">
                <el-popconfirm
                  confirmButtonText='Stop'
                  cancelButtonText='No, Thanks'
                  icon="el-icon-info"
                  iconColor="red"
                  title="Stops Application"
                  @onConfirm="stopZelApp(scope.row.Names[0].substr(1, scope.row.Names[0].length))"
                >
                  <ElButton slot="reference">
                    Stop
                  </ElButton>
                </el-popconfirm>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane
          label="Installed"
          name="installed"
        >
          <el-table
            :data="installedZelApps.data"
            empty-text="No ZelApp installed"
            style="width: 100%"
          >
            <el-table-column
              label="Name"
              prop="name"
              sortable
            >
              <template slot-scope="scope">
                {{ getZelAppName(scope.row.name) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Port"
              prop="port"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="CPU"
              prop="cpu"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveCpu(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="RAM"
              prop="ram"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveRam(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="HDD"
              prop="hdd"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveHdd(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              v-if="privilage === 'zelteam' || privilage === 'admin'"
              label="Actions"
              prop="actions"
              sortable
            >
              <template slot-scope="scope">
                <el-popconfirm
                  confirmButtonText='Start'
                  cancelButtonText='No, Thanks'
                  icon="el-icon-info"
                  iconColor="green"
                  title="Starts Application"
                  @onConfirm="startZelApp(scope.row.name)"
                >
                  <ElButton slot="reference">
                    Start
                  </ElButton>
                </el-popconfirm>
                <el-popconfirm
                  confirmButtonText='Restart'
                  cancelButtonText='No, Thanks'
                  icon="el-icon-info"
                  iconColor="orange"
                  title="Retarts Application"
                  @onConfirm="restartZelApp(scope.row.name)"
                >
                  <ElButton slot="reference">
                    Restart
                  </ElButton>
                </el-popconfirm>
              </template>
            </el-table-column>
            <el-table-column
              v-if="privilage === 'zelteam' || privilage === 'admin'"
              label="Remove"
              prop="remove"
              sortable
            >
              <template slot-scope="scope">
                <el-popconfirm
                  confirmButtonText='Remove'
                  cancelButtonText='No, Thanks'
                  icon="el-icon-info"
                  iconColor="red"
                  title="Removes Application"
                  @onConfirm="removeZelApp(scope.row.name)"
                >
                  <ElButton slot="reference">
                    Remove
                  </ElButton>
                </el-popconfirm>
              </template>
            </el-table-column>
            <el-table-column
              v-if="privilage === 'zelteam' || privilage === 'admin'"
              label="Manage"
              prop="manage"
              sortable
            >
              <template slot-scope="scope">
                <el-popconfirm
                  confirmButtonText='Manage!'
                  cancelButtonText='No, Thanks'
                  icon="el-icon-info"
                  iconColor="green"
                  title="Opens Application management centre"
                  @onConfirm="openAppManagement(scope.row.name)"
                >
                  <ElButton slot="reference">
                    Manage
                  </ElButton>
                </el-popconfirm>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane
          label="Available"
          name="available"
        >
          <el-table
            :data="availableZelApps.data"
            empty-text="No ZelApp available"
            style="width: 100%"
          >
            <el-table-column
              label="Name"
              prop="name"
              sortable
            >
              <template slot-scope="scope">
                {{ getZelAppName(scope.row.name) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Image"
              prop="repotag"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="Owner"
              prop="owner"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="Port"
              prop="port"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="CPU"
              prop="cpu"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveCpu(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="RAM"
              prop="ram"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveRam(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="HDD"
              prop="hdd"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveHdd(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              v-if="privilage === 'zelteam' || privilage === 'admin'"
              label="Install"
              prop="install"
              sortable
            >
              <template slot-scope="scope">
                <el-popconfirm
                  confirmButtonText='Install'
                  cancelButtonText='No, Thanks'
                  icon="el-icon-info"
                  iconColor="green"
                  title="Installs Application"
                  @onConfirm="installTemporaryLocalApp(scope.row.name)"
                >
                  <ElButton slot="reference">
                    Install
                  </ElButton>
                </el-popconfirm>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane
          label="My Local ZelApps"
          name="myLocalZelApps"
        >
          <el-table
            :data="myLocalApps"
            empty-text="No Local ZelApp owned"
            style="width: 100%"
          >
            <el-table-column
              label="Name"
              prop="name"
              sortable
            >
              <template slot-scope="scope">
                {{ getZelAppName(scope.row.name) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Port"
              prop="port"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="CPU"
              prop="cpu"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveCpu(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="RAM"
              prop="ram"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveRam(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="HDD"
              prop="hdd"
              sortable
            >
              <template slot-scope="scope">
                {{ resolveHdd(scope.row) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Actions"
              prop="actions"
              sortable
            >
              <template slot-scope="scope">
                <el-popconfirm
                  confirmButtonText='Start'
                  cancelButtonText='No, Thanks'
                  icon="el-icon-info"
                  iconColor="green"
                  title="Starts Application"
                  @onConfirm="startZelApp(scope.row.name)"
                >
                  <ElButton slot="reference">
                    Start
                  </ElButton>
                </el-popconfirm>
                <el-popconfirm
                  confirmButtonText='Restart'
                  cancelButtonText='No, Thanks'
                  icon="el-icon-info"
                  iconColor="orange"
                  title="Retarts Application"
                  @onConfirm="restartZelApp(scope.row.name)"
                >
                  <ElButton slot="reference">
                    Restart
                  </ElButton>
                </el-popconfirm>
              </template>
            </el-table-column>
            <el-table-column
              label="Remove"
              prop="remove"
              sortable
            >
              <template slot-scope="scope">
                <el-popconfirm
                  confirmButtonText='Remove'
                  cancelButtonText='No, Thanks'
                  icon="el-icon-info"
                  iconColor="red"
                  title="Removes Application"
                  @onConfirm="removeZelApp(scope.row.name)"
                >
                  <ElButton slot="reference">
                    Remove
                  </ElButton>
                </el-popconfirm>
              </template>
            </el-table-column>
            <el-table-column
              label="Manage"
              prop="manage"
              sortable
            >
              <template slot-scope="scope">
                <el-popconfirm
                  confirmButtonText='Manage!'
                  cancelButtonText='No, Thanks'
                  icon="el-icon-info"
                  iconColor="green"
                  title="Opens Application management centre"
                  @onConfirm="openAppManagement(scope.row.name)"
                >
                  <ElButton slot="reference">
                    Manage
                  </ElButton>
                </el-popconfirm>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
      <div v-if="managedApplication">
        <el-page-header
          class="pageheader"
          @back="goBackToZelApps"
          :content="applicationManagementAndStatus"
        >
        </el-page-header>
        <el-container>
          <el-aside width="192px">
            <el-menu
              :default-active="managementMenuItem"
              mode="vertical"
              class="mobilemenu"
              @select="handleSelect"
              :unique-opened=true
              background-color="#333333"
              text-color="#fff"
              active-text-color="#ffd04b"
              style="text-align: left;"
            >
              <el-menu-item
                style="margin-bottom: -19px; margin-top: -10px; cursor: default !important;"
                disabled
              >
                <span>Local App Management</span>
              </el-menu-item>
              <el-menu-item index="appspecifics">
                <i class="el-icon-info"></i>
                <span>Specifications</span>
              </el-menu-item>
              <el-menu-item index="appinspect">
                <i class="el-icon-magic-stick"></i>
                <span>Information</span>
              </el-menu-item>
              <el-menu-item index="appstats">
                <i class="el-icon-s-platform"></i>
                <span>Resources</span>
              </el-menu-item>
              <el-menu-item index="appchanges">
                <i class="el-icon-files"></i>
                <span>File Changes</span>
              </el-menu-item>
              <el-menu-item index="appprocesses">
                <i class="el-icon-location-outline"></i>
                <span>Processes</span>
              </el-menu-item>
              <el-menu-item index="appinstances">
                <i class="el-icon-location-outline"></i>
                <span>Running Instances</span>
              </el-menu-item>
              <el-menu-item index="applogs">
                <i class="el-icon-document"></i>
                <span>Log File</span>
              </el-menu-item>
              <el-menu-item index="appcontrol">
                <i class="el-icon-s-operation"></i>
                <span>Control</span>
              </el-menu-item>
              <el-menu-item index="appexec">
                <i class="el-icon-video-play"></i>
                <span>Execute Commands</span>
              </el-menu-item>
              <hr>
              <el-menu-item
                style="margin-bottom: -19px; margin-top: -10px; cursor: default !important;"
                disabled
              >
                <span>Global App Management</span>
              </el-menu-item>
              <el-menu-item
                index="globalappspecifics"
                :disabled="callBResponse.data ? false : true"
                @click="handleGlobalDisabledClick"
              >
                <i class="el-icon-info"></i>
                <span>Global Specifications</span>
              </el-menu-item>
              <el-menu-item
                index="updateappglobalspecifications"
                :disabled="callBResponse.data ? false : true"
                @click="handleGlobalDisabledClick"
              >
                <i class="el-icon-magic-stick"></i>
                <span>Update Specifications</span>
              </el-menu-item>
            </el-menu>
          </el-aside>
          <el-main>
            <div v-if="managementMenuItem == 'appspecifics'">
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
                <p>
                  Name: {{ callResponse.data.name }}
                </p>
                <p>
                  Description: {{ callResponse.data.description }}
                </p>
                <p>
                  Specifications Hash: {{ callResponse.data.hash }}
                </p>
                <p>
                  Repository: {{ callResponse.data.repotag }}
                </p>
                <p>
                  owner: {{ callResponse.data.owner }}
                </p>
                <p>
                  Registered on Blockheight: {{ callResponse.data.height }}
                </p>
                <p>
                  Expires on Blockheight: {{ callResponse.data.height + 22000 }}
                </p>
                <p>
                  Specifications version: {{ callResponse.data.version }}
                </p>
                <p>
                  Public Port: {{ callResponse.data.port }}
                </p>
                <p>
                  Forwarded Port: {{ callResponse.data.containerPort }}
                </p>
                <p>
                  Application Data: {{ callResponse.data.containerData }}
                </p>
                <p>
                  Application Enviroment: {{ callResponse.data.enviromentParameters }}
                </p>
                <p>
                  Application Commands: {{ callResponse.data.commands }}
                </p>
                <p>
                  Tiered Specifications: {{ callResponse.data.tiered }}
                </p>
                <div v-if="callResponse.data.tiered">
                  <p>
                    BAMF CPU: {{ callResponse.data.cpubamf }} Cores
                  </p>
                  <p>
                    BAMF RAM: {{ callResponse.data.rambamf / 10 }} GB
                  </p>
                  <p>
                    BAMF SSD: {{ callResponse.data.hddbamf }} GB
                  </p>
                  <p>
                    SUPER CPU: {{ callResponse.data.cpusuper }} Cores
                  </p>
                  <p>
                    SUPER RAM: {{ callResponse.data.ramsuper / 10 }} GB
                  </p>
                  <p>
                    SUPER SSD: {{ callResponse.data.hddsuper }} GB
                  </p>
                  <p>
                    BASIC CPU: {{ callResponse.data.cpubasic }} Cores
                  </p>
                  <p>
                    BASIC RAM: {{ callResponse.data.rambasic / 10 }} GB
                  </p>
                  <p>
                    BASIC SSD: {{ callResponse.data.hddbasic }} GB
                  </p>
                </div>
                <div v-else>
                  <p>
                    CPU: {{ callResponse.data.cpu }} Cores
                  </p>
                  <p>
                    RAM: {{ callResponse.data.ram / 10 }} GB
                  </p>
                  <p>
                    SSD: {{ callResponse.data.hdd }} GB
                  </p>
                </div>
              </div>
              <div v-else>
                Local Specifications loading<i class="el-icon-loading"></i>
              </div>
              <h2>Global Specifications</h2>
              <div
                v-if="callBResponse.data"
                style="text-align: left"
              >
                <p>
                  Name: {{ callBResponse.data.name }}
                </p>
                <p>
                  Description: {{ callBResponse.data.description }}
                </p>
                <p>
                  Specifications Hash: {{ callBResponse.data.hash }}
                </p>
                <p>
                  Repository: {{ callBResponse.data.repotag }}
                </p>
                <p>
                  owner: {{ callBResponse.data.owner }}
                </p>
                <p>
                  Registered on Blockheight: {{ callBResponse.data.height }}
                </p>
                <p>
                  Expires on Blockheight: {{ callBResponse.data.height + 22000 }}
                </p>
                <p>
                  Specifications version: {{ callBResponse.data.version }}
                </p>
                <p>
                  Public Port: {{ callBResponse.data.port }}
                </p>
                <p>
                  Forwarded Port: {{ callBResponse.data.containerPort }}
                </p>
                <p>
                  Application Data: {{ callBResponse.data.containerData }}
                </p>
                <p>
                  Application Enviroment: {{ callBResponse.data.enviromentParameters }}
                </p>
                <p>
                  Application Commands: {{ callBResponse.data.commands }}
                </p>
                <p>
                  Tiered Specifications: {{ callBResponse.data.tiered }}
                </p>
                <div v-if="callBResponse.data.tiered">
                  <p>
                    BAMF CPU: {{ callBResponse.data.cpubamf }} Cores
                  </p>
                  <p>
                    BAMF RAM: {{ callBResponse.data.rambamf / 10 }} GB
                  </p>
                  <p>
                    BAMF SSD: {{ callBResponse.data.hddbamf }} GB
                  </p>
                  <p>
                    SUPER CPU: {{ callBResponse.data.cpusuper }} Cores
                  </p>
                  <p>
                    SUPER RAM: {{ callBResponse.data.ramsuper / 10 }} GB
                  </p>
                  <p>
                    SUPER SSD: {{ callBResponse.data.hddsuper }} GB
                  </p>
                  <p>
                    BASIC CPU: {{ callBResponse.data.cpubasic }} Cores
                  </p>
                  <p>
                    BASIC RAM: {{ callBResponse.data.rambasic / 10 }} GB
                  </p>
                  <p>
                    BASIC SSD: {{ callBResponse.data.hddbasic }} GB
                  </p>
                </div>
                <div v-else>
                  <p>
                    CPU: {{ callBResponse.data.cpu }} Cores
                  </p>
                  <p>
                    RAM: {{ callBResponse.data.ram / 10 }} GB
                  </p>
                  <p>
                    SSD: {{ callBResponse.data.hdd }} GB
                  </p>
                </div>
              </div>
              <div v-else-if="callBResponse.status === 'error'">
                Global specifications not found!
              </div>
              <div v-else>
                Global Specifications loading<i class="el-icon-loading"></i>
              </div>
            </div>
            <div v-if="managementMenuItem == 'appinspect'">
              <el-input
                v-if="callResponse.data"
                type="textarea"
                autosize
                v-model="stringifiedResponse"
              >
              </el-input>
            </div>
            <div v-if="managementMenuItem == 'appstats'">
              <el-input
                v-if="callResponse.data"
                type="textarea"
                autosize
                v-model="stringifiedResponse"
              >
              </el-input>
            </div>
            <div v-if="managementMenuItem == 'appchanges'">
              {{ callResponse.data }}
            </div>
            <div v-if="managementMenuItem == 'appprocesses'">
              {{ callResponse.data }}
            </div>
            <div v-if="managementMenuItem == 'appinstances'">
              {{ callResponse.data }}
            </div>

            <div v-if="managementMenuItem == 'applogs'">
              <div>
                <p>Following action will download Log file from your Application debug file. This may take a few minutes depending on file size</p>
              </div>
              <el-popconfirm
                confirmButtonText='Download Log'
                cancelButtonText='No, Thanks'
                icon="el-icon-info"
                iconColor="orange"
                title="Download Log file?"
                @onConfirm="downloadApplicationLog()"
              >
                <ElButton slot="reference">
                  Download Log File
                </ElButton>
              </el-popconfirm>
              <p v-if="total && downloaded">
                {{ (downloaded / 1e6).toFixed(2) + " / " + (total / 1e6).toFixed(2) }} MB - {{ ((downloaded / total) * 100).toFixed(2) + "%" }}
                <el-tooltip
                  content="Cancel Download"
                  placement="top"
                >
                  <el-button
                    v-if="total && downloaded && total !== downloaded"
                    type="danger"
                    icon="el-icon-close"
                    circle
                    size="mini"
                    @click="cancelDownload"
                  ></el-button>
                </el-tooltip>
              </p>
              <br><br>
              <div>
                <p>Below is an output of last 100 lines of log file</p>
              </div>
              <el-input
                v-if="callResponse.data"
                type="textarea"
                autosize
                v-model="asciResponse"
              >
              </el-input>
            </div>
            <div v-else-if="managementMenuItem == 'appcontrol'">
              <p>
                General options to control running status of ZelApp.
              </p>
              <el-popconfirm
                confirmButtonText='Start'
                cancelButtonText='No, Thanks'
                icon="el-icon-info"
                iconColor="green"
                title="Starts ZelApp"
                @onConfirm="startZelApp(managedApplication)"
              >
                <ElButton slot="reference">
                  Start ZelApp
                </ElButton>
              </el-popconfirm>
              <el-popconfirm
                confirmButtonText='Stop'
                cancelButtonText='No, Thanks'
                icon="el-icon-info"
                iconColor="red"
                title="Stops ZelApp"
                @onConfirm="stopZelApp(managedApplication)"
              >
                <ElButton slot="reference">
                  Stop ZelApp
                </ElButton>
              </el-popconfirm>
              <el-popconfirm
                confirmButtonText='Restart'
                cancelButtonText='No, Thanks'
                icon="el-icon-info"
                iconColor="orange"
                title="Restarts ZelApp"
                @onConfirm="restartZelApp(managedApplication)"
              >
                <ElButton slot="reference">
                  Restart ZelApp
                </ElButton>
              </el-popconfirm>
              <el-divider></el-divider>
              <p>
                The Pause command suspends all processes in the specified ZelApp.
              </p>
              <el-popconfirm
                confirmButtonText='Pause'
                cancelButtonText='No, Thanks'
                icon="el-icon-info"
                iconColor="orange"
                title="Pauses ZelApp"
                @onConfirm="pauseZelApp(managedApplication)"
              >
                <ElButton slot="reference">
                  Pause ZelApp
                </ElButton>
              </el-popconfirm>
              <el-popconfirm
                confirmButtonText='Unpause'
                cancelButtonText='No, Thanks'
                icon="el-icon-info"
                iconColor="orange"
                title="Unpauses ZelApp"
                @onConfirm="unpauseZelApp(managedApplication)"
              >
                <ElButton slot="reference">
                  Unpause ZelApp
                </ElButton>
              </el-popconfirm>
              <el-divider></el-divider>
              <p>
                Stops, Uninstalls and Removes all ZelApp data from this specific ZelNode.
              </p>
              <el-popconfirm
                confirmButtonText='Remove'
                cancelButtonText='No, Thanks'
                icon="el-icon-info"
                iconColor="red"
                title="Removes ZelApp"
                @onConfirm="removeZelApp(managedApplication)"
              >
                <ElButton slot="reference">
                  Remove ZelApp
                </ElButton>
              </el-popconfirm>
            </div>
            <div v-if="managementMenuItem == 'appexec'">
              <p>
                Here you can execute some commands with a set of enviroment variables on this local application instance. Both are array of strings. Useful especially for testing and tweaking purposes.
              </p>
              <el-form
                :model="zelAppRegistrationSpecification"
                label-width="100px"
              >
                <el-form-item label="Commands">
                  <el-input
                    placeholder="Array of strings of Commands"
                    textarea
                    v-model="zelAppExec.cmd"
                  >
                  </el-input>
                </el-form-item>
                <el-form-item label="Enviroment">
                  <el-input
                    placeholder="Array of strings of Enviromental Parameters"
                    textarea
                    v-model="zelAppExec.env"
                  >
                  </el-input>
                </el-form-item>
              </el-form>
              <ElButton @click="zelAppExecute">
                Execute
              </ElButton>
              <div v-if="commandExecuting">
                <i class="el-icon-loading"></i>
              </div>
              <el-input
                v-if="callResponse.data"
                type="textarea"
                autosize
                v-model="asciResponse"
              >
              </el-input>
            </div>
            <div v-if="managementMenuItem == 'globalappspecifics'">
              <h2>Global Specifications</h2>
              <div
                v-if="callBResponse.data"
                style="text-align: left"
              >
                <p>
                  Name: {{ callBResponse.data.name }}
                </p>
                <p>
                  Description: {{ callBResponse.data.description }}
                </p>
                <p>
                  Specifications Hash: {{ callBResponse.data.hash }}
                </p>
                <p>
                  Repository: {{ callBResponse.data.repotag }}
                </p>
                <p>
                  owner: {{ callBResponse.data.owner }}
                </p>
                <p>
                  Registered on Blockheight: {{ callBResponse.data.height }}
                </p>
                <p>
                  Expires on Blockheight: {{ callBResponse.data.height + 22000 }}
                </p>
                <p>
                  Specifications version: {{ callBResponse.data.version }}
                </p>
                <p>
                  Public Port: {{ callBResponse.data.port }}
                </p>
                <p>
                  Forwarded Port: {{ callBResponse.data.containerPort }}
                </p>
                <p>
                  Application Data: {{ callBResponse.data.containerData }}
                </p>
                <p>
                  Application Enviroment: {{ callBResponse.data.enviromentParameters }}
                </p>
                <p>
                  Application Commands: {{ callBResponse.data.commands }}
                </p>
                <p>
                  Tiered Specifications: {{ callBResponse.data.tiered }}
                </p>
                <div v-if="callBResponse.data.tiered">
                  <p>
                    BAMF CPU: {{ callBResponse.data.cpubamf }} Cores
                  </p>
                  <p>
                    BAMF RAM: {{ callBResponse.data.rambamf / 10 }} GB
                  </p>
                  <p>
                    BAMF SSD: {{ callBResponse.data.hddbamf }} GB
                  </p>
                  <p>
                    SUPER CPU: {{ callBResponse.data.cpusuper }} Cores
                  </p>
                  <p>
                    SUPER RAM: {{ callBResponse.data.ramsuper / 10 }} GB
                  </p>
                  <p>
                    SUPER SSD: {{ callBResponse.data.hddsuper }} GB
                  </p>
                  <p>
                    BASIC CPU: {{ callBResponse.data.cpubasic }} Cores
                  </p>
                  <p>
                    BASIC RAM: {{ callBResponse.data.rambasic / 10 }} GB
                  </p>
                  <p>
                    BASIC SSD: {{ callBResponse.data.hddbasic }} GB
                  </p>
                </div>
                <div v-else>
                  <p>
                    CPU: {{ callBResponse.data.cpu }} Cores
                  </p>
                  <p>
                    RAM: {{ callBResponse.data.ram / 10 }} GB
                  </p>
                  <p>
                    SSD: {{ callBResponse.data.hdd }} GB
                  </p>
                </div>
              </div>
              <div v-else-if="callBResponse.status === 'error'">
                Global specifications not found!
              </div>
              <div v-else>
                Global Specifications loading<i class="el-icon-loading"></i>
              </div>
            </div>
            <div v-if="managementMenuItem === 'updateappglobalspecifications'">
              <div v-if="!fluxCommunication">
                Warninig: Connected Flux is not communicating properly with Flux network
              </div>
              <h2>Here you can update your application specifications.</h2>
              <div class="zelapps-register">
                <el-form
                  :model="zelAppUpdateSpecification"
                  label-width="100px"
                >
                  <el-form-item label="Version">
                    <el-input
                      placeholder="ZelApp Version"
                      disabled
                      v-model="zelAppUpdateSpecification.version"
                    >
                    </el-input>
                  </el-form-item>
                  <el-form-item label="Name">
                    <el-input
                      placeholder="ZelApp name"
                      disabled
                      v-model="zelAppUpdateSpecification.name"
                    >
                    </el-input>
                  </el-form-item>
                  <el-form-item label="Desc.">
                    <el-input
                      placeholder="Description"
                      type="textarea"
                      autosize
                      v-model="zelAppUpdateSpecification.description"
                    >
                    </el-input>
                  </el-form-item>
                  <el-form-item label="Repo">
                    <el-input
                      placeholder="Docker Hub namespace/repository:tag"
                      disabled
                      v-model="zelAppUpdateSpecification.repotag"
                    >
                    </el-input>
                  </el-form-item>
                  <el-form-item label="Owner">
                    <el-input
                      placeholder="ZelID of application owner"
                      v-model="zelAppUpdateSpecification.owner"
                    >
                    </el-input>
                  </el-form-item>
                  <el-form-item label="Port">
                    <el-input
                      placeholder="Port on which application will be available"
                      type="number"
                      min="31000"
                      max="39999"
                      v-model="zelAppUpdateSpecification.port"
                    >
                    </el-input>
                  </el-form-item>
                  <el-form-item label="Enviroment">
                    <el-input
                      placeholder="Array of strings of Enviromental Parameters"
                      textarea
                      v-model="zelAppUpdateSpecification.enviromentParameters"
                    >
                    </el-input>
                  </el-form-item>
                  <el-form-item label="Commands">
                    <el-input
                      placeholder="Array of strings of Commands"
                      textarea
                      v-model="zelAppUpdateSpecification.commands"
                    >
                    </el-input>
                  </el-form-item>
                  <el-form-item label="Cont. Port">
                    <el-input
                      placeholder="Container Port - port on which your container has"
                      nubmer
                      min="0"
                      max="65535"
                      v-model="zelAppUpdateSpecification.containerPort"
                    >
                    </el-input>
                  </el-form-item>
                  <el-form-item label="Cont. Data">
                    <el-input
                      placeholder="Data folder that is shared by application to ZelApp volume"
                      textarea
                      v-model="zelAppUpdateSpecification.containerData"
                    >
                    </el-input>
                  </el-form-item>
                  <el-form-item label="CPU">
                    <el-input
                      placeholder="CPU cores to use by default"
                      nubmer
                      min="0"
                      max="7"
                      step="0.1"
                      v-model="zelAppUpdateSpecification.cpu"
                    >
                    </el-input>
                  </el-form-item>
                  <el-form-item label="RAM">
                    <el-input
                      placeholder="RAM in MB value to use by default"
                      nubmer
                      min="0"
                      max="28000"
                      step="100"
                      v-model="zelAppUpdateSpecification.ram"
                    >
                    </el-input>
                  </el-form-item>
                  <el-form-item label="SSD">
                    <el-input
                      placeholder="SSD in GB value to use by default"
                      nubmer
                      min="0"
                      max="570"
                      step="1"
                      v-model="zelAppUpdateSpecification.hdd"
                    >
                    </el-input>
                  </el-form-item>
                  <el-form-item label="Tiered">
                    <el-switch v-model="zelAppUpdateSpecification.tiered"></el-switch>
                  </el-form-item>
                  <div v-if="zelAppUpdateSpecification.tiered">
                    <el-form-item label="BASIC CPU">
                      <el-input
                        placeholder="CPU cores to use by BASIC"
                        nubmer
                        min="0"
                        max="1"
                        step="0.1"
                        v-model="zelAppUpdateSpecification.cpubasic"
                      >
                      </el-input>
                    </el-form-item>
                    <el-form-item label="BASIC RAM">
                      <el-input
                        placeholder="RAM in MB value to use by BASIC"
                        nubmer
                        min="0"
                        max="1000"
                        step="100"
                        v-model="zelAppUpdateSpecification.rambasic"
                      >
                      </el-input>
                    </el-form-item>
                    <el-form-item label="BASIC SSD">
                      <el-input
                        placeholder="SSD in GB value to use by BASIC"
                        nubmer
                        min="0"
                        max="20"
                        step="1"
                        v-model="zelAppUpdateSpecification.hddbasic"
                      >
                      </el-input>
                    </el-form-item>
                    <el-form-item label="SUPER CPU">
                      <el-input
                        placeholder="CPU cores to use by SUPER"
                        nubmer
                        min="0"
                        max="3"
                        step="0.1"
                        v-model="zelAppUpdateSpecification.cpusuper"
                      >
                      </el-input>
                    </el-form-item>
                    <el-form-item label="SUPER RAM">
                      <el-input
                        placeholder="RAM in MB value to use by SUPER"
                        nubmer
                        min="0"
                        max="5000"
                        step="100"
                        v-model="zelAppUpdateSpecification.ramsuper"
                      >
                      </el-input>
                    </el-form-item>
                    <el-form-item label="SUPER SSD">
                      <el-input
                        placeholder="SSD in GB value to use by SUPER"
                        nubmer
                        min="0"
                        max="120"
                        step="1"
                        v-model="zelAppUpdateSpecification.hddsuper"
                      >
                      </el-input>
                    </el-form-item>
                    <el-form-item label="BAMF CPU">
                      <el-input
                        placeholder="CPU cores to use by BAMF"
                        nubmer
                        min="0"
                        max="7"
                        step="0.1"
                        v-model="zelAppUpdateSpecification.cpubamf"
                      >
                      </el-input>
                    </el-form-item>
                    <el-form-item label="BAMF RAM">
                      <el-input
                        placeholder="RAM in MB value to use by BAMF"
                        nubmer
                        min="0"
                        max="28000"
                        step="100"
                        v-model="zelAppUpdateSpecification.rambamf"
                      >
                      </el-input>
                    </el-form-item>
                    <el-form-item label="BAMF SSD">
                      <el-input
                        placeholder="SSD in GB value to use by BAMF"
                        nubmer
                        min="0"
                        max="570"
                        step="1"
                        v-model="zelAppUpdateSpecification.hddbamf"
                      >
                      </el-input>
                    </el-form-item>
                  </div>
                </el-form>
              </div>
              <div>
                <ElButton @click="checkFluxUpdateSpecificationsAndFormatMessage">
                  Compute Update Message
                </ElButton>
              </div>
              <div v-if="dataToSign">
                <el-form>
                  <el-form-item label="Update Message">
                    <el-input
                      type="textarea"
                      autosize
                      disabled
                      v-model="dataToSign"
                    >
                    </el-input>
                  </el-form-item>
                  <el-form-item label="Signature">
                    <el-input
                      type="textarea"
                      autosize
                      v-model="signature"
                    >
                    </el-input>
                  </el-form-item>
                </el-form>
                <div>
                  Sign with ZelCore
                  <br>
                  <a
                    @click="initiateSignWS"
                    :href="'zel:?action=sign&message=' + dataToSign + '&icon=http%3A%2F%2Fzelid.io%2Fimg%2FzelID.svg&callback=http%3A%2F%2F' + userconfig.externalip + ':' + config.apiPort + '%2Fzelid%2Fprovidesign%2F'"
                  >
                    <img
                      class="zelidLogin"
                      src="@/assets/img/zelID.svg"
                    />
                  </a>
                </div>
                <br><br>
              </div>
            </div>
          </el-main>
        </el-container>
      </div>
      <div
        v-if="output"
        class='actionCenter'
      >
        <br>
        <el-input
          type="textarea"
          autosize
          v-model="stringOutput"
        >
        </el-input>
      </div>
    </div>
    <div v-if="zelAppsSection === 'globalzelapps'">
      <el-tabs v-model="activeNameGlobal">
        <el-tab-pane
          label="Active Apps"
          name="activeapps"
        >
          <el-table
            :data="globalZelAppSpecs.data"
            empty-text="No global ZelApp"
            style="width: 100%"
          >
            <el-table-column
              label="Name"
              prop="name"
              sortable
            >
              <template slot-scope="scope">
                {{ getZelAppName(scope.row.name) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Description"
              prop="description"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="Visit"
              prop="visit"
              sortable
            >
              <template slot-scope="scope">
                <ElButton @click="openGlobalZelApp(scope.row.name)">
                  Visit
                </ElButton>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane
          label="My Apps"
          name="myeapps"
        >
          <el-table
            :data="myGlobalApps"
            empty-text="No global ZelApp owned"
            style="width: 100%"
          >
            <el-table-column
              label="Name"
              prop="name"
              sortable
            >
              <template slot-scope="scope">
                {{ getZelAppName(scope.row.name) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Description"
              prop="description"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="Visit"
              prop="visit"
              sortable
            >
              <template slot-scope="scope">
                <ElButton @click="openGlobalZelApp(scope.row.name)">
                  Visit
                </ElButton>
              </template>
            </el-table-column>
            <el-table-column
              label="Manage"
              prop="manage"
              sortable
            >
              <template slot-scope="scope">
                <ElButton @click="openAppManagement(scope.row.name)">
                  Manage
                </ElButton>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
      <div
        v-if="output"
        class='actionCenter'
      >
        <br>
        <el-input
          v-if="output"
          type="textarea"
          autosize
          v-model="stringOutput"
        >
        </el-input>
      </div>
    </div>
    <div v-if="zelAppsSection === 'registerzelapp'">
      <div v-if="!fluxCommunication">
        Warninig: Connected Flux is not communicating properly with Flux network
      </div>
      <div class="zelapps-register">
        <el-form
          :model="zelAppRegistrationSpecification"
          label-width="100px"
        >
          <el-form-item label="Version">
            <el-input
              placeholder="ZelApp Version"
              disabled
              v-model="zelAppRegistrationSpecification.version"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Name">
            <el-input
              placeholder="ZelApp name"
              v-model="zelAppRegistrationSpecification.name"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Desc.">
            <el-input
              placeholder="Description"
              type="textarea"
              autosize
              v-model="zelAppRegistrationSpecification.description"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Repo">
            <el-input
              placeholder="Docker Hub namespace/repository:tag"
              v-model="zelAppRegistrationSpecification.repotag"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Owner">
            <el-input
              placeholder="ZelID of application owner"
              v-model="zelAppRegistrationSpecification.owner"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Port">
            <el-input
              placeholder="Port on which application will be available"
              type="number"
              min="31000"
              max="39999"
              v-model="zelAppRegistrationSpecification.port"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Enviroment">
            <el-input
              placeholder="Array of strings of Enviromental Parameters"
              textarea
              v-model="zelAppRegistrationSpecification.enviromentParameters"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Commands">
            <el-input
              placeholder="Array of strings of Commands"
              textarea
              v-model="zelAppRegistrationSpecification.commands"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Cont. Port">
            <el-input
              placeholder="Container Port - port on which your container has"
              nubmer
              min="0"
              max="65535"
              v-model="zelAppRegistrationSpecification.containerPort"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Cont. Data">
            <el-input
              placeholder="Data folder that is shared by application to ZelApp volume"
              textarea
              v-model="zelAppRegistrationSpecification.containerData"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="CPU">
            <el-input
              placeholder="CPU cores to use by default"
              nubmer
              min="0"
              max="7"
              step="0.1"
              v-model="zelAppRegistrationSpecification.cpu"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="RAM">
            <el-input
              placeholder="RAM in MB value to use by default"
              nubmer
              min="0"
              max="28000"
              step="100"
              v-model="zelAppRegistrationSpecification.ram"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="SSD">
            <el-input
              placeholder="SSD in GB value to use by default"
              nubmer
              min="0"
              max="570"
              step="1"
              v-model="zelAppRegistrationSpecification.hdd"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Tiered">
            <el-switch v-model="zelAppRegistrationSpecification.tiered"></el-switch>
          </el-form-item>
          <div v-if="zelAppRegistrationSpecification.tiered">
            <el-form-item label="BASIC CPU">
              <el-input
                placeholder="CPU cores to use by BASIC"
                nubmer
                min="0"
                max="1"
                step="0.1"
                v-model="zelAppRegistrationSpecification.cpubasic"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="BASIC RAM">
              <el-input
                placeholder="RAM in MB value to use by BASIC"
                nubmer
                min="0"
                max="1000"
                step="100"
                v-model="zelAppRegistrationSpecification.rambasic"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="BASIC SSD">
              <el-input
                placeholder="SSD in GB value to use by BASIC"
                nubmer
                min="0"
                max="20"
                step="1"
                v-model="zelAppRegistrationSpecification.hddbasic"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="SUPER CPU">
              <el-input
                placeholder="CPU cores to use by SUPER"
                nubmer
                min="0"
                max="3"
                step="0.1"
                v-model="zelAppRegistrationSpecification.cpusuper"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="SUPER RAM">
              <el-input
                placeholder="RAM in MB value to use by SUPER"
                nubmer
                min="0"
                max="5000"
                step="100"
                v-model="zelAppRegistrationSpecification.ramsuper"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="SUPER SSD">
              <el-input
                placeholder="SSD in GB value to use by SUPER"
                nubmer
                min="0"
                max="120"
                step="1"
                v-model="zelAppRegistrationSpecification.hddsuper"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="BAMF CPU">
              <el-input
                placeholder="CPU cores to use by BAMF"
                nubmer
                min="0"
                max="7"
                step="0.1"
                v-model="zelAppRegistrationSpecification.cpubamf"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="BAMF RAM">
              <el-input
                placeholder="RAM in MB value to use by BAMF"
                nubmer
                min="0"
                max="28000"
                step="100"
                v-model="zelAppRegistrationSpecification.rambamf"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="BAMF SSD">
              <el-input
                placeholder="SSD in GB value to use by BAMF"
                nubmer
                min="0"
                max="570"
                step="1"
                v-model="zelAppRegistrationSpecification.hddbamf"
              >
              </el-input>
            </el-form-item>
          </div>
        </el-form>
        <div>
          <ElButton @click="checkFluxSpecificationsAndFormatMessage">
            Compute Registration Message
          </ElButton>
        </div>
        <div v-if="dataToSign">
          <el-form>
            <el-form-item label="Registration Message">
              <el-input
                type="textarea"
                autosize
                disabled
                v-model="dataToSign"
              >
              </el-input>
            </el-form-item>
            <el-form-item label="Signature">
              <el-input
                type="textarea"
                autosize
                v-model="signature"
              >
              </el-input>
            </el-form-item>
          </el-form>
          <div>
            Sign with ZelCore
            <br>
            <a
              @click="initiateSignWS"
              :href="'zel:?action=sign&message=' + dataToSign + '&icon=http%3A%2F%2Fzelid.io%2Fimg%2FzelID.svg&callback=http%3A%2F%2F' + userconfig.externalip + ':' + config.apiPort + '%2Fzelid%2Fprovidesign%2F'"
            >
              <img
                class="zelidLogin"
                src="@/assets/img/zelID.svg"
              />
            </a>
          </div>
          <br><br>
          Price per Month: {{ appPricePerMonth }} ZEL
          <br><br>
          <ElButton @click="register">
            Register ZelApp
          </ElButton>
          <br><br>
          <div v-if="registrationHash">
            {{ registrationHash }}
            To finish registration, Please do a transaction of {{ appPricePerMonth }} to address
            {{ zelapps.address }}
            with following message:
            {{ registrationHash }}
            <br><br>
            Transaction must be mined by {{ new Date(validTill).toLocaleString('en-GB', timeoptions) }}
          </div>
          <div v-if="registrationHash">
            Pay with ZelCore
            <br>
            <a
              @click="initiateSignWS"
              :href="'zel:?action=pay&coin=zelcash&address=' + zelapps.address + '&amount=' + appPricePerMonth + '&message=' + registrationHash + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Fzelcash%2Fzelflux%2Fmaster%2FZelFront%2Fsrc%2Fassets%2Fimg%2Fflux_banner.png'"
            >
              <img
                class="zelidLogin"
                src="@/assets/img/zelID.svg"
              />
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

import ZelCashService from '@/services/ZelCashService';
import ZelAppsService from '@/services/ZelAppsService';

const store = require('store');
const qs = require('qs');

Vue.use(Vuex);

const vue = new Vue();

export default {
  name: 'ZelApps',
  data() {
    return {
      timeoptions: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
      activeName: 'running',
      activeNameGlobal: 'activeapps',
      getRunningZelAppsResponse: {
        status: '',
        data: [],
      },
      getAllZelAppsResponse: {
        status: '',
        data: [],
      },
      installedZelApps: {
        status: '',
        data: [],
      },
      availableZelApps: {
        status: '',
        data: [],
      },
      globalZelAppSpecs: {
        status: '',
        data: [],
      },
      tier: '',
      output: '',
      fluxCommunication: false,
      zelAppRegistrationSpecificationB: {
        version: 1,
        name: '',
        description: '',
        repotag: '',
        owner: '',
        port: null,
        enviromentParameters: '', // []
        commands: '', // []
        containerPort: null,
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
      zelAppRegistrationSpecification: {
        version: 1,
        name: 'tralalafolding',
        description: 'Folding @ Home is cool :)',
        repotag: 'yurinnick/folding-at-home:latest',
        owner: '1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC',
        port: 31000,
        enviromentParameters: '["USER=foldingUser", "TEAM=262156", "ENABLE_GPU=false", "ENABLE_SMP=true"]', // []
        commands: '["--allow","0/0","--web-allow","0/0"]', // []
        containerPort: 7396,
        containerData: '/config',
        cpu: 0.5,
        ram: 500,
        hdd: 5,
        tiered: false,
        cpubasic: 0.5,
        rambasic: 500,
        hddbasic: 5,
        cpusuper: 1,
        ramsuper: 1000,
        hddsuper: 5,
        cpubamf: 2,
        rambamf: 2000,
        hddbamf: 5,
      },
      zelAppUpdateSpecification: {
        version: 1,
        name: '',
        description: '',
        repotag: '',
        owner: '',
        port: null,
        enviromentParameters: '', // []
        commands: '', // []
        containerPort: null,
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
      registrationtype: 'zelappregister',
      updatetype: 'zelappupdate',
      version: 1,
      dataForZelAppRegistration: {},
      dataForZelAppUpdate: {},
      dataToSign: '',
      timestamp: '',
      signature: '',
      registrationHash: '',
      updateHash: '',
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
      zelapps: {
        // in zel per month
        price: {
          cpu: 3 * 5, // per 0.1 cpu core,
          ram: 1 * 5, // per 100mb,
          hdd: 0.5 * 5, // per 1gb,
        },
        address: 't1...', // apps registration address
        epochstart: 690000, // zelapps epoch blockheight start
        portMin: 31000, // originally should have been from 30000 but we got temporary folding there
        portMax: 39999,
      },
      websocket: null,
      managedApplication: '',
      managementMenuItem: 'appspecifics',
      selectedAppOwner: '',
      callResponse: { // general
        status: '',
        data: '',
      },
      callBResponse: { // general B
        status: '',
        data: '',
      },
      total: '',
      downloaded: '',
      abortToken: {},
      zelAppExec: {
        cmd: '',
        env: '',
      },
      commandExecuting: false,
      defaultProps: {
        children: 'children',
        label: 'label',
      },
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'zelAppsSection',
      'privilage',
    ]),
    applicationManagementAndStatus() {
      console.log(this.getAllZelAppsResponse);
      const zelappInfo = this.getAllZelAppsResponse.data.find((zelapp) => zelapp.Names[0] === this.getZelAppDockerNameIdentifier()) || {};
      const appInfo = {
        name: this.managedApplication,
        state: zelappInfo.State || 'Unknown state',
        status: zelappInfo.Status || 'Unkown status',
      };
      appInfo.state = appInfo.state.charAt(0).toUpperCase() + appInfo.state.slice(1);
      appInfo.status = appInfo.status.charAt(0).toUpperCase() + appInfo.status.slice(1);
      const niceString = `${appInfo.name} - ${appInfo.state} - ${appInfo.status}`;
      return niceString;
    },
    asciResponse() {
      if (typeof this.callResponse.data === 'string') {
        return this.callResponse.data.replace(/[^\x20-\x7E \t\r\n\v\f]/g, '');
      }
      return '';
    },
    myGlobalApps() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      if (this.globalZelAppSpecs.data) {
        return this.globalZelAppSpecs.data.filter((app) => app.owner === auth.zelid);
      }
      return [];
    },
    myLocalApps() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      if (this.installedZelApps.data) {
        return this.installedZelApps.data.filter((app) => app.owner === auth.zelid);
      }
      return [];
    },
    stringifiedResponse() {
      return JSON.stringify(this.callResponse.data, null, 4);
    },
    stringOutput() {
      let string = '';
      this.output.forEach((output) => {
        string += `${JSON.stringify(output)}\r\n`;
      });
      return string;
    },
    appPricePerMonth() {
      let price = 10;
      if (this.dataForZelAppRegistration.tiered) {
        const cpuTotalCount = this.dataForZelAppRegistration.cpubasic + this.dataForZelAppRegistration.cpusuper + this.dataForZelAppRegistration.cpubamf;
        const cpuPrice = cpuTotalCount * this.zelapps.price.cpu * 10; // 0.1 core cost cpu price
        const cpuTotal = cpuPrice / 3;
        const ramTotalCount = this.dataForZelAppRegistration.rambasic + this.dataForZelAppRegistration.ramsuper + this.dataForZelAppRegistration.rambamf;
        const ramPrice = (ramTotalCount * this.zelapps.price.ram) / 100;
        const ramTotal = ramPrice / 3;
        const hddTotalCount = this.dataForZelAppRegistration.hddbasic + this.dataForZelAppRegistration.hddsuper + this.dataForZelAppRegistration.hddbamf;
        const hddPrice = hddTotalCount * this.zelapps.price.hdd;
        const hddTotal = hddPrice / 3;
        price = Math.ceil(cpuTotal + ramTotal + hddTotal);
        if (price < 10) {
          price = 10;
        }
        return price;
      }
      const cpuTotal = this.dataForZelAppRegistration.cpu * this.zelapps.price.cpu * 10;
      const ramTotal = (this.dataForZelAppRegistration.ram * this.zelapps.price.ram) / 100;
      const hddTotal = this.dataForZelAppRegistration.hdd * this.zelapps.price.hdd;
      price = Math.ceil(cpuTotal + ramTotal + hddTotal);
      if (price < 10) {
        price = 10;
      }
      return price;
    },
    validTill() {
      const expTime = this.timestamp + 60 * 60 * 1000; // 1 hour
      return expTime;
    },
  },
  watch: {
    zelAppsSection(val, oldVal) {
      console.log(val, oldVal);
      this.switcher(val);
    },
    activeName(val, oldVal) {
      this.callResponse.data = '';
      this.callResponse.status = '';
      this.callBResponse.data = '';
      this.callBResponse.status = '';
      this.zelAppExec.cmd = '';
      this.zelAppExec.env = '';
      console.log(val, oldVal);
      this.output = '';
      switch (val) {
        case 'running':
          this.zelappsGetListRunningZelApps();
          break;
        case 'all':
          this.zelappsGetListAllZelApps();
          break;
        case 'installed':
          this.zelappsGetInstalledZelApps();
          this.zelappsGetListAllZelApps();
          break;
        case 'available':
          this.zelappsGetAvailableZelApps();
          break;
        case 'myLocalZelApps':
          this.zelappsGetInstalledZelApps();
          this.zelappsGetListAllZelApps();
          break;
        case 'stopped':
          // getting all and checking state?
          break;
        default:
          console.log('ZelApps Section: Unrecognized method'); // should not be visible if everything works correctly
      }
    },
    zelAppRegistrationSpecification: {
      handler(val, oldVal) {
        console.log(val, oldVal);
        this.dataToSign = '';
        this.signature = '';
        this.timestamp = null;
        this.dataForZelAppRegistration = {};
        this.registrationHash = '';
        if (this.websocket !== null) {
          this.websocket.close();
          this.websocket = null;
        }
      },
      deep: true,
    },
    zelAppUpdateSpecification: {
      handler(val, oldVal) {
        console.log(val, oldVal);
        this.dataToSign = '';
        this.signature = '';
        this.timestamp = null;
        this.dataForZelAppUpdate = {};
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
    const zelidauth = localStorage.getItem('zelidauth');
    const auth = qs.parse(zelidauth);
    this.zelAppRegistrationSpecification.owner = auth.zelid;
    console.log(auth);
    this.getZelNodeStatus();
    this.zelappsGetInstalledZelApps();
    this.switcher(this.zelAppsSection);
  },
  methods: {
    switcher(value) {
      switch (value) {
        case 'localzelapps':
          this.zelappsGetListRunningZelApps();
          break;
        case 'globalzelapps':
          this.zelappsGetListGlobalZelApps();
          break;
        case 'registerzelapp':
          this.registrationInformation();
          this.checkFluxCommunication();
          break;
        default:
          console.log('ZelApps Section: Unrecognized method');
      }
    },
    async zelappsGetListGlobalZelApps() {
      const response = await ZelAppsService.globalZelAppSpecifications();
      console.log(response);
      this.globalZelAppSpecs.status = response.data.status;
      this.globalZelAppSpecs.data = response.data.data;
    },
    async zelappsGetAvailableZelApps() {
      const response = await ZelAppsService.availableZelApps();
      this.availableZelApps.status = response.data.status;
      this.availableZelApps.data = response.data.data;
    },
    async zelappsGetInstalledZelApps() {
      const response = await ZelAppsService.installedZelApps();
      this.installedZelApps.status = response.data.status;
      this.installedZelApps.data = response.data.data;
    },
    async zelappsGetListRunningZelApps() {
      const response = await ZelAppsService.listRunningZelApps();
      console.log(response);
      this.getRunningZelAppsResponse.status = response.data.status;
      this.getRunningZelAppsResponse.data = response.data.data;
    },
    async zelappsGetListAllZelApps() {
      const response = await ZelAppsService.listAllZelApps();
      console.log(response);
      this.getAllZelAppsResponse.status = response.data.status;
      this.getAllZelAppsResponse.data = response.data.data;
    },
    async stopZelApp(zelapp) {
      this.output = '';
      vue.$customMes.success('Stopping ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.stopZelApp(zelidauth, zelapp);
      if (response.data.status === 'success') {
        vue.$customMes.success(response.data.data.message || response.data.data);
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
      this.zelappsGetListAllZelApps();
      this.zelappsGetListRunningZelApps();
      console.log(response);
    },
    async startZelApp(zelapp) {
      this.output = '';
      vue.$customMes.success('Starting ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.startZelApp(zelidauth, zelapp);
      if (response.data.status === 'success') {
        vue.$customMes.success(response.data.data.message || response.data.data);
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
      this.zelappsGetListAllZelApps();
      console.log(response);
    },
    async restartZelApp(zelapp) {
      this.output = '';
      vue.$customMes.success('Restarting ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.restartZelApp(zelidauth, zelapp);
      if (response.data.status === 'success') {
        vue.$customMes.success(response.data.data.message || response.data.data);
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
      this.zelappsGetListAllZelApps();
      console.log(response);
    },
    async pauseZelApp(zelapp) {
      this.output = '';
      vue.$customMes.success('Pausing ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.pauseZelApp(zelidauth, zelapp);
      if (response.data.status === 'success') {
        vue.$customMes.success(response.data.data.message || response.data.data);
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
      this.zelappsGetListAllZelApps();
      console.log(response);
    },
    async unpauseZelApp(zelapp) {
      this.output = '';
      vue.$customMes.success('UnPausing ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.unpauseZelApp(zelidauth, zelapp);
      if (response.data.status === 'success') {
        vue.$customMes.success(response.data.data.message || response.data.data);
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
      this.zelappsGetListAllZelApps();
      console.log(response);
    },
    async removeZelApp(zelapp) {
      const self = this;
      this.output = '';
      vue.$customMes.success('Removing ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      // const response = await ZelAppsService.installFoldingAtHome(zelidauth, zelapp);
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.target.response);
          self.output = JSON.parse(`[${progressEvent.target.response.replace(/}{/g, '},{')}]`);
        },
      };
      const response = await ZelAppsService.justAPI().get(`/zelapps/zelappremove/${zelapp}`, axiosConfig);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.zelappsGetInstalledZelApps();
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
        if (this.output[this.output.length - 1].status === 'error') {
          vue.$customMes.error(this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          vue.$customMes.success(this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        }
        setTimeout(() => {
          self.managedApplication = '';
        }, 5000);
      }
    },
    async installTemporaryLocalApp(zelapp) { // todo rewrite to installZelApp later
      const appName = zelapp;
      const self = this;
      this.output = '';
      vue.$customMes.success('Installing ZelApp');
      const zelidauth = localStorage.getItem('zelidauth');
      // const response = await ZelAppsService.installTemporaryLocalApp(zelidauth, zelapp);
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.target.response);
          self.output = JSON.parse(`[${progressEvent.target.response.replace(/}{/g, '},{')}]`);
        },
      };
      const response = await ZelAppsService.justAPI().get(`/zelapps/installtemporarylocalapp/${appName}`, axiosConfig);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        console.log(response);
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
        console.log(this.output);
        for (let i = 0; i < this.output.length; i += 1) {
          if (this.output[i] && this.output[i].data && this.output[i].data.message && this.output[i].data.message.includes('Error occured')) {
            // error is defined one line above
            if (this.output[i - 1] && this.output[i - 1].data) {
              vue.$customMes.error(this.output[i - 1].data.message || this.output[i - 1].data);
              return;
            }
          }
        }
        if (this.output[this.output.length - 1].status === 'error') {
          vue.$customMes.error(this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          vue.$customMes.success(this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        }
      }
    },
    installedZelApp(zelappName) {
      return this.installedZelApps.data.find((zelapp) => zelapp.name === zelappName);
    },
    openZelApp(name) {
      let zelappInfo = this.installedZelApp(name);
      if (!zelappInfo) {
        zelappInfo = this.installedZelApp(`zel${name}`);
      }
      if (zelappInfo) {
        const backendURL = store.get('backendURL') || `http://${this.userconfig.externalip}:${this.config.apiPort}`;
        const ip = backendURL.split(':')[1].split('//')[1];
        const url = `http://${ip}:${zelappInfo.port}`;
        this.openSite(url);
      } else {
        vue.$customMes.error('Unable to open ZelApp :(');
      }
    },
    async getZelNodeStatus() {
      const response = await ZelCashService.getZelNodeStatus();
      if (response.data.status === 'success') {
        this.tier = response.data.tier;
      }
    },
    resolveCpu(zelapp) {
      if (this.tier === 'BASIC') {
        return (`${zelapp.cpubasic || zelapp.cpu} cores`);
      }
      if (this.tier === 'SUPER') {
        return (`${zelapp.cpusuper || zelapp.cpu} cores`);
      }
      if (this.tier === 'BAMF') {
        return (`${zelapp.cpubamf || zelapp.cpu} cores`);
      }
      return (`${zelapp.cpu} cores`);
    },
    resolveRam(zelapp) {
      if (this.tier === 'BASIC') {
        return (`${zelapp.rambasic || zelapp.ram} MB`);
      }
      if (this.tier === 'SUPER') {
        return (`${zelapp.ramsuper || zelapp.ram} MB`);
      }
      if (this.tier === 'BAMF') {
        return (`${zelapp.rambamf || zelapp.ram} MB`);
      }
      return (`${zelapp.ram} MB`);
    },
    resolveHdd(zelapp) {
      if (this.tier === 'BASIC') {
        return (`${zelapp.hddbasic || zelapp.hdd} GB`);
      }
      if (this.tier === 'SUPER') {
        return (`${zelapp.hddsuper || zelapp.hdd} GB`);
      }
      if (this.tier === 'BAMF') {
        return (`${zelapp.hddbamf || zelapp.hdd} GB`);
      }
      return (`${zelapp.hdd} GB`);
    },
    openSite(url) {
      const win = window.open(url, '_blank');
      win.focus();
    },
    checkHWParameters(zelAppSpecs) {
      // check specs parameters. JS precision
      if ((zelAppSpecs.cpu * 10) % 1 !== 0 || (zelAppSpecs.cpu * 10) > (this.fluxSpecifics.cpu.bamf - this.lockedSystemResources.cpu) || zelAppSpecs.cpu < 0.1) {
        return new Error('CPU badly assigned');
      }
      if (zelAppSpecs.ram % 100 !== 0 || zelAppSpecs.ram > (this.fluxSpecifics.ram.bamf - this.lockedSystemResources.ram) || zelAppSpecs.ram < 100) {
        return new Error('RAM badly assigned');
      }
      if (zelAppSpecs.hdd % 1 !== 0 || zelAppSpecs.hdd > (this.fluxSpecifics.hdd.bamf - this.lockedSystemResources.hdd) || zelAppSpecs.hdd < 1) {
        return new Error('SSD badly assigned');
      }
      if (zelAppSpecs.tiered) {
        if ((zelAppSpecs.cpubasic * 10) % 1 !== 0 || (zelAppSpecs.cpubasic * 10) > (this.fluxSpecifics.cpu.basic - this.lockedSystemResources.cpu) || zelAppSpecs.cpubasic < 0.1) {
          return new Error('CPU for BASIC badly assigned');
        }
        if (zelAppSpecs.rambasic % 100 !== 0 || zelAppSpecs.rambasic > (this.fluxSpecifics.ram.basic - this.lockedSystemResources.ram) || zelAppSpecs.rambasic < 100) {
          return new Error('RAM for BASIC badly assigned');
        }
        if (zelAppSpecs.hddbasic % 1 !== 0 || zelAppSpecs.hddbasic > (this.fluxSpecifics.hdd.basic - this.lockedSystemResources.hdd) || zelAppSpecs.hddbasic < 1) {
          return new Error('SSD for BASIC badly assigned');
        }
        if ((zelAppSpecs.cpusuper * 10) % 1 !== 0 || (zelAppSpecs.cpusuper * 10) > (this.fluxSpecifics.cpu.super - this.lockedSystemResources.cpu) || zelAppSpecs.cpusuper < 0.1) {
          return new Error('CPU for SUPER badly assigned');
        }
        if (zelAppSpecs.ramsuper % 100 !== 0 || zelAppSpecs.ramsuper > (this.fluxSpecifics.ram.super - this.lockedSystemResources.ram) || zelAppSpecs.ramsuper < 100) {
          return new Error('RAM for SUPER badly assigned');
        }
        if (zelAppSpecs.hddsuper % 1 !== 0 || zelAppSpecs.hddsuper > (this.fluxSpecifics.hdd.super - this.lockedSystemResources.hdd) || zelAppSpecs.hddsuper < 1) {
          return new Error('SSD for SUPER badly assigned');
        }
        if ((zelAppSpecs.cpubamf * 10) % 1 !== 0 || (zelAppSpecs.cpubamf * 10) > (this.fluxSpecifics.cpu.bamf - this.lockedSystemResources.cpu) || zelAppSpecs.cpubamf < 0.1) {
          return new Error('CPU for BAMF badly assigned');
        }
        if (zelAppSpecs.rambamf % 100 !== 0 || zelAppSpecs.rambamf > (this.fluxSpecifics.ram.bamf - this.lockedSystemResources.ram) || zelAppSpecs.rambamf < 100) {
          return new Error('RAM for BAMF badly assigned');
        }
        if (zelAppSpecs.hddbamf % 1 !== 0 || zelAppSpecs.hddbamf > (this.fluxSpecifics.hdd.bamf - this.lockedSystemResources.hdd) || zelAppSpecs.hddbamf < 1) {
          return new Error('SSD for BAMF badly assigned');
        }
      }
      return true;
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
    async checkFluxSpecificationsAndFormatMessage() {
      try {
        let zelAppSpecification = this.zelAppRegistrationSpecification;
        console.log(zelAppSpecification);
        zelAppSpecification = this.ensureObject(zelAppSpecification);
        let { version } = zelAppSpecification; // shall be 1
        let { name } = zelAppSpecification;
        let { description } = zelAppSpecification;
        let { repotag } = zelAppSpecification;
        let { owner } = zelAppSpecification;
        let { port } = zelAppSpecification;
        let { enviromentParameters } = zelAppSpecification;
        let { commands } = zelAppSpecification;
        let { containerPort } = zelAppSpecification;
        let { containerData } = zelAppSpecification;
        let { cpu } = zelAppSpecification;
        let { ram } = zelAppSpecification;
        let { hdd } = zelAppSpecification;
        const { tiered } = zelAppSpecification;
        // check if signature of received data is correct
        if (!version || !name || !description || !repotag || !owner || !port || !enviromentParameters || !commands || !containerPort || !containerData || !cpu || !ram || !hdd) {
          throw new Error('Missing ZelApp specification parameter');
        }
        version = this.ensureNumber(version);
        name = this.ensureString(name);
        description = this.ensureString(description);
        repotag = this.ensureString(repotag);
        owner = this.ensureString(owner);
        port = this.ensureNumber(port);
        enviromentParameters = this.ensureObject(enviromentParameters);
        const envParamsCorrected = [];
        if (Array.isArray(enviromentParameters)) {
          enviromentParameters.forEach((parameter) => {
            const param = this.ensureString(parameter);
            envParamsCorrected.push(param);
          });
        } else {
          throw new Error('Enviromental parameters for ZelApp are invalid');
        }
        commands = this.ensureObject(commands);
        const commandsCorrected = [];
        if (Array.isArray(commands)) {
          commands.forEach((command) => {
            const cmm = this.ensureString(command);
            commandsCorrected.push(cmm);
          });
        } else {
          throw new Error('ZelApp commands are invalid');
        }
        containerPort = this.ensureNumber(containerPort);
        containerData = this.ensureString(containerData);
        cpu = this.ensureNumber(cpu);
        ram = this.ensureNumber(ram);
        hdd = this.ensureNumber(hdd);
        if (typeof tiered !== 'boolean') {
          throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
        }

        // finalised parameters that will get stored in global database
        const zelAppSpecFormatted = {
          version, // integer
          name, // string
          description, // string
          repotag, // string
          owner, // zelid string
          port, // integer
          enviromentParameters: envParamsCorrected, // array of strings
          commands: commandsCorrected, // array of strings
          containerPort, // integer
          containerData, // string
          cpu, // float 0.1 step
          ram, // integer 100 step (mb)
          hdd, // integer 1 step
          tiered, // boolean
        };

        if (tiered) {
          let { cpubasic } = zelAppSpecification;
          let { cpusuper } = zelAppSpecification;
          let { cpubamf } = zelAppSpecification;
          let { rambasic } = zelAppSpecification;
          let { ramsuper } = zelAppSpecification;
          let { rambamf } = zelAppSpecification;
          let { hddbasic } = zelAppSpecification;
          let { hddsuper } = zelAppSpecification;
          let { hddbamf } = zelAppSpecification;
          if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
            throw new Error('ZelApp was requested as tiered setup but specifications are missing');
          }
          cpubasic = this.ensureNumber(cpubasic);
          cpusuper = this.ensureNumber(cpusuper);
          cpubamf = this.ensureNumber(cpubamf);
          rambasic = this.ensureNumber(rambasic);
          ramsuper = this.ensureNumber(ramsuper);
          rambamf = this.ensureNumber(rambamf);
          hddbasic = this.ensureNumber(hddbasic);
          hddsuper = this.ensureNumber(hddsuper);
          hddbamf = this.ensureNumber(hddbamf);

          zelAppSpecFormatted.cpubasic = cpubasic;
          zelAppSpecFormatted.cpusuper = cpusuper;
          zelAppSpecFormatted.cpubamf = cpubamf;
          zelAppSpecFormatted.rambasic = rambasic;
          zelAppSpecFormatted.ramsuper = ramsuper;
          zelAppSpecFormatted.rambamf = rambamf;
          zelAppSpecFormatted.hddbasic = hddbasic;
          zelAppSpecFormatted.hddsuper = hddsuper;
          zelAppSpecFormatted.hddbamf = hddbamf;
        }
        // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper port, repotag exists, string lengths, specs are ok
        if (version !== 1) {
          throw new Error('ZelApp message version specification is invalid');
        }
        if (name.length > 32) {
          throw new Error('ZelApp name is too long');
        }
        // furthermore name cannot contain any special character
        if (!name.match(/^[a-zA-Z0-9]+$/)) {
          throw new Error('ZelApp name contains special characters. Only a-z, A-Z and 0-9 are allowed');
        }
        if (name.startsWith('zel')) {
          throw new Error('ZelApp name can not start with zel');
        }
        if (description.length > 256) {
          throw new Error('Description is too long. Maximum of 256 characters is allowed');
        }
        const parameters = this.checkHWParameters(zelAppSpecFormatted);
        if (parameters !== true) {
          const errorMessage = parameters;
          throw new Error(errorMessage);
        }

        // check port is within range
        if (zelAppSpecFormatted.port < this.zelapps.portMin || zelAppSpecFormatted.port > this.zelapps.portMax) {
          throw new Error(`Assigned port is not within ZelApps range ${this.zelapps.portMin}-${this.zelapps.portMax}`);
        }

        // check if containerPort makes sense
        if (zelAppSpecFormatted.containerPort < 0 || zelAppSpecFormatted.containerPort > 65535) {
          throw new Error('Container Port is not within system limits 0-65535');
        }

        // check wheter shared Folder is not root
        if (containerData.length < 2) {
          throw new Error('ZelApp container data folder not specified. If no data folder is whished, use /tmp');
        }

        // check repotag if available for download
        const splittedRepo = zelAppSpecFormatted.repotag.split(':');
        if (splittedRepo[0] && splittedRepo[1] && !splittedRepo[2]) {
          const zelidauth = localStorage.getItem('zelidauth');
          const data = {
            repotag: zelAppSpecFormatted.repotag,
          };
          const resDocker = await ZelAppsService.checkDockerExistance(zelidauth, data).catch((error) => {
            vue.$customMes.error(error.message || error);
          });
          console.log(resDocker);
          if (resDocker.data.status === 'error') {
            throw resDocker.data.data;
          }
        } else {
          throw new Error('Repository is not in valid format namespace/repository:tag');
        }
        this.timestamp = new Date().getTime();
        this.dataForZelAppRegistration = zelAppSpecFormatted;
        this.dataToSign = this.registrationtype + this.version + JSON.stringify(zelAppSpecFormatted) + this.timestamp;
      } catch (error) {
        console.log(error.message);
        vue.$customMes.error(error.message || error);
      }
    },
    async checkFluxUpdateSpecificationsAndFormatMessage() {
      try {
        let zelAppSpecification = this.zelAppUpdateSpecification;
        console.log(zelAppSpecification);
        zelAppSpecification = this.ensureObject(zelAppSpecification);
        let { version } = zelAppSpecification; // shall be 1
        let { name } = zelAppSpecification;
        let { description } = zelAppSpecification;
        let { repotag } = zelAppSpecification;
        let { owner } = zelAppSpecification;
        let { port } = zelAppSpecification;
        let { enviromentParameters } = zelAppSpecification;
        let { commands } = zelAppSpecification;
        let { containerPort } = zelAppSpecification;
        let { containerData } = zelAppSpecification;
        let { cpu } = zelAppSpecification;
        let { ram } = zelAppSpecification;
        let { hdd } = zelAppSpecification;
        const { tiered } = zelAppSpecification;
        // check if signature of received data is correct
        if (!version || !name || !description || !repotag || !owner || !port || !enviromentParameters || !commands || !containerPort || !containerData || !cpu || !ram || !hdd) {
          throw new Error('Missing ZelApp specification parameter');
        }
        version = this.ensureNumber(version);
        name = this.ensureString(name);
        description = this.ensureString(description);
        repotag = this.ensureString(repotag);
        owner = this.ensureString(owner);
        port = this.ensureNumber(port);
        enviromentParameters = this.ensureObject(enviromentParameters);
        const envParamsCorrected = [];
        if (Array.isArray(enviromentParameters)) {
          enviromentParameters.forEach((parameter) => {
            const param = this.ensureString(parameter);
            envParamsCorrected.push(param);
          });
        } else {
          throw new Error('Enviromental parameters for ZelApp are invalid');
        }
        commands = this.ensureObject(commands);
        const commandsCorrected = [];
        if (Array.isArray(commands)) {
          commands.forEach((command) => {
            const cmm = this.ensureString(command);
            commandsCorrected.push(cmm);
          });
        } else {
          throw new Error('ZelApp commands are invalid');
        }
        containerPort = this.ensureNumber(containerPort);
        containerData = this.ensureString(containerData);
        cpu = this.ensureNumber(cpu);
        ram = this.ensureNumber(ram);
        hdd = this.ensureNumber(hdd);
        if (typeof tiered !== 'boolean') {
          throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
        }

        // finalised parameters that will get stored in global database
        const zelAppSpecFormatted = {
          version, // integer
          name, // string
          description, // string
          repotag, // string
          owner, // zelid string
          port, // integer
          enviromentParameters: envParamsCorrected, // array of strings
          commands: commandsCorrected, // array of strings
          containerPort, // integer
          containerData, // string
          cpu, // float 0.1 step
          ram, // integer 100 step (mb)
          hdd, // integer 1 step
          tiered, // boolean
        };

        if (tiered) {
          let { cpubasic } = zelAppSpecification;
          let { cpusuper } = zelAppSpecification;
          let { cpubamf } = zelAppSpecification;
          let { rambasic } = zelAppSpecification;
          let { ramsuper } = zelAppSpecification;
          let { rambamf } = zelAppSpecification;
          let { hddbasic } = zelAppSpecification;
          let { hddsuper } = zelAppSpecification;
          let { hddbamf } = zelAppSpecification;
          if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
            throw new Error('ZelApp was requested as tiered setup but specifications are missing');
          }
          cpubasic = this.ensureNumber(cpubasic);
          cpusuper = this.ensureNumber(cpusuper);
          cpubamf = this.ensureNumber(cpubamf);
          rambasic = this.ensureNumber(rambasic);
          ramsuper = this.ensureNumber(ramsuper);
          rambamf = this.ensureNumber(rambamf);
          hddbasic = this.ensureNumber(hddbasic);
          hddsuper = this.ensureNumber(hddsuper);
          hddbamf = this.ensureNumber(hddbamf);

          zelAppSpecFormatted.cpubasic = cpubasic;
          zelAppSpecFormatted.cpusuper = cpusuper;
          zelAppSpecFormatted.cpubamf = cpubamf;
          zelAppSpecFormatted.rambasic = rambasic;
          zelAppSpecFormatted.ramsuper = ramsuper;
          zelAppSpecFormatted.rambamf = rambamf;
          zelAppSpecFormatted.hddbasic = hddbasic;
          zelAppSpecFormatted.hddsuper = hddsuper;
          zelAppSpecFormatted.hddbamf = hddbamf;
        }
        // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper port, repotag exists, string lengths, specs are ok
        if (version !== 1) {
          throw new Error('ZelApp message version specification is invalid');
        }
        if (name.length > 32) {
          throw new Error('ZelApp name is too long');
        }
        // furthermore name cannot contain any special character
        if (!name.match(/^[a-zA-Z0-9]+$/)) {
          throw new Error('ZelApp name contains special characters. Only a-z, A-Z and 0-9 are allowed');
        }
        if (name.startsWith('zel')) {
          throw new Error('ZelApp name can not start with zel');
        }
        if (name !== this.callBResponse.data.name) {
          throw new Error('ZelApp name can not be changed');
        }
        if (repotag !== this.callBResponse.data.repotag) {
          throw new Error('Repository can not be changed');
        }
        if (description.length > 256) {
          throw new Error('Description is too long. Maximum of 256 characters is allowed');
        }
        const parameters = this.checkHWParameters(zelAppSpecFormatted);
        if (parameters !== true) {
          const errorMessage = parameters;
          throw new Error(errorMessage);
        }

        // check port is within range
        if (zelAppSpecFormatted.port < this.zelapps.portMin || zelAppSpecFormatted.port > this.zelapps.portMax) {
          throw new Error(`Assigned port is not within ZelApps range ${this.zelapps.portMin}-${this.zelapps.portMax}`);
        }

        // check if containerPort makes sense
        if (zelAppSpecFormatted.containerPort < 0 || zelAppSpecFormatted.containerPort > 65535) {
          throw new Error('Container Port is not within system limits 0-65535');
        }

        // check wheter shared Folder is not root
        if (containerData.length < 2) {
          throw new Error('ZelApp container data folder not specified. If no data folder is whished, use /tmp');
        }

        // check repotag if available for download
        const splittedRepo = zelAppSpecFormatted.repotag.split(':');
        if (splittedRepo[0] && splittedRepo[1] && !splittedRepo[2]) {
          const zelidauth = localStorage.getItem('zelidauth');
          const data = {
            repotag: zelAppSpecFormatted.repotag,
          };
          const resDocker = await ZelAppsService.checkDockerExistance(zelidauth, data).catch((error) => {
            vue.$customMes.error(error.message || error);
          });
          console.log(resDocker);
          if (resDocker.data.status === 'error') {
            throw resDocker.data.data;
          }
        } else {
          throw new Error('Repository is not in valid format namespace/repository:tag');
        }
        this.timestamp = new Date().getTime();
        this.dataForZelAppRegistration = zelAppSpecFormatted;
        this.dataToSign = this.updatetype + this.version + JSON.stringify(zelAppSpecFormatted) + this.timestamp;
      } catch (error) {
        console.log(error.message);
        vue.$customMes.error(error.message || error);
      }
    },
    async checkFluxCommunication() {
      const response = await ZelAppsService.checkCommunication();
      if (response.data.status === 'success') {
        this.fluxCommunication = true;
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
    },
    async registrationInformation() {
      const response = await ZelAppsService.zelappsRegInformation();
      const { data } = response.data;
      if (response.data.status === 'success') {
        this.zelapps.price.cpu = data.price.cpu;
        this.zelapps.price.hdd = data.price.hdd;
        this.zelapps.price.ram = data.price.ram;
        this.zelapps.address = data.address;
        this.zelapps.epochstart = data.epochstart;
        this.zelapps.portMin = data.portMin;
        this.zelapps.portMax = data.portMax;
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
    },
    async openGlobalZelApp(zelappName) {
      const response = await ZelAppsService.getZelAppLocation(zelappName).catch((error) => {
        vue.$customMes.error(error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        const zelappLocations = response.data.data;
        const location = zelappLocations[0];
        if (!location) {
          vue.$customMes.error('Application is awaiting launching...');
        } else {
          const { ip } = location;
          const appSpecs = this.globalZelAppSpecs.data.find((app) => app.name === zelappName);
          const { port } = appSpecs;
          const url = `http://${ip}:${port}`;
          this.openSite(url);
        }
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
    },
    openAppManagement(zelappName) {
      console.log(zelappName);
      this.callResponse.data = '';
      this.callResponse.status = '';
      this.callBResponse.data = '';
      this.callBResponse.status = '';
      this.zelAppExec.cmd = '';
      this.zelAppExec.env = '';
      this.managedApplication = zelappName;
      this.getAppOwner();
      this.getInstalledApplicationSpecifics();
      this.getGlobalApplicationSpecifics();
      this.managementMenuItem = 'appspecifics';
    },
    goBackToZelApps() {
      this.managedApplication = '';
    },
    handleSelect(key, keyPath) {
      this.showMenu = false;
      this.managementMenuItem = key;
      this.callResponse.data = '';
      this.callResponse.status = '';
      // do not reset global application specifics obtained
      this.zelAppExec.cmd = '';
      this.zelAppExec.env = '';
      console.log(key, keyPath);
      console.log(key);
      switch (key) {
        case 'appspecifics':
          this.getInstalledApplicationSpecifics();
          this.getGlobalApplicationSpecifics();
          break;
        case 'appinspect':
          this.getApplicationInspect();
          break;
        case 'appstats':
          this.getApplicationStats();
          break;
        case 'appchanges':
          this.getApplicationChanges();
          break;
        case 'applogs':
          this.getApplicationLogs();
          break;
        case 'appprocesses':
          this.getApplicationProcesses();
          break;
        case 'appinstances':
          this.getApplicationLocations();
          break;
        case 'appcontrol':
          this.zelappsGetListAllZelApps();
          break;
        case 'appexec':
          break;
        case 'globalappspecifics':
          this.getGlobalApplicationSpecifics();
          break;
        case 'updateappglobalspecifications':
          this.getGlobalApplicationSpecifics();
          break;
        default:
          vue.$customMes.info('Feature coming soon!');
          console.log('Menu: Unrecognized method');
      }
    },
    async register() {
      const zelidauth = localStorage.getItem('zelidauth');
      const data = {
        type: this.registrationtype,
        version: this.version,
        zelAppSpecification: this.dataForZelAppRegistration,
        timestamp: this.timestamp,
        signature: this.signature,
      };
      const response = await ZelAppsService.registerZelApp(zelidauth, data).catch((error) => {
        vue.$customMes.error(error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        this.registrationHash = response.data.data;
        vue.$customMes.success(response.data.data.message || response.data.data);
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
    },
    initiateSignWS() {
      const self = this;
      const signatureMessage = this.zelAppRegistrationSpecification.owner + this.timestamp;
      const wsuri = `ws://${this.userconfig.externalip}:${this.config.apiPort}/ws/zelsign/${signatureMessage}`;
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
    getZelAppName(zelappName) {
      // this id is used for volumes, docker names so we know it reall belongs to zelflux
      if (zelappName.startsWith('zel')) {
        return zelappName.substr(3, zelappName.length);
      }
      return zelappName;
    },
    async getAppOwner() {
      const response = await ZelAppsService.getZelAppOwner(this.managedApplication);
      console.log(response);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
      this.selectedAppOwner = response.data.data;
    },
    async getInstalledApplicationSpecifics() {
      const response = await ZelAppsService.getInstalledZelAppSpecifics(this.managedApplication);
      console.log(response);
      if (response.data.status === 'error' || !response.data.data[0]) {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        [this.callResponse.data] = response.data.data;
      }
    },
    async getGlobalApplicationSpecifics() {
      const response = await ZelAppsService.getZelAppSpecifics(this.managedApplication);
      console.log(response);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
        this.callBResponse.status = response.data.status;
      } else {
        this.callBResponse.status = response.data.status;
        this.callBResponse.data = response.data.data;
        const specs = response.data.data;
        console.log(specs);
        this.zelAppUpdateSpecification.version = specs.version;
        this.zelAppUpdateSpecification.name = specs.name;
        this.zelAppUpdateSpecification.description = specs.description;
        this.zelAppUpdateSpecification.repotag = specs.repotag;
        this.zelAppUpdateSpecification.owner = specs.owner;
        this.zelAppUpdateSpecification.port = specs.port;
        this.zelAppUpdateSpecification.enviromentParameters = this.ensureString(specs.enviromentParameters);
        this.zelAppUpdateSpecification.commands = this.ensureString(specs.commands);
        this.zelAppUpdateSpecification.containerPort = specs.containerPort;
        this.zelAppUpdateSpecification.containerData = specs.containerData;
        this.zelAppUpdateSpecification.cpu = specs.cpu;
        this.zelAppUpdateSpecification.ram = specs.ram;
        this.zelAppUpdateSpecification.hdd = specs.hdd;
        this.zelAppUpdateSpecification.tiered = specs.tiered;
        this.zelAppUpdateSpecification.cpubasic = specs.cpubasic;
        this.zelAppUpdateSpecification.rambasic = specs.rambasic;
        this.zelAppUpdateSpecification.hddbasic = specs.hddbasic;
        this.zelAppUpdateSpecification.cpusuper = specs.cpusuper;
        this.zelAppUpdateSpecification.ramsuper = specs.ramsuper;
        this.zelAppUpdateSpecification.hddsuper = specs.hddsuper;
        this.zelAppUpdateSpecification.cpubamf = specs.cpubamf;
        this.zelAppUpdateSpecification.rambamf = specs.rambamf;
        this.zelAppUpdateSpecification.hddbamf = specs.hddbamf;
      }
    },
    async getApplicationLocations() {
      const response = await ZelAppsService.getZelAppLocation(this.managedApplication);
      console.log(response);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async getApplicationLogs() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.getZelAppLogsTail(zelidauth, this.managedApplication);
      console.log(response);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async getApplicationInspect() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.getZelAppInspect(zelidauth, this.managedApplication);
      console.log(response);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async getApplicationStats() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.getZelAppStats(zelidauth, this.managedApplication);
      console.log(response);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async zelAppExecute() {
      const zelidauth = localStorage.getItem('zelidauth');
      if (!this.zelAppExec.cmd) {
        vue.$customMes.error('No commands specified');
        return;
      }
      const env = this.zelAppExec.env ? this.zelAppExec.env : '[]';
      const cmd = this.zelAppExec.cmd ? this.zelAppExec.cmd : '[]';
      this.commandExecuting = true;
      const response = await ZelAppsService.getZelAppExec(zelidauth, this.managedApplication, cmd, env);
      console.log(response);
      this.commandExecuting = false;
      this.callResponse.status = response.status;
      this.callResponse.data = response.data;
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
    },
    async getApplicationChanges() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.getZelAppChanges(zelidauth, this.managedApplication);
      console.log(response);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async getApplicationProcesses() {
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await ZelAppsService.getZelAppTop(zelidauth, this.managedApplication);
      console.log(response);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    cancelDownload() {
      this.abortToken.cancel('User download cancelled');
      this.downloaded = '';
      this.total = '';
    },
    async downloadApplicationLog() {
      const self = this;
      self.abortToken = ZelCashService.cancelToken();
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
        cancelToken: self.abortToken.token,
      };
      const response = await ZelCashService.justAPI().get(`/zelapps/zelapplog/${this.managedApplication}`, axiosConfig);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'app.log');
      document.body.appendChild(link);
      link.click();
    },
    getZelAppIdentifier() {
      // this id is used for volumes, docker names so we know it reall belongs to zelflux
      if (this.managedApplication.startsWith('zel')) {
        return this.managedApplication;
      }
      return `zel${this.managedApplication}`;
    },
    getZelAppDockerNameIdentifier() {
      // this id is used for volumes, docker names so we know it reall belongs to zelflux
      const name = this.getZelAppIdentifier();
      if (name.startsWith('/')) {
        return name;
      }
      return `/${name}`;
    },
    handleGlobalDisabledClick() {
      if (!this.callBResponse.data) {
        vue.$message.info('Global Management unavailable. Missing specifications!');
      }
    },
  },
};
</script>
