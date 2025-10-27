<template>
  <div class="app-details">
    <!-- App Header -->
    <div class="app-detail-header">
      <!-- Header: Left -->
      <div class="app-header-left d-flex align-items-center">
        <span class="go-back mr-1 cursor-pointer">
          <feather-icon
            :icon="$store.state.appConfig.isRTL ? 'ChevronRightIcon' : 'ChevronLeftIcon'"
            size="20"
            class="align-bottom"
            @click="$emit('close-app-view')"
          />
        </span>
        <h4 class="app-name mb-0">
          {{ appData.name }}
        </h4>
      </div>
    </div>
    <!-- App Details -->
    <vue-perfect-scrollbar
      :settings="perfectScrollbarSettings"
      class="app-scroll-area scroll-area"
    >
      <b-row class="match-height">
        <b-col
          xxl="9"
          xl="8"
          lg="8"
          md="12"
        >
          <br>
          <b-card v-if="!userZelid">
            <b-card-title>Automated Login</b-card-title>
            <dl class="row">
              <dd class="col-sm-6">
                <b-tabs content-class="mt-0">
                  <b-tab title="3rd Party Login" active>
                    <div class="ssoLogin">
                      <div id="ssoLoading">
                        <b-spinner variant="primary" />
                        <div>
                          Loading Sign In Options
                        </div>
                      </div>
                      <div
                        id="ssoLoggedIn"
                        style="display: none"
                      >
                        <b-spinner variant="primary" />
                        <div>
                          Finishing Login Process
                        </div>
                      </div>
                      <div id="ssoVerify" style="display: none">
                        <b-button class="mb-2" variant="primary" type="submit" @click="cancelVerification">
                          Cancel Verification
                        </b-button>
                        <div>
                          <b-spinner variant="primary" />
                          <div>
                            Finishing Verification Process
                          </div>
                          <div>
                            <i>Please check email for verification link.</i>
                          </div>
                        </div>
                      </div>
                      <div id="firebaseui-auth-container" />
                    </div>
                  </b-tab>
                  <b-tab title="Email/Password">
                    <dl class="row">
                      <dd class="col-sm-12 mt-1">
                        <b-form
                          id="emailLoginForm"
                          ref="emailLoginForm"
                          class="mx-5"
                          @submit.prevent
                        >
                          <b-row>
                            <b-col cols="12">
                              <b-form-group
                                label="Email"
                                label-for="h-email"
                                label-cols-md="4"
                              >
                                <b-form-input
                                  id="h-email"
                                  v-model="emailForm.email"
                                  type="email"
                                  placeholder="Email..."
                                  required
                                />
                              </b-form-group>
                            </b-col>
                            <b-col cols="12">
                              <b-form-group
                                label="Password"
                                label-for="h-password"
                                label-cols-md="4"
                              >
                                <b-form-input
                                  id="h-password"
                                  v-model="emailForm.password"
                                  type="password"
                                  placeholder="Password..."
                                  required
                                />
                              </b-form-group>
                            </b-col>
                            <b-col cols="12">
                              <b-form-group label-cols-md="4">
                                <b-button
                                  type="submit"
                                  variant="primary"
                                  class="w-100"
                                  @click="emailLogin"
                                >
                                  <div id="emailLoginProcessing" style="display: none">
                                    <b-spinner variant="secondary" small />
                                  </div>
                                  <div id="emailLoginExecute">
                                    Login
                                  </div>
                                </b-button>
                              </b-form-group>
                            </b-col>
                            <b-col cols="12">
                              <b-form-group label-cols-md="4">
                                <b-button
                                  id="signUpButton"
                                  v-b-modal.modal-prevent-closing
                                  type="submit"
                                  variant="secondary"
                                  class="w-100"
                                  @click="createAccount"
                                >
                                  Sign Up
                                </b-button>
                              </b-form-group>
                            </b-col>
                          </b-row>
                        </b-form>
                        <div id="ssoEmailVerify" class="text-center" style="display: none">
                          <b-button class="mb-2" variant="primary" type="submit" @click="cancelVerification">
                            Cancel Verification
                          </b-button>
                          <div>
                            <b-spinner variant="primary" />
                            <div>
                              Finishing Verification Process
                            </div>
                            <div>
                              <i>Please check email for verification link.</i>
                            </div>
                          </div>
                        </div>
                      </dd>
                    </dl>
                  </b-tab>
                </b-tabs>
              </dd>
              <dd class="col-sm-6">
                <b-card-text class="text-center loginText">
                  Decentralized Login
                </b-card-text>
                <div class="loginRow">
                  <a
                    title="Login with Zelcore"
                    @click="initiateLoginWS"
                  >
                    <img
                      class="walletIcon"
                      src="@/assets/images/FluxID.svg"
                      alt="Flux ID"
                      height="100%"
                      width="100%"
                    >
                  </a>
                  <a
                    title="Login with SSP"
                    @click="initSSPLogin"
                  >
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
                  <a
                    title="Login with WalletConnect"
                    @click="initWalletConnectLogin"
                  >
                    <img
                      class="walletIcon"
                      src="@/assets/images/walletconnect.svg"
                      alt="WalletConnect"
                      height="100%"
                      width="100%"
                    >
                  </a>
                  <a
                    title="Login with Metamask"
                    @click="initMetamaskLogin"
                  >
                    <img
                      class="walletIcon"
                      src="@/assets/images/metamask.svg"
                      alt="Metamask"
                      height="100%"
                      width="100%"
                    >
                  </a>
                </div>
              </dd>
            </dl>
          </b-card>
          <b-card v-if="!userZelid">
            <b-card-title>Manual Login</b-card-title>
            <dl class="row">
              <dd class="col-sm-12">
                <b-card-text class="text-center">
                  Sign the following message with any Flux ID / SSP Wallet ID / Bitcoin / Ethereum address
                </b-card-text>
                <br><br>
                <b-form
                  class="mx-5"
                  @submit.prevent
                >
                  <b-row>
                    <b-col cols="12">
                      <b-form-group
                        label="Message"
                        label-for="h-message"
                        label-cols-md="3"
                      >
                        <b-form-input
                          id="h-message"
                          v-model="loginForm.loginPhrase"
                          placeholder="Insert Login Phrase"
                        />
                      </b-form-group>
                    </b-col>
                    <b-col cols="12">
                      <b-form-group
                        label="Address"
                        label-for="h-address"
                        label-cols-md="3"
                      >
                        <b-form-input
                          id="h-address"
                          v-model="loginForm.zelid"
                          placeholder="Insert Flux ID or Bitcoin address"
                        />
                      </b-form-group>
                    </b-col>
                    <b-col cols="12">
                      <b-form-group
                        label="Signature"
                        label-for="h-signature"
                        label-cols-md="3"
                      >
                        <b-form-input
                          id="h-signature"
                          v-model="loginForm.signature"
                          placeholder="Insert Signature"
                        />
                      </b-form-group>
                    </b-col>
                    <b-col cols="12">
                      <b-form-group label-cols-md="3">
                        <b-button
                          type="submit"
                          variant="primary"
                          class="w-100"
                          @click="login"
                        >
                          Login
                        </b-button>
                      </b-form-group>
                    </b-col>
                  </b-row>
                </b-form>
              </dd>
            </dl>
          </b-card>
          <b-card v-if="userZelid" no-body title="Details">
            <b-card-body class="d-flex flex-column flex-grow-1">
              <b-form-textarea
                id="textarea-rows"
                rows="2"
                readonly
                :value="appData.description"
                class="description-text"
              />
              <div
                v-if="appData.contacts"
                class="form-row form-group mt-2"
                style="padding: 0;"
              >
                <label class="col-3 col-form-label">
                  Contact
                  <v-icon
                    v-b-tooltip.hover.top="'Add your email contact to get notifications ex. app about to expire, app spawns. Your contact will be uploaded to Flux Storage to not be public visible'"
                    name="info-circle"
                  />
                </label>
                <div class="col">
                  <b-form-input
                    id="contact"
                    v-model="contact"
                  />
                </div>
              </div>
              <div v-if="appData.geolocationOptions">
                <b-form-group
                  label-cols="3"
                  label-cols-lg="20"
                  :label="`Deployment Location`"
                  label-for="geolocation"
                >
                  <b-form-select
                    id="geolocation"
                    v-model="selectedGeolocation"
                    :options="appData.geolocationOptions"
                  >
                    <b-form-select-option :value="null">
                      Worldwide
                    </b-form-select-option>
                  </b-form-select>
                </b-form-group>
              </div>
              <div v-if="appData.selectInstances">
                <b-form-group
                  v-if="appData.version >= 3"
                  label-cols="3"
                  label-cols-lg="20"
                >
                  <template #label>
                    Instances
                    <v-icon
                      v-b-tooltip.hover.top="'Minimum number of application instances to be spawned'"
                      name="info-circle"
                    />
                  </template>
                  <div class="mx-1">
                    {{ appInstances }}
                  </div>
                  <input
                    id="appInstances"
                    v-model="appInstances"
                    type="range"
                    class="form-control-range"
                    style="width: 100%; outline: none;"
                    :min="3"
                    :max="100"
                    :step="1"
                  />
                </b-form-group>
              </div>
              <b-form-group
                v-if="appData.version >= 6"
                label-cols="3"
                label-cols-lg="20"
              >
                <template #label>
                  Period
                  <v-icon
                    v-b-tooltip.hover.top="'How long an application will live on Flux network'"
                    name="info-circle"
                  />
                </template>
                <div class="mx-1">
                  {{ getExpireLabel }}
                </div>
                <input
                  id="period"
                  v-model="expirePosition"
                  type="range"
                  class="form-control-range"
                  style="width: 100%; outline: none;"
                  :min="0"
                  :max="3"
                  :step="1"
                />
              </b-form-group>
              <div style="padding: 0;">
                <b-tabs pills class="mt-1" @activate-tab="componentSelected">
                  <b-tab
                    v-for="(component, index) in appData.compose"
                    :key="index"
                    :title="component.name"
                  >
                    <div class="my-2 ml-2">
                      <div class="list-entry">
                        <p><b style="display: inline-block; width: 120px;">Description:</b>&nbsp;{{ component.description }}</p>
                        <p><b style="display: inline-block; width: 120px;">Repository:</b>&nbsp;{{ component.repotag }}</p>
                      </div>
                    </div>
                    <div
                      v-if="component.userEnvironmentParameters?.length > 0"
                      title="Parameters"
                      border-variant="dark"
                    >
                      <b-tabs v-if="component.userEnvironmentParameters" pills>
                        <b-tab
                          v-for="(parameter, paramIndex) in component.userEnvironmentParameters"
                          :key="paramIndex"
                          :title="parameter.name"
                        >
                          <div class="form-row form-group">
                            <label class="col-2 col-form-label ml-2">
                              Value
                              <v-icon
                                v-b-tooltip.hover.top="parameter.description"
                                name="info-circle"
                                class="mr-1"
                              />
                            </label>
                            <div class="col">
                              <b-form-input
                                id="enviromentParameters"
                                v-model="parameter.value"
                                :placeholder="parameter.placeholder"
                              />
                            </div>
                          </div>
                        </b-tab>
                      </b-tabs>
                    </div>
                    <div
                      v-if="component.userSecrets"
                      title="Secrets"
                      border-variant="primary"
                    >
                      <b-tabs v-if="component.userSecrets" pills>
                        <b-tab
                          v-for="(parameter, paramIndex) in component.userSecrets"
                          :key="paramIndex"
                          :title="parameter.name"
                        >
                          <div class="form-row form-group">
                            <label class="col-2 col-form-label">
                              Value
                              <v-icon
                                v-b-tooltip.hover.top="parameter.description"
                                name="info-circle"
                                class="mr-1"
                              />
                            </label>
                            <div class="col">
                              <b-form-input
                                id="secrets"
                                v-model="parameter.value"
                                :placeholder="parameter.placeholder"
                              />
                            </div>
                          </div>
                        </b-tab>
                      </b-tabs>
                    </div>
                    <b-button
                      v-if="userZelid"
                      v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                      variant="outline-warning"
                      aria-label="View Additional Details"
                      class="mb-6"
                      @click="componentParamsModalShowing = true"
                    >
                      View Additional Details
                    </b-button>
                  </b-tab>
                </b-tabs>
              </div>
              <div
                v-if="!appData.enabled"
                class="text-center"
              >
                <h4>
                  This Application is temporarily disabled
                </h4>
              </div>
              <div v-else class="text-center mt-auto">
                <!-- Footer ensures it's always at the bottom -->
                <div class="text-left mt-2">
                  <div class="d-flex align-items-center p-0 mt-auto">
                    <b-form-checkbox
                      id="tos"
                      v-model="tosAgreed"
                      switch
                      class="custom-control-primary"
                    />
                    <span>
                      I agree with
                      <a
                        href="https://cdn.runonflux.io/Flux_Terms_of_Service.pdf"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Terms of Service
                      </a>
                    </span>
                  </div>
                  <b-button
                    v-if="userZelid"
                    variant="outline-success"
                    aria-label="Launch Marketplace App"
                    class="mt-1 w-100"
                    @click="checkFluxSpecificationsAndFormatMessage"
                  >
                    Start Launching Marketplace Application
                  </b-button>
                </div>
              </div>
            </b-card-body>
          </b-card>
        </b-col>
        <b-col
          xxl="3"
          xl="4"
          lg="4"
          class="d-lg-flex d-none"
        >
          <br>
          <b-card no-body>
            <b-card-header class="app-requirements-header">
              <h4 class="mb-0">
                CPU
              </h4>
            </b-card-header>
            <vue-apex-charts
              class="mt-1"
              type="radialBar"
              height="190"
              :options="cpuRadialBar"
              :series="cpu.series"
            />
          </b-card>
          <b-card no-body>
            <b-card-header class="app-requirements-header">
              <h4 class="mb-0">
                RAM
              </h4>
            </b-card-header>
            <vue-apex-charts
              class="mt-1"
              type="radialBar"
              height="190"
              :options="ramRadialBar"
              :series="ram.series"
            />
          </b-card>
          <b-card no-body>
            <b-card-header class="app-requirements-header">
              <h4 class="mb-0">
                HDD
              </h4>
            </b-card-header>
            <vue-apex-charts
              class="mt-1"
              type="radialBar"
              height="190"
              :options="hddRadialBar"
              :series="hdd.series"
            />
          </b-card>
        </b-col>
        <b-row class="d-lg-none d-sm-none d-md-flex d-none">
          <b-col md="4">
            <b-card no-body>
              <b-card-header class="app-requirements-header">
                <h5 class="mb-0">
                  CPU
                </h5>
              </b-card-header>
              <vue-apex-charts
                class="mt-1"
                type="radialBar"
                height="200"
                :options="cpuRadialBar"
                :series="cpu.series"
              />
            </b-card>
          </b-col>
          <b-col md="4">
            <b-card no-body>
              <b-card-header class="app-requirements-header">
                <h5 class="mb-0">
                  RAM
                </h5>
              </b-card-header>
              <vue-apex-charts
                class="mt-1"
                type="radialBar"
                height="200"
                :options="ramRadialBar"
                :series="ram.series"
              />
            </b-card>
          </b-col>
          <b-col md="4">
            <b-card no-body>
              <b-card-header class="app-requirements-header">
                <h5 class="mb-0">
                  HDD
                </h5>
              </b-card-header>
              <vue-apex-charts
                class="mt-1"
                type="radialBar"
                height="200"
                :options="hddRadialBar"
                :series="hdd.series"
              />
            </b-card>
          </b-col>
        </b-row>
        <b-row class="d-md-none">
          <b-col cols="4">
            <b-card no-body>
              <b-card-header class="app-requirements-header">
                <h6 class="mb-0">
                  CPU
                </h6>
              </b-card-header>
              <vue-apex-charts
                class="mt-3"
                type="radialBar"
                height="130"
                :options="cpuRadialBarSmall"
                :series="cpu.series"
              />
            </b-card>
          </b-col>
          <b-col cols="4">
            <b-card no-body>
              <b-card-header class="app-requirements-header">
                <h6 class="mb-0">
                  RAM
                </h6>
              </b-card-header>
              <vue-apex-charts
                class="mt-3"
                type="radialBar"
                height="130"
                :options="ramRadialBarSmall"
                :series="ram.series"
              />
            </b-card>
          </b-col>
          <b-col cols="4">
            <b-card no-body>
              <b-card-header class="app-requirements-header">
                <h6 class="mb-0">
                  HDD
                </h6>
              </b-card-header>
              <vue-apex-charts
                class="mt-3"
                type="radialBar"
                height="130"
                :options="hddRadialBarSmall"
                :series="hdd.series"
              />
            </b-card>
          </b-col>
        </b-row>
      </b-row>
    </vue-perfect-scrollbar>

    <b-modal
      v-model="componentParamsModalShowing"
      title="Extra Component Parameters"
      size="lg"
      centered
      ok-only
      ok-title="Close"
      header-bg-variant="primary"
      title-class="custom-modal-title"
    >
      <div v-if="currentComponent">
        <list-entry
          title="Static Parameters"
          :data="currentComponent.environmentParameters.join(', ')"
        />
        <list-entry
          title="Custom Domains"
          :data="currentComponent.domains.join(', ') || 'none'"
        />
        <list-entry
          title="Automatic Domains"
          :data="constructAutomaticDomains(appData.name).join(', ')"
        />
        <list-entry
          title="Ports"
          :data="currentComponent.ports.join(', ')"
        />
        <list-entry
          title="Container Ports"
          :data="currentComponent.containerPorts.join(', ')"
        />
        <list-entry
          title="Container Data"
          :data="currentComponent.containerData"
        />
        <list-entry
          title="Commands"
          :data="currentComponent.commands.length > 0 ? currentComponent.commands.join(', ') : 'none'"
        />
      </div>
    </b-modal>

    <b-modal
      v-model="confirmLaunchDialogCloseShowing"
      title="Finish Launching App?"
      centered
      ok-title="Yes"
      cancel-title="No"
      header-bg-variant="primary"
      title-class="custom-modal-title"
      @ok="closeLaunchModals"
    >
      <h5 class="text-center">
        Please ensure that you have paid for your app, or saved the payment details for later.
      </h5>
      <br>
      <h5 class="text-center">
        Close the Launch App dialog?
      </h5>
    </b-modal>

    <b-modal
      v-model="launchModalShowing"
      title="Launching Marketplace App"
      size="xlg"
      centered
      no-close-on-backdrop
      no-close-on-esc
      hide-footer
      header-bg-variant="primary"
      title-class="custom-modal-title"
      @hide="confirmLaunchDialogCancel"
    >
      <form-wizard
        ref="formWizard"
        :color="tierColors.cumulus"
        :title="null"
        :subtitle="null"
        layout="vertical"
        back-button-text="Previous"
        class="wizard-vertical mb-3"
        @on-complete="confirmLaunchDialogFinish()"
      >
        <template slot="footer" scope="props">
          <div>
            <b-button v-if="props.activeTabIndex > 0" class="wizard-footer-left" type="button" variant="outline-dark" @click="$refs.formWizard.prevTab()">
              Previous
            </b-button>
            <!-- Original Next button -->
            <b-button class="wizard-footer-right" type="button" variant="outline-dark" @click="$refs.formWizard.nextTab()">
              {{ props.isLastStep ? 'Done' : 'Next' }}
            </b-button>
          </div>
        </template>
        <tab-content title="Check Registration">
          <b-card
            title="Registration Message"
            class="text-center wizard-card"
          >
            <div class="text-wrap">
              <b-form-textarea
                id="registrationmessage"
                v-model="dataToSign"
                rows="6"
                readonly
              />
              <b-icon ref="copyButtonRef" v-b-tooltip="tooltipText" class="clipboard icon" scale="1.5" icon="clipboard" @click="copyMessageToSign" />
            </div>
          </b-card>
        </tab-content>
        <tab-content
          title="Sign App Message"
          :before-change="() => signature !== null"
        >
          <div class="mx-auto" style="width: 600px;">
            <h4 class="text-center">
              Sign Message with same method you have used for login
            </h4>
            <div class="loginRow mx-auto" style="width: 400px;">
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
                  :src="isDark ? require('@/assets/images/ssp-logo-white.svg') : require('@/assets/images/ssp-logo-black.svg')"
                  alt="SSP"
                  height="100%"
                  width="100%"
                >
              </a>
            </div>
            <div class="loginRow mx-auto" style="width: 400px;">
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
          </div>
          <b-form-input
            id="signature"
            v-model="signature"
            class="mb-2"
          />
        </tab-content>
        <tab-content
          title="Register Application"
          :before-change="() => registrationHash !== null"
        >
          <b-card
            title="Register Application"
            class="text-center wizard-card"
          >
            <b-card-text>
              <b-icon class="mr-1" scale="1.4" icon="cash-coin" />Price:&nbsp;&nbsp;<b>{{ appPricePerDeploymentUSD }} USD + VAT</b>
            </b-card-text>
            <div>
              <b-button
                :variant="loading || completed ? 'outline-success' : 'success'"
                aria-label="Register"
                class="my-1"
                style="width: 250px"
                :disabled="loading || completed"
                @click="register"
              >
                <template v-if="loading">
                  <b-spinner small />
                  Processing...
                </template>
                <template v-else-if="completed">
                  Done!
                </template>
                <template v-else>
                  Register
                </template>
              </b-button>
            </div>
            <b-card-text
              v-if="registrationHash"
              v-b-tooltip
              :title="registrationHash"
              class="mt-1"
            >
              Registration Hash Received
            </b-card-text>
          </b-card>
        </tab-content>
        <tab-content title="Send Payment">
          <b-row
            class="match-height"
          >
            <b-col
              xs="6"
              lg="8"
            >
              <b-card
                title="Send Payment"
                class="text-center wizard-card"
              >
                <div class="d-flex justify-content-center align-items-center mb-1">
                  <b-icon class="mr-1" scale="1.4" icon="cash-coin" />Price:&nbsp;&nbsp;<b>{{ appPricePerDeploymentUSD }} USD + VAT</b>
                </div>
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
                title="Pay with Stripe/PayPal"
                class="text-center wizard-card"
              >
                <div class="loginRow">
                  <a v-if="stripeEnabled" @click="initStripePay">
                    <img
                      class="stripePay"
                      src="@/assets/images/Stripe.svg"
                      alt="Stripe"
                      height="100%"
                      width="100%"
                    >
                  </a>
                  <a v-if="paypalEnabled" @click="initPaypalPay">
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
            v-if="!applicationPriceFluxError"
            class="match-height"
          >
            <b-col xs="6" lg="8">
              <b-card
                class="text-center wizard-card"
              >
                <b-card-text>
                  To pay in FLUX, please make a transaction of <b>{{ appPricePerDeployment }} FLUX</b> to address<br>
                  <b>'{{ deploymentAddress }}'</b><br>
                  with the following message<br>
                  <b>'{{ registrationHash }}'</b>
                </b-card-text>
              </b-card>
            </b-col>
            <b-col xs="6" lg="4">
              <b-card>
                <h4 v-if="applicationPriceFluxDiscount > 0">
                  <kbd class="d-flex justify-content-center bg-primary mb-1">Discount - {{ applicationPriceFluxDiscount }}%</kbd>
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
                      :src="isDark ? require('@/assets/images/ssp-logo-white.svg') : require('@/assets/images/ssp-logo-black.svg')"
                      alt="SSP"
                      height="100%"
                      width="100%"
                    >
                  </a>
                </div>
              </b-card>
            </b-col>
          </b-row>
        </tab-content>
      </form-wizard>
    </b-modal>
  </div>
</template>

<script>
import {
  BButton,
  BCard,
  BCardHeader,
  BCardText,
  BCol,
  BFormInput,
  BFormTextarea,
  BModal,
  BRow,
  BTabs,
  BTab,
  VBModal,
  VBToggle,
  VBTooltip,
  BFormSelect,
  BFormSelectOption,
  BFormGroup,
} from 'bootstrap-vue';
import {
  FormWizard,
  TabContent,
} from 'vue-form-wizard';
import VuePerfectScrollbar from 'vue-perfect-scrollbar';
import VueApexCharts from 'vue-apexcharts';
import Ripple from 'vue-ripple-directive';
import { useToast } from 'vue-toastification/composition';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';

import { $themeColors } from '@themeConfig';
import 'vue-form-wizard/dist/vue-form-wizard.min.css';

import {
  ref,
  watch,
  computed,
  getCurrentInstance,
  nextTick,
  onMounted,
} from 'vue';

import ListEntry from '@/views/components/ListEntry.vue';
import AppsService from '@/services/AppsService';
import IDService from '@/services/IDService';
import DaemonService from '@/services/DaemonService';
import tierColors from '@/libs/colors';
import SignClient from '@walletconnect/sign-client';
import { WalletConnectModal } from '@walletconnect/modal';
import { MetaMaskSDK } from '@metamask/sdk';
import useAppConfig from '@core/app-config/useAppConfig';
import { useClipboard } from '@vueuse/core';
import { getUser, loginWithEmail, createEmailSSO } from '@/libs/firebase';
import firebase from 'firebase/compat/app';
import * as firebaseui from 'firebaseui';
import 'firebaseui/dist/firebaseui.css';

import getPaymentGateways, { paymentBridge } from '@/libs/fiatGateways';
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

const walletConnectModal = new WalletConnectModal(walletConnectOptions);

const metamaskOptions = {
  enableDebug: true,
};

const MMSDK = new MetaMaskSDK(metamaskOptions);
let ethereum;

const qs = require('qs');
const axios = require('axios');
const store = require('store');
const timeoptions = require('@/libs/dateFormat');

export default {
  components: {
    BButton,
    BCard,
    BCardHeader,
    BCardText,
    BCol,
    BFormInput,
    BFormTextarea,
    BModal,
    BRow,
    BTabs,
    BTab,
    BFormSelect,
    BFormSelectOption,
    BFormGroup,
    FormWizard,
    TabContent,

    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
    ListEntry,

    // 3rd Party
    VuePerfectScrollbar,
    VueApexCharts,
  },
  directives: {
    Ripple,
    'b-modal': VBModal,
    'b-toggle': VBToggle,
    'b-tooltip': VBTooltip,
  },
  props: {
    appData: {
      type: Object,
      required: true,
    },
    zelid: {
      type: String,
      required: false,
      default: '',
    },
    tier: {
      type: String,
      required: false,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const vm = getCurrentInstance().proxy;
    // Use toast
    const toast = useToast();

    const { skin } = useAppConfig();

    const isDark = computed(() => skin.value === 'dark');

    const resolveTagVariant = (status) => {
      if (status === 'Open') return 'warning';
      if (status === 'Passed') return 'success';
      if (status === 'Unpaid') return 'info';
      if (status && status.startsWith('Rejected')) return 'danger';
      return 'primary';
    };

    const showToast = (variant, title, icon = 'InfoIcon') => {
      toast({
        component: ToastificationContent,
        props: {
          title,
          icon,
          variant,
        },
      });
    };

    const modalShow = ref(false);
    const websocket = ref(null);
    const loginPhrase = ref('');
    const signClient = ref(null);
    const ssoVerification = ref('');
    const loginForm = ref({ zelid: '', signature: '', loginPhrase: '' });
    const userZelid = ref(props.zelid || '');
    const emailForm = ref({ email: '', password: '' });
    const ui = ref(null);
    const createSSOForm = ref({ email: '', pw1: '', pw2: '' });
    const emailState = ref(null);
    const pw1State = ref(null);
    const pw2State = ref(null);
    const formRef = ref(null);
    const bvModal = ref(null);

    const getEmergencyLoginPhrase = async () => {
      try {
        const response = await IDService.emergencyLoginPhrase();
        console.log(response);
        if (response.data.status === 'error') {
          showToast('danger', response.data.data.message);
        } else {
          loginPhrase.value = response.data.data;
          loginForm.value.loginPhrase = response.data.data;
        }
      } catch (error) {
        console.log(error);
        showToast('danger', error);
      }
    };

    const getZelIdLoginPhrase = async () => {
      try {
        const response = await IDService.loginPhrase();
        console.log(response.data.data);
        if (response.data.status === 'error') {
          await getEmergencyLoginPhrase();
        } else {
          loginPhrase.value = response.data.data;
          loginForm.value.loginPhrase = response.data.data;
        }
      } catch (error) {
        console.log(error);
        showToast('danger', error);
      }
    };

    const getVariant = (status) => (status === 'error' ? 'danger' : 'success');

    const resetLoginUI = () => {
      document.getElementById('ssoVerify').style.display = 'none';
      document.getElementById('ssoEmailVerify').style.display = 'none';
      document.getElementById('ssoLoggedIn').style.display = 'none';
      document.getElementById('emailLoginProcessing').style.display = 'none';
      document.getElementById('emailLoginExecute').style.display = 'block';
      document.getElementById('emailLoginForm').style.display = 'block';
      document.getElementById('signUpButton').style.display = 'block';
      emailForm.value.email = '';
      emailForm.value.password = '';
      ui.value.reset();
      ui.value.start('#firebaseui-auth-container');
      ssoVerification.value = false;
    };

    const cancelVerification = () => {
      resetLoginUI();
    };

    const handleSignedInUser = async (user) => {
      try {
        if (user.emailVerified) {
          document.getElementById('ssoLoggedIn').style.display = 'block';
          const token = user.auth.currentUser.accessToken;
          const message = loginPhrase.value;
          const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          };

          const fluxLogin = await axios.post('https://service.fluxcore.ai/api/signInOrUp', { message }, { headers });
          if (fluxLogin.data?.status !== 'success') {
            throw new Error('Login Failed, please try again.');
          }
          console.log(fluxLogin);
          const authLogin = {
            zelid: fluxLogin.data.public_address,
            signature: fluxLogin.data.signature,
            loginPhrase: loginPhrase.value,
          };

          const response = await IDService.verifyLogin(authLogin);
          console.log(response);
          if (response.data.status === 'success') {
            const zelidauth = {
              zelid: fluxLogin.data.public_address,
              signature: fluxLogin.data.signature,
              loginPhrase: loginPhrase.value,
            };
            vm.$store.commit('flux/setPrivilege', response.data.data.privilege);
            vm.$store.commit('flux/setZelid', zelidauth.zelid);
            localStorage.setItem('zelidauth', qs.stringify(zelidauth));
            userZelid.value = zelidauth.zelid;
            showToast('success', response.data.data.message);
          } else {
            showToast(getVariant(response.data.status), response.data.data.message || response.data.data);
            resetLoginUI();
          }
        } else {
          // eslint-disable-next-line no-use-before-define
          await handleEmailVerification(user);
        }
      } catch (error) {
        console.log(error);
        resetLoginUI();
        showToast('warning', 'Login Failed, please try again.');
      }
    };

    const checkVerification = async () => {
      try {
        let user = getUser();
        if (user && ssoVerification.value) {
          await user.reload();
          user = getUser();
          if (user.emailVerified) {
            showToast('info', 'email verified');
            document.getElementById('ssoVerify').style.display = 'none';
            handleSignedInUser(user);
            ssoVerification.value = false;
          } else {
            setTimeout(checkVerification, 5000);
          }
        } else {
          resetLoginUI();
        }
      } catch (error) {
        showToast('warning', 'email verification failed');
        resetLoginUI();
      }
    };

    const handleEmailVerification = async (user) => {
      if (user.displayName) {
        const urlPattern = /\b((http|https|ftp):\/\/[-A-Z0-9+&@#%?=~_|!:,.;]*[-A-Z0-9+&@#%=~_|]|www\.[-A-Z0-9+&@#%?=~_|!:,.;]*[-A-Z0-9+&@#%=~_|]|[-A-Z0-9]+\.[A-Z]{2,}[-A-Z0-9+&@#%?=~_|]*[-A-Z0-9+&@#%=~_|])/i;
        if (urlPattern.test(user.displayName)) {
          throw new Error('Login Failed, please try again.');
        }
      }
      try {
        await user.sendEmailVerification();
        showToast('info', 'please verify email');
      } catch {
        showToast('warning', 'failed to send new verification email');
      } finally {
        document.getElementById('ssoVerify').style.display = 'block';
        document.getElementById('ssoEmailVerify').style.display = 'block';
        document.getElementById('emailLoginForm').style.display = 'none';
        ssoVerification.value = true;
        await checkVerification();
      }
    };

    const handleSignInSuccessWithAuthResult = (authResult) => {
      if (authResult.user) {
        handleSignedInUser(authResult.user);
      }
      return false;
    };

    const emailLogin = async () => {
      try {
        if (document.getElementById('emailLoginForm').reportValidity()) {
          document.getElementById('emailLoginExecute').style.display = 'none';
          document.getElementById('emailLoginProcessing').style.display = 'block';
          document.getElementById('signUpButton').style.display = 'none';

          const checkUser = await loginWithEmail(emailForm.value);
          handleSignInSuccessWithAuthResult(checkUser); // Ensure to define this handler function
        }
      } catch (error) {
        document.getElementById('emailLoginExecute').style.display = 'block';
        document.getElementById('emailLoginProcessing').style.display = 'none';
        document.getElementById('signUpButton').style.display = 'block';
        document.getElementById('ssoEmailVerify').style.display = 'none';
        showToast('danger', 'login failed, please try again');
      }
    };

    const createAccount = () => {
      modalShow.value = !modalShow.value;
    };

    const login = async () => {
      try {
        const response = await IDService.verifyLogin(loginForm.value);
        console.log(response);

        if (response.data.status === 'success') {
          const zelidauth = {
            zelid: loginForm.value.zelid,
            signature: loginForm.value.signature,
            loginPhrase: loginForm.value.loginPhrase,
          };

          vm.$store.commit('flux/setPrivilege', response.data.data.privilage);
          vm.$store.commit('flux/setZelid', zelidauth.zelid);
          localStorage.setItem('zelidauth', qs.stringify(zelidauth));
          userZelid.value = zelidauth.zelid;

          await nextTick();
          window.scrollTo({
            top: 0,
          });

          showToast('success', response.data.data.message);
        } else {
          showToast(getVariant(response.data.status), response.data.data.message || response.data.data);
        }
      } catch (e) {
        console.log(e);
        showToast('danger', e.toString());
      }
    };

    const checkFormValidity = () => {
      const valid = formRef.value?.reportValidity();

      if (createSSOForm.value.pw1.length >= 8) pw1State.value = true;
      else {
        showToast('info', 'Password must be at least 8 characters.');
        return null;
      }

      if (createSSOForm.value.pw2.length >= 8) pw2State.value = true;
      else {
        showToast('info', 'Password must be at least 8 characters.');
        return null;
      }

      if (createSSOForm.value.pw1 !== createSSOForm.value.pw2) {
        showToast('info', 'Passwords do not match.');
        pw1State.value = false;
        pw2State.value = false;
        return null;
      }

      return valid;
    };

    const resetModal = () => {
      createSSOForm.value.email = '';
      createSSOForm.value.pw1 = '';
      createSSOForm.value.pw2 = '';
      emailState.value = null;
      pw1State.value = null;
      pw2State.value = null;
    };

    const handleSubmit = async () => {
      if (!checkFormValidity()) return;

      try {
        const createUser = await createEmailSSO({
          email: createSSOForm.value.email,
          password: createSSOForm.value.pw1,
        });
        handleSignInSuccessWithAuthResult(createUser);
      } catch (error) {
        resetLoginUI();
        showToast('danger', 'Account creation failed, please try again.');
      }

      // eslint-disable-next-line vue/valid-next-tick
      await nextTick(() => {
        bvModal.value.hide('modal-prevent-closing');
      });
    };

    const handleOk = (bvModalEvent) => {
      bvModalEvent.preventDefault();
      handleSubmit();
    };

    const onOpenLogin = (evt) => console.log('WebSocket opened:', evt);
    const onCloseLogin = (evt) => console.log('WebSocket closed:', evt);
    const onErrorLogin = (evt) => console.log('WebSocket error:', evt);
    const onMessageLogin = (evt) => {
      const data = qs.parse(evt.data);
      if (data.status === 'success' && data.data) {
        const zelidauth = {
          zelid: data.data.zelid,
          signature: data.data.signature,
          loginPhrase: data.data.loginPhrase,
        };
        // eslint-disable-next-line no-use-before-define
        vm.$store.commit('flux/setPrivilege', data.data.privilage);
        vm.$store.commit('flux/setZelid', zelidauth.zelid);
        localStorage.setItem('zelidauth', qs.stringify(zelidauth));
        userZelid.value = zelidauth.zelid;
        showToast('success', data.data.message);
      }
      console.log('Message received:', data);
    };

    const callbackValueLogin = () => {
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
          vm.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          vm.$store.commit('flux/setFluxPort', apiPort);
        }
        mybackend += hostname;
        mybackend += ':';
        // eslint-disable-next-line no-use-before-define
        mybackend += config.value.apiPort;
      }
      const backendURL = store.get('backendURL') || mybackend;
      const url = `${backendURL}/id/verifylogin`;
      return encodeURI(url);
    };

    const initZelcoreLogin = () => {
      try {
        const protocol = `zel:?action=sign&message=${loginPhrase.value}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${callbackValueLogin()}`;
        if (window.zelcore) {
          window.zelcore.protocol(protocol);
        } else {
          const hiddenLink = document.createElement('a');
          hiddenLink.href = protocol;
          hiddenLink.style.display = 'none';
          document.body.appendChild(hiddenLink);
          hiddenLink.click();
          document.body.removeChild(hiddenLink);
        }
      } catch (error) {
        showToast('warning', 'Failed to sign message, please try again.');
      }
    };

    const initiateLoginWS = () => {
      initZelcoreLogin();
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
          vm.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          vm.$store.commit('flux/setFluxPort', apiPort);
        }
        mybackend += hostname;
        mybackend += ':';
        // eslint-disable-next-line no-use-before-define
        mybackend += config.value.apiPort;
      }
      let backendURL = store.get('backendURL') || mybackend;
      backendURL = backendURL.replace('https://', 'wss://');
      backendURL = backendURL.replace('http://', 'ws://');

      const wsuri = `${backendURL}/ws/id/${loginPhrase.value}`;
      websocket.value = new WebSocket(wsuri);

      websocket.value.onopen = (evt) => onOpenLogin(evt);
      websocket.value.onclose = (evt) => onCloseLogin(evt);
      websocket.value.onmessage = (evt) => onMessageLogin(evt);
      websocket.value.onerror = (evt) => onErrorLogin(evt);
    };

    const uiConfig = {
      callbacks: {
        signInSuccessWithAuthResult: handleSignInSuccessWithAuthResult,
        uiShown() {
          const loadingElement = document.getElementById('ssoLoading');
          if (loadingElement) {
            loadingElement.style.display = 'none';
          }
        },
      },
      popupMode: true,
      signInFlow: 'popup',
      signInOptions: [
        {
          provider: firebase.auth.GoogleAuthProvider.PROVIDER_ID,
          customParameters: { prompt: 'select_account' },
        },
        'apple.com',
      ],
      tosUrl: 'https://cdn.runonflux.io/Flux_Terms_of_Service.pdf',
      privacyPolicyUrl: 'https://runonflux.io/privacyPolicy',
    };

    const onSessionConnectLogin = async (session) => {
      console.log(session);
      try {
        const result = await signClient.value.request({
          topic: session.topic,
          chainId: 'eip155:1',
          request: {
            method: 'personal_sign',
            params: [
              loginPhrase.value,
              session.namespaces.eip155.accounts[0].split(':')[2],
            ],
          },
        });
        console.log(result);
        const walletConnectInfo = {
          zelid: session.namespaces.eip155.accounts[0].split(':')[2],
          signature: result,
          loginPhrase: loginPhrase.value,
        };
        const response = await IDService.verifyLogin(walletConnectInfo);
        console.log(response);
        if (response.data.status === 'success') {
          const zelidauth = walletConnectInfo;
          vm.$store.commit('flux/setPrivilege', response.data.data.privilage);
          vm.$store.commit('flux/setZelid', zelidauth.zelid);
          localStorage.setItem('zelidauth', qs.stringify(zelidauth));
          userZelid.value = zelidauth.zelid;
          showToast('success', response.data.data.message);
        } else {
          showToast(getVariant(response.data.status), response.data.data.message || response.data.data);
        }
      } catch (error) {
        console.error(error);
        showToast('danger', error.message);
      }
    };

    const onSessionUpdate = (session) => {
      console.log(session);
    };

    const initWalletConnectLogin = async () => {
      try {
        signClient.value = await SignClient.init(walletConnectOptions);
        signClient.value.on('session_event', ({ event }) => {
          console.log(event);
        });

        signClient.value.on('session_update', ({ topic, params }) => {
          const { namespaces } = params;
          // eslint-disable-next-line no-underscore-dangle
          const _session = signClient.value.session.get(topic);
          const updatedSession = { ..._session, namespaces };
          onSessionUpdate(updatedSession);
        });

        signClient.value.on('session_delete', () => {
          // Session was deleted -> reset the dapp state, clean up from user session, etc.
        });

        const { uri, approval } = await signClient.value.connect({
          requiredNamespaces: {
            eip155: {
              methods: ['personal_sign'],
              chains: ['eip155:1'],
              events: ['chainChanged', 'accountsChanged'],
            },
          },
        });
        if (uri) {
          walletConnectModal.openModal({ uri });
          const session = await approval();
          await onSessionConnectLogin(session);
          walletConnectModal.closeModal();
        }
      } catch (error) {
        console.error(error);
        showToast('danger', error.message);
      }
    };

    const initSSPLogin = async () => {
      try {
        if (!window.ssp) {
          showToast('danger', 'SSP Wallet not installed');
          return;
        }
        const responseData = await window.ssp.request('sspwid_sign_message', { message: loginPhrase.value });
        if (responseData.status === 'ERROR') {
          throw new Error(responseData.data || responseData.result);
        }
        const sspLogin = {
          zelid: responseData.address,
          signature: responseData.signature,
          loginPhrase: loginPhrase.value,
        };
        const response = await IDService.verifyLogin(sspLogin);
        console.log(response);
        if (response.data.status === 'success') {
          const zelidauth = sspLogin;
          vm.$store.commit('flux/setPrivilege', response.data.data.privilage);
          vm.$store.commit('flux/setZelid', zelidauth.zelid);
          localStorage.setItem('zelidauth', qs.stringify(zelidauth));
          userZelid.value = zelidauth.zelid;
          showToast('success', response.data.data.message);
        } else {
          showToast('danger', response.data.data.message || response.data.data);
        }
      } catch (error) {
        showToast('danger', error.message);
      }
    };

    const siweLogin = async (siweMessage, from) => {
      try {
        const msg = `0x${Buffer.from(siweMessage, 'utf8').toString('hex')}`;
        const sign = await window.ethereum.request({
          method: 'personal_sign',
          params: [msg, from],
        });
        const metamaskLogin = {
          zelid: from,
          signature: sign,
          loginPhrase: loginPhrase.value,
        };
        const response = await IDService.verifyLogin(metamaskLogin);
        if (response.data.status === 'success') {
          const zelidauth = metamaskLogin;
          vm.$store.commit('flux/setPrivilege', response.data.data.privilage);
          vm.$store.commit('flux/setZelid', zelidauth.zelid);
          localStorage.setItem('zelidauth', qs.stringify(zelidauth));
          userZelid.value = zelidauth.zelid;
          showToast('success', response.data.data.message);
        } else {
          showToast('danger', response.data.data.message || response.data.data);
        }
      } catch (error) {
        console.error(error);
        showToast('danger', error.message);
      }
    };

    const initMetamaskLogin = async () => {
      try {
        if (!window.ethereum) {
          showToast('danger', 'Metamask not detected');
          return;
        }

        let account;
        if (!window.ethereum.selectedAddress) {
          const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
          account = accounts[0];
        } else {
          account = window.ethereum.selectedAddress;
        }
        await siweLogin(loginPhrase.value, account);
      } catch (error) {
        showToast('danger', error.message);
      }
    };

    const tier = ref('');
    tier.value = props.tier;
    const loading = ref(false);
    const completed = ref(false);
    // Variables to control showing dialogs
    const launchModalShowing = ref(false);
    const componentParamsModalShowing = ref(false);
    const confirmLaunchDialogCloseShowing = ref(false);

    // Holds the currently selected component, for viewing
    // additional parameters in a modal dialog
    const currentComponent = ref(null);

    // Registration variables
    const version = ref(1);
    const registrationtype = ref('fluxappregister');
    const dataToSign = ref(null);
    const signature = ref(null);
    const dataForAppRegistration = ref(null);
    const timestamp = ref(null);
    const appPricePerDeployment = ref(0);
    const appPricePerDeploymentUSD = ref(0);
    const fiatCheckoutURL = ref(null);
    const checkoutLoading = ref(false);
    const applicationPriceFluxError = ref(false);
    const applicationPriceFluxDiscount = ref('');
    const registrationHash = ref(null);
    const stripeEnabled = ref(true);
    const paypalEnabled = ref(true);
    const selectedEnterpriseNodes = ref([]);
    const enterprisePublicKeys = ref([]);
    const selectedGeolocation = ref(null);
    const contact = ref(null);
    const appInstances = ref(Number(3));
    const appRegistrationSpecification = ref(null);
    const tooltipText = ref('Copy to clipboard');
    const copyButtonRef = ref(null);
    const expireOptions = ref([]);
    const expirePosition = ref(Number(0));
    const tosAgreed = ref(false);
    const deploymentAddress = ref(null);
    const currentBlockHeight = ref(0); // Store current block height for default expire calculation
    expireOptions.value = [
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
    ];

    // Function to adjust expire options based on block height
    const adjustExpireOptionsForBlockHeight = async () => {
      try {
        const response = await DaemonService.getBlockchainInfo();
        if (response.data.status === 'success' && response.data.data) {
          const currentHeight = response.data.data.blocks;
          currentBlockHeight.value = currentHeight; // Store for later use
          // After block 2020000, chain works 4x faster, so multiply block periods by 4
          if (currentHeight >= 2020000) {
            expireOptions.value = expireOptions.value.map((option) => ({
              ...option,
              value: option.value * 4,
            }));
          }
        }
      } catch (error) {
        console.error('Failed to fetch blockchain info for expire options adjustment:', error);
        // Keep default values if fetch fails
      }
    };

    const config = computed(() => vm.$store.state.flux.config);
    const validTill = computed(() => timestamp.value + 60 * 60 * 1000); // 1 hour
    const subscribedTill = computed(() => {
      if (props.appData.version >= 6) {
        const auxArray = expireOptions.value;
        if (auxArray[expirePosition.value]) {
          return Date.now() + auxArray[expirePosition.value].time + 60 * 60 * 1000;
        }
      }
      const expTime = Date.now() + 30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000; // 1 month
      return expTime;
    });
    const getExpireLabel = computed(() => {
      const auxArray = expireOptions.value;
      if (auxArray[expirePosition.value]) {
        return auxArray[expirePosition.value].label;
      }
      return null;
    });
    const callbackValue = () => {
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
          vm.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          vm.$store.commit('flux/setFluxPort', apiPort);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += config.value.apiPort;
      }
      const backendURL = store.get('backendURL') || mybackend;
      const url = `${backendURL}/id/providesign`;
      return encodeURI(url);
    };

    const onError = (evt) => {
      console.log(evt);
    };
    const onMessage = (evt) => {
      const data = qs.parse(evt.data);
      if (data.status === 'success' && data.data) {
        // user is now signed. Store their values
        signature.value = data.data.signature;
      }
      console.log(data);
      console.log(evt);
    };
    const onClose = (evt) => {
      console.log(evt);
    };
    const onOpen = (evt) => {
      console.log(evt);
    };
    const initSignFluxSSO = async () => {
      try {
        const message = dataToSign.value;
        const firebaseUser = getUser();
        if (!firebaseUser) {
          showToast('warning', 'Not logged in as SSO. Login with SSO or use different signing method.');
          return;
        }
        const token = firebaseUser.auth.currentUser.accessToken;
        const headers = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        };
        const signSSO = await axios.post('https://service.fluxcore.ai/api/signMessage', { message }, { headers });
        if (signSSO.data?.status !== 'success' && signSSO.data?.signature) {
          showToast('warning', 'Failed to sign message, please try again.');
          return;
        }
        signature.value = signSSO.data.signature;
        showToast('success', 'Message signed.');
      } catch (error) {
        showToast('warning', 'Failed to sign message, please try again.');
      }
    };
    const initZelcorePay = () => {
      try {
        const protocol = `zel:?action=pay&coin=zelcash&address=${deploymentAddress.value}&amount=${appPricePerDeployment.value}&message=${registrationHash.value}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png`;
        if (window.zelcore) {
          window.zelcore.protocol(protocol);
        } else {
          const hiddenLink = document.createElement('a');
          hiddenLink.href = protocol;
          hiddenLink.style.display = 'none';
          document.body.appendChild(hiddenLink);
          hiddenLink.click();
          document.body.removeChild(hiddenLink);
        }
      } catch (error) {
        showToast('warning', 'Failed to sign message, please try again.');
      }
    };
    const initZelcore = async () => {
      try {
        const protocol = `zel:?action=sign&message=${dataToSign.value}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${callbackValue()}`;
        if (window.zelcore) {
          window.zelcore.protocol(protocol);
        } else if (dataToSign.value.length > 1800) {
          const message = dataToSign.value;
          // upload to flux storage
          const data = {
            publicid: Math.floor((Math.random() * 999999999999999)).toString(),
            public: message,
          };
          await axios.post(
            'https://storage.runonflux.io/v1/public',
            data,
          );
          const zelProtocol = `zel:?action=sign&message=FLUX_URL=https://storage.runonflux.io/v1/public/${data.publicid}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${callbackValue()}`;
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
        showToast('warning', 'Failed to sign message, please try again.');
      }
    };
    const initiateSignWS = async () => {
      await initZelcore();
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
          vm.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          vm.$store.commit('flux/setFluxPort', apiPort);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += config.value.apiPort;
      }
      let backendURL = store.get('backendURL') || mybackend;
      backendURL = backendURL.replace('https://', 'wss://');
      backendURL = backendURL.replace('http://', 'ws://');
      const signatureMessage = userZelid.value + timestamp.value;
      console.log(`signatureMessage: ${signatureMessage}`);
      const wsuri = `${backendURL}/ws/sign/${signatureMessage}`;
      const ws = new WebSocket(wsuri);
      websocket.value = ws;

      ws.onopen = (evt) => { onOpen(evt); };
      ws.onclose = (evt) => { onClose(evt); };
      ws.onmessage = (evt) => { onMessage(evt); };
      ws.onerror = (evt) => { onError(evt); };
    };

    const initMMSDK = async () => {
      try {
        await MMSDK.init();
        ethereum = MMSDK.getProvider();
      } catch (error) {
        console.log(error);
      }
    };
    initMMSDK();

    const siwe = async (siweMessage, from) => {
      try {
        const msg = `0x${Buffer.from(siweMessage, 'utf8').toString('hex')}`;
        const sign = await ethereum.request({
          method: 'personal_sign',
          params: [msg, from],
        });
        console.log(sign); // this is signature
        signature.value = sign;
      } catch (error) {
        console.error(error); // rejection occured
        showToast('danger', error.message);
      }
    };

    const initMetamask = async () => {
      try {
        if (!ethereum) {
          showToast('danger', 'Metamask not detected');
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
        siwe(dataToSign.value, account);
      } catch (error) {
        showToast('danger', error.message);
      }
    };
    const initSSP = async () => {
      try {
        if (!window.ssp) {
          showToast('danger', 'SSP Wallet not installed');
          return;
        }
        const responseData = await window.ssp.request('sspwid_sign_message', { message: dataToSign.value });
        if (responseData.status === 'ERROR') {
          throw new Error(responseData.data || responseData.result);
        }
        signature.value = responseData.signature;
      } catch (error) {
        showToast('danger', error.message);
      }
    };

    const initSSPpay = async () => {
      try {
        if (!window.ssp) {
          showToast('danger', 'SSP Wallet not installed');
          return;
        }
        const data = {
          message: registrationHash.value,
          amount: (+appPricePerDeployment.value || 0).toString(),
          address: deploymentAddress.value,
          chain: 'flux',
        };
        const responseData = await window.ssp.request('pay', data);
        if (responseData.status === 'ERROR') {
          throw new Error(responseData.data || responseData.result);
        } else {
          showToast('success', `${responseData.data}: ${responseData.txid}`);
        }
      } catch (error) {
        showToast('danger', error.message);
      }
    };

    const openSite = (url) => {
      const win = window.open(url, '_blank');
      win.focus();
    };

    const initStripePay = async () => {
      try {
        fiatCheckoutURL.value = null;
        checkoutLoading.value = true;
        const hash = registrationHash.value;
        const { name } = appRegistrationSpecification.value;
        const price = appPricePerDeploymentUSD.value;
        const { description } = appRegistrationSpecification.value;
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
              marketplace: true,
              registration: true,
            },
          },
        };
        const checkoutURL = await axios.post(`${paymentBridge}/api/v1/stripe/checkout/create`, data);
        if (checkoutURL.data.status === 'error') {
          showToast('error', 'Failed to create stripe checkout');
          checkoutLoading.value = false;
          return;
        }
        fiatCheckoutURL.value = checkoutURL.data.data;
        checkoutLoading.value = false;
        try {
          openSite(checkoutURL.data.data);
        } catch (error) {
          console.log(error);
          showToast('error', 'Failed to open Stripe checkout, pop-up blocked?');
        }
      } catch (error) {
        console.log(error);
        showToast('error', 'Failed to create stripe checkout');
        checkoutLoading.value = false;
      }
    };

    const initPaypalPay = async () => {
      try {
        fiatCheckoutURL.value = null;
        checkoutLoading.value = true;
        const hash = registrationHash.value;
        const { name } = appRegistrationSpecification.value;
        const price = appPricePerDeploymentUSD.value;
        const { description } = appRegistrationSpecification.value;
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
              marketplace: true,
              registration: true,
            },
          },
        };
        const checkoutURL = await axios.post(`${paymentBridge}/api/v1/paypal/checkout/create`, data);
        if (checkoutURL.data.status === 'error') {
          showToast('error', 'Failed to create PayPal checkout');
          checkoutLoading.value = false;
          return;
        }
        fiatCheckoutURL.value = checkoutURL.data.data;
        checkoutLoading.value = false;
        try {
          openSite(checkoutURL.data.data);
        } catch (error) {
          console.log(error);
          showToast('error', 'Failed to open PayPal checkout, pop-up blocked?');
        }
      } catch (error) {
        console.log(error);
        showToast('error', 'Failed to create PayPal checkout');
        checkoutLoading.value = false;
      }
    };

    const onSessionConnect = async (session) => {
      console.log(session);
      // const msg = `0x${Buffer.from(loginPhrase.value, 'utf8').toString('hex')}`;
      const result = await signClient.value.request({
        topic: session.topic,
        chainId: 'eip155:1',
        request: {
          method: 'personal_sign',
          params: [
            dataToSign.value,
            session.namespaces.eip155.accounts[0].split(':')[2],
          ],
        },
      });
      console.log(result);
      signature.value = result;
    };

    const initWalletConnect = async () => {
      try {
        const signClientAux = await SignClient.init(walletConnectOptions);
        signClient.value = signClientAux;
        const lastKeyIndex = signClientAux.session.getAll().length - 1;
        const lastSession = signClientAux.session.getAll()[lastKeyIndex];
        if (lastSession) {
          onSessionConnect(lastSession);
        } else {
          throw new Error('WalletConnect session expired. Please log into FluxOS again');
        }
      } catch (error) {
        console.error(error);
        showToast('danger', error.message);
      }
    };

    const perfectScrollbarSettings = {
      maxScrollbarLength: 150,
    };

    const resolveCpu = (app) => app.compose.reduce((total, component) => total + component.cpu, 0);

    const resolveRam = (app) => app.compose.reduce((total, component) => total + component.ram, 0);

    const resolveHdd = (app) => app.compose.reduce((total, component) => total + component.hdd, 0);

    const cpu = ref({
      series: [],
    });
    const ram = ref({
      series: [],
    });
    const hdd = ref({
      series: [],
    });

    const fetchEnterpriseKey = async (nodeip) => { // we must have at least +5 nodes or up to 10% of spare keys
      try {
        const node = nodeip.split(':')[0];
        const port = Number(nodeip.split(':')[1] || 16127);
        // const agent = new https.Agent({
        //   rejectUnauthorized: false,
        // });
        const { hostname } = window.location;
        const regex = /[A-Za-z]/g;
        let ipAccess = true;
        if (hostname.match(regex)) {
          ipAccess = false;
        }
        let queryUrl = `https://${node.replace(/\./g, '-')}-${port}.node.api.runonflux.io/flux/pgp`;
        if (ipAccess) {
          queryUrl = `http://${node}:${port}/flux/pgp`;
        }
        const response = await axios.get(queryUrl); // ip with port
        if (response.data.status === 'error') {
          showToast('danger', response.data.data.message || response.data.data);
        } else {
          const pgpKey = response.data.data;
          return pgpKey;
        }
        return null;
      } catch (error) {
        console.log(error);
        return null;
      }
    };

    const getEnterpriseNodes = async () => {
      const enterpriseList = sessionStorage.getItem('flux_enterprise_nodes');
      if (enterpriseList) {
        return JSON.parse(enterpriseList);
      }
      try {
        const entList = await AppsService.getEnterpriseNodes();
        if (entList.data.status === 'error') {
          showToast('danger', entList.data.data.message || entList.data.data);
        } else {
          sessionStorage.setItem('flux_enterprise_nodes', JSON.stringify(entList.data.data));
          return entList.data.data;
        }
      } catch (error) {
        console.log(error);
      }
      return [];
    };
    /**
    * To encrypt a message with an array of encryption public keys
    * @param {string} message Message to encrypt
    * @param {array} encryptionKeys Armored version of array of public key
    * @returns {string} Return armored version of encrypted message
    */
    const encryptMessage = async (message, encryptionKeys) => {
      try {
        const openpgp = await getOpenPGP();
        const encKeys = encryptionKeys.map((key) => key.nodekey);
        const publicKeys = await Promise.all(encKeys.map((armoredKey) => openpgp.readKey({ armoredKey })));
        const pgpMessage = await openpgp.createMessage({ text: message.replace('\\“', '\\"') });
        const encryptedMessage = await openpgp.encrypt({
          message: pgpMessage, // input as Message object
          encryptionKeys: publicKeys,
        });
        // '-----BEGIN PGP MESSAGE ... END PGP MESSAGE-----'
        return encryptedMessage;
      } catch (error) {
        showToast('danger', 'Data encryption failed');
        return null;
      }
    };
    const autoSelectNodes = async () => {
      const maxSamePubKeyNodes = +appInstances.value + 3;
      const maxNumberOfNodes = +appInstances.value + Math.ceil(Math.max(7, +appInstances.value * 0.15));
      const notSelectedEnterpriseNodes = await getEnterpriseNodes();
      const nodesToSelect = [];
      const selectedEnNodes = [];
      const kycNodes = notSelectedEnterpriseNodes.filter((x) => x.enterprisePoints > 0 && x.score > 1000); // allows to install multiple apps 3 to 4 only in kyc nodes
      for (let i = 0; i < kycNodes.length; i += 1) {
        // todo here check if max same pub key is satisfied
        const alreadySelectedPubKeyOccurances = selectedEnNodes.filter((node) => node.pubkey === kycNodes[i].pubkey).length;
        const toSelectPubKeyOccurances = nodesToSelect.filter((node) => node.pubkey === kycNodes[i].pubkey).length;
        if (alreadySelectedPubKeyOccurances + toSelectPubKeyOccurances < maxSamePubKeyNodes) {
          nodesToSelect.push(kycNodes[i]);
        }
        if (nodesToSelect.length + selectedEnNodes.length >= maxNumberOfNodes) {
          break;
        }
      }
      if (nodesToSelect.length < maxNumberOfNodes) {
        throw new Error('Not enough kyc nodes available to run your enterprise app.');
      }
      nodesToSelect.forEach(async (node) => {
        const nodeExists = selectedEnNodes.find((existingNode) => existingNode.ip === node.ip);
        if (!nodeExists) {
          selectedEnNodes.push(node);
          // fetch pgp key
          // we do not need pgp key as we dont do encryption
          const keyExists = enterprisePublicKeys.value.find((key) => key.nodeip === node.ip);
          if (!keyExists) {
            const pgpKey = await fetchEnterpriseKey(node.ip);
            if (pgpKey) {
              const pair = {
                nodeip: node.ip,
                nodekey: pgpKey,
              };
              const keyExistsB = enterprisePublicKeys.value.find((key) => key.nodeip === node.ip);
              if (!keyExistsB) {
                enterprisePublicKeys.value.push(pair);
              }
            }
          }
        }
      });
      console.log(selectedEnNodes);
      console.log(enterprisePublicKeys.value);
      return selectedEnNodes.map((node) => node.ip);
    };

    watch(() => props.appData, () => {
      if (websocket.value !== null) {
        websocket.value.close();
        websocket.value = null;
      }
      cpu.value = {
        series: [((resolveCpu(props.appData) / 15) * 100)],
      };
      ram.value = {
        series: [((resolveRam(props.appData) / 59000) * 100)],
      };
      hdd.value = {
        series: [((resolveHdd(props.appData) / 820) * 100)],
      };

      // Evaluate any user parameters from the database
      props.appData.compose.forEach((component) => {
        const paramModel = component.userEnvironmentParameters || [];
        // check if any of these parameters are special 'port' parameters
        paramModel.forEach((parameter) => {
          if (Object.prototype.hasOwnProperty.call(parameter, 'port')) {
            // eslint-disable-next-line no-param-reassign
            parameter.value = component.ports[parameter.port];
          }
        });
      });
      currentComponent.value = props.appData.compose[0];
      if (props.appData.isAutoEnterprise) {
        autoSelectNodes().then((v) => {
          // appSpecification.nodes = v;
          selectedEnterpriseNodes.value = v;
          console.log('auto selected nodes', v);
        }).catch(console.log);
      }
    });

    const constructUniqueAppName = (appName) => `${appName}${Date.now()}`;

    const constructAutomaticDomains = (appName) => {
      if (!userZelid.value) {
        return ['No Flux ID'];
      }
      const appNameWithTimestamp = constructUniqueAppName(appName);
      const lowerCaseName = appNameWithTimestamp.toLowerCase();
      const domains = [`${lowerCaseName}.app.runonflux.io`];
      return domains;
    };

    const appsDeploymentInformation = async () => {
      const response = await AppsService.appsDeploymentInformation();
      const { data } = response.data;
      if (response.data.status === 'success') {
        deploymentAddress.value = data.address;
      } else {
        showToast('danger', response.data.data.message || response.data.data);
      }
    };
    appsDeploymentInformation();

    const checkFluxSpecificationsAndFormatMessage = async () => {
      try {
        if (!tosAgreed.value) {
          throw new Error('Please agree to Terms of Service');
        }
        loading.value = false;
        completed.value = false;
        // construct a valid v4 app spec from the marketplace app spec,
        // filtering out unnecessary fields like 'price' and 'category'
        const appName = constructUniqueAppName(props.appData.name);
        const appSpecification = {
          version: props.appData.version,
          name: appName,
          description: props.appData.description,
          owner: userZelid.value,
          instances: appInstances.value,
          compose: [],
        };
        if (props.appData.version >= 5) {
          appSpecification.contacts = [];
          appSpecification.geolocation = [];
          if (selectedGeolocation.value) {
            appSpecification.geolocation.push(selectedGeolocation.value);
          }
          if (contact.value) {
            const contacts = [contact.value];
            const contactsid = Math.floor((Math.random() * 999999999999999)).toString();
            const data = {
              contactsid,
              contacts,
            };
            // eslint-disable-next-line no-await-in-loop
            const resp = await axios.post('https://storage.runonflux.io/v1/contacts', data);
            if (resp.data.status === 'error') {
              throw new Error(resp.data.message || resp.data);
            }
            showToast('success', 'Successful upload of Contact Parameter to Flux Storage');
            appSpecification.contacts = [`F_S_CONTACTS=https://storage.runonflux.io/v1/contacts/${contactsid}`];
          }
        }
        if (props.appData.version >= 6) {
          const auxArray = expireOptions.value;
          // After PON fork (block 2020000), default expire is 88000 blocks (4x22000)
          const defaultExpire = currentBlockHeight.value >= 2020000 ? 88000 : 22000;
          appSpecification.expire = auxArray[expirePosition.value].value || defaultExpire;
        }
        if (props.appData.version >= 7) {
          appSpecification.staticip = props.appData.staticip;
          if (props.appData.isAutoEnterprise) {
            if (selectedEnterpriseNodes.value.length === 0) {
              const v = await autoSelectNodes();
              // appSpecification.nodes = v;
              selectedEnterpriseNodes.value = v;
            }
            appSpecification.nodes = selectedEnterpriseNodes.value;
          } else {
            appSpecification.nodes = props.appData.nodes || [];
          }
        }
        // formation, pre verification
        for (let i = 0; i < props.appData.compose.length; i += 1) {
          const component = props.appData.compose[i];
          let envParams = JSON.parse(JSON.stringify(component.environmentParameters));
          const assignedEnv = component.userEnvironmentParameters || [];
          assignedEnv.forEach((param) => {
            envParams.push(`${param.name}=${param.value}`);
          });
          if (component.envFluxStorage) {
            const envid = Math.floor((Math.random() * 999999999999999)).toString();
            const data = {
              envid,
              env: envParams,
            };
            // eslint-disable-next-line no-await-in-loop
            const resp = await axios.post('https://storage.runonflux.io/v1/env', data);
            if (resp.data.status === 'error') {
              throw new Error(resp.data.message || resp.data);
            }
            showToast('success', 'Successful upload of Environment Parameters to Flux Storage');
            envParams = [`F_S_ENV=https://storage.runonflux.io/v1/env/${envid}`];
          }
          let { ports } = component;
          if (component.portSpecs) {
            ports = [];
            for (let y = 0; y < component.portSpecs.length; y += 1) {
              const portInterval = component.portSpecs[y];
              if (typeof portInterval === 'string') { // '0-10'
                const minPort = Number(portInterval.split('-')[0]);
                const maxPort = Number(portInterval.split('-')[1]);
                ports.push(Math.floor(Math.random() * (maxPort - minPort + 1) + minPort));
              } else {
                throw new Error('Port Specs Range for the application on Marketplace is not properly configured');
              }
            }
          }
          if (props.appData.name.toLowerCase().includes('streamr')) {
            envParams.push(`STREAMR__BROKER__CLIENT__NETWORK__CONTROL_LAYER__WEBSOCKET_PORT_RANGE__MIN=${ports[0]}`);
            envParams.push(`STREAMR__BROKER__CLIENT__NETWORK__CONTROL_LAYER__WEBSOCKET_PORT_RANGE__MAX=${ports[0]}`);
            envParams.push('LOG_COLORS=false');
            component.containerPorts = [ports[0]];
          }
          const appComponent = {
            name: component.name,
            description: component.description,
            repotag: component.repotag,
            ports,
            containerPorts: component.containerPorts,
            environmentParameters: envParams,
            commands: component.commands,
            containerData: component.containerData,
            domains: component.domains,
            cpu: component.cpu,
            ram: component.ram,
            hdd: component.hdd,
            tiered: component.tiered,
          };
          if (component.tiered) {
            appComponent.cpubasic = component.cpubasic;
            appComponent.rambasic = component.rambasic;
            appComponent.hddbasic = component.hddbasic;
            appComponent.cpusuper = component.cpusuper;
            appComponent.ramsuper = component.ramsuper;
            appComponent.hddsuper = component.hddsuper;
            appComponent.cpubamf = component.cpubamf;
            appComponent.rambamf = component.rambamf;
            appComponent.hddbamf = component.hddbamf;
          }
          if (props.appData.version >= 7) {
            appComponent.secrets = props.appData.secrets || '';
            appComponent.repoauth = props.appData.repoauth || '';
            const userSecrets = [];
            const assignedSecrets = component.userSecrets || [];
            assignedSecrets.forEach((param) => {
              userSecrets.push(`${param.name}=${param.value}`);
            });
            if (userSecrets.length > 0) {
              // eslint-disable-next-line no-await-in-loop
              const encryptedMessage = await encryptMessage(JSON.stringify(userSecrets), enterprisePublicKeys.value);
              if (encryptedMessage) {
                appComponent.secrets = encryptedMessage;
              } else {
                throw new Error('Secrets failed to encrypt');
              }
            }
          }
          appSpecification.compose.push(appComponent);
        }
        appRegistrationSpecification.value = appSpecification;

        // call api for verification of app registration specifications that returns formatted specs
        const responseAppSpecs = await AppsService.appRegistrationVerificaiton(appSpecification);
        console.log(responseAppSpecs);
        if (responseAppSpecs.data.status === 'error') {
          throw new Error(responseAppSpecs.data.data.message || responseAppSpecs.data.data);
        }
        const appSpecFormatted = responseAppSpecs.data.data;
        appPricePerDeployment.value = 0;
        appPricePerDeploymentUSD.value = 0;
        applicationPriceFluxError.value = false;
        applicationPriceFluxDiscount.value = '';
        const auxSpecsFormatted = JSON.parse(JSON.stringify(appSpecFormatted));
        auxSpecsFormatted.priceUSD = props.appData.priceUSD;
        console.log(auxSpecsFormatted.priceUSD);
        if (appInstances.value && appInstances.value > 3) {
          auxSpecsFormatted.priceUSD = Number(((auxSpecsFormatted.priceUSD * appInstances.value) / 3).toFixed(2));
        }
        if (expirePosition.value === '1') {
          auxSpecsFormatted.priceUSD *= 3;
        } else if (expirePosition.value === '2') {
          auxSpecsFormatted.priceUSD *= 6;
        } else if (expirePosition.value === '3') {
          auxSpecsFormatted.priceUSD *= 12;
        }
        const response = await AppsService.appPriceUSDandFlux(auxSpecsFormatted);
        if (response.data.status === 'error') {
          throw new Error(response.data.data.message || response.data.data);
        }
        appPricePerDeploymentUSD.value = +response.data.data.usd;
        if (Number.isNaN(+response.data.data.fluxDiscount)) {
          applicationPriceFluxError.value = true;
          showToast('danger', 'Not possible to complete payment with Flux crypto currency');
        } else {
          appPricePerDeployment.value = +response.data.data.flux;
          applicationPriceFluxDiscount.value = +response.data.data.fluxDiscount;
        }
        if (websocket.value !== null) {
          websocket.value.close();
          websocket.value = null;
        }
        timestamp.value = Date.now();
        dataForAppRegistration.value = appSpecFormatted;
        dataToSign.value = `${registrationtype.value}${version.value}${JSON.stringify(appSpecFormatted)}${Date.now()}`;
        registrationHash.value = null;
        signature.value = null;
        launchModalShowing.value = true;
      } catch (error) {
        console.log(error);
        showToast('danger', error.message || error);
      }
    };

    const smallchart = {
      height: 150,
      type: 'radialBar',
      sparkline: {
        enabled: true,
      },
      dropShadow: {
        enabled: true,
        blur: 3,
        left: 1,
        top: 1,
        opacity: 0.1,
      },
    };

    const largechart = {
      height: 200,
      type: 'radialBar',
      sparkline: {
        enabled: true,
      },
      dropShadow: {
        enabled: true,
        blur: 3,
        left: 1,
        top: 1,
        opacity: 0.1,
      },
    };

    const cpuRadialBar = {
      chart: largechart,
      colors: [$themeColors.primary],
      labels: ['CORES'],
      stroke: {
        lineCap: 'round',
      },
      plotOptions: {
        radialBar: {
          offsetY: 0,
          startAngle: 0,
          endAngle: 360,
          hollow: {
            size: '65%',
          },
          dataLabels: {
            name: {
              offsetY: -15,
              color: $themeColors.secondary,
              fontSize: '1.5rem',
            },
            value: {
              formatter: (val) => ((parseFloat(val) * 15) / 100).toFixed(1),
              offsetY: 10,
              color: $themeColors.success,
              fontSize: '2.86rem',
              fontWeight: '300',
            },
          },
        },
      },
    };

    const cpuRadialBarSmall = {
      chart: smallchart,
      colors: [$themeColors.primary],
      labels: ['CORES'],
      stroke: {
        lineCap: 'round',
      },
      plotOptions: {
        radialBar: {
          offsetY: 0,
          startAngle: 0,
          endAngle: 360,
          hollow: {
            size: '65%',
          },
          dataLabels: {
            name: {
              offsetY: -15,
              color: $themeColors.secondary,
              fontSize: '1.2rem',
            },
            value: {
              formatter: (val) => ((parseFloat(val) * 15) / 100).toFixed(1),
              offsetY: 10,
              color: $themeColors.success,
              fontSize: '2rem',
              fontWeight: '300',
            },
          },
        },
      },
    };

    const ramRadialBar = {
      chart: largechart,
      colors: [$themeColors.primary],
      labels: ['MB'],
      stroke: {
        lineCap: 'round',
      },
      plotOptions: {
        radialBar: {
          offsetY: 0,
          startAngle: 0,
          endAngle: 360,
          hollow: {
            size: '65%',
          },
          dataLabels: {
            name: {
              offsetY: -15,
              color: $themeColors.secondary,
              fontSize: '1.5rem',
            },
            value: {
              formatter: (val) => ((parseFloat(val) * 59000) / 100).toFixed(0),
              offsetY: 10,
              color: $themeColors.success,
              fontSize: '2.86rem',
              fontWeight: '300',
            },
          },
        },
      },
    };

    const ramRadialBarSmall = {
      chart: smallchart,
      colors: [$themeColors.primary],
      labels: ['MB'],
      stroke: {
        lineCap: 'round',
      },
      plotOptions: {
        radialBar: {
          offsetY: 0,
          startAngle: 0,
          endAngle: 360,
          hollow: {
            size: '65%',
          },
          dataLabels: {
            name: {
              offsetY: -15,
              color: $themeColors.secondary,
              fontSize: '1.2rem',
            },
            value: {
              formatter: (val) => ((parseFloat(val) * 59000) / 100).toFixed(0),
              offsetY: 10,
              color: $themeColors.success,
              fontSize: '2rem',
              fontWeight: '300',
            },
          },
        },
      },
    };

    const hddRadialBar = {
      chart: largechart,
      colors: [$themeColors.primary],
      labels: ['GB'],
      stroke: {
        lineCap: 'round',
      },
      plotOptions: {
        radialBar: {
          offsetY: 0,
          startAngle: 0,
          endAngle: 360,
          hollow: {
            size: '65%',
          },
          dataLabels: {
            name: {
              offsetY: -15,
              color: $themeColors.secondary,
              fontSize: '1.5rem',
            },
            value: {
              formatter: (val) => ((parseFloat(val) * 820) / 100).toFixed(0),
              offsetY: 10,
              color: $themeColors.success,
              fontSize: '2.86rem',
              fontWeight: '300',
            },
          },
        },
      },
    };

    const hddRadialBarSmall = {
      chart: smallchart,
      colors: [$themeColors.primary],
      labels: ['GB'],
      stroke: {
        lineCap: 'round',
      },
      plotOptions: {
        radialBar: {
          offsetY: 0,
          startAngle: 0,
          endAngle: 360,
          hollow: {
            size: '65%',
          },
          dataLabels: {
            name: {
              offsetY: -15,
              color: $themeColors.secondary,
              fontSize: '1.2rem',
            },
            value: {
              formatter: (val) => ((parseFloat(val) * 820) / 100).toFixed(0),
              offsetY: 10,
              color: $themeColors.success,
              fontSize: '2rem',
              fontWeight: '300',
            },
          },
        },
      },
    };

    const copyMessageToSign = async () => {
      const { copy } = useClipboard({ source: dataToSign.value, legacy: true });
      copy();
      tooltipText.value = 'Copied!';
      setTimeout(async () => {
        await nextTick();
        const button = copyButtonRef.value;
        if (button) {
          button.blur();
          tooltipText.value = '';
        }
      }, 1000);
      setTimeout(() => {
        tooltipText.value = 'Copy to clipboard';
      }, 1500);
    };

    const register = async () => {
      const zelidauth = localStorage.getItem('zelidauth');
      const data = {
        type: registrationtype.value,
        version: version.value,
        appSpecification: dataForAppRegistration.value,
        timestamp: timestamp.value,
        signature: signature.value,
      };
      showToast('info', 'Propagating message accross Flux network...');
      loading.value = true;
      const response = await AppsService.registerApp(zelidauth, data).catch((error) => {
        loading.value = false;
        showToast('danger', error.message || error);
      });
      loading.value = false;
      console.log(response);
      if (response.data.status === 'success') {
        completed.value = true;
        registrationHash.value = response.data.data;
        showToast('success', response.data.data.message || response.data.data);
      } else {
        showToast('danger', response.data.data.message || response.data.data);
      }
      const fiatGateways = await getPaymentGateways();
      if (fiatGateways) {
        stripeEnabled.value = fiatGateways.stripe;
        paypalEnabled.value = fiatGateways.paypal;
      }
    };

    const componentSelected = (component) => {
      currentComponent.value = props.appData.compose[component];
    };

    const confirmLaunchDialogFinish = () => {
      confirmLaunchDialogCloseShowing.value = true;
    };

    const confirmLaunchDialogCancel = (modalEvt) => {
      if (registrationHash.value !== null && !confirmLaunchDialogCloseShowing.value && launchModalShowing.value) {
        modalEvt.preventDefault();
        confirmLaunchDialogCloseShowing.value = true;
      }
    };

    const closeLaunchModals = () => {
      confirmLaunchDialogCloseShowing.value = false;
      launchModalShowing.value = false;
    };

    const initializeFirebaseUI = () => {
      const container = document.getElementById('firebaseui-auth-container');
      if (container) {
        const existingUI = firebaseui.auth.AuthUI.getInstance();
        ui.value = existingUI || new firebaseui.auth.AuthUI(firebase.auth());
        if (ui.value) {
          ui.value.start(container, uiConfig);
        } else {
          console.error('Failed to initialize FirebaseUI AuthUI instance');
        }
      }
    };

    watch(
      () => props.isActive,
      async (newVal) => {
        if (!newVal) return;
        await nextTick();
        initializeFirebaseUI();
      },
    );

    onMounted(async () => {
      if (!userZelid.value) {
        getZelIdLoginPhrase();
      }
      // Adjust expire options based on current block height
      await adjustExpireOptionsForBlockHeight();
    });

    return {
      // UI
      closeLaunchModals,
      tosAgreed,
      loading,
      completed,
      perfectScrollbarSettings,
      resolveTagVariant,

      resolveCpu,
      resolveRam,
      resolveHdd,

      constructAutomaticDomains,
      checkFluxSpecificationsAndFormatMessage,

      timeoptions,

      cpuRadialBar,
      cpuRadialBarSmall,
      cpu,

      ramRadialBar,
      ramRadialBarSmall,
      ram,

      hddRadialBar,
      hddRadialBarSmall,
      hdd,

      ui,
      loginForm,
      initiateLoginWS,
      initMetamaskLogin,
      loginPhrase,
      resetModal,
      handleOk,
      login,
      modalShow,
      emailLogin,
      initSSPLogin,
      createAccount,
      handleSignInSuccessWithAuthResult,
      cancelVerification,
      ssoVerification,
      createSSOForm,
      emailForm,
      getZelIdLoginPhrase,
      userZelid,
      dataToSign,
      selectedGeolocation,
      contact,
      appInstances,
      signClient,
      signature,
      appPricePerDeployment,
      appPricePerDeploymentUSD,
      applicationPriceFluxDiscount,
      applicationPriceFluxError,
      fiatCheckoutURL,
      checkoutLoading,
      registrationHash,
      deploymentAddress,
      stripeEnabled,
      paypalEnabled,

      validTill,
      subscribedTill,

      register,
      callbackValue,
      callbackValueLogin,
      initiateSignWS,
      initMetamask,
      initSSP,
      initSSPpay,
      initPaypalPay,
      initStripePay,
      openSite,
      initSignFluxSSO,
      initZelcorePay,
      initWalletConnect,
      initWalletConnectLogin,
      onSessionConnect,
      siwe,
      copyMessageToSign,

      launchModalShowing,
      componentParamsModalShowing,
      confirmLaunchDialogCloseShowing,
      confirmLaunchDialogFinish,
      confirmLaunchDialogCancel,
      expirePosition,
      getExpireLabel,

      currentComponent,
      componentSelected,

      tierColors,

      skin,
      isDark,
      tooltipText,
      copyButtonRef,
    };
  },
};
</script>

<style scoped>
#registrationmessage {
  padding-right: 25px !important;
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
.text-decoration-line-through {
  text-decoration: line-through;
}
.wizard-card {
  height: 250px;
}
.go-back:hover {
  color: #2B61D1;
}
</style>

<style>
  .custom-modal-title {
    color: #fff !important;
  }
</style>

<style lang="scss">
@import "@core/scss/vue/libs/vue-wizard.scss";
</style>
