<template>
  <div>
    <b-modal
      v-model="progressVisable"
      hide-footer
      centered
      hide-header-close
      no-close-on-backdrop
      no-close-on-esc
      size="lg"
      header-bg-variant="primary"
      title-class="custom-modal-title"
      :title="operationTitle"
      title-tag="h5"
    >
      <div class="d-flex flex-column justify-content-center align-items-center" style="height: 100%;">
        <div class="d-flex align-items-center mb-2">
          <b-spinner label="Loading..." />
          <div class="ml-1">
            Waiting for the operation to be completed...
          </div>
        </div>
      </div>
    </b-modal>
    <b-card>
      <b-card-sub-title>
        Note: Mining of any sort including bandwidth mining is prohibited as well as any illegal activites. Please read through
        <b-link
          href="https://cdn.runonflux.io/Flux_Terms_of_Service.pdf"
          target="_blank"
          active-class="primary"
          rel="noopener noreferrer"
        >
          Terms of Service
        </b-link>
        before deploying your application. In case of any question please contact the Flux Community via
        <b-link
          href="https://discord.gg/runonflux"
          target="_blank"
          active-class="primary"
          rel="noopener noreferrer"
        >
          Discord
        </b-link>
        or submit an issue directly to
        <b-link
          href="https://github.com/RunOnFlux/flux"
          target="_blank"
          active-class="primary"
          rel="noopener noreferrer"
        >
          Flux repository.
        </b-link>.
      </b-card-sub-title>
    </b-card>
    <div
      v-if="specificationVersion >= 4"
      @dragover="dragover"
      @dragleave="dragleave"
      @drop="drop"
    >
      <b-overlay
        no-center
        variant="transparent"
        opacity="1"
        blur="3px"
        :show="isDragging"
        rounded="sm"
      >
        <template #overlay>
          <div id="fileDropOverlay" class="text-center">
            <b-icon icon="folder" font-scale="8" animation="cylon" />
            <div class="text bd-highlight" style="font-size: 20px">
              Drop your docker-compose.yaml here
            </div>
          </div>
        </template>
        <b-row class="match-height">
          <b-col xs="6">
            <b-form-file
              ref="uploadSpecs"
              class="d-none"
              @input="loadFile"
            />
            <b-card>
              <b-row align-h="end">
                <b-col>
                  <b-card-title>
                    Details
                  </b-card-title>
                </b-col>
                <b-col sm="auto" class="pr-0 mb-1">
                  <b-button
                    v-b-tooltip.hover.top="'Upload Docker Compose File'"
                    class="mr-0"
                    variant="outline-primary"
                    @click="uploadFile"
                  >
                    <v-icon name="cloud-download-alt" /> Upload
                  </b-button>
                </b-col>
                <b-col sm="auto" class="pl-1 mb-1">
                  <b-button
                    v-b-tooltip.hover.top="'Import Application Specification'"
                    class="ml-0"
                    variant="outline-primary"
                    @click="importAppSpecs = true"
                  >
                    <v-icon name="cloud-download-alt" /> Import
                  </b-button>
                </b-col>
              </b-row>
              <b-form-group
                label-cols="2"
                label-cols-lg="1"
                label="Version"
                label-for="version"
              >
                <b-form-input
                  id="version"
                  v-model="appRegistrationSpecification.version"
                  :placeholder="appRegistrationSpecification.version.toString()"
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
                  v-model="appRegistrationSpecification.name"
                  placeholder="Application Name"
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
                  v-model="appRegistrationSpecification.description"
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
                  v-model="appRegistrationSpecification.owner"
                  placeholder="Flux ID of Application Owner"
                />
              </b-form-group>
              <div v-if="specificationVersion >= 5">
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
                      v-model="appRegistrationSpecification.contacts"
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
                <div v-if="specificationVersion >= 5 && !isPrivateApp">
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
                <div v-if="specificationVersion >= 5 && !isPrivateApp">
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
              </div>
              <br>
              <b-form-group
                v-if="appRegistrationSpecification.version >= 3"
                label-cols="2"
                label-cols-lg="1"
                label="Instances"
                label-for="instances"
              >
                <div class="mx-1">
                  {{ appRegistrationSpecification.instances }}
                </div>
                <b-form-input
                  id="instances"
                  v-model="appRegistrationSpecification.instances"
                  placeholder="Minimum number of application instances to be spawned"
                  type="range"
                  :min="minInstances"
                  :max="maxInstances"
                  step="1"
                />
              </b-form-group>
              <br>
              <b-form-group
                v-if="appRegistrationSpecification.version >= 6"
                label-cols="2"
                label-cols-lg="1"
                label="Period"
                label-for="period"
              >
                <div class="mx-1">
                  {{ getExpireLabel || (appRegistrationSpecification.expire ? `${appRegistrationSpecification.expire} blocks` : '1 month') }}
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
              <br>
              <div
                v-if="appRegistrationSpecification.version >= 7"
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
                    v-model="appRegistrationSpecification.staticip"
                    switch
                    class="custom-control-primary inline"
                  />
                </div>
              </div>
              <div
                v-if="appRegistrationSpecification.version === 7"
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
              <div
                v-if="appRegistrationSpecification.version >= 8"
                class="form-row form-group"
              >
                <label class="col-form-label">
                  Enterprise Application
                  <v-icon
                    v-b-tooltip.hover.top="'Select if your application requires privacy, your components specifications will be encrypted and only machines running ArcaneOS will be able to install them.'"
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
          v-for="(component, index) in appRegistrationSpecification.compose"
          :key="index"
          ref="components"
        >
          <b-card-title>
            Component {{ component.name }}
            <b-button
              v-if="appRegistrationSpecification.compose.length > 1"
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="warning"
              aria-label="Remove Component"
              class="float-right"
              size="sm"
              @click="removeComponent(index)"
            >
              Remove
            </b-button>
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
                      id="repo"
                      v-model="component.name"
                      placeholder="Component name"
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
                      id="repo"
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
                      id="repo"
                      v-model="component.repotag"
                      placeholder="Docker image namespace/repository:tag"
                    />
                  </div>
                </div>
                <div
                  v-if="appRegistrationSpecification.version >= 7 && isPrivateApp"
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
                      id="repoauth"
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
                      id="ports"
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
                      id="domains"
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
                      id="containerPorts"
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
                      id="environmentParameters"
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
                      id="commands"
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
                      id="containerData"
                      v-model="component.containerData"
                    />
                  </div>
                </div>
                <div
                  v-if="appRegistrationSpecification.version === 7 && isPrivateApp"
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
                      id="secrets"
                      v-model="component.secrets"
                      placeholder="[]"
                    />
                  </div>
                </div>
                <br>
                <b-card-title>
                  Resources &nbsp;&nbsp;&nbsp;<h6 v-if="appRegistrationSpecification.version < 8" class="inline text-small">
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
                  label-cols="2"
                  label-cols-lg="1"
                  label="CPU"
                  label-for="cpu"
                >
                  <div class="mx-1">
                    {{ component.cpu }}
                  </div>
                  <b-form-input
                    id="cpu"
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
                  label-cols="2"
                  label-cols-lg="1"
                  label="RAM"
                  label-for="ram"
                >
                  <div class="mx-1">
                    {{ component.ram }}
                  </div>
                  <b-form-input
                    id="ram"
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
                  label-cols="2"
                  label-cols-lg="1"
                  label="SSD"
                  label-for="ssd"
                >
                  <div class="mx-1">
                    {{ component.hdd }}
                  </div>
                  <b-form-input
                    id="ssd"
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
          v-if="appRegistrationSpecification.version === 7 && isPrivateApp"
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
                  <b-card class="mx-2">
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
        <b-card
          v-if="appRegistrationSpecification.version >= 8 && isPrivateApp"
          title="Priority Nodes"
        >
          Select if needed Priority Nodes to run your app, the app can still deploy on other nodes on the network.<br>
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
                :empty-text="'No Priority Nodes selected'"
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
              aria-label="Choose Enterprise Nodes"
              class="mb-2 mr-2"
              @click="chooseEnterpriseDialog = true"
            >
              Choose Priority Nodes
            </b-button>
          </div>
        </b-card>
      </b-overlay>
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
                v-model="appRegistrationSpecification.version"
                :placeholder="appRegistrationSpecification.version.toString()"
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
                v-model="appRegistrationSpecification.name"
                placeholder="App Name"
              />
            </b-form-group>
            <b-form-group
              label-cols="2"
              label="Desc."
              label-for="desc"
            >
              <b-form-textarea
                id="desc"
                v-model="appRegistrationSpecification.description"
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
                v-model="appRegistrationSpecification.repotag"
                placeholder="Docker image namespace/repository:tag"
              />
            </b-form-group>
            <b-form-group
              label-cols="2"
              label="Owner"
              label-for="owner"
            >
              <b-form-input
                id="owner"
                v-model="appRegistrationSpecification.owner"
                placeholder="Flux ID of Application Owner"
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
                  v-model="appRegistrationSpecification.ports"
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
                  v-model="appRegistrationSpecification.domains"
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
                  v-model="appRegistrationSpecification.enviromentParameters"
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
                  v-model="appRegistrationSpecification.commands"
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
                  v-model="appRegistrationSpecification.containerPorts"
                />
              </div>
            </div>
            <div class="form-row form-group">
              <label class="col-3 col-form-label">
                Cont. Data
                <v-icon
                  v-b-tooltip.hover.top="'Data folder that is shared by application to App volume. Prepend with r: for synced data between instances. Ex. r:/data. Prepend with g: for synced data and master/slave solution. Ex. g:/data'"
                  name="info-circle"
                  class="mr-1"
                />
              </label>
              <div class="col">
                <b-form-input
                  id="containerData"
                  v-model="appRegistrationSpecification.containerData"
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
                  v-model="appRegistrationSpecification.tiered"
                  switch
                  class="custom-control-primary inline"
                />
              </h6>
            </b-card-title>
            <b-form-group
              v-if="appRegistrationSpecification.version >= 3"
              label-cols="2"
              label-cols-lg="1"
              label="Instances"
              label-for="instances"
            >
              <div class="mx-1">
                {{ appRegistrationSpecification.instances }}
              </div>
              <b-form-input
                id="instances"
                v-model="appRegistrationSpecification.instances"
                placeholder="Minimum number of application instances to be spawned"
                type="range"
                min="3"
                max="100"
                step="1"
              />
            </b-form-group>
            <b-form-group
              v-if="!appRegistrationSpecification.tiered"
              label-cols="2"
              label-cols-lg="1"
              label="CPU"
              label-for="cpu"
            >
              <div class="mx-1">
                {{ appRegistrationSpecification.cpu }}
              </div>
              <b-form-input
                id="cpu"
                v-model="appRegistrationSpecification.cpu"
                placeholder="CPU cores to use by default"
                type="range"
                min="0.1"
                max="15"
                step="0.1"
              />
            </b-form-group>
            <b-form-group
              v-if="!appRegistrationSpecification.tiered"
              label-cols="2"
              label-cols-lg="1"
              label="RAM"
              label-for="ram"
            >
              <div class="mx-1">
                {{ appRegistrationSpecification.ram }}
              </div>
              <b-form-input
                id="ram"
                v-model="appRegistrationSpecification.ram"
                placeholder="RAM in MB value to use by default"
                type="range"
                min="100"
                max="59000"
                step="100"
              />
            </b-form-group>
            <b-form-group
              v-if="!appRegistrationSpecification.tiered"
              label-cols="2"
              label-cols-lg="1"
              label="SSD"
              label-for="ssd"
            >
              <div class="mx-1">
                {{ appRegistrationSpecification.hdd }}
              </div>
              <b-form-input
                id="ssd"
                v-model="appRegistrationSpecification.hdd"
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
      <b-row v-if="appRegistrationSpecification.tiered">
        <b-col
          xs="12"
          md="6"
          lg="4"
        >
          <b-card title="Cumulus">
            <div>
              CPU: {{ appRegistrationSpecification.cpubasic }}
            </div>
            <b-form-input
              v-model="appRegistrationSpecification.cpubasic"
              type="range"
              min="0.1"
              max="3"
              step="0.1"
            />
            <div>
              RAM: {{ appRegistrationSpecification.rambasic }}
            </div>
            <b-form-input
              v-model="appRegistrationSpecification.rambasic"
              type="range"
              min="100"
              max="5000"
              step="100"
            />
            <div>
              SSD: {{ appRegistrationSpecification.hddbasic }}
            </div>
            <b-form-input
              v-model="appRegistrationSpecification.hddbasic"
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
              CPU: {{ appRegistrationSpecification.cpusuper }}
            </div>
            <b-form-input
              v-model="appRegistrationSpecification.cpusuper"
              type="range"
              min="0.1"
              max="7"
              step="0.1"
            />
            <div>
              RAM: {{ appRegistrationSpecification.ramsuper }}
            </div>
            <b-form-input
              v-model="appRegistrationSpecification.ramsuper"
              type="range"
              min="100"
              max="28000"
              step="100"
            />
            <div>
              SSD: {{ appRegistrationSpecification.hddsuper }}
            </div>
            <b-form-input
              v-model="appRegistrationSpecification.hddsuper"
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
              CPU: {{ appRegistrationSpecification.cpubamf }}
            </div>
            <b-form-input
              v-model="appRegistrationSpecification.cpubamf"
              type="range"
              min="0.1"
              max="15"
              step="0.1"
            />
            <div>
              RAM: {{ appRegistrationSpecification.rambamf }}
            </div>
            <b-form-input
              v-model="appRegistrationSpecification.rambamf"
              type="range"
              min="1000"
              max="59000"
              step="100"
            />
            <div>
              SSD: {{ appRegistrationSpecification.hddbamf }}
            </div>
            <b-form-input
              v-model="appRegistrationSpecification.hddbamf"
              type="range"
              min="1"
              max="820"
              step="1"
            />
          </b-card>
        </b-col>
      </b-row>
    </div>
    <div>
      <br>
      <b-form-checkbox
        id="tos"
        v-model="tosAgreed"
        switch
        class="custom-control-primary inline"
      />
      I agree with
      <a
        href="https://cdn.runonflux.io/Flux_Terms_of_Service.pdf"
        target="_blank"
        rel="noopener noreferrer"
      >
        Terms of Service
      </a>
    </div>
    <div
      v-if="appRegistrationSpecification.version >= 4 && appRegistrationSpecification.compose.length < (currentHeight < 1300000 ? 5 : 10)"
      class="text-center"
    >
      <b-button
        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
        variant="secondary"
        aria-label="Add Component to Application Composition"
        class="mb-4"
        @click="addCopmonent"
      >
        Add Component to Application Composition
      </b-button>
    </div>
    <div class="text-center">
      <b-button
        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
        variant="success"
        aria-label="Compute Registration Message"
        class="mb-2"
        @click="checkFluxSpecificationsAndFormatMessage"
      >
        Compute Registration Message
      </b-button>
    </div>
    <div v-if="dataToSign">
      <b-form-group
        label-cols="3"
        label-cols-lg="2"
        label="Registration Message"
        label-for="registrationmessage"
      >
        <div class="text-wrap">
          <b-form-textarea
            id="registrationmessage"
            v-model="dataToSign"
            style="padding-top: 15px;"
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
        label-for="signature"
      >
        <b-form-input
          id="signature"
          v-model="signature"
        />
      </b-form-group>
      <b-row class="match-height">
        <b-col
          xs="6"
          lg="8"
        >
          <b-card
            class="text-center"
            title="Register Application"
          >
            <b-card-text>
              <h5>
                &nbsp;<b-icon
                  class="mr-1 mt-2"
                  scale="1.4"
                  icon="cash-coin"
                />Price: <b>{{ applicationPriceUSD }} USD + VAT</b>
              </h5>
            </b-card-text>
            <b-card-text>
              <h5>
                &nbsp;<b-icon
                  class="mr-1"
                  scale="1.4"
                  icon="clock"
                />Subscription period: <b>{{ getExpireLabel || (appRegistrationSpecification.expire ? `${appRegistrationSpecification.expire} blocks` : '1 month') }}</b>
              </h5>
            </b-card-text>
            <b-button
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              :disabled="!signature"
              variant="outline-success"
              aria-label="Register Flux App"
              class="mt-3"
              style="width: 300px"
              @click="register"
            >
              Register
            </b-button>
          </b-card>
        </b-col>
        <b-col
          xs="6"
          lg="4"
        >
          <b-card
            ref="signContainer"
            class="text-center highlight-container"
            title="Sign with"
          >
            <div class="loginRow">
              <a @click="initiateSignWS">
                <img
                  class="walletIcon"
                  src="@/assets/images/FluxID.svg"
                  alt="Flux ID"
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
                aria-label="Flux Single Sign On/Email"
                class="my-1"
                style="width: 250px"
                @click="initSignFluxSSO"
              >
                Flux Single Sign On (SSO)/Email
              </b-button>
            </div>
          </b-card>
        </b-col>
      </b-row>
      <div
        v-if="registrationHash"
        class="match-height"
      >
        <b-row>
          <b-card title="Test Application Installation">
            <b-card-text>
              <div>
                It's now time to test your application install/launch. It's very important to test the app install/launch to make sure your application specifications work.
                You will get the application install/launch log at the bottom of this page once it's completed, if the app starts you can proceed with the payment, if not, you need to fix/change the specifications and try again before you can pay the app subscription.
              </div>
              <span v-if="testError" style="color: red">
                <br>
                <b>WARNING: Test failed! Check logs at the bottom. If the error is related with your application specifications try to fix it before you pay your registration subscription.</b>
              </span>
            </b-card-text>
            <b-button
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Test Launch"
              class="my-1"
              @click="testAppInstall(registrationHash)"
            >
              Test Installation
            </b-button>
          </b-card>
        </b-row>
      </div>
      <b-row
        v-if="testFinished"
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
            To finish the application registration, pay your application with your prefered payment method or check below how to pay with Flux crypto currency.
          </b-card>
        </b-col>
        <b-col
          xs="6"
          lg="4"
        >
          <b-card
            class="text-center"
            title="Pay with Stripe/PayPal"
          >
            <div class="loginRow">
              <a v-if="stripeEnabled" @click="initStripePay(registrationHash, appRegistrationSpecification.name, applicationPriceUSD, appRegistrationSpecification.description)">
                <img
                  class="stripePay"
                  src="@/assets/images/Stripe.svg"
                  alt="Stripe"
                  height="100%"
                  width="100%"
                >
              </a>
              <a v-if="paypalEnabled" @click="initPaypalPay(registrationHash, appRegistrationSpecification.name, applicationPriceUSD, appRegistrationSpecification.description)">
                <img
                  class="paypalPay"
                  src="@/assets/images/PayPal.png"
                  alt="PayPal"
                  height="100%"
                  width="100%"
                >
              </a>
              <span v-if="!paypalEnabled && !stripeEnabled">Fiat Gateways Unavailable.</span>
            </div>
            <div
              v-if="checkoutLoading"
              className="loginRow"
            >
              <b-spinner variant="primary" />
              <div class="text-center">
                Checkout Loading ...
              </div>
            </div>
            <div
              v-if="fiatCheckoutURL"
              className="loginRow"
            >
              <a
                :href="fiatCheckoutURL"
                target="_blank"
                rel="noopener noreferrer"
              >
                Click here for checkout if not redirected
              </a>
            </div>
          </b-card>
        </b-col>
      </b-row>
      <b-row
        v-if="testFinished && !applicationPriceFluxError"
        class="match-height"
      >
        <b-col
          xs="6"
          lg="8"
        >
          <b-card>
            <b-card-text>
              To pay in FLUX, please make a transaction of <b>{{ applicationPrice }} FLUX</b> to address
              <b>'{{ deploymentAddress }}'</b>
              with the following message:
              <b>'{{ registrationHash }}'</b>
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
              <a @click="initZelcorePay">
                <img
                  class="walletIcon"
                  src="@/assets/images/FluxID.svg"
                  alt="Flux ID"
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
            <div
              v-if="paymentLoading"
              class="mt-2 text-center"
            >
              <b-spinner
                variant="primary"
                small
              />
              <div class="text-center mt-1">
                Waiting for payment...
              </div>
            </div>
            <div
              v-if="paymentReceived && transactionId"
              class="mt-2"
            >
              <b-alert
                variant="success"
                show
              >
                <strong>Payment Received!</strong>
                <br>
                <small>Transaction ID: {{ transactionId }}</small>
              </b-alert>
            </div>
          </b-card>
        </b-col>
      </b-row>
    </div>
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
    <b-modal
      v-model="chooseEnterpriseDialog"
      title="Select Enterprise Nodes"
      size="xl"
      centered
      button-size="sm"
      ok-only
      ok-title="Done"
      header-bg-variant="primary"
      title-class="custom-modal-title"
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
            @filtered="onFilteredSelection"
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
    <b-modal
      v-model="importAppSpecs"
      title="Import Application Specifications"
      size="lg"
      centered
      ok-title="Import"
      cancel-title="Cancel"
      header-bg-variant="primary"
      title-class="custom-modal-title"
      @ok="importSpecs(importedSpecs)"
      @cancel="importAppSpecs = false; importedSpecs = ''"
    >
      <b-form-textarea
        id="importedAppSpecs"
        v-model="importedSpecs"
        rows="6"
      />
    </b-modal>
  </div>
</template>

<script>
import {
  BProgress,
  BButton,
  BCard,
  BCardSubTitle,
  BCardText,
  BCardTitle,
  BFormCheckbox,
  BFormGroup,
  BFormInput,
  BFormSelect,
  BFormSelectOption,
  BFormTextarea,
  BLink,
  BTable,
  BPagination,
  BInputGroup,
  BInputGroupAppend,
  VBTooltip,
} from 'bootstrap-vue';

import { mapState } from 'vuex';
import Ripple from 'vue-ripple-directive';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import AppsService from '@/services/AppsService';
import DaemonService from '@/services/DaemonService';
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';
import ListEntry from '@/views/components/ListEntry.vue';

import SignClient from '@walletconnect/sign-client';
import { MetaMaskSDK } from '@metamask/sdk';
import useAppConfig from '@core/app-config/useAppConfig';
import { useClipboard } from '@vueuse/core';
import { getUser } from '@/libs/firebase';
import getPaymentGateways, { paymentBridge } from '@/libs/fiatGateways';

import topologicalSort from '@/utils/topologicalSort';
import yaml from 'js-yaml';
import { getOpenPGP } from '@/utils/openpgp-wrapper';

const projectId = 'df787edc6839c7de49d527bba9199eaa';

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

const qs = require('qs');
const axios = require('axios');
const store = require('store');
// const https = require('https');
const timeoptions = require('@/libs/dateFormat');

const geolocations = require('../../libs/geolocation');

export default {
  components: {
    BProgress,
    BButton,
    BCard,
    BCardSubTitle,
    BCardText,
    BCardTitle,
    BFormCheckbox,
    BFormGroup,
    BFormInput,
    BFormSelect,
    BFormSelectOption,
    BFormTextarea,
    BLink,
    BTable,
    BPagination,
    BInputGroup,
    BInputGroupAppend,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
    ConfirmDialog,
    ListEntry,
  },
  directives: {
    'b-tooltip': VBTooltip,
    Ripple,
  },
  data() {
    return {
      progressVisable: false,
      operationTitle: '',
      isDragging: false,
      reader: new FileReader(),
      tooltipText: 'Copy to clipboard',
      importAppSpecs: false,
      importedSpecs: '',
      timeoptions,
      version: 1,
      websocket: null,
      dataToSign: '',
      timestamp: '',
      signature: '',
      registrationHash: '',
      registrationtype: 'fluxappregister',
      currentHeight: 1350000,
      specificationVersion: 8,
      appRegistrationSpecification: {},
      appRegistrationSpecificationV3Template: {
        version: 3,
        name: '',
        description: '',
        owner: '',
        instances: 3,
        repotag: '',
        ports: '[]',
        domains: '[]',
        enviromentParameters: '[]',
        commands: '[]',
        containerPorts: '[]',
        containerData: '',
        cpu: 0.5,
        ram: 2000,
        hdd: 40,
        tiered: false,
        cpubasic: 0.5,
        rambasic: 500,
        hddbasic: 10,
        cpusuper: 1.5,
        ramsuper: 2500,
        hddsuper: 60,
        cpubamf: 3.5,
        rambamf: 14000,
        hddbamf: 285,
      },
      appRegistrationSpecificationV4Template: {
        version: 4,
        name: '',
        description: '',
        owner: '',
        instances: 3,
        compose: [
          {
            name: '',
            description: '',
            repotag: '',
            ports: '[]',
            domains: '[]',
            environmentParameters: '[]',
            commands: '[]',
            containerPorts: '[]',
            containerData: '',
            cpu: 0.5,
            ram: 2000,
            hdd: 40,
            tiered: false,
            cpubasic: 0.5,
            rambasic: 500,
            hddbasic: 10,
            cpusuper: 1.5,
            ramsuper: 2500,
            hddsuper: 60,
            cpubamf: 3.5,
            rambamf: 14000,
            hddbamf: 285,
          },
        ],
      },
      appRegistrationSpecificationV5Template: {
        version: 5,
        name: '',
        description: '',
        owner: '',
        instances: 3,
        contacts: '[]',
        geolocation: [],
        compose: [
          {
            name: '',
            description: '',
            repotag: '',
            ports: '[]',
            domains: '[]',
            environmentParameters: '[]',
            commands: '[]',
            containerPorts: '[]',
            containerData: '',
            cpu: 0.5,
            ram: 2000,
            hdd: 40,
            tiered: false,
            cpubasic: 0.5,
            rambasic: 500,
            hddbasic: 10,
            cpusuper: 1.5,
            ramsuper: 2500,
            hddsuper: 60,
            cpubamf: 3.5,
            rambamf: 14000,
            hddbamf: 285,
          },
        ],
      },
      appRegistrationSpecificationV6Template: {
        version: 6,
        name: '',
        description: '',
        owner: '',
        instances: 3,
        contacts: '[]',
        geolocation: [],
        expire: 22000,
        compose: [
          {
            name: '',
            description: '',
            repotag: '',
            ports: '[]',
            domains: '[]',
            environmentParameters: '[]',
            commands: '[]',
            containerPorts: '[]',
            containerData: '',
            cpu: 0.5,
            ram: 2000,
            hdd: 40,
            tiered: false,
            cpubasic: 0.5,
            rambasic: 500,
            hddbasic: 10,
            cpusuper: 1.5,
            ramsuper: 2500,
            hddsuper: 60,
            cpubamf: 3.5,
            rambamf: 14000,
            hddbamf: 285,
          },
        ],
      },
      appRegistrationSpecificationV7Template: {
        version: 7,
        name: '',
        description: '',
        owner: '',
        instances: 3,
        contacts: '[]',
        geolocation: [],
        nodes: [],
        expire: 22000,
        staticip: false,
        compose: [
          {
            name: '',
            description: '',
            repotag: '',
            repoauth: '',
            ports: '[]',
            domains: '[]',
            environmentParameters: '[]',
            secrets: '', // at encryption will become string
            commands: '[]',
            containerPorts: '[]',
            containerData: '',
            cpu: 0.5,
            ram: 2000,
            hdd: 40,
            tiered: false,
            cpubasic: 0.5,
            rambasic: 500,
            hddbasic: 10,
            cpusuper: 1.5,
            ramsuper: 2500,
            hddsuper: 60,
            cpubamf: 3.5,
            rambamf: 14000,
            hddbamf: 285,
          },
        ],
      },
      appRegistrationSpecificationV8Template: {
        version: 8,
        name: '',
        description: '',
        owner: '',
        instances: 3,
        contacts: '[]',
        geolocation: [],
        nodes: [],
        expire: 22000,
        staticip: false,
        enterprise: '',
        compose: [
          {
            name: '',
            description: '',
            repotag: '',
            repoauth: '',
            ports: '[]',
            domains: '[]',
            environmentParameters: '[]',
            commands: '[]',
            containerPorts: '[]',
            containerData: '',
            cpu: 0.5,
            ram: 2000,
            hdd: 40,
          },
        ],
      },
      isPrivateApp: false,
      composeTemplate: {
        name: '',
        description: '',
        repotag: '',
        ports: '[]',
        domains: '[]',
        environmentParameters: '[]',
        commands: '[]',
        containerPorts: '[]',
        containerData: '',
        cpu: 0.5,
        ram: 2000,
        hdd: 40,
        tiered: false,
        cpubasic: 0.5,
        rambasic: 500,
        hddbasic: 10,
        cpusuper: 1.5,
        ramsuper: 2500,
        hddsuper: 60,
        cpubamf: 3.5,
        rambamf: 14000,
        hddbamf: 285,
      },
      composeTemplatev7: {
        name: '',
        description: '',
        repotag: '',
        repoauth: '',
        ports: '[]',
        domains: '[]',
        environmentParameters: '[]',
        secrets: '', // at encryption will become string
        commands: '[]',
        containerPorts: '[]',
        containerData: '',
        cpu: 0.5,
        ram: 2000,
        hdd: 40,
        tiered: false,
        cpubasic: 0.5,
        rambasic: 500,
        hddbasic: 10,
        cpusuper: 1.5,
        ramsuper: 2500,
        hddsuper: 60,
        cpubamf: 3.5,
      },
      composeTemplatev8: {
        name: '',
        description: '',
        repotag: '',
        repoauth: '',
        ports: '[]',
        domains: '[]',
        environmentParameters: '[]',
        commands: '[]',
        containerPorts: '[]',
        containerData: '',
        cpu: 0.5,
        ram: 2000,
        hdd: 40,
      },
      dataForAppRegistration: {},
      applicationPrice: 0,
      applicationPriceFluxError: false,
      applicationPriceFluxDiscount: '',
      applicationPriceUSD: 0,
      deploymentAddress: '',
      minInstances: 3,
      maxInstances: 100,
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
      possibleLocations: [],
      allowedGeolocations: {},
      forbiddenGeolocations: {},
      numberOfGeolocations: 1,
      numberOfNegativeGeolocations: 1,
      output: [],
      downloading: false,
      downloadOutputReturned: false,
      downloadOutput: {},
      nodeIP: '',
      tosAgreed: false,
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
          { key: 'score', label: 'Enterprise Score', sortable: true },
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
          { key: 'score', label: 'Score', sortable: true },
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
      signClient: null,
      fiatCheckoutURL: '',
      checkoutLoading: false,
      ipAccess: false,
      stripeEnabled: true,
      paypalEnabled: true,
      testError: false,
      paymentId: '',
      paymentWebsocket: null,
      transactionId: '',
      paymentReceived: false,
      paymentLoading: false,
      testFinished: false,
    };
  },
  computed: {
    ...mapState('flux', [
      'config',
      'privilege',
    ]),
    skin() {
      return useAppConfig().skin.value;
    },
    validTill() {
      const expTime = this.timestamp + 60 * 60 * 1000; // 1 hour
      return expTime;
    },
    subscribedTill() {
      const expire = this.convertExpire();
      if (expire) {
        const timeFound = this.expireOptions.find((option) => option.value === expire);
        if (timeFound) {
          const expTime = this.timestamp + timeFound.time;
          return expTime;
        }
        const blocks = expire;
        // Calculate time based on current block height
        // Before fork (block 2020000): 2 minutes per block
        // After fork: 30 seconds per block
        const forkBlock = 2020000;
        const currentBlock = this.currentHeight;

        let validTime = 0;
        if (currentBlock < forkBlock) {
          // Currently before fork: 2 minutes per block
          validTime = blocks * 2 * 60 * 1000;
        } else {
          // Currently after fork: 30 seconds per block
          validTime = blocks * 30 * 1000;
        }

        const expTime = this.timestamp + validTime;
        return expTime;
      }
      const expTime = this.timestamp + 30 * 24 * 60 * 60 * 1000; // 1 month
      return expTime;
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
    paymentCallbackValue() {
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
      const url = `${backendURL}/payment/verifypayment?paymentid=${this.paymentId}`;
      return encodeURI(url);
    },
    getExpireLabel() {
      if (this.expireOptions[this.expirePosition]) {
        return this.expireOptions[this.expirePosition].label;
      }
      return null;
    },
    immutableAppSpecs() {
      return JSON.stringify(this.appRegistrationSpecification);
    },
  },
  watch: {
    // changed this to watch a string. Whenever checkFluxSpecificationsAndFormatMessage was
    // being run, it was reassigning properties which was causing this watcher to fire, even if
    // the properties were the same (empty fields). This would cause the viewport to jump to the
    // top of the screen if you click compute registration message twice. Should probably just disable
    // the button once clicked, then re-enable if specs change.
    immutableAppSpecs: {
      handler() {
        this.dataToSign = '';
        this.signature = '';
        this.timestamp = null;
        this.dataForAppRegistration = {};
        this.registrationHash = '';
        this.output = [];
        this.testError = false;
        this.testFinished = false;
        if (this.websocket !== null) {
          this.websocket.close();
          this.websocket = null;
        }
      },
    },
    expirePosition: {
      handler() {
        this.dataToSign = '';
        this.signature = '';
        this.timestamp = null;
        this.dataForAppRegistration = {};
        this.registrationHash = '';
        this.output = [];
        this.testError = false;
        this.testFinished = false;
        if (this.websocket !== null) {
          this.websocket.close();
          this.websocket = null;
        }
      },
    },
    isPrivateApp(value) {
      console.log(value);
      if (this.appRegistrationSpecification.version >= 7 && value === false) {
        this.appRegistrationSpecification.nodes = [];
        this.appRegistrationSpecification.compose.forEach((component) => {
          if (this.appRegistrationSpecification.version === 7 && value === false) {
            // eslint-disable-next-line no-param-reassign
            component.secrets = '';
          }
          // eslint-disable-next-line no-param-reassign
          component.repoauth = '';
        });
        this.selectedEnterpriseNodes = [];
      }
      if (this.appRegistrationSpecification.version === 7 && value === false) {
        // remove any geolocation
        this.allowedGeolocations = {};
        this.forbiddenGeolocations = {};
      }
      if (this.appRegistrationSpecification.version === 8 && value === false) {
        this.appRegistrationSpecification.enterprise = '';
      }
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
  },
  beforeMount() {
    this.appRegistrationSpecification = this.appRegistrationSpecificationV7Template;
  },
  mounted() {
    const { hostname } = window.location;
    const regex = /[A-Za-z]/g;
    if (hostname.match(regex)) {
      this.ipAccess = false;
    } else {
      this.ipAccess = true;
    }
    this.initMMSDK();
    this.getGeolocationData();
    this.getDaemonInfo();
    this.appsDeploymentInformation();
    this.getFluxnodeStatus();
    this.getMultiplier();
    this.getEnterpriseNodes();
    const zelidauth = localStorage.getItem('zelidauth');
    const auth = qs.parse(zelidauth);
    this.appRegistrationSpecification.owner = auth.zelid;
    if (this.$router.currentRoute.params.appspecs) {
      this.importSpecs(this.$router.currentRoute.params.appspecs);
    }
    if (auth.zelid) {
      this.appRegistrationSpecification.owner = auth.zelid;
    } else {
      this.showToast('warning', 'Please log in first before registering an application');
    }
  },
  methods: {
    async initMMSDK() {
      try {
        await MMSDK.init();
        ethereum = MMSDK.getProvider();
      } catch (error) {
        console.log(error);
      }
    },
    onFilteredSelection(filteredItems) {
      // Trigger pagination to update the number of buttons/pages due to filtering
      this.entNodesSelectTable.totalRows = filteredItems.length;
      this.entNodesSelectTable.currentPage = 1;
    },
    getExpirePosition(value) {
      const position = this.expireOptions.findIndex((opt) => opt.value === value);
      if (position || position === 0) {
        return position;
      }
      return 2;
    },
    decodeGeolocation(existingGeolocation) {
      // decode geolocation and push it properly numberOfGeolocations, numberOfNegativeGeolocations
      // selectedContinent1, selectedCountry1, selectedRegion1
      // existingGeolocation is an array that can contain older specs of a, b OR can contain new specs of ac (a!c);
      console.log(existingGeolocation);
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
    async getFluxnodeStatus() {
      try {
        const fluxnodeStatus = await DaemonService.getFluxNodeStatus();
        if (fluxnodeStatus.data.status === 'error') {
          this.showToast('danger', fluxnodeStatus.data.data.message || fluxnodeStatus.data.data);
        } else {
          this.nodeIP = fluxnodeStatus.data.data.ip.split(':')[0];
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
    convertExpire() {
      if (this.expireOptions[this.expirePosition]) {
        return this.expireOptions[this.expirePosition].value;
      }
      // After PON fork (block 2020000), default expire is 88000 blocks (4x22000)
      return this.currentHeight >= 2020000 ? 88000 : 22000;
    },
    async importRsaPublicKey(base64SpkiDer) {
      const spkiDer = Buffer.from(base64SpkiDer, 'base64');
      // eslint-disable-next-line no-return-await
      return await crypto.subtle.importKey(
        'spki',
        spkiDer,
        {
          name: 'RSA-OAEP',
          hash: 'SHA-256',
        },
        false,
        ['encrypt'],
      );
    },
    base64ToUint8Array(base64) {
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);

      for (let i = 0; i < len; i += 1) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      return bytes;
    },
    arrayBufferToBase64(buffer) {
      const data = [];

      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;

      for (let i = 0; i < len; i += 1) {
        data.push(String.fromCharCode(bytes[i]));
      }

      return btoa(data.join(''));
    },
    async encryptAesKeyWithRsaKey(aesKey, rsaPubKey) {
      const base64AesKey = this.arrayBufferToBase64(aesKey);

      const rsaEncryptedBase64AesKey = await crypto.subtle.encrypt(
        {
          name: 'RSA-OAEP',
        },
        rsaPubKey,
        Buffer.from(base64AesKey),
      );

      const base64RsaEncryptedBase64AesKey = this.arrayBufferToBase64(
        rsaEncryptedBase64AesKey,
      );

      return base64RsaEncryptedBase64AesKey;
    },
    async encryptEnterpriseWithAes(
      plainText,
      aesKey,
      base64RsaEncryptedAesKey,
    ) {
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const plaintextEncoded = new TextEncoder().encode(plainText);
      const rsaEncryptedAesKey = this.base64ToUint8Array(base64RsaEncryptedAesKey);

      const aesCryptoKey = await crypto.subtle.importKey(
        'raw',
        aesKey,
        'AES-GCM',
        true,
        ['encrypt', 'decrypt'],
      );

      const ciphertextTagBuf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce },
        aesCryptoKey,
        plaintextEncoded,
      );

      const ciphertextTag = new Uint8Array(ciphertextTagBuf);

      const keyNonceCiphertextTag = new Uint8Array(
        rsaEncryptedAesKey.length + nonce.length + ciphertextTag.length,
      );

      keyNonceCiphertextTag.set(rsaEncryptedAesKey);
      keyNonceCiphertextTag.set(nonce, rsaEncryptedAesKey.byteLength);
      keyNonceCiphertextTag.set(
        ciphertextTag,
        rsaEncryptedAesKey.byteLength + nonce.length,
      );

      const keyNonceCiphertextTagBase64 = this.arrayBufferToBase64(
        keyNonceCiphertextTag.buffer,
      );

      return keyNonceCiphertextTagBase64;
    },
    async checkFluxSpecificationsAndFormatMessage() {
      try {
        if (!this.tosAgreed) {
          throw new Error('Please agree to Terms of Service');
        }
        if (this.appRegistrationSpecification.compose.find((comp) => comp.repotag.toLowerCase().includes('presearch/node')
          || comp.repotag.toLowerCase().includes('thijsvanloef/palworld-server-docker'))) {
          throw new Error('This application is configured and needs to be bought directly from marketplace.');
        }
        // formation, pre verificaiton
        this.operationTitle = ' Compute registration message...';
        this.progressVisable = true;
        const appSpecification = JSON.parse(JSON.stringify(this.appRegistrationSpecification));
        let secretsPresent = false;
        if (appSpecification.version === 7) {
          // construct nodes
          this.constructNodes();
          // encryption
          // if we have secrets or repoauth
          this.appRegistrationSpecification.compose.forEach((component) => {
            if (component.repoauth || component.secrets) {
              secretsPresent = true;
              // we must have some nodes
              if (!this.appRegistrationSpecification.nodes.length) {
                throw new Error('Private repositories and secrets can only run on Enterprise Nodes');
              }
            }
          });
          if (secretsPresent) { // we do encryption
            this.showToast('info', 'Encrypting specifications, this will take a while...');
            const fetchedKeys = [];
            // eslint-disable-next-line no-restricted-syntax
            for (const node of this.appRegistrationSpecification.nodes) {
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
            for (const component of this.appRegistrationSpecification.compose) {
              component.environmentParameters = component.environmentParameters.replace('\\“', '\\"');
              component.commands = component.commands.replace('\\“', '\\"');
              component.domains = component.domains.replace('\\“', '\\"');
              if (component.secrets && !component.secrets.startsWith('-----BEGIN PGP MESSAGE')) {
              // need encryption
                component.secrets = component.secrets.replace('\\“', '\\"');
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
            this.appRegistrationSpecification.compose.forEach((component) => {
              if (component.secrets && !component.secrets.startsWith('-----BEGIN PGP MESSAGE')) {
                throw new Error('Encryption failed');
              }
              if (component.repoauth && !component.repoauth.startsWith('-----BEGIN PGP MESSAGE')) {
                throw new Error('Encryption failed');
              }
            });
          }
        }
        if (appSpecification.version >= 5) {
          appSpecification.geolocation = this.generateGeolocations();
        }
        if (appSpecification.version >= 6) {
          appSpecification.expire = this.convertExpire();
        }

        if (appSpecification.version >= 8) {
          // construct nodes
          this.constructNodes();
          if (this.isPrivateApp) {
            const zelidauth = localStorage.getItem('zelidauth');
            // call api to get RSA public key
            const appPubKeyData = {
              name: appSpecification.name,
              owner: appSpecification.owner,
            };
            const responseGetPublicKey = await AppsService.getAppPublicKey(zelidauth, appPubKeyData);
            if (responseGetPublicKey.data.status === 'error') {
              throw new Error(responseGetPublicKey.data.data.message || responseGetPublicKey.data.data);
            }
            const pubkey = responseGetPublicKey.data.data;

            const rsaPubKey = await this.importRsaPublicKey(pubkey);
            const aesKey = crypto.getRandomValues(new Uint8Array(32));

            const encryptedEnterpriseKey = await this.encryptAesKeyWithRsaKey(
              aesKey,
              rsaPubKey,
            );
            const enterpriseSpecs = {
              contacts: appSpecification.contacts,
              compose: appSpecification.compose,
            };
            const encryptedEnterprise = await this.encryptEnterpriseWithAes(
              JSON.stringify(enterpriseSpecs),
              aesKey,
              encryptedEnterpriseKey,
            );
            appSpecification.enterprise = encryptedEnterprise;
            appSpecification.contacts = [];
            appSpecification.compose = [];
          }
        }
        // call api for verification of app registration specifications that returns formatted specs
        const responseAppSpecs = await AppsService.appRegistrationVerificaiton(appSpecification);
        if (responseAppSpecs.data.status === 'error') {
          throw new Error(responseAppSpecs.data.data.message || responseAppSpecs.data.data);
        }
        const appSpecFormatted = responseAppSpecs.data.data;
        this.applicationPrice = 0;
        this.applicationPriceUSD = 0;
        this.applicationPriceFluxDiscount = '';
        this.applicationPriceFluxError = false;

        const response = await AppsService.appPriceUSDandFlux(appSpecFormatted);
        if (response.data.status === 'error') {
          throw new Error(response.data.data.message || response.data.data);
        }
        this.applicationPriceUSD = +response.data.data.usd;
        if (Number.isNaN(+response.data.data.fluxDiscount)) {
          this.applicationPriceFluxError = true;
          this.showToast('danger', 'Not possible to complete payment with Flux crypto currency');
        } else {
          this.applicationPrice = +response.data.data.flux;
          this.applicationPriceFluxDiscount = +response.data.data.fluxDiscount;
        }
        this.progressVisable = false;
        this.timestamp = Date.now();
        this.dataForAppRegistration = appSpecFormatted;
        this.dataToSign = this.registrationtype + this.version + JSON.stringify(appSpecFormatted) + this.timestamp;
        this.$nextTick(() => {
          if (!this.isElementInViewport(this.$refs.signContainer)) {
            this.$refs.signContainer.scrollIntoView({ behavior: 'smooth' });
          }
        });
      } catch (error) {
        this.progressVisable = false;
        console.log(error);
        this.showToast('danger', error.message || error);
      }
    },

    async getDaemonInfo() {
      const daemonGetInfo = await DaemonService.getInfo();
      if (daemonGetInfo.data.status === 'error') {
        this.showToast('danger', daemonGetInfo.data.data.message || daemonGetInfo.data.data);
      } else {
        this.currentHeight = daemonGetInfo.data.data.blocks;
        this.adjustExpireOptionsForBlockHeight();
      }
      if (!this.$router.currentRoute.params.appspecs) {
        this.specificationVersion = 8;
        this.composeTemplate = this.composeTemplatev8;
        this.appRegistrationSpecification = this.appRegistrationSpecificationV8Template;
        this.appRegistrationSpecification.compose.forEach((component) => {
          const ports = this.getRandomPort();
          // eslint-disable-next-line no-param-reassign
          component.ports = ports;
          // eslint-disable-next-line no-param-reassign
          component.domains = '[""]';
        });
        const zelidauth = localStorage.getItem('zelidauth');
        const auth = qs.parse(zelidauth);
        this.appRegistrationSpecification.owner = auth.zelid;
      }
    },

    adjustExpireOptionsForBlockHeight() {
      // After block 2020000, the chain works 4 times faster
      // So all expire periods (in blocks) need to be multiplied by 4x
      if (this.currentHeight >= 2020000) {
        this.expireOptions = [
          {
            value: 20000,
            label: '1 week',
            time: 7 * 24 * 60 * 60 * 1000,
          },
          {
            value: 44000,
            label: '2 weeks',
            time: 14 * 24 * 60 * 60 * 1000,
          },
          {
            value: 88000,
            label: '1 month',
            time: 30 * 24 * 60 * 60 * 1000,
          },
          {
            value: 264000,
            label: '3 months',
            time: 90 * 24 * 60 * 60 * 1000,
          },
          {
            value: 528000,
            label: '6 months',
            time: 180 * 24 * 60 * 60 * 1000,
          },
          {
            value: 1056000,
            label: '1 year',
            time: 365 * 24 * 60 * 60 * 1000,
          },
        ];
        this.minExpire = 20000;
        this.maxExpire = 1056000;
      }
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
        this.showToast('success', 'Message signed.');
      } catch (error) {
        this.showToast('warning', 'Failed to sign message, please try again.');
      }
    },
    async initZelcorePay() {
      try {
        this.paymentLoading = true;
        this.paymentReceived = false;
        this.transactionId = '';

        // Request a payment ID from the backend
        const { protocol, hostname, port } = window.location;
        let mybackend = '';
        mybackend += protocol;
        mybackend += '//';
        const regex = /[A-Za-z]/g;
        if (hostname.split('-')[4]) {
          const splitted = hostname.split('-');
          const names = splitted[4].split('.');
          const adjP = +names[0] + 1;
          names[0] = adjP.toString();
          names[2] = 'api';
          splitted[4] = '';
          mybackend += splitted.join('-');
          mybackend += names.join('.');
        } else if (hostname.match(regex)) {
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

        const paymentResponse = await axios.get(`${backendURL}/payment/paymentrequest`);
        if (paymentResponse.data.status !== 'success') {
          throw new Error('Failed to create payment request');
        }

        this.paymentId = paymentResponse.data.data.paymentId;

        // Set up WebSocket connection for payment confirmation
        this.initiatePaymentWS();

        // Build ZelCore protocol URL with callback
        const zelProtocol = `zel:?action=pay&coin=zelcash&address=${this.deploymentAddress}&amount=${this.applicationPrice}&message=${this.registrationHash}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png&callback=${this.paymentCallbackValue}`;

        if (window.zelcore) {
          window.zelcore.protocol(zelProtocol);
        } else {
          const hiddenLink = document.createElement('a');
          hiddenLink.href = zelProtocol;
          hiddenLink.style.display = 'none';
          document.body.appendChild(hiddenLink);
          hiddenLink.click();
          document.body.removeChild(hiddenLink);
        }
      } catch (error) {
        this.paymentLoading = false;
        this.showToast('error', 'Failed to initiate ZelCore payment. Please try again.');
        console.error(error);
      }
    },
    async initZelcore() {
      try {
        const protocol = `zel:?action=sign&message=${this.dataToSign}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${this.callbackValue}`;
        if (window.zelcore) {
          window.zelcore.protocol(protocol);
        } else if (this.dataToSign.length > 1800) {
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
          const hiddenLink = document.createElement('a');
          hiddenLink.href = zelProtocol;
          hiddenLink.style.display = 'none';
          document.body.appendChild(hiddenLink);
          hiddenLink.click();
          document.body.removeChild(hiddenLink);
        } else {
          const hiddenLink = document.createElement('a');
          hiddenLink.href = protocol;
          hiddenLink.style.display = 'none';
          document.body.appendChild(hiddenLink);
          hiddenLink.click();
          document.body.removeChild(hiddenLink);
        }
      } catch (error) {
        this.showToast('warning', 'Failed to sign message, please try again.');
      }
    },
    async initiateSignWS() {
      await this.initZelcore();
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
      const signatureMessage = this.appRegistrationSpecification.owner + this.timestamp;
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
    async initiatePaymentWS() {
      const self = this;
      const { protocol, hostname, port } = window.location;
      let mybackend = '';
      const wsprotocol = protocol === 'https:' ? 'wss://' : 'ws://';
      mybackend += wsprotocol;
      const regex = /[A-Za-z]/g;
      if (hostname.split('-')[4]) {
        const splitted = hostname.split('-');
        const names = splitted[4].split('.');
        const adjP = +names[0] + 1;
        names[0] = adjP.toString();
        names[2] = 'api';
        splitted[4] = '';
        mybackend += splitted.join('-');
        mybackend += names.join('.');
      } else if (hostname.match(regex)) {
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
      // Convert HTTP/HTTPS to WebSocket protocol
      backendURL = backendURL.replace('https://', 'wss://');
      backendURL = backendURL.replace('http://', 'ws://');
      const wsuri = `${backendURL}/ws/payment/${this.paymentId}`;
      const websocket = new WebSocket(wsuri);
      this.paymentWebsocket = websocket;

      websocket.onopen = (evt) => { self.onPaymentOpen(evt); };
      websocket.onclose = (evt) => { self.onPaymentClose(evt); };
      websocket.onmessage = (evt) => { self.onPaymentMessage(evt); };
      websocket.onerror = (evt) => { self.onPaymentError(evt); };
    },
    onPaymentError(evt) {
      console.log('Payment WebSocket error:', evt);
      this.paymentLoading = false;
    },
    onPaymentMessage(evt) {
      const data = qs.parse(evt.data);
      console.log('Payment WebSocket message:', data);

      if (data.status === 'success' && data.data) {
        // Payment received - extract nested data object
        const paymentData = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
        this.transactionId = paymentData.txid;
        this.paymentReceived = true;
        this.paymentLoading = false;
        this.showToast('success', `Payment received! Transaction ID: ${this.transactionId}`);
      } else if (data.status === 'error') {
        this.paymentLoading = false;
        const errorMsg = typeof data.data === 'string' ? data.data : (data.data?.message || data.message || 'Payment request expired or invalid');
        this.showToast('error', errorMsg);
      }
    },
    onPaymentClose(evt) {
      console.log('Payment WebSocket closed:', evt);
      if (!this.paymentReceived) {
        this.paymentLoading = false;
      }
    },
    onPaymentOpen(evt) {
      console.log('Payment WebSocket opened:', evt);
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
      this.progressVisable = true;
      this.operationTitle = 'Propagating message accross Flux network...';
      const response = await AppsService.registerApp(zelidauth, data).catch((error) => {
        this.showToast('danger', error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        this.registrationHash = response.data.data;
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      const fiatGateways = await getPaymentGateways();
      if (fiatGateways) {
        this.stripeEnabled = fiatGateways.stripe;
        this.paypalEnabled = fiatGateways.paypal;
      }
      this.progressVisable = false;
    },

    async appsDeploymentInformation() {
      const response = await AppsService.appsDeploymentInformation();
      const { data } = response.data;
      if (response.data.status === 'success') {
        this.deploymentAddress = data.address;
        this.minInstances = data.minimumInstances;
        this.maxInstances = data.maximumInstances;
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
    },

    addCopmonent() {
      // insert composeTemplate to appSpecs
      const ports = this.getRandomPort();
      this.composeTemplate.ports = ports;
      this.composeTemplate.domains = '[""]';
      this.appRegistrationSpecification.compose.push(JSON.parse(JSON.stringify(this.composeTemplate)));
    },

    removeComponent(index) {
      this.appRegistrationSpecification.compose.splice(index, 1);
    },

    getRandomPort() {
      const min = 31001;
      const max = 39998;
      const portsArray = [];
      const port = Math.floor(Math.random() * (max - min) + min);
      portsArray.push(port);
      return JSON.stringify(portsArray);
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
    async testAppInstall(app) {
      if (this.downloading) {
        this.showToast('danger', 'Test install/launch was already initiated');
        return;
      }
      const self = this;
      this.output = [];
      this.downloadOutput = {};
      this.downloadOutputReturned = false;
      this.downloading = true;
      this.testError = false;
      this.testFinished = false;
      this.showToast('warning', `Testing ${app} installation, please wait`);
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
      let response;
      try {
        if (this.appRegistrationSpecification.nodes.length > 0) {
          const nodeip = this.appRegistrationSpecification.nodes[Math.floor(Math.random() * this.appRegistrationSpecification.nodes.length)];
          const ip = nodeip.split(':')[0];
          const port = Number(nodeip.split(':')[1] || 16127);
          const url = `https://${ip.replace(/\./g, '-')}-${port}.node.api.runonflux.io/apps/testappinstall/${app}`;
          response = await axios.get(url, axiosConfig);
        } else {
          response = await AppsService.justAPI().get(`/apps/testappinstall/${app}`, axiosConfig);
        }
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
          this.testError = true;
        } else {
          console.log(response);
          this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
          console.log(this.output);
          for (let i = 0; i < this.output.length; i += 1) {
            if (this.output[i] && this.output[i].data && this.output[i].data.message && this.output[i].data.message.includes('Error occured')) {
              // error is defined one line above
              if (this.output[i - 1] && this.output[i - 1].data) {
                this.showToast('danger', 'Error on Test, check logs');
                this.testError = true;
                return;
              }
            }
          }
          if (this.output[this.output.length - 1].status === 'error') {
            this.testError = true;
            this.showToast('danger', 'Error on Test, check logs');
          } else if (this.output[this.output.length - 1].status === 'warning') {
            this.testError = true;
            this.showToast('warning', 'Warning on Test, check logs');
          } else {
            this.showToast('success', 'Test passed, you can continue with app payment');
            this.testError = false;
          }
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
      this.testFinished = true;
      this.downloading = false;
    },
    async uploadEnvToFluxStorage(componentIndex) {
      try {
        const envid = Math.floor((Math.random() * 999999999999999)).toString();
        if (this.appRegistrationSpecification.compose[componentIndex].environmentParameters.toString().includes('F_S_ENV=')) {
          this.showToast('warning', 'Environment parameters are already in Flux Storage');
          return;
        }
        const data = {
          envid,
          env: JSON.parse(this.appRegistrationSpecification.compose[componentIndex].environmentParameters),
        };
        const resp = await axios.post('https://storage.runonflux.io/v1/env', data);
        if (resp.data.status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          this.showToast('success', 'Successful upload of Environment to Flux Storage');
          this.appRegistrationSpecification.compose[componentIndex].environmentParameters = `["F_S_ENV=https://storage.runonflux.io/v1/env/${envid}"]`;
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    async uploadCmdToFluxStorage(componentIndex) {
      try {
        const cmdid = Math.floor((Math.random() * 999999999999999)).toString();
        if (this.appRegistrationSpecification.compose[componentIndex].commands.toString().includes('F_S_CMD=')) {
          this.showToast('warning', 'Commands are already in Flux Storage');
          return;
        }
        const data = {
          cmdid,
          cmd: JSON.parse(this.appRegistrationSpecification.compose[componentIndex].commands),
        };
        const resp = await axios.post('https://storage.runonflux.io/v1/cmd', data);
        if (resp.data.status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          this.showToast('success', 'Successful upload of Commands to Flux Storage');
          this.appRegistrationSpecification.compose[componentIndex].commands = `["F_S_CMD=https://storage.runonflux.io/v1/cmd/${cmdid}"]`;
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    async uploadContactsToFluxStorage() {
      try {
        const contactsid = Math.floor((Math.random() * 999999999999999)).toString();
        if (this.appRegistrationSpecification.contacts.toString().includes('F_S_CONTACTS=')) {
          this.showToast('warning', 'Contacts are already in Flux Storage');
          return;
        }
        const data = {
          contactsid,
          contacts: JSON.parse(this.appRegistrationSpecification.contacts),
        };
        const resp = await axios.post('https://storage.runonflux.io/v1/contacts', data);
        if (resp.data.status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          this.showToast('success', 'Successful upload of Contacts to Flux Storage');
          this.appRegistrationSpecification.contacts = `["F_S_CONTACTS=https://storage.runonflux.io/v1/contacts/${contactsid}"]`;
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
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
    openSite(url) {
      const win = window.open(url, '_blank');
      win.focus();
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
      const { instances } = this.appRegistrationSpecification;
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
      this.appRegistrationSpecification.nodes = [];
      this.selectedEnterpriseNodes.forEach((node) => {
        this.appRegistrationSpecification.nodes.push(node.ip);
      });
      if (this.appRegistrationSpecification.nodes.length > this.maximumEnterpriseNodes) {
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
        const openpgp = await getOpenPGP();
        const publicKeys = await Promise.all(encryptionKeys.map((armoredKey) => openpgp.readKey({ armoredKey })));
        console.log(encryptionKeys);
        console.log(message);
        const pgpMessage = await openpgp.createMessage({ text: message.replace('\\“', '\\"') });
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
        this.paymentLoading = true;
        this.paymentReceived = false;
        this.transactionId = '';

        const data = {
          message: this.registrationHash,
          amount: (+this.applicationPrice || 0).toString(),
          address: this.deploymentAddress,
          chain: 'flux',
        };
        const responseData = await window.ssp.request('pay', data);
        if (responseData.status === 'ERROR') {
          this.paymentLoading = false;
          throw new Error(responseData.data || responseData.result);
        } else {
          this.transactionId = responseData.txid;
          this.paymentReceived = true;
          this.paymentLoading = false;
          this.showToast('success', `Payment received! Transaction ID: ${responseData.txid}`);
        }
      } catch (error) {
        this.paymentLoading = false;
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
              marketplace: false,
              registration: true,
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
        try {
          this.openSite(checkoutURL.data.data);
        } catch (error) {
          console.log(error);
          this.showToast('error', 'Failed to open Stripe checkout, pop-up blocked?');
        }
      } catch (error) {
        console.log(error);
        this.showToast('error', 'Failed to create stripe checkout');
        this.checkoutLoading = false;
      }
    },
    async initPaypalPay(hash, name, price, description) {
      try {
        this.fiatCheckoutURL = '';
        this.checkoutLoading = true;
        let clientIP = null;
        let clientIPResponse = await axios.get('https://api.ipify.org?format=json').catch(() => {
          console.log('Error geting clientIp from api.ipify.org from');
        });
        if (clientIPResponse && clientIPResponse.data && clientIPResponse.data.ip) {
          clientIP = clientIPResponse.data.ip;
        } else {
          clientIPResponse = await axios.get('https://ipinfo.io').catch(() => {
            console.log('Error geting clientIp from ipinfo.io from');
          });
          if (clientIPResponse && clientIPResponse.data && clientIPResponse.data.ip) {
            clientIP = clientIPResponse.data.ip;
          } else {
            clientIPResponse = await axios.get('https://api.ip2location.io').catch(() => {
              console.log('Error geting clientIp from api.ip2location.io from');
            });
            if (clientIPResponse && clientIPResponse.data && clientIPResponse.data.ip) {
              clientIP = clientIPResponse.data.ip;
            }
          }
        }
        const zelidauth = localStorage.getItem('zelidauth');
        const auth = qs.parse(zelidauth);
        const data = {
          zelid: auth.zelid,
          signature: auth.signature,
          loginPhrase: auth.loginPhrase,
          details: {
            clientIP,
            name,
            description,
            hash,
            price,
            productName: name,
            return_url: 'home.runonflux.io/successcheckout',
            cancel_url: 'home.runonflux.io',
            kpi: {
              origin: 'FluxOS',
              marketplace: false,
              registration: true,
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
        try {
          this.openSite(checkoutURL.data.data);
        } catch (error) {
          console.log(error);
          this.showToast('error', 'Failed to open Paypal checkout, pop-up blocked?');
        }
      } catch (error) {
        console.log(error);
        this.showToast('error', 'Failed to create PayPal checkout');
        this.checkoutLoading = false;
      }
    },
    importSpecs(appSpecs) {
      try {
        JSON.parse(appSpecs);
      } catch (error) {
        this.showToast('error', 'Invalid Application Specifications');
        return;
      }
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      if (appSpecs) {
        const specs = JSON.parse(appSpecs);
        console.log(specs);
        this.appRegistrationSpecification = JSON.parse(appSpecs);

        this.appRegistrationSpecification.instances = specs.instances || 3;
        if (this.appRegistrationSpecification.version <= 3) {
          this.appRegistrationSpecification.version = 3; // enforce specs version 3
          this.appRegistrationSpecification.ports = specs.port || this.ensureString(specs.ports); // v1 compatibility
          this.appRegistrationSpecification.domains = this.ensureString(specs.domains);
          this.appRegistrationSpecification.enviromentParameters = this.ensureString(specs.enviromentParameters);
          this.appRegistrationSpecification.commands = this.ensureString(specs.commands);
          this.appRegistrationSpecification.containerPorts = specs.containerPort || this.ensureString(specs.containerPorts); // v1 compatibility
        } else {
          if (this.appRegistrationSpecification.version <= 7) {
            this.appRegistrationSpecification.version = 7;
          }
          this.appRegistrationSpecification.contacts = this.ensureString([]);
          this.appRegistrationSpecification.geolocation = this.ensureString([]);
          if (this.appRegistrationSpecification.version >= 5) {
            this.appRegistrationSpecification.contacts = this.ensureString(specs.contacts || []);
            this.appRegistrationSpecification.geolocation = this.ensureString(specs.geolocation || []);
            try {
              this.decodeGeolocation(specs.geolocation || []);
            } catch (error) {
              console.log(error);
              this.appRegistrationSpecification.geolocation = this.ensureString([]);
            }
          }
          this.appRegistrationSpecification.compose.forEach((component) => {
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
          if (this.appRegistrationSpecification.version >= 6) {
            this.appRegistrationSpecification.expire = this.ensureNumber(specs.expire || 22000);
            this.expirePosition = this.getExpirePosition(this.appRegistrationSpecification.expire);
          }
          if (this.appRegistrationSpecification.version === 7) {
            this.appRegistrationSpecification.staticip = this.appRegistrationSpecification.staticip ?? false;
            this.appRegistrationSpecification.nodes = this.appRegistrationSpecification.nodes || [];
            if (this.appRegistrationSpecification.nodes && this.appRegistrationSpecification.nodes.length) {
              this.isPrivateApp = true;
            }
            // fetch information about enterprise nodes, pgp keys
            this.appRegistrationSpecification.nodes.forEach(async (node) => {
              if (!this.enterpriseNodes) {
                await this.getEnterpriseNodes();
              }
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
            this.selectedEnterpriseNodes = [];
            this.appRegistrationSpecification.nodes.forEach((node) => {
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
          if (this.appRegistrationSpecification.version >= 8) {
            this.appRegistrationSpecification.staticip = this.appRegistrationSpecification.staticip ?? false;
            this.appRegistrationSpecification.nodes = this.appRegistrationSpecification.nodes || [];
            if (this.appRegistrationSpecification.enterprise) {
              this.isPrivateApp = true;
              this.showToast('danger', 'This app was enterprise, all components information will not be migrated');
            }
            this.selectedEnterpriseNodes = [];
            this.appRegistrationSpecification.nodes.forEach((node) => {
              // add to selected node list
              if (this.enterpriseNodes) {
                const nodeFound = this.enterpriseNodes.find((entNode) => entNode.ip === node || node === `${entNode.txhash}:${entNode.outidx}`);
                if (nodeFound) {
                  this.selectedEnterpriseNodes.push(nodeFound);
                }
              } else {
                this.showToast('danger', 'Failed to load Priority Node List');
              }
            });
          }
        }
      }
      if (auth.zelid) {
        this.appRegistrationSpecification.owner = auth.zelid;
      } else {
        this.appRegistrationSpecification.owner = '';
        this.showToast('warning', 'Please log in first before registering an application');
      }
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
    byteValueAsMb(value) {
      const multipliers = {
        k: 1 / 1024,
        kb: 1 / 1024,
        mb: 1,
        m: 1,
        gb: 1024,
        g: 1024,
      };

      const separated = value.match(/[0-9]+(?:\.[0-9]+)?|[a-zA-Z]+/g);
      if (separated.length !== 2) return 0;
      const unscaledValue = +separated[0];
      const multiplier = separated[1].toLowerCase();
      if (!(multiplier in multipliers)) return 0;
      return Math.ceil(unscaledValue * multipliers[multiplier]);
    },
    dragover(e) {
      e.preventDefault();
      this.isDragging = true;
    },
    dragleave() {
      this.isDragging = false;
    },
    drop(e) {
      e.preventDefault();
      this.isDragging = false;

      if (!e?.dataTransfer?.files || !e.dataTransfer.files.length) return;

      const file = e.dataTransfer.files[0];

      if (file?.type !== 'application/x-yaml') {
        this.showToast('warning', 'File must be in yaml format. Ignoring.');
        return;
      }

      this.loadFile(file);
    },
    loadFile(file) {
      this.reader.addEventListener('load', this.parseCompose, { once: true });
      this.reader.readAsText(file);
    },
    uploadFile() {
      this.$refs.uploadSpecs.$el.childNodes[0].click();
    },
    isElementInViewport(el) {
      const rect = el.getBoundingClientRect();

      return (
        rect.top >= 0
        && rect.left >= 0
        && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight)
        && rect.right <= (window.innerWidth || document.documentElement.clientWidth)
      );
    },
    parseCompose() {
      let parsed;
      try {
        parsed = yaml.load(this.reader.result);
      } catch (err) {
        this.showToast('warning', 'Unable to parse yaml file. Ignoring.');
      }

      if (!parsed) return;
      if (!parsed.services) {
        this.showToast('warning', 'Yaml parsed, but no services found. Ignoring.');
        return;
      }

      try {
        const range = (start, stop, step) => Array.from({ length: (stop - start) / step + 1 }, (_, i) => start + i * step);

        const fluxApp = { compose: [] };
        const dependsOnDag = {};

        Object.entries(parsed.services).forEach((entry) => {
          const [componentName, config] = entry;

          const component = { name: componentName };
          fluxApp.compose.push(component);
          if (!(componentName in dependsOnDag)) dependsOnDag[componentName] = new Set();

          if (config.depends_on) {
            let dependsOn = config.depends_on;

            // assume we have an object and use the keys
            if (!(Array.isArray(dependsOn))) {
              dependsOn = Object.keys(dependsOn);
            }

            dependsOn.forEach((dependee) => {
              if (!(dependee in dependsOnDag)) {
                dependsOnDag[dependee] = new Set();
              }

              dependsOnDag[dependee].add(componentName);
            });
          }

          component.repotag = config.image || '';

          if (config.deploy?.resources?.limits) {
            const { limits } = config.deploy.resources;
            // round up to nearest 0.1
            if (limits.cpus) component.cpu = Math.max((Math.ceil(+limits.cpus * 10) / 10).toFixed(1), 0.1);
            if (limits.memory) {
              const parsedMemory = this.byteValueAsMb(limits.memory);
              // round up to nearest 100 (with 100 min)
              const roundedMemory = Math.max(Math.ceil(parsedMemory / 100) * 100, 100);
              component.ram = roundedMemory;
            }
          }

          let parsedCommand = '';
          if (config.command) {
            // p = previous
            // c = current
            parsedCommand = config.command.match(/\\?.|^$/g).reduce(
              (p, c) => {
                if (c === '"') {
                  // eslint-disable-next-line no-bitwise, no-param-reassign
                  p.quote ^= 1;
                } else if (!p.quote && c === ' ') {
                  p.a.push('');
                } else {
                  // eslint-disable-next-line no-param-reassign
                  p.a[p.a.length - 1] += c.replace(/\\(.)/, '$1');
                }
                return p;
              },
              { a: [''] },
            ).a;
          } else {
            parsedCommand = [];
          }

          component.commands = this.ensureString(parsedCommand);

          if (config.environment) {
            let env = config.environment;
            // env is a map, convert
            if (!(env instanceof Array)) {
              env = Object.keys(env).map((key) => `${key}=${env[key]}`);
            }
            component.environmentParameters = this.ensureString(env);
          } else {
            component.environmentParameters = '[]';
          }

          if (config.ports && config.ports.length) {
            let parsedHostPorts = [];
            let parsedContainerPorts = [];
            let parsedDomains = [];

            config.ports.forEach((composePort) => {
              // don't allow long form port mapping
              if (typeof composePort !== 'string') return;
              // we don't allow random host port assignment
              // maybe we should assign out of a range though
              if (!composePort.includes(':')) return;

              let [ports, containerPorts] = composePort.split(':');
              if (ports.includes('-')) {
                const [portsStart, portsEnd] = ports.split('-');
                ports = range(+portsStart, +portsEnd, 1);
              }

              if (containerPorts.includes('-')) {
                const [cPortsStart, cPortsEnd] = containerPorts.split('-');
                containerPorts = range(+cPortsStart, +cPortsEnd, 1);
              }

              if (typeof ports === 'string') ports = [ports];
              if (typeof containerPorts === 'string') containerPorts = [containerPorts];

              if (ports.length !== containerPorts.length) return;

              const domains = Array.from({ length: ports.length }, () => '');

              parsedHostPorts = parsedHostPorts.concat(ports.map((p) => +p));
              parsedContainerPorts = parsedContainerPorts.concat(containerPorts.map((p) => +p));
              parsedDomains = parsedDomains.concat(domains);
            });

            component.ports = this.ensureString(parsedHostPorts);
            component.containerPorts = this.ensureString(parsedContainerPorts);
            component.domains = this.ensureString(parsedDomains);
          } else {
            component.ports = '[]';
            component.containerPorts = '[]';
            component.domains = '[]';
          }
          // add in defaults. I was cloning the v7 compose specs, but we can't do this as it gets
          // set to the main app specs which is mutating the template. We should be using @ungap/structured-clone
          // as a polyfill for NodeJS < 17, then cloning the template.
          component.hdd = 40;
          if (!component.ram) component.ram = 2000;
          if (!component.cpu) component.cpu = 0.5;

          component.description = '';
          component.repoauth = '';
          component.containerData = '/tmp';
          component.tiered = false;
          component.secrets = '';
          component.cpubasic = 0.5;
          component.rambasic = 500;
          component.hddbasic = 10;
          component.cpusuper = 1.5;
          component.ramsuper = 2500;
          component.hddsuper = 60;
          component.cpubamf = 3.5;
          component.rambamf = 14000;
          component.hddbamf = 285;
        });

        const order = topologicalSort(dependsOnDag);
        if (order.length === fluxApp.compose.length) {
          fluxApp.compose.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
        }

        this.appRegistrationSpecification.compose = fluxApp.compose;

        if (this.$refs.components.length && !this.isElementInViewport(this.$refs.components[0])) {
          this.$refs.components[0].scrollIntoView({ behavior: 'smooth' });
        }
      } catch (err) {
        console.log(err);
        this.showToast('Error', 'Unable to parse compose specifications.');
      }
    },
  },
};
</script>

<style scoped>
#registrationmessage {
  padding-right: 25px !important;
}
#fileDropOverlay {
  position:fixed;
  top:50%;
  left:50%;
  margin-top:-y;
  margin-left:-x;
}
.text-wrap {
  position: relative;
  padding: 0em;
}
.clipboard.icon {
  position: absolute;
  top: 0.4em;
  right: 1.7em;
  margin-top: 4px;
  margin-left: 4px;
  width: 12px;
  height: 12px;
  border: solid 1px #333333;
  border-top: none;
  border-radius: 1px;
  cursor: pointer;
}
.inline {
  display: inline;
  padding-left: 5px;
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
.fluxSSO {
  height: 90px;
  padding: 10px;
  margin-left: 5px;
}
.fluxSSO img {
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
.highlight-container {
  animation: highlight 2s ease-in 0.4s;
}
@keyframes highlight {
  from {
    background-color: rgb(225, 224, 221);
  }
}
</style>

<style>
  .custom-modal-title {
    color: #fff !important;
  }
</style>
