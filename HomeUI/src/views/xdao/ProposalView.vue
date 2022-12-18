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
            @click="$emit('close-proposal-view')"
          />
        </span>
        <h4 class="proposal-topic mb-0">
          {{ proposalViewData.topic }}
        </h4>
      </div>

      <!-- Header: Right -->
      <!-- <div class="proposal-header-right ml-2 pl-1">

        <feather-icon
          :icon="$store.state.appConfig.isRTL ? 'ChevronRightIcon' : 'ChevronLeftIcon'"
          size="17"
          class="ml-75 cursor-pointer"
          :class="{'text-muted pointer-events-none': !hasPreviousProposal}"
          @click="$emit('change-opened-proposal', 'previous')"
        />

        <feather-icon
          :icon="$store.state.appConfig.isRTL ? 'ChevronLeftIcon' : 'ChevronRightIcon'"
          size="17"
          class="ml-75 cursor-pointer"
          :class="{'text-muted pointer-events-none': !hasNextProposal}"
          @click="$emit('change-opened-proposal', 'next')"
        />
      </div> -->
    </div>

    <!-- Email Details -->
    <vue-perfect-scrollbar
      :settings="perfectScrollbarSettings"
      class="proposal-scroll-area scroll-area"
    >
      <b-card :title="`Proposed By ${proposalViewData.nickName}`">
        <b-form-textarea
          id="textarea-rows"
          rows="10"
          readonly
          :value="proposalViewData.description"
          class="description-text"
        />
      </b-card>
      <b-row class="mt-1 match-height">
        <b-col
          xxl="4"
          lg="12"
        >
          <b-card title="Status">
            <div class="text-center badge-wrapper mr-1">
              <b-badge
                pill
                :variant="`light-${resolveTagVariant(proposalViewData.status)}`"
                class="text-uppercase"
              >
                {{ proposalViewData.status }}
              </b-badge>
            </div>
          </b-card>
        </b-col>
        <b-col
          xxl="4"
          md="6"
          sm="12"
        >
          <b-card title="Start Date">
            <p class="text-center date">
              {{ new Date(Number(proposalViewData.submitDate)).toLocaleString("en-GB", timeoptions.shortDate) }}
            </p>
          </b-card>
        </b-col>
        <b-col
          xxl="4"
          md="6"
          sm="12"
        >
          <b-card title="End Date">
            <p class="text-center date">
              {{ new Date(Number(proposalViewData.voteEndDate)).toLocaleString("en-GB", timeoptions.shortDate) }}
            </p>
          </b-card>
        </b-col>
      </b-row>
      <b-row class="match-height">
        <b-col lg="6">
          <b-card no-body>
            <b-card-header>
              <h4 class="mb-0">
                Vote Overview
              </h4>
            </b-card-header>
            <!-- apex chart -->
            <vue-apex-charts
              type="radialBar"
              height="200"
              :options="voteOverviewRadialBar"
              :series="voteOverview.series"
            />
            <b-row class="text-center mx-0">
              <b-col
                cols="6"
                class="border-top border-right d-flex align-items-between flex-column py-1"
              >
                <b-card-text class="text-muted mb-0">
                  Required
                </b-card-text>
                <h3 class="font-weight-bolder mb-0">
                  {{ Number(proposalViewData.votesRequired).toLocaleString() }}
                </h3>
              </b-col>

              <b-col
                cols="6"
                class="border-top d-flex align-items-between flex-column py-1"
              >
                <b-card-text class="text-muted mb-0">
                  Received
                </b-card-text>
                <h3 class="font-weight-bolder mb-0">
                  {{ Number(proposalViewData.votesTotal).toLocaleString() }}
                </h3>
              </b-col>
            </b-row>
          </b-card>
        </b-col>
        <b-col lg="6">
          <b-card no-body>
            <b-card-header>
              <h4 class="mb-0">
                Vote Breakdown
              </h4>
            </b-card-header>
            <!-- apex chart -->
            <vue-apex-charts
              type="radialBar"
              height="200"
              :options="voteBreakdownRadialBar"
              :series="voteBreakdown.series"
            />
            <b-row class="text-center mx-0">
              <b-col
                cols="6"
                class="border-top border-right d-flex align-items-between flex-column py-1"
              >
                <b-card-text class="text-muted mb-0">
                  Yes
                </b-card-text>
                <h3 class="font-weight-bolder mb-0 text-success">
                  {{ Number(proposalViewData.votesYes).toLocaleString() }}
                </h3>
              </b-col>

              <b-col
                cols="6"
                class="border-top d-flex align-items-between flex-column py-1"
              >
                <b-card-text class="text-muted mb-0">
                  No
                </b-card-text>
                <h3 class="font-weight-bolder mb-0 text-danger">
                  {{ Number(proposalViewData.votesNo).toLocaleString() }}
                </h3>
              </b-col>
            </b-row>
          </b-card>
        </b-col>
      </b-row>
      <b-row class="match-height">
        <b-col lg="6">
          <b-card title="Grant Amount">
            <div class="text-center badge-wrapper mr-1">
              <b-badge
                pill
                :variant="`light-primary`"
                class="text-uppercase"
              >
                {{ Number(proposalViewData.grantValue).toLocaleString() }} FLUX
              </b-badge>
            </div>
          </b-card>
        </b-col>
        <b-col lg="6">
          <b-card title="Grant Address">
            <div class="text-center badge-wrapper mr-1">
              <h4>
                <b-link
                  :href="`https://explorer.runonflux.io/address/${proposalViewData.grantAddress}`"
                  target="_blank"
                  active-class="primary"
                  rel
                >
                  {{ proposalViewData.grantAddress }}
                </b-link>
              </h4>
            </div>
          </b-card>
        </b-col>
      </b-row>
      <div v-if="proposalViewData.status === 'Open'">
        <b-row
          v-if="!haveVoted"
          class="match-height"
        >
          <b-col
            xl="3"
            md="5"
          >
            <b-card title="Vote Now!">
              <p>You haven't voted yet! You have a total of {{ myNumberOfVotes }} available.</p>
              <div>
                <p>
                  To vote you need to first sign a message with Zelcore with your ZelID corresponding to your Flux Nodes.
                </p>
                <div>
                  <a
                    :href="'zel:?action=sign&message=' + dataToSign + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=' + callbackValueSign()"
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
                </div>
              </div>
            </b-card>
          </b-col>
          <b-col
            xl="5"
            md="7"
          >
            <b-card>
              <b-row class="mt-2">
                <b-col
                  cols="12"
                  class="mb-1"
                >
                  <b-form-group
                    label="Message"
                    label-for="h-message"
                    label-cols-md="3"
                  >
                    <b-form-input
                      id="h-message"
                      v-model="dataToSign"
                      readonly
                      placeholder="Message to Sign"
                    />
                  </b-form-group>
                </b-col>
                <b-col
                  cols="12"
                  class="mb-1"
                >
                  <b-form-group
                    label="Address"
                    label-for="h-address"
                    label-cols-md="3"
                  >
                    <b-form-input
                      id="h-address"
                      v-model="userZelid"
                      placeholder="Insert ZelID"
                    />
                  </b-form-group>
                </b-col>
                <b-col
                  cols="12"
                  class="mb-1"
                >
                  <b-form-group
                    label="Signature"
                    label-for="h-signature"
                    label-cols-md="3"
                  >
                    <b-form-input
                      id="h-signature"
                      v-model="signature"
                      placeholder="Insert Signature"
                    />
                  </b-form-group>
                </b-col>
              </b-row>
            </b-card>
          </b-col>
          <b-col
            xl="4"
            md="12"
          >
            <b-card class="text-center">
              <p>Remember, you can't change your vote! After voting it could take around 5 minutes to see the number of votes updated with your vote.</p>
              <div id="vote-yes-button">
                <b-button
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="success"
                  size="lg"
                  pill
                  class="vote-button d-block mt-2"
                  :disabled="!signature ? true : false"
                  @click="vote(true)"
                >
                  YES
                </b-button>
              </div>
              <b-tooltip
                ref="tooltip"
                :disabled="signature ? true : false"
                target="vote-yes-button"
              >
                <span>Please enter a Signature</span>
              </b-tooltip>
              <div id="vote-no-button">
                <b-button
                  v-ripple.400="'rgba(255, 255, 255, 0.15)'"
                  variant="danger"
                  size="lg"
                  pill
                  class="vote-button d-block mt-2"
                  :disabled="!signature ? true : false"
                  @click="vote(false)"
                >
                  NO
                </b-button>
              </div>
              <b-tooltip
                ref="tooltip"
                :disabled="signature ? true : false"
                target="vote-no-button"
              >
                <span>Please enter a Signature</span>
              </b-tooltip>
            </b-card>
          </b-col>
        </b-row>
        <b-row v-else>
          <b-col cols="12">
            <b-card title="Your Vote">
              <div class="text-center badge-wrapper mr-1">
                <b-badge
                  pill
                  :variant="`light-${myVote === 'No' ? 'danger' : 'success'}`"
                  class="vote-badge"
                >
                  {{ myVote.toUpperCase() }} x{{ myNumberOfVotes }}
                </b-badge>
              </div>
            </b-card>
          </b-col>
        </b-row>
      </div>
    </vue-perfect-scrollbar>
  </div>
</template>

<script>
import { computed } from 'vue';
import {
  BBadge,
  BButton,
  BCard,
  BCardHeader,
  BCardText,
  BCol,
  BFormGroup,
  BFormInput,
  BFormTextarea,
  BLink,
  BRow,
  BTooltip,
} from 'bootstrap-vue';
import useAppConfig from '@core/app-config/useAppConfig';
import VuePerfectScrollbar from 'vue3-perfect-scrollbar';
import VueApexCharts from 'vue3-apexcharts';
import Ripple from 'vue-ripple-directive';
import { useToast } from 'vue-toastification';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';

import { $themeColors } from '@themeConfig';

const axios = require('axios');
import qs from 'qs';
import store from 'store';
const timeoptions = require('@/libs/dateFormat');

export default {
  components: {
    BBadge,
    BButton,
    BCard,
    BCardHeader,
    BCardText,
    BCol,
    BFormGroup,
    BFormInput,
    BFormTextarea,
    BLink,
    BRow,
    BTooltip,

    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,

    // 3rd Party
    VuePerfectScrollbar,
    VueApexCharts,
  },
  directives: {
    Ripple,
  },
  props: {
    proposalViewData: {
      type: Object,
      required: true,
    },
    zelid: {
      type: String,
      required: false,
      default: '',
    },
    hasNextProposal: {
      type: Boolean,
      required: true,
    },
    hasPreviousProposal: {
      type: Boolean,
      required: true,
    },
  },
  setup(props, ctx) {
    const config = computed(() => ctx.root.$store.state.flux.config);

    // Use toast
    const toast = useToast();

    const resolveTagVariant = (status) => {
      if (status === 'Open') return 'warning';
      if (status === 'Passed') return 'success';
      if (status === 'Unpaid') return 'info';
      if (status && status.startsWith('Rejected')) return 'danger';
      return 'primary';
    };

    const getMessagePhrase = async () => {
      const response = await axios.get('https://stats.runonflux.io/general/messagephrase');
      if (response.data.status === 'success') {
        return response.data.data;
      }
      return false;
    };

    const {
      xdaoOpenProposals,
    } = useAppConfig();

    const myNumberOfVotes = ref(0);
    const dataToSign = ref('');
    const myVote = ref('No');
    const haveVoted = ref(false);
    const signature = ref(null);
    const userZelid = ref('');
    userZelid.value = props.zelid;

    const hasSignature = computed(() => signature.value !== null);

    const loadVotePower = async () => {
      let url = `https://stats.runonflux.io/proposals/votepower?zelid=${userZelid.value}`;
      if (props.proposalViewData.hash) {
        url = `https://stats.runonflux.io/proposals/votepower?zelid=${userZelid.value}&hash=${props.proposalViewData.hash}`;
      }
      const responseApi = await axios.get(url);
      console.log(responseApi);
      if (responseApi.data.status === 'success') {
        myNumberOfVotes.value = responseApi.data.data.power;
      } else {
        // vue.$customMes.error(responseApi.data.data.message || responseApi.data.data)
        myNumberOfVotes.value = 0;
      }
    };

    const getVoteInformation = async () => {
      const response = await axios.get(`https://stats.runonflux.io/proposals/voteInformation?hash=${props.proposalViewData.hash}&zelid=${userZelid.value}`);
      return response.data;
    };

    const loadVotes = async () => {
      if (userZelid.value) {
        myNumberOfVotes.value = 0;
        const voteInformation = await getVoteInformation();
        if (voteInformation.status === 'success') {
          const votesInformation = voteInformation.data;
          if (props.proposalViewData.status === 'Open') {
            if (votesInformation == null || votesInformation.length === 0) {
              await loadVotePower();
              haveVoted.value = false;
              // dataToSign.value = await getMessagePhrase()
            } else {
              votesInformation.forEach((vote) => {
                myNumberOfVotes.value += vote.numberOfVotes;
              });
              myVote.value = 'No';
              if (votesInformation[0].vote) {
                myVote.value = 'Yes';
              }
              haveVoted.value = true;
            }
          }
        } else {
          // vue.$customMes.error(voteInformation.data.message || voteInformation.data);
        }
      }
    };

    const callbackValueSign = () => {
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
          ctx.root.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          ctx.root.$store.commit('flux/setFluxPort', apiPort);
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
    const onOpen = (evt) => {
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

    const initiateSignWS = () => {
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
          ctx.root.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          ctx.root.$store.commit('flux/setFluxPort', apiPort);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += config.value.apiPort;
      }
      let backendURL = store.get('backendURL') || mybackend;
      backendURL = backendURL.replace('https://', 'wss://');
      backendURL = backendURL.replace('http://', 'ws://');
      const signatureMessage = userZelid.value + dataToSign.value.slice(-13);
      const wsuri = `${backendURL}/ws/sign/${signatureMessage}`;
      const websocket = new WebSocket(wsuri);
      // const websocket = websocket

      websocket.onopen = (evt) => { onOpen(evt); };
      websocket.onclose = (evt) => { onClose(evt); };
      websocket.onmessage = (evt) => { onMessage(evt); };
      websocket.onerror = (evt) => { onError(evt); };
    };

    const getProposalDetails = async () => {
      dataToSign.value = await getMessagePhrase();
      loadVotes();
    };

    const perfectScrollbarSettings = {
      maxScrollbarLength: 150,
    };

    const voteOverview = ref({
      series: [],
    });
    const voteBreakdown = ref({
      series: [],
    });

    watch(() => props.proposalViewData, () => {
      console.log(props.proposalViewData);
      voteOverview.value = {
        series: [((props.proposalViewData.votesTotal / props.proposalViewData.votesRequired) * 100).toFixed(1)],
      };
      if (props.proposalViewData.votesTotal !== 0) {
        voteBreakdown.value = {
          series: [((props.proposalViewData.votesYes / (props.proposalViewData.votesTotal)) * 100).toFixed(0)],
        };
      } else {
        voteBreakdown.value = {
          series: [0],
        };
      }
      getProposalDetails();
    });

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

    const vote = async (voteType) => {
      const data = {
        hash: props.proposalViewData.hash,
        zelid: userZelid.value,
        message: dataToSign.value,
        signature: signature.value,
        vote: voteType,
      };
      console.log(data);
      const response = await axios.post('https://stats.runonflux.io/proposals/voteproposal', JSON.stringify(data));
      console.log(response);
      if (response.data.status === 'success') {
        showToast('success', 'Vote registered successfully');
        myVote.value = voteType ? 'Yes' : 'No';
        haveVoted.value = true;
        // Decrement the menu badge value
        xdaoOpenProposals.value -= 1;
      } else {
        showToast('danger', response.data.data.message || response.data.data);
      }
    };

    const voteOverviewRadialBar = {
      chart: {
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
      },
      colors: [$themeColors.primary],
      plotOptions: {
        radialBar: {
          offsetY: -10,
          startAngle: -150,
          endAngle: 150,
          hollow: {
            size: '77%',
          },
          track: {
            background: $themeColors.dark,
            strokeWidth: '70%',
          },
          dataLabels: {
            name: {
              show: false,
            },
            value: {
              color: $themeColors.light,
              fontSize: '2.3rem',
              fontWeight: '600',
            },
          },
        },
      },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'horizontal',
          shadeIntensity: 0.5,
          gradientToColors: [$themeColors.success],
          inverseColors: true,
          opacityFrom: 1,
          opacityTo: 1,
          stops: [0, 100],
        },
      },
      stroke: {
        lineCap: 'round',
      },
      grid: {
        padding: {
          bottom: 30,
        },
      },
    };
    const voteBreakdownRadialBar = {
      chart: {
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
      },
      colors: [$themeColors.primary],
      labels: ['Yes'],
      plotOptions: {
        radialBar: {
          offsetY: -10,
          startAngle: -150,
          endAngle: 150,
          hollow: {
            size: '77%',
          },
          track: {
            background: $themeColors.dark,
            strokeWidth: '50%',
          },
          dataLabels: {
            name: {
              offsetY: -15,
              color: $themeColors.light,
              fontSize: '1.5rem',
            },
            value: {
              offsetY: 10,
              color: $themeColors.light,
              fontSize: '2.86rem',
              fontWeight: '600',
            },
          },
        },
      },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'horizontal',
          shadeIntensity: 0.5,
          gradientToColors: [$themeColors.success],
          inverseColors: true,
          opacityFrom: 1,
          opacityTo: 1,
          stops: [0, 100],
        },
      },
      stroke: {
        lineCap: 'round',
      },
      grid: {
        padding: {
          bottom: 30,
        },
      },
    };

    return {

      // UI
      perfectScrollbarSettings,
      voteOverviewRadialBar,
      voteBreakdownRadialBar,
      resolveTagVariant,

      // useEmail
      // resolveLabelColor,
      timeoptions,
      voteOverview,
      voteBreakdown,
      vote,

      initiateSignWS,
      callbackValueSign,

      myVote,
      haveVoted,
      myNumberOfVotes,
      dataToSign,
      signature,
      hasSignature,

      onError,
      onOpen,
      onClose,
      onMessage,

      userZelid,
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
