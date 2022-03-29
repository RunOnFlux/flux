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
            @click="$emit('close-sharednode-view')"
          />
        </span>
        <h4 class="app-name mb-0">
          Titan Shared Nodes
        </h4>
      </div>
    </div>

    <!-- App Details -->
    <vue-perfect-scrollbar
      :settings="perfectScrollbarSettings"
      class="marketplace-app-list scroll-area"
    >
      <b-card bg-variant="transparent">
        <b-row class="match-height">
          <b-col xl="4">
            <b-card
              border-variant="primary"
              no-body
            >
              <b-card-title class="text-white text-uppercase shared-node-info-title">
                Active Nodes
              </b-card-title>
              <b-card-body class="shared-node-info-body">
                <h1 class="active-node-value">
                  {{ nodes.length }}
                </h1>
                <div class="d-flex">
                  <h4 class="flex-grow-1">
                    Total: {{ totalCollateral.toLocaleString() }} Flux
                  </h4>
                  <b-avatar
                    size="24"
                    variant="primary"
                    button
                    @click="showNodeInfoDialog()"
                  >
                    <v-icon
                      scale="0.9"
                      name="info"
                    />
                  </b-avatar>
                </div>
              </b-card-body>
            </b-card>
          </b-col>
          <b-col xl="4">
            <b-card
              border-variant="primary"
              no-body
            >
              <b-card-title class="text-white text-uppercase shared-node-info-title">
                Staking Stats
              </b-card-title>
              <b-card-body class="shared-node-info-body">
                <div class="d-flex flex-column">
                  <div class="d-flex flex-row">
                    <h5 class="flex-grow-1">
                      My Staking Total
                    </h5>
                    <h4>
                      {{ myStakes ? toFixedLocaleString(myStakes.reduce((total, stake) => total + stake.collateral, 0), 0) : 0 }}
                    </h4>
                  </div>
                  <div class="d-flex flex-row">
                    <h5 class="flex-grow-1">
                      Titan Staking Total
                    </h5>
                    <h4>
                      {{ titanStats ? toFixedLocaleString(titanStats.total) : '...' }}
                    </h4>
                  </div>
                  <div class="d-flex flex-row">
                    <h5 class="flex-grow-1">
                      Current Supply
                    </h5>
                    <h4>
                      {{ titanStats ? toFixedLocaleString(titanStats.currentsupply) : '...' }}
                    </h4>
                  </div>
                  <div class="d-flex flex-row">
                    <h5 class="flex-grow-1">
                      Max Supply
                    </h5>
                    <h4>
                      {{ titanStats ? toFixedLocaleString(titanStats.maxsupply) : '...' }}
                    </h4>
                  </div>
                  <div>
                    <hr>
                  </div>
                  <div class="d-flex flex-row">
                    <b-button
                      v-if="userZelid"
                      class="flex-grow-1 .btn-relief-primary"
                      variant="gradient-primary"
                      @click="showStakeDialog"
                    >
                      Stake Flux
                    </b-button>
                  </div>
                </div>
              </b-card-body>
            </b-card>
          </b-col>
          <b-col xl="4">
            <b-card
              border-variant="primary"
              no-body
            >
              <b-card-title class="text-white text-uppercase shared-node-info-title">
                Lockup Period APR
              </b-card-title>
              <b-card-body
                v-if="titanConfig"
                class="shared-node-info-body"
              >
                <div
                  v-for="lockup in titanConfig.lockups"
                  :key="lockup.time"
                  class="lockup"
                >
                  <div class="d-flex flex-row">
                    <h2 class="flex-grow-1">
                      {{ lockup.name }}
                    </h2>
                    <h1>
                      ~{{ (lockup.apr*100).toFixed(2) }}%
                    </h1>
                  </div>
                </div>
                <div class="float-right">
                  <b-avatar
                    size="24"
                    variant="primary"
                    button
                  >
                    <v-icon
                      scale="0.9"
                      name="info"
                    />
                  </b-avatar>
                </div>
              </b-card-body>
            </b-card>
          </b-col>
        </b-row>
      </b-card>
      <b-card
        v-if="!userZelid"
        title="My Seats"
      >
        <h5>
          Please login using your ZelID to view your node stakes
        </h5>
      </b-card>
      <b-row
        v-else
        class=""
      >
        <b-col xl="9">
          <b-card
            class="sharednodes-container"
            no-body
          >
            <b-card-title
              class="stakes-title"
            >
              My Active Stakes
            </b-card-title>
            <b-card-body>
              <ul
                class="marketplace-media-list"
              >
                <b-media
                  v-for="stake in myStakes"
                  :key="stake.uuid"
                  tag="li"
                  no-body
                >
                  <b-media-body
                    class="app-media-body"
                    style="overflow: inherit;"
                  >
                    <div class="d-flex flex-row row">
                      <b-avatar
                        v-if="stake.confirmations === -1"
                        size="48"
                        variant="danger"
                        class="node-status mt-auto mb-auto"
                        button
                        @click="showPaymentDetailsDialog(stake)"
                      >
                        <v-icon
                          scale="1.75"
                          name="hourglass-half"
                        />
                      </b-avatar>
                      <b-avatar
                        v-else-if="titanConfig && stake.confirmations >= titanConfig.confirms"
                        size="48"
                        variant="light-success"
                        class="node-status mt-auto mb-auto"
                      >
                        <v-icon
                          scale="1.75"
                          name="check"
                        />
                      </b-avatar>
                      <b-avatar
                        v-else
                        size="48"
                        variant="light-warning"
                        class="node-status mt-auto mb-auto"
                      >
                        {{ stake.confirmations }}/{{ titanConfig ? titanConfig.confirms : 0 }}
                      </b-avatar>
                      <div
                        class="d-flex flex-column seat-column col"
                        style="flex-grow: 0.8;"
                      >
                        <h3 class="mr-auto ml-auto mt-auto mb-auto">
                          {{ stake.collateral.toLocaleString() }} Flux
                        </h3>
                      </div>
                      <div class="d-flex flex-column seat-column col">
                        <h4 class="mr-auto ml-auto">
                          Start Date: {{ new Date(stake.timestamp*1000).toLocaleDateString() }}
                        </h4>
                        <h5 class="mr-auto ml-auto">
                          End Date: {{ new Date(stake.expiry*1000).toLocaleDateString() }}
                        </h5>
                      </div>
                      <div class="d-flex flex-column seat-column col">
                        <h4 class="mr-auto ml-auto">
                          Paid: {{ toFixedLocaleString(stake.paid, 2) }} Flux
                        </h4>
                        <h5 class="mr-auto ml-auto">
                          Pending: {{ toFixedLocaleString(stake.reward, 2) }} Flux
                        </h5>
                      </div>
                      <div class="d-flex flex-column seat-column col">
                        <h4 class="mr-auto ml-auto">
                          Monthly Rewards
                        </h4>
                        <h5
                          v-if="titanConfig"
                          class="mr-auto ml-auto"
                        >
                          ~{{ toFixedLocaleString(calcMonthlyReward(stake), 2) }} Flux
                        </h5>
                        <h5
                          v-else
                          class="mr-auto ml-auto"
                        >
                          ... Flux
                        </h5>
                      </div>
                      <!--<div class="d-flex flex-column ml-auto">
                        <b-button
                          class="mt-auto mb-auto"
                          variant="danger"
                          size="sm"
                          pill
                          @click="showCancelStakingDialog(seat);"
                        >
                          Stop Staking
                        </b-button>
                      </div>-->
                    </div>
                  </b-media-body>
                </b-media>
              </ul>
            </b-card-body>
          </b-card>
        </b-col>
        <b-col
          xl="3"
        >
          <b-card no-body>
            <b-card-title
              class="stakes-title"
            >
              Redeem Rewards
            </b-card-title>
            <b-card-body>
              <div class="d-flex flex-row">
                <h5 class="flex-grow-1">
                  Paid:
                </h5>
                <h4>
                  {{ myStakes ? toFixedLocaleString(myStakes.reduce((total, stake) => total + stake.paid, 0), 2) : 0 }} Flux
                </h4>
              </div>
              <div class="d-flex flex-row">
                <h5 class="flex-grow-1">
                  Available:
                </h5>
                <h4>
                  {{ toFixedLocaleString(totalReward, 2) }} Flux
                </h4>
              </div>
              <b-button
                class="float-right mt-2"
                variant="danger"
                size="sm"
                pill
                :disabled="totalReward <= titanConfig.redeemFee"
                @click="showRedeemDialog()"
              >
                Redeem
              </b-button>
            </b-card-body>
          </b-card>
        </b-col>
      </b-row>
    </vue-perfect-scrollbar>

    <b-modal
      v-model="nodeModalShowing"
      title="Titan Nodes"
      size="lg"
      centered
      button-size="sm"
      ok-only
      @ok="() => nodeModalShowing = false"
    >
      <b-card
        v-for="node in nodes"
        :key="node.uuid"
        :title="node.name"
      >
        <b-row>
          <b-col>
            <h5>
              Location: {{ node.location }}
            </h5>
          </b-col>
          <b-col>
            <h5>
              Collateral: {{ toFixedLocaleString(node.collateral, 0) }}
            </h5>
          </b-col>
        </b-row>
        <b-row>
          <b-col>
            <h5>
              Created: {{ new Date(node.created).toLocaleDateString() }}
            </h5>
          </b-col>
          <b-col>
            <b-button
              pill
              size="sm"
              variant="primary"
              @click="visitNode(node)"
            >
              Visit
            </b-button>
          </b-col>
        </b-row>
      </b-card>
    </b-modal>

    <b-modal
      v-model="redeemModalShowing"
      title="Redeem Rewards"
      size="lg"
      centered
      button-size="sm"
      ok-only
      ok-title="Cancel"
      @ok="redeemModalShowing = false"
    >
      <form-wizard
        :color="tierColors.cumulus"
        :title="null"
        :subtitle="null"
        layout="vertical"
        back-button-text="Previous"
        class="wizard-vertical mb-3"
        @on-complete="confirmRedeemDialogFinish()"
      >
        <tab-content
          title="Redeem Amount"
        >
          <b-card
            title="Redeem Amount"
            class="text-center wizard-card"
          >
            <h4>
              Available: {{ toFixedLocaleString(totalReward, 2) }} Flux
            </h4>
            <!-- <div>
              <h5 class="float-left">
                {{ titanConfig ? titanConfig.redeemFee : 0 }}
              </h5>
              <h5 class="float-right">
                {{ toFixedLocaleString(totalReward, 2) }}
              </h5>
            </div>
            <b-form-input
              id="redeemamount"
              v-model="redeemAmount"
              type="range"
              :min="titanConfig ? titanConfig.redeemFee : 0"
              :max="parseFloat(toFixedLocaleString(totalReward, 2))"
              :step="0.01"
              number
            />
            <b-form-spinbutton
              id="redeemamount-spnner"
              v-model="redeemAmount"
              :min="titanConfig ? titanConfig.redeemFee : 0"
              :max="parseFloat(toFixedLocaleString(totalReward, 2))"
              :step="0.01"
              size="sm"
              inline
            /> -->
            <h4 style="margin-top: 10px;">
              You will receive
            </h4>
            <h3>
              {{ toFixedLocaleString(totalReward - (titanConfig ? titanConfig.redeemFee : 0), 2) }} Flux
            </h3>
            <h6>
              (Redeem Fee: {{ titanConfig ? titanConfig.redeemFee : '...' }} Flux)
            </h6>
          </b-card>
        </tab-content>
        <tab-content
          title="Redeem Address"
          :before-change="() => checkRedeemAddress()"
        >
          <b-card
            title="Choose Redeem Address"
            class="text-center wizard-card"
          >
            <b-form-select
              v-model="redeemAddress"
              :options="redeemAddresses"
            >
              <template #first>
                <b-form-select-option
                  :value="null"
                  disabled
                >
                  -- Please select an address --
                </b-form-select-option>
              </template>
            </b-form-select>
          </b-card>
        </tab-content>
        <tab-content
          title="Sign Request"
          :before-change="() => signature !== null"
        >
          <b-card
            title="Sign Redeem Request with Zelcore"
            class="text-center wizard-card"
          >
            <a
              :href="`zel:?action=sign&message=${dataToSign}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${callbackValue()}`"
              @click="initiateSignWS"
            >
              <img
                class="zelidLogin mb-2"
                src="@/assets/images/zelID.svg"
                alt="Zel ID"
                height="100%"
                width="100%"
              >
            </a>
            <b-form-input
              id="data"
              v-model="dataToSign"
              :disabled="true"
              class="mb-1"
            />
            <b-form-input
              id="signature"
              v-model="signature"
            />
          </b-card>
        </tab-content>
        <tab-content
          title="Request Redeem"
          :before-change="() => requestSent === true"
        >
          <b-card
            title="Submit Redeem Request"
            class="text-center wizard-card"
          >
            <div class="mt-3 mb-auto ">
              <b-button
                size="lg"
                :disabled="sendingRequest || requestSent"
                variant="warning"
                @click="requestRedeem"
              >
                Submit Request
              </b-button>
              <h4
                v-if="requestSent"
                class="mt-3 text-success"
              >
                Redeem request has been received and will be processed within 24 hours
              </h4>
              <h4
                v-if="requestFailed"
                class="mt-3 text-danger"
              >
                Redeem request failed
              </h4>
            </div>
          </b-card>
        </tab-content>
      </form-wizard>
    </b-modal>

    <b-modal
      v-model="paymentDetailsDialogShowing"
      title="Pending Payment"
      size="md"
      centered
      button-size="sm"
      ok-only
      ok-title="OK"
      @ok="paymentDetailsDialogShowing = false;"
    >
      <b-card
        v-if="selectedStake"
        title="Send Funds"
        class="text-center payment-details-card"
      >
        <b-card-text>
          To finish staking, send <span class="text-success">{{ toFixedLocaleString(selectedStake.collateral) }}</span> FLUX to address<br>
          <h5
            class="text-wrap ml-auto mr-auto text-warning mt-1"
            style="width: 25rem;"
          >
            {{ titanConfig.fundingAddress }}
          </h5>
          with the following message<br>
          <h5
            class="text-wrap ml-auto mr-auto text-warning mt-1"
            style="width: 25rem;"
          >
            {{ selectedStake.signatureHash }}
          </h5>
          <div class="d-flex flex-row mt-2">
            <h3 class="col text-center mt-2">
              Pay with<br>Zelcore
            </h3>
            <a
              :href="`zel:?action=pay&coin=zelcash&address=${titanConfig.fundingAddress}&amount=${selectedStake.collateral}&message=${selectedStake.signatureHash}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png`"
              class="col"
            >
              <img
                class="zelidLogin"
                src="@/assets/images/zelID.svg"
                alt="Zel ID"
                height="100%"
                width="100%"
              >
            </a>
          </div>
          <h5 class="mt-1">
            This stake will expire if the transaction is not on the blockchain before <span class="text-danger">{{ new Date(selectedStake.expiry * 1000).toLocaleString() }}</span>
          </h5>
        </b-card-text>
      </b-card>
    </b-modal>

    <b-modal
      v-model="confirmStakeDialogCloseShowing"
      title="Cancel Staking?"
      size="sm"
      centered
      button-size="sm"
      ok-title="Yes"
      cancel-title="No"
      @ok="confirmStakeDialogCloseShowing = false; stakeModalShowing = false;"
    >
      <h3 class="text-center">
        Are you sure you want to cancel staking with Titan?
      </h3>
    </b-modal>

    <b-modal
      v-model="confirmStakeDialogFinishShowing"
      title="Finish Staking?"
      size="sm"
      centered
      button-size="sm"
      ok-title="Yes"
      cancel-title="No"
      @ok="confirmStakeDialogFinishShowing = false; stakeModalShowing = false;"
    >
      <h3 class="text-center">
        Please ensure that you have sent payment for your stake, or saved the payment details for later.
      </h3>
      <br>
      <h4 class="text-center">
        Close the Titan Staking dialog?
      </h4>
    </b-modal>

    <b-modal
      v-model="stakeModalShowing"
      title="Stake Flux with Titan"
      size="lg"
      centered
      no-close-on-backdrop
      no-close-on-esc
      button-size="sm"
      ok-only
      ok-title="Cancel"
      @ok="confirmStakeDialogCancel"
    >
      <form-wizard
        :color="tierColors.cumulus"
        :title="null"
        :subtitle="null"
        layout="vertical"
        back-button-text="Previous"
        class="wizard-vertical mb-3"
        @on-complete="confirmStakeDialogFinish()"
      >
        <tab-content
          title="Stake Amount"
        >
          <b-card
            title="Choose Stake Amount"
            class="text-center wizard-card"
          >
            <div>
              <h3 class="float-left">
                50
              </h3>
              <h3 class="float-right">
                40,000
              </h3>
            </div>
            <b-form-input
              id="stakeamount"
              v-model="stakeAmount"
              type="range"
              min="50"
              max="40000"
              step="5"
            />
            <b-form-spinbutton
              id="stakeamount-spnner"
              v-model="stakeAmount"
              min="50"
              max="40000"
              size="lg"
              :formatter-fn="toFixedLocaleString"
              class="stakeAmountSpinner"
            />
          </b-card>
        </tab-content>
        <tab-content
          title="Choose Duration"
          :before-change="() => checkDuration()"
        >
          <b-card
            v-if="titanConfig"
            title="Select Lockup Period"
            class="text-center wizard-card"
          >
            <div
              v-for="(lockup, index) in titanConfig.lockups"
              :key="lockup.time"
              class="mb-1"
            >
              <div class="ml-auto mr-auto">
                <b-button
                  :class="index === selectedLockupIndex ? 'selectedLockupButton' : 'unselectedLockupButton'"
                  :style="`background-color: ${indexedTierColors[index]} !important;`"
                  @click="selectLockup(index)"
                >
                  {{ lockup.name }} - ~{{ (lockup.apr*100).toFixed(2) }}%
                </b-button>
              </div>
            </div>
          </b-card>
        </tab-content>
        <tab-content
          title="Sign Stake"
          :before-change="() => signature !== null"
        >
          <b-card
            title="Sign Stake with Zelcore"
            class="text-center wizard-card"
          >
            <a
              :href="`zel:?action=sign&message=${dataToSign}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${callbackValue()}`"
              @click="initiateSignWS"
            >
              <img
                class="zelidLogin mb-2"
                src="@/assets/images/zelID.svg"
                alt="Zel ID"
                height="100%"
                width="100%"
              >
            </a>
            <b-form-input
              id="data"
              v-model="dataToSign"
              :disabled="true"
              class="mb-1"
            />
            <b-form-input
              id="signature"
              v-model="signature"
            />
          </b-card>
        </tab-content>
        <tab-content
          title="Register Stake"
          :before-change="() => stakeRegistered === true"
        >
          <b-card
            title="Register Stake with Titan"
            class="text-center wizard-card"
          >
            <div class="mt-3 mb-auto ">
              <b-button
                size="lg"
                :disabled="registeringStake || stakeRegistered"
                variant="success"
                @click="registerStake"
              >
                Register Stake
              </b-button>
              <h4
                v-if="stakeRegistered"
                class="mt-3 text-success"
              >
                Registration received
              </h4>
              <h4
                v-if="stakeRegisterFailed"
                class="mt-3 text-danger"
              >
                Registration failed
              </h4>
            </div>
          </b-card>
        </tab-content>
        <tab-content
          title="Send Funds"
        >
          <div
            v-if="titanConfig && signatureHash"
          >
            <b-card
              title="Send Funds"
              class="text-center wizard-card"
            >
              <b-card-text>
                To finish staking, make a transaction of <span class="text-success">{{ toFixedLocaleString(stakeAmount) }}</span> FLUX to address<br>
                <h5
                  class="text-wrap ml-auto mr-auto text-warning"
                  style="width: 25rem;"
                >
                  {{ titanConfig.fundingAddress }}
                </h5>
                with the following message<br>
              </b-card-text>
              <h5
                class="text-wrap ml-auto mr-auto text-warning"
                style="width: 25rem;"
              >
                {{ signatureHash }}
              </h5>
              <div class="d-flex flex-row mt-2">
                <h3 class="col text-center mt-2">
                  Pay with<br>Zelcore
                </h3>
                <a
                  :href="`zel:?action=pay&coin=zelcash&address=${titanConfig.fundingAddress}&amount=${stakeAmount}&message=${signatureHash}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png`"
                  class="col"
                >
                  <img
                    class="zelidLogin"
                    src="@/assets/images/zelID.svg"
                    alt="Zel ID"
                    height="100%"
                    width="100%"
                  >
                </a>
              </div>
            </b-card>
          </div>
        </tab-content>
      </form-wizard>
    </b-modal>
  </div>
</template>

<script>
import {
  BAvatar,
  BButton,
  BCard,
  BCardBody,
  // BCardHeader,
  BCardText,
  BCardTitle,
  BCol,
  BFormInput,
  BFormSelect,
  BFormSelectOption,
  BFormSpinbutton,
  BMedia,
  BMediaBody,
  BModal,
  BRow,
  // BTabs,
  // BTab,
  VBModal,
  VBToggle,
  VBTooltip,
} from 'bootstrap-vue';
import {
  FormWizard,
  TabContent,
} from 'vue-form-wizard';
import VuePerfectScrollbar from 'vue-perfect-scrollbar';
import Ripple from 'vue-ripple-directive';
import { useToast } from 'vue-toastification/composition';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';

import 'vue-form-wizard/dist/vue-form-wizard.min.css';

import {
  ref,
  computed,
} from '@vue/composition-api';

import axios from 'axios';

import tierColors from '@/libs/colors';
import DashboardService from '@/services/DashboardService';

const qs = require('qs');
const store = require('store');
const timeoptions = require('@/libs/dateFormat');

export default {
  components: {
    BAvatar,
    BButton,
    BCard,
    BCardBody,
    // BCardHeader,
    BCardText,
    BCardTitle,
    BCol,
    BFormInput,
    BFormSelect,
    BFormSelectOption,
    BFormSpinbutton,
    BMedia,
    BMediaBody,
    BModal,
    BRow,
    // BTabs,
    // BTab,

    FormWizard,
    TabContent,

    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,

    // 3rd Party
    VuePerfectScrollbar,
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
  setup(props, ctx) {
    // Use toast
    const toast = useToast();
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

    const tier = ref('');
    tier.value = props.tier;
    const userZelid = ref('');
    userZelid.value = props.zelid;

    // const apiURL = 'http://192.168.68.144:1234';
    const apiURL = 'http://titantest.runonflux.io:54978';

    const totalReward = ref(0);
    const stakeAmount = ref(200);
    const selectedLockupIndex = ref(0);
    const dataToSign = ref(null);
    const signature = ref(null);
    const signatureHash = ref(null);
    const timestamp = ref(null);
    const websocket = ref(null);
    const stakeRegistered = ref(false);
    const stakeRegisterFailed = ref(false);
    const registeringStake = ref(false);
    const config = computed(() => ctx.root.$store.state.flux.config);
    const selectedStake = ref(null);

    const redeemAmount = ref(0);
    const redeemAddress = ref(null);
    const redeemAddresses = ref(null);
    const requestSent = ref(false);
    const requestFailed = ref(false);
    const sendingRequest = ref(false);

    const indexedTierColors = ref([
      tierColors.cumulus,
      tierColors.nimbus,
      tierColors.stratus,
    ]);

    const backend = () => {
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
          ctx.root.$store.commit('flux/setUserIp', hostname);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += config.value.apiPort;
      }
      const backendURL = store.get('backendURL') || mybackend;
      return backendURL;
    };

    const callbackValue = () => {
      const backendURL = backend();
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

    const initiateSignWS = () => {
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
          ctx.root.$store.commit('flux/setUserIp', hostname);
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
      console.log(wsuri);
      const ws = new WebSocket(wsuri);
      websocket.value = ws;

      ws.onopen = (evt) => { onOpen(evt); };
      ws.onclose = (evt) => { onClose(evt); };
      ws.onmessage = (evt) => { onMessage(evt); };
      ws.onerror = (evt) => { onError(evt); };
    };

    // Variables to control showing dialogs
    const stakeModalShowing = ref(false);
    const confirmStakeDialogCloseShowing = ref(false);
    const confirmStakeDialogFinishShowing = ref(false);
    const paymentDetailsDialogShowing = ref(false);
    const nodeModalShowing = ref(false);
    const redeemModalShowing = ref(false);

    const perfectScrollbarSettings = {
      maxScrollbarLength: 150,
    };

    const nodes = ref([]);
    const totalCollateral = ref(0);
    const myStakes = ref([]);
    const titanConfig = ref();
    const titanStats = ref();
    const nodeCount = ref(0);

    const getRegistrationMessage = async () => {
      const response = await axios.get(`${apiURL}/registermessage`);
      dataToSign.value = response.data;
      timestamp.value = response.data.substr(response.data.length - 13);
      // console.log(dataToSign.value);
    };

    const getRedeemMessage = async () => {
      const response = await axios.get(`${apiURL}/redeemmessage`);
      dataToSign.value = response.data;
      timestamp.value = response.data.substr(response.data.length - 13);
    };

    const checkRedeemAddress = async () => {
      if (!redeemAddress) return false;
      await getRedeemMessage();
      return true;
    };

    const getStats = async () => {
      const response = await axios.get(`${apiURL}/stats`);
      titanStats.value = response.data;
      // console.log(titanStats.value);
    };

    const getSharedNodeList = async () => {
      const response = await axios.get(`${apiURL}/nodes`);
      const allNodes = [];
      totalCollateral.value = 0;
      response.data.forEach((_node) => {
        const node = _node;
        allNodes.push(node);
        totalCollateral.value += node.collateral;
      });
      // console.log(allNodes);
      nodes.value = allNodes;
    };

    const getMyStakes = async (force = false) => {
      if (userZelid.value.length > 0) {
        const response = await axios.get(`${apiURL}/stakes/${userZelid.value}${force ? `?timestamp=${Date.now()}` : ''}`);
        myStakes.value = response.data;
        totalReward.value = (myStakes.value ? myStakes.value.reduce((total, stake) => total + stake.reward, 0) : 0);
      }
    };

    const getNodeCount = async () => {
      const response = await DashboardService.zelnodeCount();
      if (response.data.status === 'error') {
        showToast({
          component: ToastificationContent,
          props: {
            title: response.data.data.message || response.data.data,
            icon: 'InfoIcon',
            variant: 'danger',
          },
        });
        return 0;
      }
      const fluxNodesData = response.data.data;
      return fluxNodesData['stratus-enabled'];
    };

    const calcAPR = (lockup) => {
      const fluxPerReward = (22.5 * (100 - lockup.fee)) / 100;
      const collateral = 40000;
      const blocksPerDay = 720;
      const numStratusNodes = nodeCount.value;
      const payoutFrequency = numStratusNodes / blocksPerDay;
      const fluxPerMonth = (30 / payoutFrequency) * fluxPerReward;
      const rewardPerSeat = (fluxPerMonth / collateral);
      const rewardPerYear = (rewardPerSeat * 12);
      const apr = ((1 + rewardPerYear / 12) ** 12) - 1;
      return apr;
    };

    const fetchData = async () => {
      nodeCount.value = await getNodeCount();
      console.log(nodeCount.value);
      const response = await axios.get(`${apiURL}/config`);
      // console.log(response.data);
      titanConfig.value = response.data;
      titanConfig.value.lockups.forEach((lockup) => {
        // eslint-disable-next-line no-param-reassign
        lockup.apr = calcAPR(lockup);
      });
      getSharedNodeList();
      getStats();
      getMyStakes();
    };
    fetchData();

    console.log('Setting up refresh interval');
    setInterval(() => {
      fetchData();
    }, 10 * 60 * 1000);

    const showStakeDialog = () => {
      stakeModalShowing.value = true;
      stakeRegistered.value = false;
      stakeRegisterFailed.value = false;
      registeringStake.value = false;
      stakeAmount.value = 50;
      selectedLockupIndex.value = 0;
      signature.value = null;
      signatureHash.value = null;
    };

    const confirmStakeDialogFinish = () => {
      confirmStakeDialogFinishShowing.value = true;
      getMyStakes(true);
    };

    const confirmStakeDialogCancel = (modalEvt) => {
      modalEvt.preventDefault();
      confirmStakeDialogCloseShowing.value = true;
    };

    const selectLockup = (lockupIndex) => {
      selectedLockupIndex.value = lockupIndex;
    };

    const showNodeInfoDialog = () => {
      nodeModalShowing.value = true;
    };

    const showRedeemDialog = () => {
      const addresses = [];
      myStakes.value.forEach((stake) => {
        if (stake.address && !addresses.some((address) => address.text === stake.address)) {
          addresses.push({
            value: stake.uuid,
            text: stake.address,
          });
        }
      });
      redeemAmount.value = titanConfig.value.redeemFee;
      redeemAddress.value = null;
      redeemAddresses.value = addresses;
      dataToSign.value = null;
      signature.value = null;
      sendingRequest.value = false;
      requestSent.value = false;
      requestFailed.value = false;
      redeemModalShowing.value = true;
    };

    const confirmRedeemDialogFinish = () => {
      redeemModalShowing.value = false;
    };

    const showPaymentDetailsDialog = (stake) => {
      // console.log(`show payment details ${stake}`);
      selectedStake.value = stake;
      paymentDetailsDialogShowing.value = true;
    };

    const registerStake = async () => {
      registeringStake.value = true;
      const zelidauthHeader = localStorage.getItem('zelidauth');
      const data = {
        amount: stakeAmount.value,
        lockup: titanConfig.value.lockups[selectedLockupIndex.value],
        timestamp: timestamp.value,
        signature: signature.value,
        data: dataToSign.value,
      };
      showToast('info', 'Registering Stake with Titan...');

      const axiosConfig = {
        headers: {
          zelidauth: zelidauthHeader,
          backend: backend(), // include the backend URL, so the titan backend can communicate with the same FluxOS instance
        },
      };
      const response = await axios.post(`${apiURL}/register`, data, axiosConfig).catch((error) => {
        console.log(error);
        stakeRegisterFailed.value = true;
        showToast('danger', error.message || error);
      });

      console.log(response.data);
      if (response && response.data && response.data.status === 'success') {
        stakeRegistered.value = true;
        signatureHash.value = response.data.hash;
        showToast('success', response.data.message || response.data);
      } else {
        stakeRegisterFailed.value = true;
        showToast('danger', response.data.message || response.data);
      }
    };

    const toFixedLocaleString = (number, digits = 0) => {
      const roundedDown = Math.floor(number * (10 ** digits)) / (10 ** digits);
      return roundedDown.toLocaleString();
    };

    const requestRedeem = async () => {
      // sendingRequest.value = true;
      const zelidauthHeader = localStorage.getItem('zelidauth');
      const data = {
        amount: totalReward.value,
        stake: redeemAddress.value,
        timestamp: timestamp.value,
        signature: signature.value,
        data: dataToSign.value,
      };
      console.log(data);

      showToast('info', 'Sending redeem request to Titan...');

      const axiosConfig = {
        headers: {
          zelidauth: zelidauthHeader,
          backend: backend(), // include the backend URL, so the titan backend can communicate with the same FluxOS instance
        },
      };
      const response = await axios.post(`${apiURL}/redeem`, data, axiosConfig).catch((error) => {
        console.log(error);
        requestFailed.value = true;
        showToast('danger', error.message || error);
      });

      console.log(response.data);
      if (response && response.data && response.data.status === 'success') {
        requestSent.value = true;
        showToast('success', response.data.message || response.data);
        fetchData();
      } else {
        requestFailed.value = true;
        showToast('danger', response.data.message || response.data);
      }
    };

    const calcMonthlyReward = (stake) => {
      const lockup = titanConfig.value.lockups.find((aLockup) => aLockup.fee === stake.fee);
      return ((stake.collateral) * lockup.apr) / 12;
    };

    const visitNode = (node) => {
      window.open(`http://${node.address}`, '_blank');
    };

    const checkDuration = async () => {
      await getRegistrationMessage();
      return selectedLockupIndex.value >= 0 && selectedLockupIndex.value < titanConfig.value.lockups.length;
    };

    const redeemAmountState = () => {
      console.log(redeemAmount.value);
      const amount = parseFloat(redeemAmount.value);
      console.log(amount);
      console.log(totalReward.value);
      return amount > titanConfig.value.redeemFee && amount <= parseFloat(toFixedLocaleString(totalReward.value, 2));
    };

    const formatPaymentTooltip = (stake) => `Send a payment of ${stake.collateral} Flux to<br>${titanConfig.nodeAddress}<br>with a message<br>${stake.signatureHash}`;

    return {

      // UI
      perfectScrollbarSettings,

      timeoptions,

      nodes,
      totalCollateral,
      myStakes,
      totalReward,
      titanConfig,
      titanStats,

      userZelid,
      signature,
      signatureHash,
      dataToSign,
      callbackValue,
      initiateSignWS,
      timestamp,

      getMyStakes,

      calcAPR,
      calcMonthlyReward,

      toFixedLocaleString,
      formatPaymentTooltip,

      showNodeInfoDialog,
      nodeModalShowing,
      visitNode,

      stakeModalShowing,
      showStakeDialog,
      stakeAmount,
      stakeRegistered,
      stakeRegisterFailed,
      selectedLockupIndex,
      selectLockup,
      registeringStake,
      registerStake,
      checkDuration,
      getRegistrationMessage,

      confirmStakeDialogCancel,
      confirmStakeDialogCloseShowing,
      confirmStakeDialogFinish,
      confirmStakeDialogFinishShowing,

      showPaymentDetailsDialog,
      paymentDetailsDialogShowing,
      selectedStake,

      showRedeemDialog,
      redeemModalShowing,
      redeemAmount,
      redeemAddress,
      redeemAddresses,
      redeemAmountState,
      getRedeemMessage,
      checkRedeemAddress,
      sendingRequest,
      requestSent,
      requestFailed,
      requestRedeem,
      confirmRedeemDialogFinish,

      tierColors,
      indexedTierColors,
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
.payment-details-card {
  height: 375px;
}
.node-status {
  margin-right: 0px;
  margin-left: 0;
}
.stakes-title {
  margin-left: 10px;
  margin-top: 10px;
}
.seat-column {
  padding-left: 0;
  padding-right: 0;
}

.stakeAmountSpinner {
  font-size: 40px;
  width: 250px;
  margin-left: auto;
  margin-right: auto;
  margin-top: 2rem;
}

.selectedLockupButton {
  border-color: red !important;
  border: 5px solid;
  height: 60px;
  width: 300px;
  font-size: 20px;
}

.unselectedLockupButton {
  border-color: transparent;
  border: 0px solid;
  height: 60px;
  width: 300px;
  font-size: 20px;
}

.active-node-value {
  font-size: 7em;
  text-align: center;
  padding-bottom: 1.5rem;
}
.shared-node-info-title {
  padding: 1.5rem;
}
.shared-node-info-body {
  padding-top: 0;
  padding-bottom: 0.3rem;
}

.lockup {
  margin-bottom: 0.5rem;
}

</style>
<style lang="scss">
  @import '@core/scss/vue/libs/vue-wizard.scss';
</style>
