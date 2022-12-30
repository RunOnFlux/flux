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
                    rel
                  >
                    {{ foundationAddress }}
                  </b-link>
                  with the following message:
                  <br><br>
                  {{ registrationHash }}
                  <br><br>
                  The transaction must be mined by {{ new Date(validTill).toLocaleString('en-GB', timeoptions) }}
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
                  <div>
                    <a
                      :href="'zel:?action=pay&coin=zelcash&address=' + foundationAddress + '&amount=' + proposalPrice + '&message=' + registrationHash + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png'"
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
} from 'bootstrap-vue';
import VuePerfectScrollbar from 'vue3-perfect-scrollbar';
import Ripple from 'vue-ripple-directive';
import { useToast } from 'vue-toastification';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';

import axios from 'axios';
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

    const getXdaoPrice = async () => {
      const response = await axios.get('https://stats.runonflux.io/proposals/price');
      console.log(response);
      if (response.data.status === 'success') {
        proposalPrice.value = response.data.data;
      } else {
        showToast('danger', response.data.data.message || response.data.data);
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
