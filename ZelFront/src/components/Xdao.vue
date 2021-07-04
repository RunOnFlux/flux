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
              @click="getProposalDetails(scope.$index)"
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
    <div v-if="xdaoSection === 'proposaldetail'">
      <p>
        Proposal Details
      </p>
      <el-form
        label-width="150px"
      >
        <el-form-item label="Status">
          <el-input
            placeholder="Proposal Status"
            v-model="proposalDetail.proposalStatus"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Submit Date">
          <el-input
            placeholder="Proposal Submit Date"
            v-model="proposalDetail.proposalSubmitDate"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Vote End Date">
          <el-input
            placeholder="Proposal Vote End Date"
            v-model="proposalDetail.proposalEndDate"
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
            v-model="proposalDetail.proposalTopic"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Grant Value">
          <el-input
            placeholder="Grant Flux Value"
            v-model="proposalDetail.proposalGrantValue"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Grant Address">
          <el-input
            placeholder="Flux Address to Receive Grant"
            v-model="proposalDetail.proposalGrantAddress"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Proposal Description">
          <el-input
            type="textarea"
            autosize
            placeholder="Proposal Description"
            v-model="proposalDetail.proposalDescription"
            disabled
          >
          </el-input>
        </el-form-item>

        <el-form-item label="Name/NickName">
          <el-input
            class="width100"
            placeholder="Name/NickName of Proposal Owner"
            v-model="proposalDetail.proposalNickName"
            disabled
          >
          </el-input>
        </el-form-item>
      </el-form>
      <div v-if="haveVoted == null">
          <div class="loginSection">
            <p>
              To vote, or check the status of your vote, log in using your ZelID
            </p>
            <div>
              <a
                @click="initiateLoginWS"
                :href="'zel:?action=sign&message=' + loginPhrase + '&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FZelFront%2Fsrc%2Fassets%2Fimg%2FzelID.svg&callback=' + callbackValueLogin"
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
              <ElButton
                @click="login()"
              >
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
          <div v-if="haveVoted == false && proposalDetail.proposalStatus === 'Open' && myNumberOfVotes > 0">
            <p>
              You have not voted yet on this proposal. You have {{ myNumberOfVotes }} votes.
            </p>
            <br>
            <ElButton @click="voteYes">
              Vote Yes
            </ElButton>
            <ElButton @click="voteNo">
              Vote No
            </ElButton>
          </div>
          <div v-if="haveVoted == false && proposalDetail.proposalStatus !== 'Open'">
            <p>
              This proposal is no longer open to votes. You have not voted on this proposal.
            </p>
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
      loginForm: {
        zelid: '',
        signature: '',
        loginPhrase: '',
      },
      loginPhrase: null,
      haveVoted: null,
      myVote: null,
      myNumberOfVotes: null,
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
    callbackValueLogin() {
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
        case 'proposaldetail':
          break;
        case null:
          console.log('xdao Section hidden');
          break;
        default:
          console.log('xdao Section: Unrecognized method'); // should not be seeable if all works correctly
      }
    },
    async getXdaoProposals() {
      // Todo call Flux Xdao Api to get proposals list.
      const submitDate = new Date();
      const endDate = new Date();
      endDate.setDate(submitDate.getDate() + 7);
      const proposal1 = {
        proposalHash: '123456789',
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
        proposalDescription: 'Funds will be spend on Marketing',
      };
      submitDate.setDate(submitDate.getDate() - 8);
      endDate.setDate(submitDate.getDate() + 7);
      const proposal2 = {
        proposalHash: '1234567890',
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
        proposalDescription: 'Funds will be spend on Dev Stuff',
      };
      this.proprosalsTable.push(proposal1);
      this.proprosalsTable.push(proposal2);
    },
    async getProposalDetails(index) {
      // Todo call Flux Xdao Api to get proposal detail information.
      this.proposalDetail = this.proprosalsTable[index];
      this.getZelIdLoginPhrase();
      this.$store.commit('setXdaoSection', 'proposaldetail');
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
            this.loginPhrase = response.data.data;
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
            this.loginPhrase = response.data.data;
            this.loginForm.loginPhrase = response.data.data;
          }
        })
        .catch((error) => {
          console.log(error);
          vue.$customMes.error(error);
          this.errorMessage = 'Error connecting to Flux';
        });
    },
    login() {
      console.log(this.loginForm);
      IDService.verifyLogin(this.loginForm)
        .then((response) => {
          console.log(response);
          if (response.data.status === 'success') {
            // user is  now signed. Store their values
            /* const zelidauth = {
              zelid: this.loginForm.zelid,
              signature: this.loginForm.signature,
              loginPhrase: this.loginForm.loginPhrase,
            }; */
            vue.$customMes.success(response.data.data.message);
            // TODO Call Xdao API to check if Voted
            this.haveVoted = false;
            this.myVote = 'Yes';
            this.myNumberOfVotes = 210;
          } else {
            vue.$customMes({
              type: response.data.status,
              message: response.data.data.message || response.data.data,
            });
          }
        })
        .catch((e) => {
          console.log(e);
          vue.$customMes.error(e.toString());
        });
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
      const wsuri = `${backendURL}/ws/id/${this.loginPhrase}`;
      const websocket = new WebSocket(wsuri);
      this.websocket = websocket;

      websocket.onopen = (evt) => { self.onOpen(evt); };
      websocket.onclose = (evt) => { self.onClose(evt); };
      websocket.onmessage = (evt) => { self.onLoginMessage(evt); };
      websocket.onerror = (evt) => { self.onError(evt); };
    },
    onLoginMessage(evt) {
      console.log('onLoginMessage');
      const data = qs.parse(evt.data);
      if (data.status === 'success' && data.data) {
        // user is now signed. Store their values
        /* const zelidauth = {
          zelid: data.data.zelid,
          signature: data.data.signature,
          loginPhrase: data.data.loginPhrase,
        }; */
        vue.$customMes.success(data.data.message);
        // TODO Call Xdao API to check if Voted
        this.haveVoted = false;
        this.myVote = 'Yes';
        this.myNumberOfVotes = 210;
      }
      console.log(data);
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
    async voteYes() {
      // Todo call Flux Xdao Api to vote Yes
    },
    async voteNo() {
      // Todo call Flux Xdao Api to vote No
    },
  },
};
</script>
