<template>
  <div class="xdaoSection">
    <div v-if="xdaoSection === 'listproposals'">
      <el-table
        :data="filteredProposals"
        :default-sort="{prop: 'submitDate', order: 'descending'}"
        style="width: 100%"
      >
        <el-table-column type="expand">
          <template slot-scope="props">
            <p>Description: {{ props.row.description }}</p>
          </template>
        </el-table-column>
        <el-table-column
          label="Topic"
          prop="topic"
          sortable
        >
        </el-table-column>
        <el-table-column
          label="Grant Value"
          prop="grantValue"
          sortable
        >
        </el-table-column>
        <el-table-column
          label="Name/NickName"
          prop="nickName"
          sortable
        >
        </el-table-column>
        <el-table-column
          label="Submit Date"
          prop="submitDate"
          sortable
        >
          <template slot-scope="scope">
            {{ new Date(scope.row.submitDate).toLocaleString('en-GB', timeoptions) }}
          </template>
        </el-table-column>
        <el-table-column
          label="End Date"
          prop="voteEndDate"
          sortable
        >
          <template slot-scope="scope">
            {{ new Date(scope.row.voteEndDate).toLocaleString('en-GB', timeoptions) }}
          </template>
        </el-table-column>
        <el-table-column
          label="Status"
          prop="status"
          sortable
        >
        </el-table-column>
        <el-table-column align="right">
          <template
            slot="header"
            slot-scope="scope"
          >
            <el-input
              v-if="scope"
              v-model="proposalFilter"
              size="mini"
              placeholder="Type to search"
            />
            <el-checkbox v-model="showUnpaid">Show Unpaid</el-checkbox>
          </template>
          <template slot-scope="scope">
            <el-button
              size="mini"
              @click="getProposalDetails(scope.row.hash)"
            >
              Details
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div v-if="xdaoSection === 'submitproposal'">
      <p>
        In this page you will be able to submit a proposal to Flux Xdao. Fields marked with * are mandatory. After your submission is paid, the proposal can't be changed. Thank you for using Flux Xdao.
      </p>
      <el-form label-width="150px">
        <el-form-item label="Topic*">
          <el-input
            placeholder="Proposal Topic"
            v-model="proposalTopic"
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Grant Amount">
          <el-input
            placeholder="Grant Flux Amount"
            v-model="proposalGrantValue"
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Grant Pay to Address">
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
      <div v-if="!proposalValid">
        <ElButton @click="validateProposal">
          Validate Xdao Proposal
        </ElButton>
      </div>
      <div v-if="proposalValid">
        <br>
        <p>Proposal is Valid</p>
        <br>
        Proposal Price: {{proposalPrice}} FLUX
        <br>
        <ElButton @click="register">
          Register Flux XDAO Proposal
        </ElButton>
        <br><br>
        <div v-if="registrationHash">
          To finish registration, please do a transaction of {{proposalPrice}} Flux to address
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
          <a :href="'zel:?action=pay&coin=zelcash&address=' + foundationAddress + '&amount=' + proposalPrice + '&message=' + registrationHash + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FZelFront%2Fsrc%2Fassets%2Fimg%2Fflux_banner.png'">
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
    <div v-if="xdaoSection === 'proposaldetail'">
      <p>
        Proposal Details
      </p>
      <el-form label-width="150px">
        <el-form-item label="Status">
          <el-input
            placeholder="Proposal Status"
            v-model="proposalDetail.status"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Submit Date">
          <el-input
            placeholder="Proposal Submit Date"
            v-model="proposalDetail.submitDate"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Vote End Date">
          <el-input
            placeholder="Proposal Vote End Date"
            v-model="proposalDetail.voteEndDate"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Total Votes Required">
          <el-input
            placeholder="Total Votes Required"
            v-model="proposalDetail.votesRequired"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Total Votes">
          <el-input
            placeholder="Total Votes"
            v-model="proposalDetail.votesTotal"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Votes Yes">
          <el-input
            placeholder="Votes Yes"
            v-model="proposalDetail.votesYes"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Votes No">
          <el-input
            placeholder="Votes No"
            v-model="proposalDetail.votesNo"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Topic">
          <el-input
            placeholder="Proposal Topic"
            v-model="proposalDetail.topic"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Grant Amount">
          <el-input
            placeholder="Grant Flux Amount"
            v-model="proposalDetail.grantValue"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Grant Pay to Address">
          <el-input
            placeholder="Flux Address to Receive Grant"
            v-model="proposalDetail.grantAddress"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Proposal Description">
          <el-input
            type="textarea"
            autosize
            placeholder="Proposal Description"
            v-model="proposalDetail.description"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Name/NickName">
          <el-input
            class="width100"
            placeholder="Name/NickName of Proposal Owner"
            v-model="proposalDetail.nickName"
            disabled
          >
          </el-input>
        </el-form-item>
      </el-form>
      <div v-if="haveVoted == null && proposalDetail.status !== 'Unpaid' && proposalDetail.status !== 'Rejected Unpaid'">
        <div class="loginSection">
          <p>
            To check the status of your vote, or your voting power, use Zelcore to login with your ZelID
          </p>
          <div>
            <a
              @click="initiateLoginWS"
              :href="'zel:?action=sign&message=' + loginForm.loginPhrase + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FZelFront%2Fsrc%2Fassets%2Fimg%2FzelID.svg&callback=' + callbackValueLogin"
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

          <p>
            or sign the following message with your ZelID.
          </p>
          <ElForm
            :model="loginForm"
            class="loginForm"
          >
            <ElFormItem>
              <ElInput
                type="text"
                name="message"
                placeholder="insert Login Phrase"
                v-model="loginForm.loginPhrase"
              >
                <template slot="prepend">Message: </template>
              </ElInput>
            </ElFormItem>
            <ElFormItem>
              <ElInput
                type="text"
                name="address"
                placeholder="insert ZelID"
                v-model="loginForm.zelid"
              >
                <template slot="prepend">Address: </template>
              </ElInput>
            </ElFormItem>
            <ElFormItem>
              <ElInput
                type="text"
                name="signature"
                placeholder="insert Signature"
                v-model="loginForm.signature"
              >
                <template slot="prepend">Signature: </template>
              </ElInput>
            </ElFormItem>
            <ElButton @click="login()">
              Login
            </ElButton>
          </ElForm>
        </div>
      </div>
      <div v-if="haveVoted != null">
        <div v-if="haveVoted == true">
          <el-form label-width="150px">
            <el-form-item label="Your Vote">
              <el-input
                class="width100"
                placeholder="Your Vote"
                v-model="myVote"
                disabled
              >
              </el-input>
            </el-form-item>
            <el-form-item label="Number of Votes">
              <el-input
                class="width100"
                placeholder="Number of Votes"
                v-model="myNumberOfVotes"
                disabled
              >
              </el-input>
            </el-form-item>
          </el-form>
        </div>
        <div v-else>
          <p>You haven't voted yet! You have a total of {{ myNumberOfVotes }} available.</p>
          <div v-if="!signedMessage">
            <p>
              To vote you need to first sign a message with ZelCore with your ZelID
            </p>
            <div>
              <a
                @click="initiateSignWS"
                :href="'zel:?action=sign&message=' + dataToSign + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FZelFront%2Fsrc%2Fassets%2Fimg%2FzelID.svg&callback=' + callbackValueSign"
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
            <br>
            <ElForm class="loginForm">
              <ElFormItem>
                <ElInput
                  type="text"
                  name="message"
                  placeholder="insert Login Phrase"
                  v-model="dataToSign"
                >
                  <template slot="prepend">Message: </template>
                </ElInput>
              </ElFormItem>
            </ElForm>
          </div>
          <div v-else>
            <p>Remember, you can't change your vote! After voting it could take around 5 minutes to see number of votes updated with your vote.</p>
            <ElButton @click="vote(true)">
              Vote Yes
            </ElButton>
            &nbsp;
            <ElButton @click="vote(false)">
              Vote No
            </ElButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';
import IDService from '@/services/IDService';

const store = require('store');
const qs = require('qs');
const axios = require('axios');

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'Xdao',
  data() {
    return {
      proposalTopic: '',
      proposalGrantValue: 0,
      proposalGrantAddress: '',
      proposalDescription: '',
      proposalNickName: '',
      proposalValid: false,
      registrationHash: '',
      foundationAddress: null,
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
      loginForm: {
        zelid: '',
        signature: '',
        loginPhrase: '',
      },
      haveVoted: null,
      myVote: null,
      myNumberOfVotes: null,
      proposalPrice: 100,
      signedMessage: false,
      dataToSign: '',
      signature: '',
      proposalFilter: '',
      showUnpaid: false,
    };
  },
  computed: {
    ...mapState([
      'config',
      'userconfig',
      'xdaoSection',
    ]),
    filteredProposals() {
      return this.proprosalsTable
        .filter((data) => !this.proposalFilter || data.topic.toLowerCase().includes(this.proposalFilter.toLowerCase()) || data.description.toLowerCase().includes(this.proposalFilter.toLowerCase()))
        .filter((x) => x.status !== 'Rejected Unpaid')
        .filter((x) => this.showUnpaid || x.status !== 'Unpaid');
    },
    callbackValueLogin() {
      console.log('callbackValueLogin');
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
      const url = `${backendURL}/zelid/verifylogin`;
      return encodeURI(url);
    },
    callbackValueSign() {
      console.log('callbackValueSign');
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
          this.proprosalsTable = [];
          this.cleanProposalDetail();
          this.getXdaoProposals();
          break;
        case 'submitproposal':
          this.cleanProposalSubmit();
          break;
        case 'proposaldetail':
          break;
        case null:
          console.log('xdao Section hidden');
          break;
        default:
          console.log('xdao Section: Unrecognized method'); // should not be seeable if all works correctly
      }
    },
    getZelIdLoginPhrase() {
      IDService.loginPhrase()
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            if (JSON.stringify(response.data.data).includes('CONN')) {
              // we can fix daemon, benchmark problems. But cannot fix mongo, docker issues (docker may be possible to fix in the future, mongo not)...
              this.getEmergencyLoginPhrase();
            } else {
              this.errorMessage = response.data.data.message;
            }
          } else {
            this.loginForm.loginPhrase = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error(error);
          this.errorMessage = 'Error connecting to Flux';
        });
    },
    getEmergencyLoginPhrase() {
      IDService.emergencyLoginPhrase()
        .then((response) => {
          console.log(response);
          if (response.data.status === 'error') {
            this.errorMessage = response.data.data.message;
          } else {
            this.loginForm.loginPhrase = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error(error);
          this.errorMessage = 'Error connecting to Flux';
        });
    },
    cleanProposalDetail() {
      this.proposalDetail = {};
      this.loginForm = {
        zelid: '',
        signature: '',
        loginPhrase: '',
      };
      this.haveVoted = null;
      this.myVote = null;
      this.myNumberOfVotes = null;
      this.signedMessage = false;
      this.dataToSign = '';
      this.signature = '';
    },
    cleanProposalSubmit() {
      this.proposalTopic = '';
      this.proposalGrantValue = 0;
      this.proposalGrantAddress = '';
      this.proposalDescription = '';
      this.proposalNickName = '';
      this.proposalValid = false;
      this.registrationHash = '';
    },
    async getXdaoProposals() {
      const response = await axios.get('https://stats.runonflux.io/proposals/listProposals');
      console.log(response);
      if (response.data.status === 'success') {
        this.proprosalsTable = response.data.data;
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
    },
    async getProposalDetails(hash) {
      this.proposalDetail = this.proprosalsTable.find((proposal) => proposal.hash === hash);
      if (this.proposalDetail) {
        console.log(this.proposalDetail);
        this.getZelIdLoginPhrase();
        this.$store.commit('setXdaoSection', 'proposaldetail');
      } else {
        vue.$customMes.error('Proposal not found');
      }
    },
    validateProposal() {
      if (this.proposalTopic === '') {
        vue.$customMes.error('Proposal Topic is Mandatory');
        return;
      }
      if (this.proposalDescription === '') {
        vue.$customMes.error('Proposal Description is Mandatory');
        return;
      }
      if (this.proposalGrantValue !== '') {
        const isnum = /^\d+$/.test(this.proposalGrantValue);
        if (isnum === true) {
          if (this.proposalGrantValue !== '0' && this.proposalGrantAddress === '') {
            vue.$customMes.error('Proposal Grant Pay to Address missing');
            return;
          }
        } else {
          vue.$customMes.error('Proposal Grant Amount needs to be a Integer Number');
          return;
        }
      }
      if (this.proposalTopic.length < 3) {
        vue.$customMes.error('Proposal Topic needs to have more words');
        return;
      }
      if (this.proposalDescription.length < 50) {
        vue.$customMes.error('Proposal Description needs to have more details');
        return;
      }
      if (/\s/.test(this.proposalGrantAddress)) {
        vue.$customMes.error('Proposal Grant Pay to Address Invalid, white space detected');
        return;
      }
      this.proposalValid = true;
    },
    initiateSignWS() {
      console.log('initiateSignWS');
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
      const wsIdentifier = this.loginForm.zelid + this.dataToSign.substr(this.dataToSign.length - 13);
      const wsuri = `${backendURL}/ws/sign/${wsIdentifier}`;
      const websocket = new WebSocket(wsuri);
      this.websocket = websocket;

      websocket.onopen = (evt) => { self.onOpen(evt); };
      websocket.onclose = (evt) => { self.onClose(evt); };
      websocket.onmessage = (evt) => { self.onSignMessage(evt); };
      websocket.onerror = (evt) => { self.onError(evt); };
    },
    onSignMessage(evt) {
      console.log('onSignMessage');
      const data = qs.parse(evt.data);
      if (data.status === 'success' && data.data) {
        this.signature = data.data.signature;
        this.signedMessage = true;
      }
      console.log(data);
      console.log(evt);
    },
    onError(evt) {
      console.log(evt);
    },
    onClose(evt) {
      console.log(evt);
    },
    onOpen(evt) {
      console.log(evt);
    },
    async login() {
      console.log(this.loginForm);
      const response = await IDService.verifyLogin(this.loginForm);
      console.log(response);
      if (response.data.status === 'success') {
        this.myNumberOfVotes = 0;
        let responseApi = await axios.get(`https://stats.runonflux.io/proposals/voteInformation?hash=${this.proposalDetail.hash}&zelid=${this.loginForm.zelid}`);
        console.log(responseApi);
        if (responseApi.data.status === 'success') {
          const votesInformantion = responseApi.data.data;
          if (this.proposalDetail.status === 'Open' && (votesInformantion == null || votesInformantion.length === 0)) {
            responseApi = await axios.get(`https://stats.runonflux.io/proposals/votepower?zelid=${this.loginForm.zelid}`);
            console.log(responseApi);
            if (responseApi.data.status === 'success') {
              this.myNumberOfVotes = response.data.data.power;
              responseApi = await axios.get('https://stats.runonflux.io/general/messagephrase');
              if (responseApi.data.status === 'success') {
                this.dataToSign = responseApi.data.data;
                this.haveVoted = false;
              } else {
                vue.$customMes.error(responseApi.data.data.message || responseApi.data.data);
                return;
              }
            } else {
              vue.$customMes.error(responseApi.data.data.message || responseApi.data.data);
              return;
            }
          } else {
            votesInformantion.forEach((vote) => {
              this.myNumberOfVotes += vote.numberOfVotes;
            });
            this.myVote = 'No';
            if (votesInformantion[0].vote) {
              this.myVote = 'Yes';
            }
            this.haveVoted = true;
          }
        } else {
          vue.$customMes.error(response.data.data.message || response.data.data);
          return;
        }
        vue.$customMes.success(response.data.data.message);
      } else {
        vue.$customMes({
          type: response.data.status,
          message: response.data.data.message || response.data.data,
        });
      }
    },
    initiateLoginWS() {
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
      const wsuri = `${backendURL}/ws/id/${this.loginForm.loginPhrase}`;
      const websocket = new WebSocket(wsuri);
      this.websocket = websocket;

      websocket.onopen = (evt) => { self.onOpen(evt); };
      websocket.onclose = (evt) => { self.onClose(evt); };
      websocket.onmessage = (evt) => { self.onLoginMessage(evt); };
      websocket.onerror = (evt) => { self.onError(evt); };
    },
    async onLoginMessage(evt) {
      console.log('onLoginMessage');
      const data = qs.parse(evt.data);
      if (data.status === 'success' && data.data) {
        this.loginForm = {
          zelid: data.data.zelid,
          signature: data.data.signature,
          loginPhrase: data.data.loginPhrase,
        };
        this.myNumberOfVotes = 0;
        let response = await axios.get(`https://stats.runonflux.io/proposals/voteInformation?hash=${this.proposalDetail.hash}&zelid=${this.loginForm.zelid}`);
        console.log(response);
        if (response.data.status === 'success') {
          const votesInformantion = response.data.data;
          if (this.proposalDetail.status === 'Open' && (votesInformantion == null || votesInformantion.length === 0)) {
            response = await axios.get(`https://stats.runonflux.io/proposals/votepower?zelid=${this.loginForm.zelid}`);
            console.log(response);
            if (response.data.status === 'success') {
              this.myNumberOfVotes = response.data.data.power;
              response = await axios.get('https://stats.runonflux.io/general/messagephrase');
              if (response.data.status === 'success') {
                this.dataToSign = response.data.data;
                this.haveVoted = false;
              } else {
                vue.$customMes.error(response.data.data.message || response.data.data);
                return;
              }
            } else {
              vue.$customMes.error(response.data.data.message || response.data.data);
              return;
            }
          } else {
            votesInformantion.forEach((vote) => {
              this.myNumberOfVotes += vote.numberOfVotes;
            });
            this.myVote = 'No';
            if (votesInformantion[0].vote) {
              this.myVote = 'Yes';
            }
            this.haveVoted = true;
          }
        } else {
          vue.$customMes.error(response.data.data.message || response.data.data);
          return;
        }
        vue.$customMes.success(data.data.message);
      }
      console.log(data);
      console.log(evt);
    },
    async register() {
      const data = {
        topic: this.proposalTopic,
        description: this.proposalDescription,
        grantValue: this.proposalGrantValue,
        grantAddress: this.proposalGrantAddress,
        nickName: this.proposalNickName,
      };
      const response = await axios.post('https://stats.runonflux.io/proposals/submitproposal', JSON.stringify(data));
      console.log(response);
      if (response.data.status === 'success') {
        this.foundationAddress = response.data.data.address;
        this.registrationHash = response.data.data.hash;
        this.proposalPrice = response.data.data.amount;
        this.validTill = response.data.data.paidTillDate;
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
    },
    async vote(myVote) {
      const data = {
        hash: this.proposalDetail.hash,
        zelid: this.loginForm.zelid,
        message: this.dataToSign,
        signature: this.signature,
        vote: myVote,
      };
      console.log(data);
      const response = await axios.post('https://stats.runonflux.io/proposals/voteproposal', JSON.stringify(data));
      console.log(response);
      if (response.data.status === 'success') {
        vue.$customMes.success('Vote registered successful');
        this.myVote = 'No';
        if (myVote) {
          this.myVote = 'Yes';
        }
        this.haveVoted = true;
      } else {
        vue.$customMes.error(response.data.data.message || response.data.data);
      }
    },
  },
};
</script>
