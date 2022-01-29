<template>
  <div class="app-details">
    <!-- App Header -->
    <div class="app-detail-header">
      <!-- Header: Left -->
      <div class="app-header-left d-flex align-items-center">
        <span class="go-back mr-1">
          <feather-icon
            :icon="$store.state.appConfig.isRTL ? 'ChevronRightIcon' : 'ChevronLeftIcon'"
            size="20"
            class="align-bottom"
            @click="$emit('close-app-view')"
          />
        </span>
        <h4 class="app-name mb-0">
          Managed Services
        </h4>
      </div>
      <b-tabs
        pills
        nav-class="nav-pill-warning"
        class="currency-selector d-flex align-items-center"
      >
        <b-tab
          title="USD"
          active
        />
        <b-tab
          title="Flux"
          active
        />
      </b-tabs>
    </div>

    <!-- App Details -->
    <vue-perfect-scrollbar
      :settings="perfectScrollbarSettings"
      class="app-scroll-area scroll-area"
    >
      <b-row
        v-for="service in config.managed"
        :key="service.title"
      >
        <b-col>
          <b-card
            :title="service.title"
            class="managedservice-container"
          >
            <b-row class="match-height">
              <b-col
                cols="3"
                class="managedservice-card"
              >
                <b-card
                  no-body
                  class="text-center"
                  :style="`background-color: ${tierColors[service.title.toLowerCase()]}`"
                >
                  <b-card-header>
                    <h3>Collateral</h3>
                  </b-card-header>
                  <b-card-body class="d-flex align-items-center justify-content-center">
                    <b-card-text>
                      <h1>{{ service.collateral.toLocaleString() }}</h1>
                      <h3>Flux</h3>
                    </b-card-text>
                  </b-card-body>
                </b-card>
              </b-col>
              <b-col
                cols="3"
                class="managedservice-card"
              >
                <b-card
                  no-body
                  class="text-center"
                  :style="`background-color: ${tierColors[service.title.toLowerCase()]}`"
                >
                  <b-card-header>
                    <h3>Specs</h3>
                  </b-card-header>
                  <b-card-body>
                    <b-card-text>
                      <h3>>= {{ service.cores }} vCores</h3>
                      <h3>>= {{ service.ram }}GB RAM</h3>
                      <h3>>= {{ service.storage }}GB Storage</h3>
                    </b-card-text>
                  </b-card-body>
                </b-card>
              </b-col>
              <b-col
                cols="6"
                class="managedservice-card"
              >
                <b-card
                  class="text-center pricing-card"
                  no-body
                  :style="`border-color: ${tierColors[service.title.toLowerCase()]}`"
                >
                  <b-card-header>
                    <h3>Pricing</h3>
                  </b-card-header>
                  <b-card-body class="d-flex align-items-center justify-content-center">
                    <b-row class="match-height">
                      <b-col cols="4">
                        <b-button
                          :style="`background-color: ${tierColors[service.title.toLowerCase()]} !important; border-color: ${tierColors[service.title.toLowerCase()]} !important`"
                          @click="openPurchaseDialog(service, 3);"
                        >
                          <h3
                            style="white-space: nowrap"
                          >
                            3 Months
                          </h3>
                          <h4>${{ service.priceUSD["3m"] }}</h4>
                        </b-button>
                      </b-col>
                      <b-col cols="4">
                        <b-button :style="`background-color: ${tierColors[service.title.toLowerCase()]} !important; border-color: ${tierColors[service.title.toLowerCase()]} !important`">
                          <h3
                            style="white-space: nowrap"
                          >
                            6 Months
                          </h3>
                          <h4>${{ service.priceUSD["6m"] }}</h4>
                        </b-button>
                      </b-col>
                      <b-col cols="4">
                        <b-button :style="`background-color: ${tierColors[service.title.toLowerCase()]} !important; border-color: ${tierColors[service.title.toLowerCase()]} !important`">
                          <h3
                            style="white-space: nowrap"
                          >
                            12 Months
                          </h3>
                          <h4>${{ service.priceUSD["12m"] }}</h4>
                        </b-button>
                      </b-col>
                    </b-row>
                  </b-card-body>
                </b-card>
              </b-col>
            </b-row>
          </b-card>
        </b-col>
      </b-row>
    </vue-perfect-scrollbar>

    <b-modal
      v-model="confirmPurchaseDialogCloseShowing"
      title="Finish Purchasing Service?"
      size="sm"
      centered
      button-size="sm"
      ok-title="Yes"
      cancel-title="No"
      @ok="confirmPurchaseDialogCloseShowing = false; purchaseModalShowing = false;"
    >
      <h3 class="text-center">
        Please ensure that you have paid for your service, or saved the payment details for later.
      </h3>
      <br>
      <h4 class="text-center">
        Close the Purchase Service dialog?
      </h4>
    </b-modal>

    <b-modal
      v-model="purchaseModalShowing"
      title="Purchasing Managed Service"
      size="xlg"
      centered
      no-close-on-backdrop
      no-close-on-esc
      button-size="sm"
      ok-only
      ok-title="Cancel"
      @ok="confirmPurchaseDialogCancel"
    >
      <form-wizard
        :color="tierColors.cumulus"
        :title="null"
        :subtitle="null"
        layout="vertical"
        back-button-text="Previous"
        class="wizard-vertical mb-3"
        @on-complete="confirmLaunchDialogFinish()"
      >
        <tab-content title="Check Registration">
          <b-card
            title="Registration Message"
            class="text-center wizard-card"
          />
        </tab-content>
        <tab-content title="Sign App Message">
          <b-card
            title="Sign App Message with Zelcore"
            class="text-center wizard-card"
          />
        </tab-content>
        <tab-content title="Register App">
          <b-card
            title="Register App"
            class="text-center wizard-card"
          />
        </tab-content>
        <tab-content title="Send Payment">
          <b-row class="match-height">
            <b-col>
              <b-card
                title="Send Payment"
                class="text-center wizard-card"
              />
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
  BCardBody,
  BCardHeader,
  BCardText,
  BCol,
  // BFormInput,
  // BFormTextarea,
  BModal,
  BRow,
  BTabs,
  BTab,
  VBModal,
  VBToggle,
  VBTooltip,
} from 'bootstrap-vue';
import {
  FormWizard,
  TabContent,
} from 'vue-form-wizard';
import VuePerfectScrollbar from 'vue-perfect-scrollbar';
// import VueApexCharts from 'vue-apexcharts';
import Ripple from 'vue-ripple-directive';
import { useToast } from 'vue-toastification/composition';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';

import 'vue-form-wizard/dist/vue-form-wizard.min.css';

import {
  ref,
} from '@vue/composition-api';

// import ListEntry from '@/views/components/ListEntry.vue';
// import AppsService from '@/services/AppsService';
import tierColors from '@/libs/colors';
import config from './services.json';

// const qs = require('qs');
// const store = require('store');
// const timeoptions = require('@/libs/dateFormat');

export default {
  components: {
    BButton,
    BCard,
    BCardBody,
    BCardHeader,
    BCardText,
    BCol,
    // BFormInput,
    // BFormTextarea,
    BModal,
    BRow,
    BTabs,
    BTab,

    FormWizard,
    TabContent,

    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
    // ListEntry,

    // 3rd Party
    VuePerfectScrollbar,
    // VueApexCharts,
  },
  directives: {
    Ripple,
    'b-modal': VBModal,
    'b-toggle': VBToggle,
    'b-tooltip': VBTooltip,
  },
  props: {
    zelid: {
      type: String,
      required: false,
      default: '',
    },
  },
  setup(props) {
    // Use toast
    const toast = useToast();

    const userZelid = ref('');
    userZelid.value = props.zelid;
    const purchaseModalShowing = ref(false);
    const confirmPurchaseDialogCloseShowing = ref(false);

    const perfectScrollbarSettings = {
      maxScrollbarLength: 150,
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

    const confirmPurchaseDialogFinish = () => {
      confirmPurchaseDialogCloseShowing.value = true;
    };

    const confirmPurchaseDialogCancel = (modalEvt) => {
      // if (registrationHash.value !== null) {
      modalEvt.preventDefault();
      confirmPurchaseDialogCloseShowing.value = true;
      // }
    };

    const openPurchaseDialog = (service, months) => {
      console.log(service);
      console.log(months);
      purchaseModalShowing.value = true;
    };

    return {

      // UI
      perfectScrollbarSettings,

      userZelid,

      openPurchaseDialog,
      purchaseModalShowing,

      confirmPurchaseDialogCloseShowing,
      confirmPurchaseDialogFinish,
      confirmPurchaseDialogCancel,

      config,

      tierColors,
      showToast,
    };
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
.text-decoration-line-through {
  text-decoration: line-through;
}
.wizard-card {
  height: 250px;
}

.managedservice-card .card .card-header + .card-body {
  padding-top: 0.6rem;
}

.managedservice-card .card .card-header {
  background-color: rgba(34, 41, 47, 0.03);
  border-bottom: 1px solid rgba(34, 41, 47, 0.125);
  display: block;
  font-size: 1.8rem;
  padding: 0.6rem;
}
.managedservice-card .card .card-header h3 {
  margin-bottom: 0.1rem;
}
.managedservice-card .card {
  margin-bottom: 0.2rem;
}
.managedservice-card .pricing-card {
  border: 3px solid;
}
.managedservice-container {
  margin-bottom: 0.3rem;
}
.managedservice-container .card-body {
  padding: 0.8rem;
}
.managedservice-container .card-title {
  margin-bottom: 0.3rem;
}
.currency-selector {
  margin-top: 0rem;
  margin-bottom: 0rem;
}
.nav-pills {
  margin-bottom: 0rem !important;
}
</style>
<style lang="scss">
  @import '@core/scss/vue/libs/vue-wizard.scss';
</style>
