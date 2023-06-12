<template>
  <div>
    <b-card>
      <b-card-sub-title>
        Note: Only verified images can currently run on Flux. To whitelist your image, please contact the Flux Team via
        <b-link
          href="https://discord.io/runonflux"
          target="_blank"
          active-class="primary"
        >
          Discord
        </b-link>
        or submit a Pull Request directly to
        <b-link
          href="https://github.com/RunOnFlux/flux"
          target="_blank"
          active-class="primary"
        >
          Flux repository
        </b-link>.
      </b-card-sub-title>
    </b-card>
    <div v-if="specificationVersion >= 4">
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
                placeholder="ZelID of Application Owner"
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
              <div v-if="specificationVersion >= 5 && !isPrivateApp">
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
                {{ getExpireLabel || (appRegistrationSpecification.expire ? appRegistrationSpecification.expire + ' blocks' : '1 month') }}
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
              v-if="appRegistrationSpecification.version >= 7"
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
        v-for="(component, index) in appRegistrationSpecification.compose"
        :key="index"
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
                    v-b-tooltip.hover.top="'Data folder that is shared by application to App volume. Prepend with s: for synced data between instances. Eg. s:/data'"
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
                v-if="appRegistrationSpecification.version >= 7 && isPrivateApp"
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
      <b-card
        v-if="appRegistrationSpecification.version >= 7 && isPrivateApp"
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
                  v-b-tooltip.hover.top="'Data folder that is shared by application to App volume. Prepend with s: for synced data between instances. Eg. s:/data'"
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
                max="840"
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
              max="840"
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
        <b-form-textarea
          id="registrationmessage"
          v-model="dataToSign"
          rows="6"
          readonly
        />
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
          <b-card title="Register App">
            <b-card-text>
              Price: {{ applicationPrice }} FLUX
            </b-card-text>
            <b-card-text>
              Subscription period: {{ getExpireLabel || (appRegistrationSpecification.expire ? appRegistrationSpecification.expire + ' blocks' : '1 month') }}
            </b-card-text>
            <b-button
              v-ripple.400="'rgba(255, 255, 255, 0.15)'"
              variant="success"
              aria-label="Register Flux App"
              class="my-1"
              @click="register"
            >
              Register Flux App
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
              @click="initiateSignWS"
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
        v-if="registrationHash"
        class="match-height"
      >
        <b-col
          xs="6"
          lg="8"
        >
          <b-card>
            <b-card-text>
              To finish the application update, please make a transaction of {{ applicationPrice }} FLUX to address
              '{{ deploymentAddress }}'
              with the following message:
              '{{ registrationHash }}'
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
            <a :href="'zel:?action=pay&coin=zelcash&address=' + deploymentAddress + '&amount=' + applicationPrice + '&message=' + registrationHash + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png'">
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
    <div v-if="registrationHash && !isPrivateApp">
      <b-row>
        <b-card title="Test Launch">
          <b-card-text>
            You can now test launch your application locally. It will run on this particular node for a few hours, so you can spot and tune your app specifications.
            <br>
            Application will run on IP: {{ nodeIP || 'Sorry, something went wrong, check IP manually' }}
          </b-card-text>
          <b-button
            v-ripple.400="'rgba(255, 255, 255, 0.15)'"
            variant="success"
            aria-label="Test Launch"
            class="my-1"
            @click="installAppLocally(registrationHash)"
          >
            Test Launch
          </b-button>
        </b-card>
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
          v-if="downloading"
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

const qs = require('qs');
const axios = require('axios');
const store = require('store');
const openpgp = require('openpgp');
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
      timeoptions,
      version: 1,
      websocket: null,
      dataToSign: '',
      timestamp: '',
      signature: '',
      registrationHash: '',
      registrationtype: 'fluxappregister',
      currentHeight: 1350000,
      specificationVersion: 6,
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
      dataForAppRegistration: {},
      applicationPrice: 0,
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
    };
  },
  computed: {
    ...mapState('flux', [
      'config',
      'privilege',
    ]),
    validTill() {
      const expTime = this.timestamp + 60 * 60 * 1000; // 1 hour
      return expTime;
    },
    subscribedTill() {
      if (this.appRegistrationSpecification.expire) {
        const timeFound = this.expireOptions.find((option) => option.value === this.appRegistrationSpecification.expire);
        if (timeFound) {
          const expTime = this.timestamp + timeFound.time;
          return expTime;
        }
        const blocks = this.appRegistrationSpecification.expire;
        const blockTime = 2 * 60 * 1000;
        const validTime = blocks * blockTime;
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
    getExpireLabel() {
      if (this.expireOptions[this.expirePosition]) {
        return this.expireOptions[this.expirePosition].label;
      }
      return null;
    },
  },
  watch: {
    appRegistrationSpecification: {
      handler() {
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
    expirePosition: {
      handler() {
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
    isPrivateApp(value) {
      console.log(value);
      if (this.appRegistrationSpecification.version >= 7 && value === false) {
        this.appRegistrationSpecification.nodes = [];
        this.appRegistrationSpecification.compose.forEach((component) => {
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
      this.dataForAppRegistration = {};
      this.registrationHash = '';
      if (this.websocket !== null) {
        this.websocket.close();
        this.websocket = null;
      }
    },
  },
  beforeMount() {
    this.appRegistrationSpecification = this.appRegistrationSpecificationV5Template;
  },
  mounted() {
    this.getGeolocationData();
    this.getDaemonInfo();
    this.appsDeploymentInformation();
    this.getFluxnodeStatus();
    this.getMultiplier();
    this.getEnterpriseNodes();
    const zelidauth = localStorage.getItem('zelidauth');
    const auth = qs.parse(zelidauth);
    this.appRegistrationSpecification.owner = auth.zelid;
  },
  methods: {
    onFilteredSelection(filteredItems) {
      // Trigger pagination to update the number of buttons/pages due to filtering
      this.entNodesSelectTable.totalRows = filteredItems.length;
      this.entNodesSelectTable.currentPage = 1;
    },
    async getFluxnodeStatus() {
      try {
        const fluxnodeStatus = await DaemonService.getZelNodeStatus();
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
        console.log(error);
      }
    },
    convertExpire() {
      if (this.expireOptions[this.expirePosition]) {
        return this.expireOptions[this.expirePosition].value;
      }
      return 22000;
    },
    async checkFluxSpecificationsAndFormatMessage() {
      try {
        if (!this.tosAgreed) {
          throw new Error('Please agree to Terms of Service');
        }
        // formation, pre verificaiton
        const appSpecification = this.appRegistrationSpecification;
        let secretsPresent = false;
        if (appSpecification.version >= 7) {
          // encryption
          // if we have secrets or repoauth
          this.appRegistrationSpecification.compose.forEach((component) => {
            if (component.repoauth || component.secrets) {
              secretsPresent = true;
              // construct nodes
              this.constructNodes();
              // we must have some nodes
              if (!this.appRegistrationSpecification.nodes.length) {
                throw new Error('Private repositories and secrets can only run on Enterprise Nodes');
              }
            }
          });
        }
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
          this.appRegistrationSpecification.compose.forEach((component) => {
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
          appSpecification.expire = this.convertExpire();
        }
        // call api for verification of app registration specifications that returns formatted specs
        const responseAppSpecs = await AppsService.appRegistrationVerificaiton(appSpecification);
        if (responseAppSpecs.data.status === 'error') {
          throw new Error(responseAppSpecs.data.data.message || responseAppSpecs.data.data);
        }
        const appSpecFormatted = responseAppSpecs.data.data;
        const response = await AppsService.appPrice(appSpecFormatted);
        this.applicationPrice = 0;
        if (response.data.status === 'error') {
          throw new Error(response.data.data.message || response.data.data);
        }
        this.applicationPrice = (Math.ceil(((+response.data.data * this.generalMultiplier) * 100))) / 100;
        this.timestamp = new Date().getTime();
        this.dataForAppRegistration = appSpecFormatted;
        this.dataToSign = this.registrationtype + this.version + JSON.stringify(appSpecFormatted) + this.timestamp;
      } catch (error) {
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
      }
      if (this.currentHeight < 1004000) { // fork height for spec v4
        this.specificationVersion = 3;
        this.appRegistrationSpecification = this.appRegistrationSpecificationV3Template;
        const ports = this.getRandomPort();
        this.appRegistrationSpecification.ports = ports;
      } else if (this.currentHeight < 1142000) {
        this.specificationVersion = 4;
        this.appRegistrationSpecification = this.appRegistrationSpecificationV4Template;
        this.appRegistrationSpecification.compose.forEach((component) => {
          const ports = this.getRandomPort();
          // eslint-disable-next-line no-param-reassign
          component.ports = ports;
        });
      } else if (this.currentHeight < 1300000) {
        this.specificationVersion = 5;
        this.appRegistrationSpecification = this.appRegistrationSpecificationV5Template;
        this.appRegistrationSpecification.compose.forEach((component) => {
          const ports = this.getRandomPort();
          // eslint-disable-next-line no-param-reassign
          component.ports = ports;
        });
      } else if (this.currentHeight < 1420000) {
        this.specificationVersion = 6;
        this.appRegistrationSpecification = this.appRegistrationSpecificationV6Template;
        this.appRegistrationSpecification.compose.forEach((component) => {
          const ports = this.getRandomPort();
          // eslint-disable-next-line no-param-reassign
          component.ports = ports;
          // eslint-disable-next-line no-param-reassign
          component.domains = '[""]';
        });
      } else {
        this.specificationVersion = 7;
        this.composeTemplate = this.composeTemplatev7;
        this.appRegistrationSpecification = this.appRegistrationSpecificationV7Template;
        this.appRegistrationSpecification.compose.forEach((component) => {
          const ports = this.getRandomPort();
          // eslint-disable-next-line no-param-reassign
          component.ports = ports;
          // eslint-disable-next-line no-param-reassign
          component.domains = '[""]';
        });
      }
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      this.appRegistrationSpecification.owner = auth.zelid;
    },

    initiateSignWS() {
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

    async register() {
      const zelidauth = localStorage.getItem('zelidauth');
      const data = {
        type: this.registrationtype,
        version: this.version,
        appSpecification: this.dataForAppRegistration,
        timestamp: this.timestamp,
        signature: this.signature,
      };
      this.showToast('info', 'Propagating message accross Flux network...');
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
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: output.progressDetail,
            variant: 'danger',
          });
        } else if (output.status === 'Verifying Checksum') {
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: { current: 1, total: 1 },
            variant: 'warning',
          });
        } else if (output.status === 'Download complete') {
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: { current: 1, total: 1 },
            variant: 'info',
          });
        } else if (output.status === 'Extracting') {
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: output.progressDetail,
            variant: 'primary',
          });
        } else if (output.status === 'Pull complete') {
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: { current: 1, total: 1 },
            variant: 'success',
          });
        } else {
          string += `${output.status}\r\n`;
        }
      });
      return string;
    },
    async installAppLocally(app) {
      if (this.downloading) {
        this.showToast('danger', 'Test launch was already initiated');
        return;
      }
      const self = this;
      this.output = [];
      this.downloadOutput = {};
      this.downloading = true;
      this.showToast('warning', `Installing ${app}`);
      const zelidauth = localStorage.getItem('zelidauth');
      // const response = await AppsService.installAppLocally(zelidauth, app);
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.target.response);
          self.output = JSON.parse(`[${progressEvent.target.response.replace(/}{/g, '},{')}]`);
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
      }
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
      for (let i = 0; i < notSelectedEnterpriseNodes.length; i += 1) {
        // todo here check if max same pub key is satisfied
        const alreadySelectedPubKeyOccurances = this.selectedEnterpriseNodes.filter((node) => node.pubkey === notSelectedEnterpriseNodes[i].pubkey).length;
        const toSelectPubKeyOccurances = nodesToSelect.filter((node) => node.pubkey === notSelectedEnterpriseNodes[i].pubkey).length;
        if (alreadySelectedPubKeyOccurances + toSelectPubKeyOccurances < maxSamePubKeyNodes) {
          nodesToSelect.push(notSelectedEnterpriseNodes[i]);
        }
        if (nodesToSelect.length + this.selectedEnterpriseNodes.length >= maxNumberOfNodes) {
          break;
        }
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
      const enterpriseList = localStorage.getItem('flux_enterprise_nodes');
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
          localStorage.setItem('flux_enterprise_nodes', JSON.stringify(this.enterpriseNodes));
        }
      } catch (error) {
        console.log(error);
      }
    },
    async fetchEnterpriseKey(nodeip) { // we must have at least +5 nodes or up to 10% of spare keys
      try {
        const node = nodeip.split(':')[0];
        const port = nodeip.split(':')[1] || 16127;
        const response = await axios.get(`http://${node}:${port}/flux/pgp`); // ip with port
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
  },
};
</script>

<style scoped>
.inline {
  display: inline;
  padding-left: 5px;
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
