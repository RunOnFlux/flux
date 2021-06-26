<template>
  <div class="xdaoSection">
    <div v-if="xdaoSection === 'listproposals'">
      <el-table
        :data="proprosalsTable"
        style="width: 100%"
      >
        <el-table-column
          label="Topic"
          prop="proposalTopic"
        >
        </el-table-column>
        <el-table-column
          label="Grant Value"
          prop="proposalGrantValue"
        >
        </el-table-column>
        <el-table-column
          label="Name/NickName"
          prop="proposalNickName"
        >
        </el-table-column>
        <el-table-column
          label="Submit Date"
          prop="proposalSubmitDate"
        >
        </el-table-column>
        <el-table-column
          label="End Date"
          prop="proposalEndDate"
        >
        </el-table-column>
        <el-table-column
          label="Status"
          prop="proposalStatus"
        >
        </el-table-column>
        <el-table-column align="right">
          <template slot-scope="scope">
            <el-button
              size="mini"
              @click="proposalDetgetProposalDetailsails(scope.$index)"
            >Details</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div v-if="xdaoSection === 'submitproposal'">
      <p>
        In this page you will be able to submit a proposal to flux xdao. Fields marked with * are mandatory. After submit/paid, proposal can't be changed. Thank you for using flux xdao.
      </p>
      <el-form
        label-width="150px"
      >
        <el-form-item label="Topic*">
          <el-input
            placeholder="Proposal Topic"
            v-model="proposalTopic"
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Grant Value">
          <el-input
            placeholder="Grant Flux Value"
            v-model="proposalGrantValue"
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Grant Address">
          <el-input
            placeholder="Flux Address to Receive Grant"
            v-model="proposalGrantAddress"
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Proposal Description*">
          <el-input
            type="textarea"
            autosize
            placeholder="Proposal Description"
            v-model="proposalDescription"
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Name/NickName">
          <el-input
            class="width100"
            placeholder="Name/NickName of Proposal Owner"
            v-model="proposalNickName"
          >
          </el-input>
        </el-form-item>
      </el-form>
      <div>
        <ElButton @click="checkProposal">
          Compute Flux Xdao Proposal
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
              :href="'zel:?action=sign&message=' + dataToSign + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FZelFront%2Fsrc%2Fassets%2Fimg%2FzelID.svg&callback=' + callbackValue"
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
          Proposal Price: 100 FLUX
          <br><br>
          <ElButton @click="register">
            Register Flux XDAO Proposal
          </ElButton>
          <br><br>
          <div v-if="registrationHash">
            To finish registration, please do a transaction of 100 Flux to address
            {{ foundationAddress }}
            with following message:
            {{ registrationHash }}
            <br><br>
            Transaction must be mined by {{ new Date(validTill).toLocaleString('en-GB', timeoptions) }}
            <br><br>
          </div>
          <div v-if="registrationHash">
            Pay with ZelCore
            <br>
            <a :href="'zel:?action=pay&coin=zelcash&address=' + foundationAddress + '&amount=' + 100 + '&message=' + registrationHash + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FZelFront%2Fsrc%2Fassets%2Fimg%2Fflux_banner.png'">
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
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';

const store = require('store');
const qs = require('qs');

Vue.use(Vuex);
// const vue = new Vue();

export default {
  name: 'Xdao',
  data() {
    return {
      proposalTopic: '',
      proposalGrantValue: 0,
      proposalGrantAddress: '',
      proposalDescription: '',
      proposalNickName: '',
      proposalZelId: '',
      version: 1,
      dataToSign: '',
      timestamp: '',
      signature: '',
      registrationHash: '',
      updateHash: '',
      foundationAddress: 't1LUs6quf7TB2zVZmexqPQdnqmrFMGZGjV6',
      registrationtype: 'fluxdaoproposalsubmit',
      websocket: null,
      timeoptions: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
      proprosalsTable: [],
      proposalDetail: {},
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'xdaoSection',
    ]),
    currentLoginPhrase() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      console.log(auth);
      return auth.loginPhrase;
    },
  },
  watch: {
    xdaoSection(val, oldVal) {
      console.log(val, oldVal);
      this.switcher(val);
    },
  },
  mounted() {
    this.switcher(this.xdaoSection);
  },
  methods: {
    switcher(value) {
      switch (value) {
        case 'listproposals':
          this.getXdaoProposals();
          break;
        case 'submitproposal':
          break;
        case null:
          console.log('xdao Section hidden');
          break;
        default:
          console.log('xdao Section: Unrecognized method'); // should not be seeable if all works correctly
      }
    },
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
    async getXdaoProposals() {
      // Todo call Flux Xdao Api to get proposals list.
      const submitDate = new Date();
      const endDate = new Date();
      endDate.setDate(submitDate.getDate() + 7);
      const proposal1 = {
        proposalTopic: 'Marketing',
        proposalGrantValue: 100000,
        proposalNickName: 'Cabecinha84',
        proposalGrantAddress: 't1jklfsajds08319312',
        proposalSubmitDate: submitDate.toLocaleString('en-GB', this.timeoptions),
        proposalEndDate: endDate.toLocaleString('en-GB', this.timeoptions),
        proposalStatus: 'Open',
        votesRequired: 230000,
        votesYes: 12020,
        votesNo: 2700,
        proposalDetails: 'Funds will be spend on Marketing',
      };
      submitDate.setDate(submitDate.getDate() - 8);
      endDate.setDate(submitDate.getDate() + 7);
      const proposal2 = {
        proposalTopic: 'Dev Stuff',
        proposalGrantValue: 200000,
        proposalNickName: 'Cabecinha84',
        proposalGrantAddress: 't1jklfsajds08319312',
        proposalSubmitDate: submitDate.toLocaleString('en-GB', this.timeoptions),
        proposalEndDate: endDate.toLocaleString('en-GB', this.timeoptions),
        proposalStatus: 'Passed',
        votesRequired: 210040,
        votesYes: 432890,
        votesNo: 4550,
        proposalDetails: 'Funds will be spend on Dev Stuff',
      };
      this.proprosalsTable.push(proposal1);
      this.proprosalsTable.push(proposal2);
    },
    async getProposalDetails(index) {
      // Todo call Flux Xdao Api to get proposal detail information.
      this.proposalDetail = this.proprosalsTable[index];
    },
    checkProposal() {
      this.timestamp = new Date().getTime();
      this.dataToSign = this.version + this.proposalZelId + this.timestamp;
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
      const signatureMessage = this.proposalZelId + this.timestamp;
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
    validTill() {
      const expTime = this.timestamp + 60 * 60 * 1000; // 1 hour
      return expTime;
    },
    async register() {
      // Todo call Flux Xdao Api to store proposal. sucess should return registration hash
      this.registrationHash = this.signature;
    },
  },
};
</script>
