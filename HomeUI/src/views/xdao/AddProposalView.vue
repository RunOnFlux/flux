<template>
  <div class="proposal-details">
    <!-- Email Header -->
    <div class="proposal-detail-header">
      <!-- Header: Left -->
      <div class="proposal-header-left d-flex align-items-center">
        <span class="go-back mr-1">
          <feather-icon
            :icon="$store.state.appConfig.isRTL ? 'ChevronRightIcon' : 'ChevronLeftIcon'"
            size="20"
            class="align-bottom"
            @click="$emit('close-add-proposal-view')"
          />
        </span>
        <h4 class="proposal-topic mb-0">
          Add Proposal
        </h4>
      </div>
    </div>

    <!-- Email Details -->
    <vue-perfect-scrollbar
      :settings="perfectScrollbarSettings"
      class="proposal-scroll-area scroll-area mt-2"
    >
      <b-row class="match-height">
        <b-col
          xl="6"
          md="12"
        >
          <b-card title="Topic">
            <b-form-input
              v-model="proposalTopic"
              placeholder="Proposal Topic"
              class="mt-4"
            />
          </b-card>
        </b-col>
        <b-col
          xl="6"
          md="12"
        >
          <b-card title="Grant">
            <b-form-group
              label-cols="4"
              label="Grant Amount"
              label-for="grantAmount"
            >
              <b-form-input
                id="grantAmount"
                v-model="proposalGrantValue"
                placeholder=""
              />
            </b-form-group>
            <b-form-group
              label-cols="4"
              label="Grant Pay to Address"
              label-for="grantAddress"
            >
              <b-form-input
                id="grantAddress"
                v-model="proposalGrantAddress"
                placeholder="Flux Address to Receive Grant"
              />
            </b-form-group>
          </b-card>
        </b-col>
      </b-row>
      <b-row class="match-height">
        <b-col cols="12">
          <b-card title="Description">
            <b-form-textarea
              v-model="proposalDescription"
              placeholder="Proposal Description"
              rows="8"
            />
          </b-card>
        </b-col>
      </b-row>
      <b-row class="match-height">
        <b-col
          xl="6"
          md="12"
        >
          <b-card title="Name/Nickname">
            <b-form-input
              v-model="proposalNickName"
              placeholder="Name/Nickname of Proposal Owner"
              class="mt-2"
            />
          </b-card>
        </b-col>
        <b-col
          xl="6"
          md="12"
        >
          <b-card
            title="Validate"
          >
            <div class="text-center">
              <b-button
                v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                variant="primary"
                pill
                size="lg"
                :disabled="proposalValid"
                @click="validateProposal"
              >
                Validate Proposal
              </b-button>
            </div>
          </b-card>
        </b-col>
      </b-row>
      <b-row v-if="proposalValid">
        <b-col cols="12">
          <b-card title="Register Proposal">
            <div class="text-center">
              <h4>Proposal Price: {{ proposalPrice }} FLUX</h4>
              <b-button
                v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                variant="primary"
                pill
                size="lg"
                @click="register"
              >
                Register Flux XDAO Proposal
              </b-button>
            </div>
          </b-card>
        </b-col>
      </b-row>
      <b-row v-if="proposalValid && registrationHash">
        <b-col cols="12">
          <b-card title="Complete Transaction">
            <b-row>
              <b-col
                xl="6"
                md="12"
              >
                <div class="text-center">
                  To finish registration, please make a transaction of {{ proposalPrice }} Flux to address
                  <b-link
                    :href="`https://explorer.runonflux.io/address/${foundationAddress}`"
                    target="_blank"
                    active-class="primary"
                    rel="noopener noreferrer"
                  >
                    {{ foundationAddress }}
                  </b-link>
                  with the following message:
                  <br><br>
                  {{ registrationHash }}
                  <br><br>
                  The transaction must be sent by {{ new Date(validTill).toLocaleString('en-GB', timeoptions) }}
                </div>
              </b-col>
              <b-col
                xl="6"
                md="12"
              >
                <div class="text-center">
                  <p>
                    Pay with Zelcore
                  </p>
                  <div v-if="!paymentLoading && !paymentReceived">
                    <a
                      @click="initZelcore"
                    >
                      <img
                        class="zelidLogin"
                        src="@/assets/images/FluxID.svg"
                        alt="Flux ID"
                        height="100%"
                        width="100%"
                      >
                    </a>
                  </div>
                  <div v-if="paymentLoading">
                    <b-spinner
                      variant="primary"
                      label="Loading..."
                      style="width: 3rem; height: 3rem;"
                    />
                    <p class="mt-2">
                      Waiting for payment confirmation...
                    </p>
                  </div>
                  <div
                    v-if="paymentReceived"
                    class="text-success"
                  >
                    <feather-icon
                      icon="CheckCircleIcon"
                      size="48"
                      class="text-success"
                    />
                    <p class="mt-2">
                      Payment Received!
                    </p>
                    <p class="small">
                      Transaction ID: {{ transactionId }}
                    </p>
                  </div>
                </div>
              </b-col>
            </b-row>
          </b-card>
        </b-col>
      </b-row>
    </vue-perfect-scrollbar>
  </div>
</template>

<script>
import {
  BButton,
  BCard,
  BCol,
  BFormGroup,
  BFormInput,
  BFormTextarea,
  BLink,
  BRow,
  BSpinner,
} from 'bootstrap-vue';
import VuePerfectScrollbar from 'vue-perfect-scrollbar';
import Ripple from 'vue-ripple-directive';
import { useToast } from 'vue-toastification/composition';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';

import {
  ref,
} from 'vue';

const axios = require('axios');
const qs = require('qs');
const store = require('store');
const timeoptions = require('@/libs/dateFormat');

export default {
  components: {
    BButton,
    BCard,
    BCol,
    BFormGroup,
    BFormInput,
    BFormTextarea,
    BLink,
    BRow,
    BSpinner,

    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,

    // 3rd Party
    VuePerfectScrollbar,
  },
  directives: {
    Ripple,
  },
  props: {
    zelid: {
      type: String,
      required: false,
      default: '',
    },
  },
  setup() {
    // Use toast
    const toast = useToast();

    const proposalTopic = ref('');
    const proposalDescription = ref('');
    const proposalGrantValue = ref(0);
    const proposalGrantAddress = ref('');
    const proposalNickName = ref('');

    const proposalValid = ref(false);

    const proposalPrice = ref(500);

    const registrationHash = ref(null);
    const foundationAddress = ref('');
    const validTill = ref(0);

    // Payment-related properties
    const paymentId = ref('');
    const paymentLoading = ref(false);
    const paymentReceived = ref(false);
    const transactionId = ref('');
    const paymentWebsocket = ref(null);

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

    const getBackendURL = () => {
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
        mybackend += hostname;
        mybackend += ':';
        const apiPort = +port > 16100 ? +port + 1 : 16127;
        mybackend += apiPort;
      }
      return store.get('backendURL') || mybackend;
    };

    const paymentCallbackValue = () => {
      const backendURL = getBackendURL();
      const url = `${backendURL}/payment/verifypayment?paymentid=${paymentId.value}`;
      return encodeURI(url);
    };

    // Payment WebSocket handlers
    const onPaymentError = (evt) => {
      console.log('Payment WebSocket error:', evt);
      paymentLoading.value = false;
    };

    const onPaymentMessage = (evt) => {
      const data = qs.parse(evt.data);
      console.log('Payment WebSocket message:', data);

      if (data.status === 'success' && data.data) {
        const paymentData = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
        transactionId.value = paymentData.txid;
        paymentReceived.value = true;
        paymentLoading.value = false;
        showToast('success', `Payment received! Transaction ID: ${transactionId.value}`);
      } else if (data.status === 'error') {
        paymentLoading.value = false;
        const errorMsg = typeof data.data === 'string' ? data.data : (data.data?.message || data.message || 'Payment request expired or invalid');
        showToast('danger', errorMsg);
      }
    };

    const onPaymentClose = (evt) => {
      console.log('Payment WebSocket closed:', evt);
      if (!paymentReceived.value) {
        paymentLoading.value = false;
      }
    };

    const onPaymentOpen = (evt) => {
      console.log('Payment WebSocket opened:', evt);
    };

    const initiatePaymentWS = () => {
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
        mybackend += hostname;
        mybackend += ':';
        const apiPort = +port > 16100 ? +port + 1 : 16127;
        mybackend += apiPort;
      }
      let backendURL = store.get('backendURL') || mybackend;
      // Convert HTTP/HTTPS to WebSocket protocol
      backendURL = backendURL.replace('https://', 'wss://');
      backendURL = backendURL.replace('http://', 'ws://');
      const wsuri = `${backendURL}/ws/payment/${paymentId.value}`;
      const websocketConn = new WebSocket(wsuri);
      paymentWebsocket.value = websocketConn;

      websocketConn.onopen = onPaymentOpen;
      websocketConn.onclose = onPaymentClose;
      websocketConn.onmessage = onPaymentMessage;
      websocketConn.onerror = onPaymentError;
    };

    const getXdaoPrice = async () => {
      const response = await axios.get('https://stats.runonflux.io/proposals/price');
      console.log(response);
      if (response.data.status === 'success') {
        proposalPrice.value = response.data.data;
      } else {
        showToast('danger', response.data.data.message || response.data.data);
      }
    };

    const initZelcore = async () => {
      try {
        paymentLoading.value = true;
        paymentReceived.value = false;
        transactionId.value = '';

        // Request a payment ID from the backend
        const backendURL = getBackendURL();

        const paymentResponse = await axios.get(`${backendURL}/payment/paymentrequest`);
        if (paymentResponse.data.status !== 'success') {
          throw new Error('Failed to create payment request');
        }

        paymentId.value = paymentResponse.data.data.paymentId;

        // Set up WebSocket connection for payment confirmation
        initiatePaymentWS();

        // Build ZelCore protocol URL with callback
        const protocol = `zel:?action=pay&coin=zelcash&address=${foundationAddress.value}&amount=${proposalPrice.value}&message=${registrationHash.value}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png&callback=${paymentCallbackValue()}`;

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
        paymentLoading.value = false;
        showToast('danger', error.message || 'Failed to initiate ZelCore payment. Please try again.');
        console.error(error);
      }
    };

    const validateProposal = () => {
      if (proposalTopic.value === '') {
        showToast('danger', 'Proposal Topic is Mandatory');
        return;
      }
      if (proposalDescription.value === '') {
        showToast('danger', 'Proposal Description is Mandatory');
        return;
      }
      if (proposalDescription.value.length < 50) {
        showToast('danger', 'Proposal Description is too short');
        return;
      }
      if (proposalTopic.value.length < 3) {
        showToast('danger', 'Proposal Topic is too short');
        return;
      }
      if (proposalGrantValue.value) {
        const isnum = /^\d+$/.test(proposalGrantValue.value);
        if (isnum === true) {
          if (proposalGrantValue.value > 0 && !proposalGrantAddress.value) {
            showToast('danger', 'Proposal Grant Pay to Address missing');
            return;
          }
        } else {
          showToast('danger', 'Proposal Grant Amount needs to be an Integer Number');
          return;
        }
      }
      if (proposalGrantAddress.value) {
        if (/\s/.test(proposalGrantAddress.value)) {
          showToast('danger', 'Proposal Grant Pay to Address Invalid, white space detected');
          return;
        }
      }
      getXdaoPrice();
      proposalValid.value = true;
    };

    const register = async () => {
      const data = {
        topic: proposalTopic.value,
        description: proposalDescription.value,
        grantValue: proposalGrantValue.value,
        grantAddress: proposalGrantAddress.value,
        nickName: proposalNickName.value,
      };
      const response = await axios.post('https://stats.runonflux.io/proposals/submitproposal', JSON.stringify(data));
      console.log(response);
      if (response.data.status === 'success') {
        foundationAddress.value = response.data.data.address;
        registrationHash.value = response.data.data.hash;
        proposalPrice.value = response.data.data.amount;
        validTill.value = response.data.data.paidTillDate;
      } else {
        showToast('danger', response.data.data.message || response.data.data);
      }
    };

    return {

      // UI
      perfectScrollbarSettings,

      // useEmail
      // resolveLabelColor,
      timeoptions,

      validateProposal,
      proposalTopic,
      proposalDescription,
      proposalGrantValue,
      proposalGrantAddress,
      proposalNickName,
      proposalValid,

      proposalPrice,
      registrationHash,
      validTill,
      foundationAddress,

      // Payment properties
      paymentId,
      paymentLoading,
      paymentReceived,
      transactionId,

      initZelcore,

      register,
    };
  },
};
</script>

<style>

</style>
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
