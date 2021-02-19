<template>
  <div>
    <div
      :key="uniqueKey"
      v-if="appsSection === 'localapps'"
    >
      <el-tabs
        v-if="!managedApplication"
        v-model="activeName"
      >
        <el-tab-pane
          label="Running"
          name="running"
        >
          <el-table
            :data="getRunningAppsResponse.data"
            empty-text="No Flux App running"
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
                <ElButton @click="openApp(scope.row.Names[0].substr(4, scope.row.Names[0].length))">
                  Visit
                </ElButton>
              </template>
            </el-table-column>
            <el-table-column
              v-if="privilage === 'fluxteam' || privilage === 'admin'"
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
                  @onConfirm="stopAll(scope.row.Names[0].substr(1, scope.row.Names[0].length))"
                  @confirm="stopAll(scope.row.Names[0].substr(1, scope.row.Names[0].length))"
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
            :data="installedApps.data"
            empty-text="No Flux App installed"
            style="width: 100%"
          >
            <el-table-column
              label="Name"
              prop="name"
              sortable
            >
              <template slot-scope="scope">
                {{ getAppName(scope.row.name) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Port"
              prop="port"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.port || scope.row.ports.toString() }}
              </template>
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
              v-if="privilage === 'fluxteam' || privilage === 'admin'"
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
                  @onConfirm="startApp(scope.row.name)"
                  @confirm="startApp(scope.row.name)"
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
                  @onConfirm="restartApp(scope.row.name)"
                  @confirm="restartApp(scope.row.name)"
                >
                  <ElButton slot="reference">
                    Restart
                  </ElButton>
                </el-popconfirm>
              </template>
            </el-table-column>
            <el-table-column
              v-if="privilage === 'fluxteam' || privilage === 'admin'"
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
                  @onConfirm="removeApp(scope.row.name)"
                  @confirm="removeApp(scope.row.name)"
                >
                  <ElButton slot="reference">
                    Remove
                  </ElButton>
                </el-popconfirm>
              </template>
            </el-table-column>
            <el-table-column
              v-if="privilage === 'fluxteam' || privilage === 'admin'"
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
                  @confirm="openAppManagement(scope.row.name)"
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
            ref="appInfoTable"
            :data="availableApps.data"
            empty-text="No Flux App available"
            style="width: 100%"
            @expand-change="loadLocations"
          >
            <el-table-column type="expand">
              <template slot-scope="props">
                <p>Description: {{ props.row.description }}</p>
                <p>Owner: {{ props.row.owner }}</p>
                <p>Hash: {{ props.row.hash }}</p>
                <p>Locations:</p>
                <div
                  v-for="location in appLocations"
                  :key="location.ip"
                >
                  <p>{{ location.ip }}
                    <ElButton @click="openApp(props.row.name, location.ip, props.row.port || props.row.port[0])">
                      Visit
                    </ElButton>
                  </p>
                </div>
              </template>
            </el-table-column>
            <el-table-column
              label="Name"
              prop="name"
              sortable
            >
              <template slot-scope="scope">
                {{ getAppName(scope.row.name) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Image"
              prop="repotag"
              sortable
            >
            </el-table-column>
            <el-table-column
              label="Port"
              prop="port"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.port || scope.row.ports.toString() }}
              </template>
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
              v-if="privilage === 'fluxteam' || privilage === 'admin'"
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
                  @confirm="installTemporaryLocalApp(scope.row.name)"
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
          label="My Local Apps"
          name="myLocalApps"
        >
          <el-table
            :data="myLocalApps"
            empty-text="No Local App owned"
            style="width: 100%"
          >
            <el-table-column
              label="Name"
              prop="name"
              sortable
            >
              <template slot-scope="scope">
                {{ getAppName(scope.row.name) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Port"
              prop="port"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.port || scope.row.ports.toString() }}
              </template>
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
                  @onConfirm="startApp(scope.row.name)"
                  @confirm="startApp(scope.row.name)"
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
                  @onConfirm="restartApp(scope.row.name)"
                  @confirm="restartApp(scope.row.name)"
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
                  @onConfirm="removeApp(scope.row.name)"
                  @confirm="removeApp(scope.row.name)"
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
                  @confirm="openAppManagement(scope.row.name)"
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
    </div>
    <div
      :key="uniqueKey"
      v-if="appsSection === 'globalapps'"
    >
      <el-tabs
        v-if=!managedApplication
        v-model="activeNameGlobal"
      >
        <el-tab-pane
          label="Active Apps"
          name="activeapps"
        >
          <el-table
            ref="appInfoTable"
            :data="globalAppSpecs.data"
            empty-text="No global App"
            style="width: 100%"
            @expand-change="loadLocations"
          >
            <el-table-column type="expand">
              <template slot-scope="props">
                <p>Description: {{ props.row.description }}</p>
                <p>Owner: {{ props.row.owner }}</p>
                <p>Hash: {{ props.row.hash }}</p>
                <p>Repository: {{ props.row.repotag }}</p>
                <p>Locations:</p>
                <div
                  v-for="location in appLocations"
                  :key="location.ip"
                >
                  <p>{{ location.ip }}
                    <ElButton @click="openApp(props.row.name, location.ip, props.row.port || props.row.ports[0])">
                      Visit
                    </ElButton>
                  </p>
                </div>
              </template>
            </el-table-column>
            <el-table-column
              label="Name"
              prop="name"
              sortable
            >
              <template slot-scope="scope">
                {{ getAppName(scope.row.name) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Repository"
              prop="repotag"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.repotag }}
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
                <ElButton @click="openGlobalApp(scope.row.name)">
                  Visit
                </ElButton>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane
          label="My Apps"
          name="myapps"
        >
          <el-table
            ref="appInfoTable"
            :data="myGlobalApps"
            empty-text="No global App owned"
            style="width: 100%"
            @expand-change="loadLocations"
          >
            <el-table-column type="expand">
              <template slot-scope="props">
                <p>Description: {{ props.row.description }}</p>
                <p>Owner: {{ props.row.owner }}</p>
                <p>Hash: {{ props.row.hash }}</p>
                <p>Repository: {{ props.row.repotag }}</p>
                <p>Locations:</p>
                <div
                  v-for="location in appLocations"
                  :key="location.ip"
                >
                  <p>{{ location.ip }}
                    <ElButton @click="openApp(props.row.name, location.ip, props.row.port || props.row.ports[0])">
                      Visit
                    </ElButton>
                  </p>
                </div>
              </template>
            </el-table-column>
            <el-table-column
              label="Name"
              prop="name"
              sortable
            >
              <template slot-scope="scope">
                {{ getAppName(scope.row.name) }}
              </template>
            </el-table-column>
            <el-table-column
              label="Repository"
              prop="repotag"
              sortable
            >
              <template slot-scope="scope">
                {{ scope.row.repotag }}
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
                <ElButton @click="openGlobalApp(scope.row.name)">
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
                <ElButton @click="openAppManagement(scope.row.name, true)">
                  Manage
                </ElButton>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>
    <div v-if="managedApplication">
      <el-page-header
        class="pageheader"
        @back="goBackToApps"
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
            <el-menu-item
              :disabled="isApplicationInstalledLocally ? false : true"
              index="appspecifics"
            >
              <i class="el-icon-info"></i>
              <span>Specifications</span>
            </el-menu-item>
            <el-menu-item
              :disabled="isApplicationInstalledLocally ? false : true"
              index="appinspect"
            >
              <i class="el-icon-magic-stick"></i>
              <span>Information</span>
            </el-menu-item>
            <el-menu-item
              :disabled="isApplicationInstalledLocally ? false : true"
              index="appstats"
            >
              <i class="el-icon-s-platform"></i>
              <span>Resources</span>
            </el-menu-item>
            <el-menu-item
              :disabled="isApplicationInstalledLocally ? false : true"
              index="appchanges"
            >
              <i class="el-icon-files"></i>
              <span>File Changes</span>
            </el-menu-item>
            <el-menu-item
              :disabled="isApplicationInstalledLocally ? false : true"
              index="appprocesses"
            >
              <i class="el-icon-location-outline"></i>
              <span>Processes</span>
            </el-menu-item>
            <el-menu-item
              :disabled="isApplicationInstalledLocally ? false : true"
              index="applogs"
            >
              <i class="el-icon-document"></i>
              <span>Log File</span>
            </el-menu-item>
            <el-menu-item
              :disabled="isApplicationInstalledLocally ? false : true"
              index="appcontrol"
            >
              <i class="el-icon-s-operation"></i>
              <span>Control</span>
            </el-menu-item>
            <el-menu-item
              :disabled="isApplicationInstalledLocally ? false : true"
              index="appexec"
            >
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
              :disabled="callBResponse.data ? false : true"
              index="appinstances"
            >
              <i class="el-icon-location-outline"></i>
              <span>Running Instances</span>
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
                Domains: {{ callResponse.data.domains }}
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
              <p v-if="callResponse.data.hash.length === 64">
                Expires on Blockheight: {{ callResponse.data.height + 22000 }}
              </p>
              <p>
                Specifications version: {{ callResponse.data.version }}
              </p>
              <p>
                Public Ports: {{ callResponse.data.port || callResponse.data.ports }}
              </p>
              <p>
                Forwarded Ports: {{ callResponse.data.containerPort || callResponse.data.containerPorts }}
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
                  BAMF RAM: {{ callResponse.data.rambamf }} MB
                </p>
                <p>
                  BAMF SSD: {{ callResponse.data.hddbamf }} GB
                </p>
                <p>
                  SUPER CPU: {{ callResponse.data.cpusuper }} Cores
                </p>
                <p>
                  SUPER RAM: {{ callResponse.data.ramsuper }} MB
                </p>
                <p>
                  SUPER SSD: {{ callResponse.data.hddsuper }} GB
                </p>
                <p>
                  BASIC CPU: {{ callResponse.data.cpubasic }} Cores
                </p>
                <p>
                  BASIC RAM: {{ callResponse.data.rambasic }} MB
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
                  RAM: {{ callResponse.data.ram }} MB
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
                Domains: {{ callBResponse.data.domains }}
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
              <p v-if="callResponse.data.hash.length === 64">
                Expires on Blockheight: {{ callBResponse.data.height + 22000 }}
              </p>
              <p>
                Specifications version: {{ callBResponse.data.version }}
              </p>
              <p>
                Public Ports: {{ callBResponse.data.port || callBResponse.data.ports }}
              </p>
              <p>
                Forwarded Ports: {{ callBResponse.data.containerPort || callBResponse.data.containerPorts }}
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
                  BAMF RAM: {{ callBResponse.data.rambamf }} MB
                </p>
                <p>
                  BAMF SSD: {{ callBResponse.data.hddbamf }} GB
                </p>
                <p>
                  SUPER CPU: {{ callBResponse.data.cpusuper }} Cores
                </p>
                <p>
                  SUPER RAM: {{ callBResponse.data.ramsuper }} MB
                </p>
                <p>
                  SUPER SSD: {{ callBResponse.data.hddsuper }} GB
                </p>
                <p>
                  BASIC CPU: {{ callBResponse.data.cpubasic }} Cores
                </p>
                <p>
                  BASIC RAM: {{ callBResponse.data.rambasic }} MB
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
                  RAM: {{ callBResponse.data.ram }} MB
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
            <el-table
              :data="callResponse.data"
              empty-text="No Instances Running"
              style="width: 100%"
            >
              <el-table-column type="expand">
                <template slot-scope="props">
                  <p>Broadcasted At: {{ new Date(props.row.broadcastedAt).toLocaleString('en-GB', timeoptions) }}</p>
                  <p>Expire At: {{ new Date(props.row.expireAt).toLocaleString('en-GB', timeoptions) }}</p>
                </template>
              </el-table-column>
              <el-table-column
                label="Name"
                prop="name"
                sortable
              >
              </el-table-column>
              <el-table-column
                label="IP"
                prop="ip"
                sortable
              >
              </el-table-column>
              <el-table-column
                label="Hash"
                prop="hash"
                sortable
              >
              </el-table-column>
              <el-table-column
                label="Visit"
                prop="visit"
                sortable
              >
                <template slot-scope="scope">
                  <ElButton @click="openApp(scope.row.name, scope.row.ip, callBResponse.data.port || callBResponse.data.ports[0])">
                    Visit
                  </ElButton>
                </template>
              </el-table-column>
            </el-table>
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
              @confirm="downloadApplicationLog()"
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
              General options to control running status of App.
            </p>
            <el-popconfirm
              confirmButtonText='Start'
              cancelButtonText='No, Thanks'
              icon="el-icon-info"
              iconColor="green"
              title="Starts App"
              @onConfirm="startApp(managedApplication)"
              @confirm="startApp(managedApplication)"
            >
              <ElButton slot="reference">
                Start App
              </ElButton>
            </el-popconfirm>
            <el-popconfirm
              confirmButtonText='Stop'
              cancelButtonText='No, Thanks'
              icon="el-icon-info"
              iconColor="red"
              title="Stops App"
              @onConfirm="stopAll(managedApplication)"
              @confirm="stopAll(managedApplication)"
            >
              <ElButton slot="reference">
                Stop App
              </ElButton>
            </el-popconfirm>
            <el-popconfirm
              confirmButtonText='Restart'
              cancelButtonText='No, Thanks'
              icon="el-icon-info"
              iconColor="orange"
              title="Restarts App"
              @onConfirm="restartApp(managedApplication)"
              @confirm="restartApp(managedApplication)"
            >
              <ElButton slot="reference">
                Restart App
              </ElButton>
            </el-popconfirm>
            <el-divider></el-divider>
            <p>
              The Pause command suspends all processes in the specified App.
            </p>
            <el-popconfirm
              confirmButtonText='Pause'
              cancelButtonText='No, Thanks'
              icon="el-icon-info"
              iconColor="orange"
              title="Pauses App"
              @onConfirm="pauseApp(managedApplication)"
              @confirm="pauseApp(managedApplication)"
            >
              <ElButton slot="reference">
                Pause App
              </ElButton>
            </el-popconfirm>
            <el-popconfirm
              confirmButtonText='Unpause'
              cancelButtonText='No, Thanks'
              icon="el-icon-info"
              iconColor="orange"
              title="Unpauses App"
              @onConfirm="unpauseApp(managedApplication)"
              @confirm="unpauseApp(managedApplication)"
            >
              <ElButton slot="reference">
                Unpause App
              </ElButton>
            </el-popconfirm>
            <el-divider></el-divider>
            <p>
              App can be redeployed with or without data reinitiation. Hard redeployement removes the App including its attached data storage volume. Soft redeployemment will reuse already existing data application.
            </p>
            <el-popconfirm
              confirmButtonText='Redeploy'
              cancelButtonText='No, Thanks'
              icon="el-icon-info"
              iconColor="orange"
              title="Redeploys App without data removal"
              @onConfirm="redeployAppSoft(managedApplication)"
              @confirm="redeployAppSoft(managedApplication)"
            >
              <ElButton slot="reference">
                Soft Redeploy App
              </ElButton>
            </el-popconfirm>
            <el-popconfirm
              confirmButtonText='Redeploy'
              cancelButtonText='No, Thanks'
              icon="el-icon-info"
              iconColor="red"
              title="Redeploys App with data removal"
              @onConfirm="redeployAppHard(managedApplication)"
              @confirm="redeployAppHard(managedApplication)"
            >
              <ElButton slot="reference">
                Hard Redeploy App
              </ElButton>
            </el-popconfirm>
            <el-divider></el-divider>
            <p>
              Stops, Uninstalls and Removes all App data from this specific Flux.
            </p>
            <el-popconfirm
              confirmButtonText='Remove'
              cancelButtonText='No, Thanks'
              icon="el-icon-info"
              iconColor="red"
              title="Removes App"
              @onConfirm="removeApp(managedApplication)"
              @confirm="removeApp(managedApplication)"
            >
              <ElButton slot="reference">
                Remove App
              </ElButton>
            </el-popconfirm>
          </div>
          <div v-if="managementMenuItem == 'appexec'">
            <p>
              Here you can execute some commands with a set of enviroment variables on this local application instance. Both are array of strings. Useful especially for testing and tweaking purposes.
            </p>
            <el-form
              :model="appRegistrationSpecification"
              label-width="100px"
            >
              <el-form-item label="Commands">
                <el-input
                  placeholder="Array of strings of Commands"
                  textarea
                  v-model="appExec.cmd"
                >
                </el-input>
              </el-form-item>
              <el-form-item label="Enviroment">
                <el-input
                  placeholder="Array of strings of Enviromental Parameters"
                  textarea
                  v-model="appExec.env"
                >
                </el-input>
              </el-form-item>
            </el-form>
            <ElButton @click="appExecute">
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
                Domains: {{ callBResponse.data.domains }}
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
              <p v-if="callResponse.data.hash.length === 64">
                Expires on Blockheight: {{ callBResponse.data.height + 22000 }}
              </p>
              <p>
                Specifications version: {{ callBResponse.data.version }}
              </p>
              <p>
                Public Ports: {{ callBResponse.data.port || callBResponse.data.ports }}
              </p>
              <p>
                Forwarded Ports: {{ callBResponse.data.containerPort || callBResponse.data.containerPorts }}
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
                  BAMF RAM: {{ callBResponse.data.rambamf }} MB
                </p>
                <p>
                  BAMF SSD: {{ callBResponse.data.hddbamf }} GB
                </p>
                <p>
                  SUPER CPU: {{ callBResponse.data.cpusuper }} Cores
                </p>
                <p>
                  SUPER RAM: {{ callBResponse.data.ramsuper }} MB
                </p>
                <p>
                  SUPER SSD: {{ callBResponse.data.hddsuper }} GB
                </p>
                <p>
                  BASIC CPU: {{ callBResponse.data.cpubasic }} Cores
                </p>
                <p>
                  BASIC RAM: {{ callBResponse.data.rambasic }} MB
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
                  RAM: {{ callBResponse.data.ram }} MB
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
              Warning: Connected Flux is not communicating properly with Flux network
            </div>
            <h2>Here you can update your application specifications.</h2>
            <div class="apps-register">
              <el-form
                :model="appUpdateSpecification"
                label-width="100px"
              >
                <el-form-item label="Version">
                  <el-input
                    placeholder="App Version"
                    disabled
                    v-model="appUpdateSpecification.version"
                  >
                  </el-input>
                </el-form-item>
                <el-form-item label="Name">
                  <el-input
                    placeholder="App name"
                    disabled
                    v-model="appUpdateSpecification.name"
                  >
                  </el-input>
                </el-form-item>
                <el-form-item label="Desc.">
                  <el-input
                    placeholder="Description"
                    type="textarea"
                    autosize
                    v-model="appUpdateSpecification.description"
                  >
                  </el-input>
                </el-form-item>
                <el-form-item label="Repo">
                  <el-input
                    placeholder="Docker Hub namespace/repository:tag"
                    disabled
                    v-model="appUpdateSpecification.repotag"
                  >
                  </el-input>
                </el-form-item>
                <el-form-item label="Owner">
                  <el-input
                    placeholder="ZelID of application owner"
                    v-model="appUpdateSpecification.owner"
                  >
                  </el-input>
                </el-form-item>
                <el-form-item label="Ports">
                  <el-input
                    placeholder="Array of Ports on which application will be available"
                    type="number"
                    min="31000"
                    max="39999"
                    v-model="appUpdateSpecification.ports"
                  >
                  </el-input>
                </el-form-item>
                <el-form-item label="Domains">
                  <el-input
                    placeholder="Array of strings of Domains managed by Flux Domain Manager (FDM). Length has to corresponds to available ports. Use empty strings for no domains"
                    textarea
                    v-model="appUpdateSpecification.domains"
                  >
                  </el-input>
                </el-form-item>
                <el-form-item label="Enviroment">
                  <el-input
                    placeholder="Array of strings of Enviromental Parameters"
                    textarea
                    v-model="appUpdateSpecification.enviromentParameters"
                  >
                  </el-input>
                </el-form-item>
                <el-form-item label="Commands">
                  <el-input
                    placeholder="Array of strings of Commands"
                    textarea
                    v-model="appUpdateSpecification.commands"
                  >
                  </el-input>
                </el-form-item>
                <el-form-item label="Cont. Ports">
                  <el-input
                    placeholder="Container Ports - array of ports on which your container has"
                    nubmer
                    min="0"
                    max="65535"
                    v-model="appUpdateSpecification.containerPorts"
                  >
                  </el-input>
                </el-form-item>
                <el-form-item label="Cont. Data">
                  <el-input
                    placeholder="Data folder that is shared by application to App volume"
                    textarea
                    v-model="appUpdateSpecification.containerData"
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
                    v-model="appUpdateSpecification.cpu"
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
                    v-model="appUpdateSpecification.ram"
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
                    v-model="appUpdateSpecification.hdd"
                  >
                  </el-input>
                </el-form-item>
                <el-form-item label="Tiered">
                  <el-switch v-model="appUpdateSpecification.tiered"></el-switch>
                </el-form-item>
                <div v-if="appUpdateSpecification.tiered">
                  <el-form-item label="BASIC CPU">
                    <el-input
                      placeholder="CPU cores to use by BASIC"
                      nubmer
                      min="0"
                      max="1"
                      step="0.1"
                      v-model="appUpdateSpecification.cpubasic"
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
                      v-model="appUpdateSpecification.rambasic"
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
                      v-model="appUpdateSpecification.hddbasic"
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
                      v-model="appUpdateSpecification.cpusuper"
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
                      v-model="appUpdateSpecification.ramsuper"
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
                      v-model="appUpdateSpecification.hddsuper"
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
                      v-model="appUpdateSpecification.cpubamf"
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
                      v-model="appUpdateSpecification.rambamf"
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
                      v-model="appUpdateSpecification.hddbamf"
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
              <br><br>
              Note: Data have to be signed by last application owner
              <br><br>
              <div>
                Sign with ZelCore
                <br>
                <a
                  @click="initiateSignWSUpdate"
                  :href="'zel:?action=sign&message=' + dataToSign + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Fzelcash%2Fzelflux%2Fmaster%2FZelFront%2Fsrc%2Fassets%2Fimg%2FzelID.svg&callback=' + callbackValue"
                >
                  <img
                    class="zelidLogin"
                    src="@/assets/img/zelID.svg"
                    alt="Zel ID"
                    height="100%"
                    width="100%"
                  />
                </a>
              </div>
              <br><br>
              Price per Month: {{ appPricePerMonthForUpdate }} FLUX
              <br><br>
              <ElButton @click="update">
                Update Flux App
              </ElButton>
              <br><br>
              <div v-if="updateHash">
                To finish application update, please do a transaction of {{ appPricePerMonthForUpdate }} to address
                {{ apps.address }}
                with following message:
                {{ updateHash }}
                <br><br>
                Transaction must be mined by {{ new Date(validTill).toLocaleString('en-GB', timeoptions) }}
                <br><br>
                Application will be subscribed till {{ new Date(subscribedTill).toLocaleString('en-GB', timeoptions) }}
                <br><br>
              </div>
              <div v-if="updateHash">
                Pay with ZelCore
                <br>
                <a :href="'zel:?action=pay&coin=zelcash&address=' + apps.address + '&amount=' + appPricePerMonthForUpdate + '&message=' + updateHash + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Fzelcash%2Fzelflux%2Fmaster%2FZelFront%2Fsrc%2Fassets%2Fimg%2Fflux_banner.png'">
                  <img
                    class="zelidLogin"
                    src="@/assets/img/zelID.svg"
                    alt="Zel ID"
                    height="100%"
                    width="100%"
                  />
                </a>
              </div>
            </div>
          </div>
        </el-main>
      </el-container>
    </div>
    <div v-if="appsSection === 'registerapp'">
      <div>
        Note: Only verified developers and images can currently run on Flux. To become a verified developer with whitelisted images, please contact Flux Team via
        <el-link
          href="https://discord.io/zel"
          target="_blank"
          type="primary"
        >
          Discord
        </el-link>.
        <br><br>
      </div>
      <div v-if="!fluxCommunication">
        Warning: Connected Flux is not communicating properly with Flux network
        <br><br>
      </div>
      <div class="apps-register">
        <el-form
          :model="appRegistrationSpecification"
          label-width="100px"
        >
          <el-form-item label="Version">
            <el-input
              placeholder="App Version"
              disabled
              v-model="appRegistrationSpecification.version"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Name">
            <el-input
              placeholder="App name"
              v-model="appRegistrationSpecification.name"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Desc.">
            <el-input
              placeholder="Description"
              type="textarea"
              autosize
              v-model="appRegistrationSpecification.description"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Repo">
            <el-input
              placeholder="Docker Hub namespace/repository:tag"
              v-model="appRegistrationSpecification.repotag"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Owner">
            <el-input
              placeholder="ZelID of application owner"
              v-model="appRegistrationSpecification.owner"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Ports">
            <el-input
              placeholder="Array of Ports on which application will be available"
              type="number"
              min="31000"
              max="39999"
              v-model="appRegistrationSpecification.ports"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Domains">
            <el-input
              placeholder="Array of strings of Domains managed by Flux Domain Manager (FDM). Length has to corresponds to available ports. Use empty strings for no domains"
              textarea
              v-model="appRegistrationSpecification.domains"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Enviroment">
            <el-input
              placeholder="Array of strings of Enviromental Parameters"
              textarea
              v-model="appRegistrationSpecification.enviromentParameters"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Commands">
            <el-input
              placeholder="Array of strings of Commands"
              textarea
              v-model="appRegistrationSpecification.commands"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Cont. Ports">
            <el-input
              placeholder="Container Ports - array of ports on which your container has"
              nubmer
              min="0"
              max="65535"
              v-model="appRegistrationSpecification.containerPorts"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Cont. Data">
            <el-input
              placeholder="Data folder that is shared by application to App volume"
              textarea
              v-model="appRegistrationSpecification.containerData"
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
              v-model="appRegistrationSpecification.cpu"
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
              v-model="appRegistrationSpecification.ram"
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
              v-model="appRegistrationSpecification.hdd"
            >
            </el-input>
          </el-form-item>
          <el-form-item label="Tiered">
            <el-switch v-model="appRegistrationSpecification.tiered"></el-switch>
          </el-form-item>
          <div v-if="appRegistrationSpecification.tiered">
            <el-form-item label="BASIC CPU">
              <el-input
                placeholder="CPU cores to use by BASIC"
                nubmer
                min="0"
                max="1"
                step="0.1"
                v-model="appRegistrationSpecification.cpubasic"
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
                v-model="appRegistrationSpecification.rambasic"
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
                v-model="appRegistrationSpecification.hddbasic"
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
                v-model="appRegistrationSpecification.cpusuper"
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
                v-model="appRegistrationSpecification.ramsuper"
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
                v-model="appRegistrationSpecification.hddsuper"
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
                v-model="appRegistrationSpecification.cpubamf"
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
                v-model="appRegistrationSpecification.rambamf"
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
                v-model="appRegistrationSpecification.hddbamf"
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
              :href="'zel:?action=sign&message=' + dataToSign + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Fzelcash%2Fzelflux%2Fmaster%2FZelFront%2Fsrc%2Fassets%2Fimg%2FzelID.svg&callback=' + callbackValue"
            >
              <img
                class="zelidLogin"
                src="@/assets/img/zelID.svg"
                alt="Zel ID"
                height="100%"
                width="100%"
              />
            </a>
          </div>
          <br><br>
          Price per Month: {{ appPricePerMonth }} FLUX
          <br><br>
          <ElButton @click="register">
            Register Flux App
          </ElButton>
          <br><br>
          <div v-if="registrationHash">
            To finish registration, please do a transaction of {{ appPricePerMonth }} to address
            {{ apps.address }}
            with following message:
            {{ registrationHash }}
            <br><br>
            Transaction must be mined by {{ new Date(validTill).toLocaleString('en-GB', timeoptions) }}
            <br><br>
            Application will be subscribed till {{ new Date(subscribedTill).toLocaleString('en-GB', timeoptions) }}
            <br><br>
          </div>
          <div v-if="registrationHash">
            Pay with ZelCore
            <br>
            <a :href="'zel:?action=pay&coin=zelcash&address=' + apps.address + '&amount=' + appPricePerMonth + '&message=' + registrationHash + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Fzelcash%2Fzelflux%2Fmaster%2FZelFront%2Fsrc%2Fassets%2Fimg%2Fflux_banner.png'">
              <img
                class="zelidLogin"
                src="@/assets/img/zelID.svg"
                height="100%"
                width="100%"
              />
            </a>
          </div>
        </div>
      </div>
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
    <div v-if="appsSection === 'fluxshare'">
      <FluxShare />
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

import DaemonService from '@/services/DaemonService';
import AppsService from '@/services/AppsService';

const FluxShare = () => import('@/components/FluxShare.vue');

const store = require('store');
const qs = require('qs');

Vue.use(Vuex);

const vue = new Vue();

export default {
  name: 'Apps',
  components: {
    FluxShare,
  },
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
      getRunningAppsResponse: {
        status: '',
        data: [],
      },
      getAllAppsResponse: {
        status: '',
        data: [],
      },
      installedApps: {
        status: '',
        data: [],
      },
      availableApps: {
        status: '',
        data: [],
      },
      globalAppSpecs: {
        status: '',
        data: [],
      },
      tier: '',
      output: '',
      fluxCommunication: false,
      appRegistrationSpecification: {
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
      registrationtype: 'fluxappregister',
      updatetype: 'fluxappupdate',
      version: 1,
      dataForAppRegistration: {},
      dataForAppUpdate: {},
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
      appExec: {
        cmd: '',
        env: '',
      },
      commandExecuting: false,
      defaultProps: {
        children: 'children',
        label: 'label',
      },
      currentHeight: 0,
      appLocations: [],
      uniqueKey: 1,
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'appsSection',
      'privilage',
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
        mybackend += this.userconfig.externalip;
        mybackend += ':';
        mybackend += this.config.apiPort;
      }
      const backendURL = store.get('backendURL') || mybackend;
      const url = `${backendURL}/zelid/providesign`;
      return encodeURI(url);
    },
    applicationManagementAndStatus() {
      console.log(this.getAllAppsResponse);
      const foundAppInfo = this.getAllAppsResponse.data.find((app) => app.Names[0] === this.getAppDockerNameIdentifier()) || {};
      const appInfo = {
        name: this.managedApplication,
        state: foundAppInfo.State || 'Unknown state',
        status: foundAppInfo.Status || 'Unknown status',
      };
      appInfo.state = appInfo.state.charAt(0).toUpperCase() + appInfo.state.slice(1);
      appInfo.status = appInfo.status.charAt(0).toUpperCase() + appInfo.status.slice(1);
      const niceString = `${appInfo.name} - ${appInfo.state} - ${appInfo.status}`;
      return niceString;
    },
    asciResponse() {
      if (typeof this.callResponse.data === 'string') {
        return this.callResponse.data.replace(/[^\x20-\x7E\t\r\n\v\f]/g, '');
      }
      return '';
    },
    myGlobalApps() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      if (this.globalAppSpecs.data) {
        return this.globalAppSpecs.data.filter((app) => app.owner === auth.zelid);
      }
      return [];
    },
    myLocalApps() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      if (this.installedApps.data) {
        return this.installedApps.data.filter((app) => app.owner === auth.zelid);
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
      const price = this.appPricePerMonthMethod(this.dataForAppRegistration);
      return price;
    },
    appPricePerMonthForUpdate() {
      const appInfo = this.callBResponse.data;
      let actualPriceToPay = this.appPricePerMonthMethod(this.dataForAppUpdate);
      console.log(actualPriceToPay);
      if (appInfo) {
        const previousSpecsPrice = this.appPricePerMonthMethod(appInfo);
        console.log(previousSpecsPrice);
        // what is the height difference
        const daemonHeight = this.currentHeight;
        const heightDifference = daemonHeight - appInfo.height; // has to be lower than 22000
        const perc = (22000 - heightDifference) / 22000;
        if (perc > 0) {
          actualPriceToPay -= (perc * previousSpecsPrice);
        }
      }
      if (actualPriceToPay < 1) {
        actualPriceToPay = 1;
      }
      actualPriceToPay = Number(Math.ceil(actualPriceToPay * 100) / 100);
      return actualPriceToPay;
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
      if (this.installedApps.data) {
        const installed = this.installedApps.data.find((app) => app.name === this.managedApplication);
        if (installed) {
          return true;
        }
        return false;
      }
      return false;
    },
  },
  watch: {
    appsSection(val, oldVal) {
      console.log(val, oldVal);
      this.switcher(val);
    },
    activeName(val, oldVal) {
      this.callResponse.data = '';
      this.callResponse.status = '';
      this.callBResponse.data = '';
      this.callBResponse.status = '';
      this.appExec.cmd = '';
      this.appExec.env = '';
      console.log(val, oldVal);
      this.output = '';
      switch (val) {
        case 'running':
          this.appsGetListRunningApps();
          break;
        case 'all':
          this.appsGetListAllApps();
          break;
        case 'installed':
          this.appsGetInstalledApps();
          this.appsGetListAllApps();
          break;
        case 'available':
          this.appsGetAvailableApps();
          break;
        case 'myLocalApps':
          this.appsGetInstalledApps();
          this.appsGetListAllApps();
          break;
        case 'stopped':
          // getting all and checking state?
          break;
        default:
          console.log('Apps Section: Unrecognized method'); // should not be visible if everything works correctly
      }
    },
    activeNameGlobal(val, oldVal) {
      this.appLocations = [];
      this.callResponse.data = '';
      this.callResponse.status = '';
      this.callBResponse.data = '';
      this.callBResponse.status = '';
      this.appExec.cmd = '';
      this.appExec.env = '';
      console.log(val, oldVal);
      this.output = '';
      switch (val) {
        case 'activeapps':
          this.appsGetListGlobalApps();
          break;
        case 'myapps':
          this.appsGetListAllApps();
          this.appsGetListGlobalApps();
          this.getDaemonInfo();
          break;
        default:
          console.log('Apps Section: Unrecognized method'); // should not be visible if everything works correctly
      }
    },
    appRegistrationSpecification: {
      handler(val, oldVal) {
        console.log(val, oldVal);
        this.dataToSign = '';
        this.signature = '';
        this.timestamp = null;
        this.dataForAppRegistration = {};
        this.registrationHash = '';
        if (this.websocket !== null) {
          this.websocket.close();
          this.websocket = null;
        }
      },
      deep: true,
    },
    appUpdateSpecification: {
      handler(val, oldVal) {
        console.log(val, oldVal);
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
    const zelidauth = localStorage.getItem('zelidauth');
    const auth = qs.parse(zelidauth);
    this.appRegistrationSpecification.owner = auth.zelid;
    console.log(auth);
    this.getZelNodeStatus();
    this.appsGetInstalledApps();
    this.getRandomPort();
    this.switcher(this.appsSection);
  },
  methods: {
    switcher(value) {
      this.managedApplication = '';
      switch (value) {
        case 'localapps':
          this.appLocations = [];
          this.appsGetListRunningApps();
          break;
        case 'globalapps':
          this.appLocations = [];
          this.appsGetListGlobalApps();
          break;
        case 'registerapp':
          this.getRandomPort();
          this.registrationInformation();
          this.checkFluxCommunication();
          break;
        default:
          console.log('Apps Section: Unrecognized method');
      }
      this.uniqueKey += this.uniqueKey;
    },
    async getDaemonInfo() {
      const daemonGetInfo = await DaemonService.getInfo();
      if (daemonGetInfo.data.status === 'error') {
        vue.$customMes.error(daemonGetInfo.data.data.message || daemonGetInfo.data.data);
      } else {
        this.currentHeight = daemonGetInfo.data.data.blocks;
      }
    },
    async appsGetListGlobalApps() {
      const response = await AppsService.globalAppSpecifications();
      console.log(response);
      this.globalAppSpecs.status = response.data.status;
      this.globalAppSpecs.data = response.data.data;
    },
    async appsGetAvailableApps() {
      const response = await AppsService.availableApps();
      this.availableApps.status = response.data.status;
      this.availableApps.data = response.data.data;
    },
    async appsGetInstalledApps() {
      const response = await AppsService.installedApps();
      this.installedApps.status = response.data.status;
      this.installedApps.data = response.data.data;
    },
    async appsGetListRunningApps() {
      const response = await AppsService.listRunningApps();
      console.log(response);
      this.getRunningAppsResponse.status = response.data.status;
      this.getRunningAppsResponse.data = response.data.data;
    },
    async appsGetListAllApps() {
      const response = await AppsService.listAllApps();
      console.log(response);
      this.getAllAppsResponse.status = response.data.status;
      this.getAllAppsResponse.data = response.data.data;
    },
    async stopAll(app) {
      this.output = '';
      vue.$customMes.success('Stopping App');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.stopAll(zelidauth, app);
      if (response.data.status === 'success') {
        vue.$customMes.success(response.data.data.message || response.data.data);
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
      this.appsGetListAllApps();
      this.appsGetListRunningApps();
      console.log(response);
    },
    async startApp(app) {
      this.output = '';
      vue.$customMes.success('Starting App');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.startApp(zelidauth, app);
      if (response.data.status === 'success') {
        vue.$customMes.success(response.data.data.message || response.data.data);
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
      this.appsGetListAllApps();
      console.log(response);
    },
    async restartApp(app) {
      this.output = '';
      vue.$customMes.success('Restarting App');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.restartApp(zelidauth, app);
      if (response.data.status === 'success') {
        vue.$customMes.success(response.data.data.message || response.data.data);
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
      this.appsGetListAllApps();
      console.log(response);
    },
    async pauseApp(app) {
      this.output = '';
      vue.$customMes.success('Pausing App');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.pauseApp(zelidauth, app);
      if (response.data.status === 'success') {
        vue.$customMes.success(response.data.data.message || response.data.data);
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
      this.appsGetListAllApps();
      console.log(response);
    },
    async unpauseApp(app) {
      this.output = '';
      vue.$customMes.success('UnPausing App');
      const zelidauth = localStorage.getItem('zelidauth');
      const response = await AppsService.unpauseApp(zelidauth, app);
      if (response.data.status === 'success') {
        vue.$customMes.success(response.data.data.message || response.data.data);
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
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
      vue.$customMes.success('Redeploying App');
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
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
        if (this.output[this.output.length - 1].status === 'error') {
          vue.$customMes.error(this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          vue.$customMes.success(this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        }
      }
    },
    async removeApp(app) {
      const self = this;
      this.output = '';
      vue.$customMes.success('Removing App');
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
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.appsGetInstalledApps();
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
    async installTemporaryLocalApp(app) { // todo rewrite to installApp later
      const appName = app;
      const self = this;
      this.output = '';
      vue.$customMes.success('Installing App');
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
      const response = await AppsService.justAPI().get(`/apps/installtemporarylocalapp/${appName}`, axiosConfig);
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
    installedApp(appName) {
      return this.installedApps.data.find((app) => app.name === appName);
    },
    openApp(name, _ip, _port) {
      const appInfo = this.installedApp(name);
      if (appInfo || (_port && _ip)) {
        const backendURL = store.get('backendURL') || `http://${this.userconfig.externalip}:${this.config.apiPort}`;
        const ip = _ip || backendURL.split(':')[1].split('//')[1];
        const port = _port || appInfo.port;
        let url = `http://${ip}:${port}`;
        if (name === 'KadenaChainWebNode') {
          url = `https://${ip}:${port}/chainweb/0.0/mainnet01/cut`;
        }
        this.openSite(url);
      } else {
        vue.$customMes.error('Unable to open App :(');
      }
    },
    async getZelNodeStatus() {
      const response = await DaemonService.getZelNodeStatus();
      if (response.data.status === 'success') {
        this.tier = response.data.data.tier;
      }
    },
    resolveCpu(app) {
      if (this.tier === 'BASIC') {
        return (`${app.cpubasic || app.cpu} cores`);
      }
      if (this.tier === 'SUPER') {
        return (`${app.cpusuper || app.cpu} cores`);
      }
      if (this.tier === 'BAMF') {
        return (`${app.cpubamf || app.cpu} cores`);
      }
      return (`${app.cpu} cores`);
    },
    resolveRam(app) {
      if (this.tier === 'BASIC') {
        return (`${app.rambasic || app.ram} MB`);
      }
      if (this.tier === 'SUPER') {
        return (`${app.ramsuper || app.ram} MB`);
      }
      if (this.tier === 'BAMF') {
        return (`${app.rambamf || app.ram} MB`);
      }
      return (`${app.ram} MB`);
    },
    resolveHdd(app) {
      if (this.tier === 'BASIC') {
        return (`${app.hddbasic || app.hdd} GB`);
      }
      if (this.tier === 'SUPER') {
        return (`${app.hddsuper || app.hdd} GB`);
      }
      if (this.tier === 'BAMF') {
        return (`${app.hddbamf || app.hdd} GB`);
      }
      return (`${app.hdd} GB`);
    },
    openSite(url) {
      const win = window.open(url, '_blank');
      win.focus();
    },
    checkHWParameters(appSpecs) {
      // check specs parameters. JS precision
      if ((appSpecs.cpu * 10) % 1 !== 0 || (appSpecs.cpu * 10) > (this.fluxSpecifics.cpu.bamf - this.lockedSystemResources.cpu) || appSpecs.cpu < 0.1) {
        return new Error('CPU badly assigned');
      }
      if (appSpecs.ram % 100 !== 0 || appSpecs.ram > (this.fluxSpecifics.ram.bamf - this.lockedSystemResources.ram) || appSpecs.ram < 100) {
        return new Error('RAM badly assigned');
      }
      if (appSpecs.hdd % 1 !== 0 || appSpecs.hdd > (this.fluxSpecifics.hdd.bamf - this.lockedSystemResources.hdd) || appSpecs.hdd < 1) {
        return new Error('SSD badly assigned');
      }
      if (appSpecs.tiered) {
        if ((appSpecs.cpubasic * 10) % 1 !== 0 || (appSpecs.cpubasic * 10) > (this.fluxSpecifics.cpu.basic - this.lockedSystemResources.cpu) || appSpecs.cpubasic < 0.1) {
          return new Error('CPU for BASIC badly assigned');
        }
        if (appSpecs.rambasic % 100 !== 0 || appSpecs.rambasic > (this.fluxSpecifics.ram.basic - this.lockedSystemResources.ram) || appSpecs.rambasic < 100) {
          return new Error('RAM for BASIC badly assigned');
        }
        if (appSpecs.hddbasic % 1 !== 0 || appSpecs.hddbasic > (this.fluxSpecifics.hdd.basic - this.lockedSystemResources.hdd) || appSpecs.hddbasic < 1) {
          return new Error('SSD for BASIC badly assigned');
        }
        if ((appSpecs.cpusuper * 10) % 1 !== 0 || (appSpecs.cpusuper * 10) > (this.fluxSpecifics.cpu.super - this.lockedSystemResources.cpu) || appSpecs.cpusuper < 0.1) {
          return new Error('CPU for SUPER badly assigned');
        }
        if (appSpecs.ramsuper % 100 !== 0 || appSpecs.ramsuper > (this.fluxSpecifics.ram.super - this.lockedSystemResources.ram) || appSpecs.ramsuper < 100) {
          return new Error('RAM for SUPER badly assigned');
        }
        if (appSpecs.hddsuper % 1 !== 0 || appSpecs.hddsuper > (this.fluxSpecifics.hdd.super - this.lockedSystemResources.hdd) || appSpecs.hddsuper < 1) {
          return new Error('SSD for SUPER badly assigned');
        }
        if ((appSpecs.cpubamf * 10) % 1 !== 0 || (appSpecs.cpubamf * 10) > (this.fluxSpecifics.cpu.bamf - this.lockedSystemResources.cpu) || appSpecs.cpubamf < 0.1) {
          return new Error('CPU for BAMF badly assigned');
        }
        if (appSpecs.rambamf % 100 !== 0 || appSpecs.rambamf > (this.fluxSpecifics.ram.bamf - this.lockedSystemResources.ram) || appSpecs.rambamf < 100) {
          return new Error('RAM for BAMF badly assigned');
        }
        if (appSpecs.hddbamf % 1 !== 0 || appSpecs.hddbamf > (this.fluxSpecifics.hdd.bamf - this.lockedSystemResources.hdd) || appSpecs.hddbamf < 1) {
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
        let appSpecification = this.appRegistrationSpecification;
        console.log(appSpecification);
        appSpecification = this.ensureObject(appSpecification);
        let { version } = appSpecification; // shall be 2
        let { name } = appSpecification;
        let { description } = appSpecification;
        let { repotag } = appSpecification;
        let { owner } = appSpecification;
        let { ports } = appSpecification;
        let { domains } = appSpecification;
        let { enviromentParameters } = appSpecification;
        let { commands } = appSpecification;
        let { containerPorts } = appSpecification;
        let { containerData } = appSpecification;
        let { cpu } = appSpecification;
        let { ram } = appSpecification;
        let { hdd } = appSpecification;
        const { tiered } = appSpecification;
        // check if signature of received data is correct
        if (!version || !name || !description || !repotag || !owner || !ports || !domains || !enviromentParameters || !commands || !containerPorts || !containerData || !cpu || !ram || !hdd) {
          throw new Error('Missing App specification parameter');
        }
        version = this.ensureNumber(version);
        name = this.ensureString(name);
        description = this.ensureString(description);
        repotag = this.ensureString(repotag);
        owner = this.ensureString(owner);
        ports = this.ensureObject(ports);
        const portsCorrect = [];
        if (Array.isArray(ports)) {
          ports.forEach((parameter) => {
            const param = this.ensureString(parameter);
            portsCorrect.push(param);
          });
        } else {
          throw new Error('Ports parameters for App are invalid');
        }
        domains = this.ensureObject(domains);
        const domainsCorrect = [];
        if (Array.isArray(domains)) {
          domains.forEach((parameter) => {
            const param = this.ensureString(parameter);
            domainsCorrect.push(param);
          });
        } else {
          throw new Error('Enviromental parameters for App are invalid');
        }
        enviromentParameters = this.ensureObject(enviromentParameters);
        const envParamsCorrected = [];
        if (Array.isArray(enviromentParameters)) {
          enviromentParameters.forEach((parameter) => {
            const param = this.ensureString(parameter);
            envParamsCorrected.push(param);
          });
        } else {
          throw new Error('Enviromental parameters for App are invalid');
        }
        commands = this.ensureObject(commands);
        const commandsCorrected = [];
        if (Array.isArray(commands)) {
          commands.forEach((command) => {
            const cmm = this.ensureString(command);
            commandsCorrected.push(cmm);
          });
        } else {
          throw new Error('App commands are invalid');
        }
        containerPorts = this.ensureObject(containerPorts);
        const containerportsCorrect = [];
        if (Array.isArray(containerPorts)) {
          containerPorts.forEach((parameter) => {
            const param = this.ensureString(parameter);
            containerportsCorrect.push(param);
          });
        } else {
          throw new Error('Container Ports parameters for App are invalid');
        }
        containerData = this.ensureString(containerData);
        cpu = this.ensureNumber(cpu);
        ram = this.ensureNumber(ram);
        hdd = this.ensureNumber(hdd);
        if (typeof tiered !== 'boolean') {
          throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
        }

        // finalised parameters that will get stored in global database
        const appSpecFormatted = {
          version, // integer
          name, // string
          description, // string
          repotag, // string
          owner, // zelid string
          ports: portsCorrect, // array of integers
          domains: domainsCorrect, //  array of strings
          enviromentParameters: envParamsCorrected, // array of strings
          commands: commandsCorrected, // array of strings
          containerPorts: containerportsCorrect, // array of integers
          containerData, // string
          cpu, // float 0.1 step
          ram, // integer 100 step (mb)
          hdd, // integer 1 step
          tiered, // boolean
        };

        if (tiered) {
          let { cpubasic } = appSpecification;
          let { cpusuper } = appSpecification;
          let { cpubamf } = appSpecification;
          let { rambasic } = appSpecification;
          let { ramsuper } = appSpecification;
          let { rambamf } = appSpecification;
          let { hddbasic } = appSpecification;
          let { hddsuper } = appSpecification;
          let { hddbamf } = appSpecification;
          if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
            throw new Error('App was requested as tiered setup but specifications are missing');
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

          appSpecFormatted.cpubasic = cpubasic;
          appSpecFormatted.cpusuper = cpusuper;
          appSpecFormatted.cpubamf = cpubamf;
          appSpecFormatted.rambasic = rambasic;
          appSpecFormatted.ramsuper = ramsuper;
          appSpecFormatted.rambamf = rambamf;
          appSpecFormatted.hddbasic = hddbasic;
          appSpecFormatted.hddsuper = hddsuper;
          appSpecFormatted.hddbamf = hddbamf;
        }
        // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper port, repotag exists, string lengths, specs are ok
        if (version !== 2) {
          throw new Error('App message version specification is invalid');
        }
        if (name.length > 32) {
          throw new Error('App name is too long');
        }
        // furthermore name cannot contain any special character
        if (!name.match(/^[a-zA-Z0-9]+$/)) {
          throw new Error('App name contains special characters. Only a-z, A-Z and 0-9 are allowed');
        }
        if (name.startsWith('zel')) {
          throw new Error('App name can not start with zel');
        }
        if (name.startsWith('flux')) {
          throw new Error('App name can not start with flux');
        }
        if (description.length > 256) {
          throw new Error('Description is too long. Maximum of 256 characters is allowed');
        }
        const parameters = this.checkHWParameters(appSpecFormatted);
        if (parameters !== true) {
          const errorMessage = parameters;
          throw new Error(errorMessage);
        }

        // check ports is within range
        appSpecFormatted.ports.forEach((port) => {
          if (port < this.apps.portMin || port > this.apps.portMax) {
            throw new Error(`Assigned port ${port} is not within Apps range ${this.apps.portMin}-${this.apps.portMax}`);
          }
        });

        // check if containerPorts makes sense
        appSpecFormatted.containerPorts.forEach((port) => {
          if (port < 0 || port > 65535) {
            throw new Error(`Container Port ${port} is not within system limits 0-65535`);
          }
        });

        if (appSpecFormatted.containerPorts.length !== appSpecFormatted.ports) {
          throw new Error('Ports specifications do not match');
        }

        if (appSpecFormatted.domains.length !== appSpecFormatted.ports) {
          throw new Error('Domains specifications do not match available ports');
        }

        if (appSpecFormatted.ports.length > 5) {
          throw new Error('Too many ports defined. Maximum of 5 allowed.');
        }

        // check wheter shared Folder is not root
        if (containerData.length < 2) {
          throw new Error('App container data folder not specified. If no data folder is whished, use /tmp');
        }

        // check repotag if available for download
        const splittedRepo = appSpecFormatted.repotag.split(':');
        if (splittedRepo[0] && splittedRepo[1] && !splittedRepo[2]) {
          const zelidauth = localStorage.getItem('zelidauth');
          const data = {
            repotag: appSpecFormatted.repotag,
          };
          const resDocker = await AppsService.checkDockerExistance(zelidauth, data).catch((error) => {
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
        this.dataForAppRegistration = appSpecFormatted;
        this.dataToSign = this.registrationtype + this.version + JSON.stringify(appSpecFormatted) + this.timestamp;
      } catch (error) {
        console.log(error.message);
        vue.$customMes.error(error.message || error);
      }
    },
    async checkFluxUpdateSpecificationsAndFormatMessage() {
      try {
        let appSpecification = this.appUpdateSpecification;
        console.log(appSpecification);
        appSpecification = this.ensureObject(appSpecification);
        let { version } = appSpecification; // shall be 2
        let { name } = appSpecification;
        let { description } = appSpecification;
        let { repotag } = appSpecification;
        let { owner } = appSpecification;
        let { ports } = appSpecification;
        let { domains } = appSpecification;
        let { enviromentParameters } = appSpecification;
        let { commands } = appSpecification;
        let { containerPorts } = appSpecification;
        let { containerData } = appSpecification;
        let { cpu } = appSpecification;
        let { ram } = appSpecification;
        let { hdd } = appSpecification;
        const { tiered } = appSpecification;
        // check if signature of received data is correct
        if (!version || !name || !description || !repotag || !owner || !ports || !domains || !enviromentParameters || !commands || !containerPorts || !containerData || !cpu || !ram || !hdd) {
          throw new Error('Missing App specification parameter');
        }
        version = this.ensureNumber(version);
        name = this.ensureString(name);
        description = this.ensureString(description);
        repotag = this.ensureString(repotag);
        owner = this.ensureString(owner);
        ports = this.ensureObject(ports);
        ports = this.ensureObject(ports);
        const portsCorrect = [];
        if (Array.isArray(ports)) {
          ports.forEach((parameter) => {
            const param = this.ensureString(parameter);
            portsCorrect.push(param);
          });
        } else {
          throw new Error('Ports parameters for App are invalid');
        }
        domains = this.ensureObject(domains);
        const domainsCorrect = [];
        if (Array.isArray(domains)) {
          domains.forEach((parameter) => {
            const param = this.ensureString(parameter);
            domainsCorrect.push(param);
          });
        } else {
          throw new Error('Enviromental parameters for App are invalid');
        }
        enviromentParameters = this.ensureObject(enviromentParameters);
        const envParamsCorrected = [];
        if (Array.isArray(enviromentParameters)) {
          enviromentParameters.forEach((parameter) => {
            const param = this.ensureString(parameter);
            envParamsCorrected.push(param);
          });
        } else {
          throw new Error('Enviromental parameters for App are invalid');
        }
        commands = this.ensureObject(commands);
        const commandsCorrected = [];
        if (Array.isArray(commands)) {
          commands.forEach((command) => {
            const cmm = this.ensureString(command);
            commandsCorrected.push(cmm);
          });
        } else {
          throw new Error('App commands are invalid');
        }
        containerPorts = this.ensureObject(containerPorts);
        const containerportsCorrect = [];
        if (Array.isArray(containerPorts)) {
          containerPorts.forEach((parameter) => {
            const param = this.ensureString(parameter);
            containerportsCorrect.push(param);
          });
        } else {
          throw new Error('Container Ports parameters for App are invalid');
        }
        containerData = this.ensureString(containerData);
        cpu = this.ensureNumber(cpu);
        ram = this.ensureNumber(ram);
        hdd = this.ensureNumber(hdd);
        if (typeof tiered !== 'boolean') {
          throw new Error('Invalid tiered value obtained. Only boolean as true or false allowed.');
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
        };

        if (tiered) {
          let { cpubasic } = appSpecFormatted;
          let { cpusuper } = appSpecFormatted;
          let { cpubamf } = appSpecFormatted;
          let { rambasic } = appSpecFormatted;
          let { ramsuper } = appSpecFormatted;
          let { rambamf } = appSpecFormatted;
          let { hddbasic } = appSpecFormatted;
          let { hddsuper } = appSpecFormatted;
          let { hddbamf } = appSpecFormatted;
          if (!cpubasic || !cpusuper || !cpubamf || !rambasic || !ramsuper || !rambamf || !hddbasic || !hddsuper || !hddbamf) {
            throw new Error('App was requested as tiered setup but specifications are missing');
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

          appSpecFormatted.cpubasic = cpubasic;
          appSpecFormatted.cpusuper = cpusuper;
          appSpecFormatted.cpubamf = cpubamf;
          appSpecFormatted.rambasic = rambasic;
          appSpecFormatted.ramsuper = ramsuper;
          appSpecFormatted.rambamf = rambamf;
          appSpecFormatted.hddbasic = hddbasic;
          appSpecFormatted.hddsuper = hddsuper;
          appSpecFormatted.hddbamf = hddbamf;
        }
        // parameters are now proper format and assigned. Check for their validity, if they are within limits, have propper ports, repotag exists, string lengths, specs are ok
        if (version !== 2) {
          throw new Error('App message version specification is invalid');
        }
        if (name.length > 32) {
          throw new Error('App name is too long');
        }
        // furthermore name cannot contain any special character
        if (!name.match(/^[a-zA-Z0-9]+$/)) {
          throw new Error('App name contains special characters. Only a-z, A-Z and 0-9 are allowed');
        }
        if (name.startsWith('zel')) {
          throw new Error('App name can not start with zel');
        }
        if (name.startsWith('flux')) {
          throw new Error('App name can not start with flux');
        }
        if (name !== this.callBResponse.data.name) {
          throw new Error('App name can not be changed');
        }
        if (repotag !== this.callBResponse.data.repotag) {
          throw new Error('Repository can not be changed');
        }
        if (description.length > 256) {
          throw new Error('Description is too long. Maximum of 256 characters is allowed');
        }
        const parameters = this.checkHWParameters(appSpecFormatted);
        if (parameters !== true) {
          const errorMessage = parameters;
          throw new Error(errorMessage);
        }

        // check ports is within range
        appSpecFormatted.ports.forEach((port) => {
          if (port < this.apps.portMin || port > this.apps.portMax) {
            throw new Error(`Assigned port ${port} is not within Apps range ${this.apps.portMin}-${this.apps.portMax}`);
          }
        });

        // check if containerPorts makes sense
        appSpecFormatted.containerPorts.forEach((port) => {
          if (port < 0 || port > 65535) {
            throw new Error(`Container Port ${port} is not within system limits 0-65535`);
          }
        });

        if (appSpecFormatted.containerPorts.length !== appSpecFormatted.ports) {
          throw new Error('Ports specifications do not match');
        }

        if (appSpecFormatted.domains.length !== appSpecFormatted.ports.length) {
          throw new Error('Domains specifications do not match available ports');
        }

        if (appSpecFormatted.ports.length > 5) {
          throw new Error('Too many ports defined. Maximum of 5 allowed.');
        }

        // check wheter shared Folder is not root
        if (containerData.length < 2) {
          throw new Error('App container data folder not specified. If no data folder is whished, use /tmp');
        }

        // check repotag if available for download
        const splittedRepo = appSpecFormatted.repotag.split(':');
        if (splittedRepo[0] && splittedRepo[1] && !splittedRepo[2]) {
          const zelidauth = localStorage.getItem('zelidauth');
          const data = {
            repotag: appSpecFormatted.repotag,
          };
          const resDocker = await AppsService.checkDockerExistance(zelidauth, data).catch((error) => {
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
        this.dataForAppUpdate = appSpecFormatted;
        this.dataToSign = this.updatetype + this.version + JSON.stringify(appSpecFormatted) + this.timestamp;
      } catch (error) {
        console.log(error.message);
        vue.$customMes.error(error.message || error);
      }
    },
    async checkFluxCommunication() {
      const response = await AppsService.checkCommunication();
      if (response.data.status === 'success') {
        this.fluxCommunication = true;
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
    },
    async registrationInformation() {
      const response = await AppsService.appsRegInformation();
      const { data } = response.data;
      if (response.data.status === 'success') {
        this.apps.price.cpu = data.price.cpu;
        this.apps.price.hdd = data.price.hdd;
        this.apps.price.ram = data.price.ram;
        this.apps.address = data.address;
        this.apps.epochstart = data.epochstart;
        this.apps.portMin = data.portMin;
        this.apps.portMax = data.portMax;
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
    },
    async openGlobalApp(appName) {
      const response = await AppsService.getAppLocation(appName).catch((error) => {
        vue.$customMes.error(error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        const appLocations = response.data.data;
        const location = appLocations[0];
        if (!location) {
          vue.$customMes.error('Application is awaiting launching...');
        } else {
          const { ip } = location;
          const appSpecs = this.globalAppSpecs.data.find((app) => app.name === appName);
          const { port } = appSpecs;
          const { ports } = appSpecs;
          if (port) {
            const url = `http://${ip}:${port}`;
            this.openSite(url);
          } else {
            const url = `http://${ip}:${ports[0]}`;
            this.openSite(url);
          }
        }
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
    },
    openAppManagement(appName, global) {
      console.log(appName);
      this.callResponse.data = '';
      this.callResponse.status = '';
      this.callBResponse.data = '';
      this.callBResponse.status = '';
      this.appExec.cmd = '';
      this.appExec.env = '';
      this.managedApplication = appName;
      this.checkFluxCommunication();
      this.getAppOwner();
      this.getDaemonInfo();
      this.getGlobalApplicationSpecifics();
      if (global) {
        this.managementMenuItem = 'globalappspecifics';
      } else {
        this.getInstalledApplicationSpecifics();
        this.managementMenuItem = 'appspecifics';
      }
    },
    goBackToApps() {
      this.managedApplication = '';
    },
    handleSelect(key, keyPath) {
      this.showMenu = false;
      this.managementMenuItem = key;
      this.callResponse.data = '';
      this.callResponse.status = '';
      // do not reset global application specifics obtained
      this.appExec.cmd = '';
      this.appExec.env = '';
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
          this.appsGetListAllApps();
          break;
        case 'appexec':
          break;
        case 'globalappspecifics':
          this.getGlobalApplicationSpecifics();
          break;
        case 'updateappglobalspecifications':
          this.getGlobalApplicationSpecifics();
          this.getDaemonInfo();
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
        appSpecification: this.dataForAppRegistration,
        timestamp: this.timestamp,
        signature: this.signature,
      };
      const response = await AppsService.registerApp(zelidauth, data).catch((error) => {
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
        vue.$customMes.error(error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        this.updateHash = response.data.data;
        console.log(this.updateHash);
        vue.$customMes.success(response.data.data.message || response.data.data);
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
    },
    initiateSignWS() {
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
        mybackend += this.userconfig.externalip;
        mybackend += ':';
        mybackend += this.config.apiPort;
      }
      let backendURL = store.get('backendURL') || mybackend;
      backendURL = backendURL.replace('https://', 'wss://');
      backendURL = backendURL.replace('http://', 'ws://');
      const signatureMessage = this.appRegistrationSpecification.owner + this.timestamp;
      const wsuri = `${backendURL}/ws/sign/${signatureMessage}`;
      const websocket = new WebSocket(wsuri);
      this.websocket = websocket;

      websocket.onopen = (evt) => { self.onOpen(evt); };
      websocket.onclose = (evt) => { self.onClose(evt); };
      websocket.onmessage = (evt) => { self.onMessage(evt); };
      websocket.onerror = (evt) => { self.onError(evt); };
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
        mybackend += this.userconfig.externalip;
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
    getAppName(appName) {
      // this id is used for volumes, docker names so we know it reall belongs to flux
      if (appName && appName.startsWith('zel')) {
        return appName.substr(3, appName.length);
      }
      if (appName && appName.startsWith('flux')) {
        return appName.substr(4, appName.length);
      }
      return appName;
    },
    async getAppOwner() {
      const response = await AppsService.getAppOwner(this.managedApplication);
      console.log(response);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
      this.selectedAppOwner = response.data.data;
    },
    async getInstalledApplicationSpecifics() {
      const response = await AppsService.getInstalledAppSpecifics(this.managedApplication);
      console.log(response);
      if (response.data.status === 'error' || !response.data.data[0]) {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        [this.callResponse.data] = response.data.data;
      }
    },
    async getGlobalApplicationSpecifics() {
      const response = await AppsService.getAppSpecifics(this.managedApplication);
      console.log(response);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
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
      }
    },
    async getApplicationLocations() {
      const response = await AppsService.getAppLocation(this.managedApplication);
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
      const response = await AppsService.getAppLogsTail(zelidauth, this.managedApplication);
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
      const response = await AppsService.getAppInspect(zelidauth, this.managedApplication);
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
      const response = await AppsService.getAppStats(zelidauth, this.managedApplication);
      console.log(response);
      if (response.data.status === 'error') {
        vue.$customMes.error(response.data.data.message || response.data.data);
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    async appExecute() {
      const zelidauth = localStorage.getItem('zelidauth');
      if (!this.appExec.cmd) {
        vue.$customMes.error('No commands specified');
        return;
      }
      const env = this.appExec.env ? this.appExec.env : '[]';
      const { cmd } = this.appExec;
      this.commandExecuting = true;
      const response = await AppsService.getAppExec(zelidauth, this.managedApplication, cmd, env);
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
      const response = await AppsService.getAppChanges(zelidauth, this.managedApplication);
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
      const response = await AppsService.getAppTop(zelidauth, this.managedApplication);
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
      self.abortToken = DaemonService.cancelToken();
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
      const response = await DaemonService.justAPI().get(`/apps/applog/${this.managedApplication}`, axiosConfig);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'app.log');
      document.body.appendChild(link);
      link.click();
    },
    getAppIdentifier() {
      // this id is used for volumes, docker names so we know it reall belongs to flux
      if (this.managedApplication && this.managedApplication.startsWith('zel')) {
        return this.managedApplication;
      }
      if (this.managedApplication && this.managedApplication.startsWith('flux')) {
        return this.managedApplication;
      }
      if (this.managedApplication === 'KadenaChainWebNode' || this.managedApplication === 'FoldingAtHomeB') {
        return `zel${this.managedApplication}`;
      }
      return `flux${this.managedApplication}`;
    },
    getAppDockerNameIdentifier() {
      // this id is used for volumes, docker names so we know it reall belongs to flux
      const name = this.getAppIdentifier();
      if (name && name.startsWith('/')) {
        return name;
      }
      return `/${name}`;
    },
    handleGlobalDisabledClick() {
      if (!this.callBResponse.data) {
        vue.$message.info('Global Management unavailable. Missing specifications!');
      }
    },
    async getAppPriceFromAPI() {
      const specifics = this.appUpdateSpecification;
      const response = await AppsService.getAppPirce(specifics);
      console.log(response);
    },
    appPricePerMonthMethod(specifications) {
      let price;
      if (specifications.tiered) {
        const cpuTotalCount = specifications.cpubasic + specifications.cpusuper + specifications.cpubamf;
        const cpuPrice = cpuTotalCount * this.apps.price.cpu * 10; // 0.1 core cost cpu price
        const cpuTotal = cpuPrice / 3;
        const ramTotalCount = specifications.rambasic + specifications.ramsuper + specifications.rambamf;
        const ramPrice = (ramTotalCount * this.apps.price.ram) / 100;
        const ramTotal = ramPrice / 3;
        const hddTotalCount = specifications.hddbasic + specifications.hddsuper + specifications.hddbamf;
        const hddPrice = hddTotalCount * this.apps.price.hdd;
        const hddTotal = hddPrice / 3;
        const totalPrice = cpuTotal + ramTotal + hddTotal;
        price = Number(Math.ceil(totalPrice * 100) / 100);
        if (price < 1) {
          price = 1;
        }
        return price;
      }
      const cpuTotal = specifications.cpu * this.apps.price.cpu * 10;
      const ramTotal = (specifications.ram * this.apps.price.ram) / 100;
      const hddTotal = specifications.hdd * this.apps.price.hdd;
      const totalPrice = cpuTotal + ramTotal + hddTotal;
      price = Number(Math.ceil(totalPrice * 100) / 100);
      if (price < 1) {
        price = 1;
      }
      return price;
    },
    async loadLocations(row, expanded) {
      console.log(row);
      console.log(expanded);
      if (expanded && expanded.length > 1) {
        const hideRow = expanded.find((hiderow) => hiderow.name !== row.name);
        if (hideRow) {
          console.log(hideRow);
          this.$refs.appInfoTable.toggleRowExpansion(hideRow);
        }
      }
      if (expanded && (expanded.length === 2 || this.appLocations.length === 0)) {
        this.appLocations = [];
        const response = await AppsService.getAppLocation(row.name).catch((error) => {
          vue.$customMes.error(error.message || error);
        });
        console.log(response);
        if (response.data.status === 'success') {
          const appLocations = response.data.data;
          this.appLocations = appLocations;
        }
      }
    },
    getRandomPort() {
      const min = 31001;
      const max = 39998;
      this.appRegistrationSpecification.ports = [Math.floor(Math.random() * (max - min) + min)];
    },
  },
};
</script>
