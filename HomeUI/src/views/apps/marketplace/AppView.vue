<template>
  <div class="app-details">
    <!-- Email Header -->
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
          {{ appData.name }}
        </h4>
      </div>
    </div>

    <!-- Email Details -->
    <vue-perfect-scrollbar
      :settings="perfectScrollbarSettings"
      class="proposal-scroll-area scroll-area"
    >
      <b-card>
        <b-form-textarea
          id="textarea-rows"
          rows="4"
          readonly
          :value="appData.description"
          class="description-text"
        />
      </b-card>
    </vue-perfect-scrollbar>
  </div>
</template>

<script>
import {
  BCard,
  BFormTextarea,
} from 'bootstrap-vue';
import VuePerfectScrollbar from 'vue-perfect-scrollbar';
import Ripple from 'vue-ripple-directive';
import { useToast } from 'vue-toastification/composition';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';

import { $themeColors } from '@themeConfig';

import {
  ref,
  watch,
  computed,
} from '@vue/composition-api';

const axios = require('axios');
const qs = require('qs');
const store = require('store');
const timeoptions = require('@/libs/dateFormat');

export default {
  components: {
    BCard,
    BFormTextarea,

    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,

    // 3rd Party
    VuePerfectScrollbar,
  },
  directives: {
    Ripple,
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
      if (props.appData.hash) {
        url = `https://stats.runonflux.io/proposals/votepower?zelid=${userZelid.value}&hash=${props.appData.hash}`;
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
      const response = await axios.get(`https://stats.runonflux.io/proposals/voteInformation?hash=${props.appData.hash}&zelid=${userZelid.value}`);
      return response.data;
    };

    const loadVotes = async () => {
      if (userZelid.value) {
        myNumberOfVotes.value = 0;
        const voteInformation = await getVoteInformation();
        if (voteInformation.status === 'success') {
          const votesInformation = voteInformation.data;
          if (props.appData.status === 'Open') {
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
      const url = `${backendURL}/zelid/providesign`;
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
      const signatureMessage = userZelid.value + dataToSign.value.substr(dataToSign.value.length - 13);
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

    watch(() => props.appData, () => {
      console.log(props.appData);
      voteOverview.value = {
        series: [((props.appData.votesTotal / props.appData.votesRequired) * 100).toFixed(1)],
      };
      if (props.appData.votesTotal !== 0) {
        voteBreakdown.value = {
          series: [((props.appData.votesYes / (props.appData.votesTotal)) * 100).toFixed(0)],
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
        hash: props.appData.hash,
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
