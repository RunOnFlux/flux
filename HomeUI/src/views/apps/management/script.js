import {
  BAlert,
  BTabs,
  BTab,
  BTable,
  BTd,
  BTr,
  BDropdown,
  BDropdownItem,
  BFormTag,
  BFormTags,
  BIcon,
  BInputGroup,
  BInputGroupPrepend,
  BInputGroupAppend,
  BCol,
  BCard,
  BCardText,
  BCardTitle,
  BCardGroup,
  BRow,
  BButton,
  BSpinner,
  BFormRadioGroup,
  BFormTextarea,
  BFormGroup,
  BFormInput,
  BFormCheckbox,
  BFormSelect,
  BFormSelectOption,
  BPagination,
  BProgress,
  BProgressBar,
  VBTooltip,
} from 'bootstrap-vue';

import VueApexCharts from 'vue-apexcharts';
import Ripple from 'vue-ripple-directive';
import { mapState } from 'vuex';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';
import ComponentDetails from '@/views/components/ComponentDetails.vue';
import AppInfo from '@/views/components/AppInfo.vue';
import FluxMap from '@/views/components/FluxMap.vue';
import JsonViewer from 'vue-json-viewer';
import FileUpload from '@/views/components/FileUpload.vue';
import { useClipboard } from '@vueuse/core';
import firebase, { getUser } from '@/libs/firebase';
import getPaymentGateways, { paymentBridge } from '@/libs/fiatGateways';

import AppsService from '@/services/AppsService';
import DaemonService from '@/services/DaemonService';

import SignClient from '@walletconnect/sign-client';
import { MetaMaskSDK } from '@metamask/sdk';
import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SerializeAddon } from '@xterm/addon-serialize';
import io from 'socket.io-client';
import useAppConfig from '@core/app-config/useAppConfig';
import AnsiToHtml from 'ansi-to-html';
import IDService from '@/services/IDService';
import hljs from 'highlight.js';
import {
  Chart, LineController, LineElement, CategoryScale, LinearScale, PointElement, Tooltip, Legend, Title, Filler,
} from 'chart.js';
import { loader, VueMonacoEditor } from '@guolao/vue-monaco-editor';
import { getOpenPGP } from '@/utils/openpgp-wrapper';

loader.config({
  paths: {
    vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs',
  },
});

Chart.register(LineController, LineElement, CategoryScale, LinearScale, PointElement, Tooltip, Legend, Title, Filler);

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

const metamaskOptions = {
  // enableAnalytics: true,
};

const MMSDK = new MetaMaskSDK(metamaskOptions);
let ethereum;

const axios = require('axios');
const qs = require('qs');
const store = require('store');
const splitargs = require('splitargs');
const geolocations = require('../../../libs/geolocation');

// PON (proof of nodes) Fork configuration - block height where chain speed increases 4x
const FORK_BLOCK_HEIGHT = 2020000;

export default {
  components: {
    AppInfo,
    VueMonacoEditor,
    FileUpload,
    JsonViewer,
    ComponentDetails,
    BAlert,
    BTabs,
    BTab,
    BTable,
    BTd,
    BTr,
    BDropdown,
    BDropdownItem,
    BFormTag,
    BFormTags,
    BIcon,
    BInputGroup,
    BInputGroupPrepend,
    BInputGroupAppend,
    BCol,
    BCard,
    BCardText,
    BCardTitle,
    BCardGroup,
    BRow,
    BButton,
    BSpinner,
    BFormRadioGroup,
    BFormTextarea,
    BFormGroup,
    BFormInput,
    BFormCheckbox,
    BFormSelect,
    BFormSelectOption,
    BPagination,
    // eslint-disable-next-line vue/no-unused-components
    BProgress,
    // eslint-disable-next-line vue/no-unused-components
    BProgressBar,
    ConfirmDialog,
    FluxMap,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
    // eslint-disable-next-line vue/no-unused-components
    VueApexCharts,
  },
  directives: {
    'b-tooltip': VBTooltip,
    Ripple,
  },
  props: {
    appName: {
      type: String,
      required: true,
    },
    global: {
      type: Boolean,
      required: true,
    },
    installedApps: {
      type: Array,
      required: true,
    },
  },
  data() {
    return {
      activeTabLocalIndexSpec: 0,
      activeTabGlobalIndexSpec: 0,
      noInstanceAvailable: false,
      activeTabInfo: null,
      activeTabFile: null,
      operationTask: '',
      monacoReady: false,
      maxEditSize: 3 * 1024 * 1024,
      supportedLanguages: [
        'abap',
        'apex',
        'azcli',
        'bat',
        'c',
        'cameligo',
        'clojure',
        'coffeescript',
        'cpp',
        'csharp',
        'csp',
        'css',
        'dart',
        'dockerfile',
        'ecl',
        'fsharp',
        'flow',
        'git-commit',
        'git-rebase',
        'go',
        'graphql',
        'handlebars',
        'hcl',
        'html',
        'ini',
        'java',
        'javascript',
        'javascriptreact',
        'json',
        'jsonc',
        'less',
        'lexon',
        'lua',
        'markdown',
        'mips',
        'mysql',
        'objective-c',
        'pascal',
        'perl',
        'pgsql',
        'php',
        'plaintext',
        'pom',
        'powershell',
        'pug',
        'python',
        'r',
        'razor',
        'ruby',
        'rust',
        'sb',
        'scss',
        'shell',
        'sol',
        'sql',
        'swift',
        'typescript',
        'typescriptreact',
        'vb',
        'xml',
        'yaml',
      ],
      extensionMapping: {
        abap: 'abap',
        cls: 'apex',
        azcli: 'azcli',
        bat: 'bat',
        c: 'c',
        mligo: 'cameligo',
        clj: 'clojure',
        coffee: 'coffeescript',
        cpp: 'cpp',
        cc: 'cpp',
        cxx: 'cpp',
        cs: 'csharp',
        csp: 'csp',
        css: 'css',
        dart: 'dart',
        dockerfile: 'dockerfile',
        ecl: 'ecl',
        fs: 'fsharp',
        fsi: 'fsharp',
        flow: 'flow',
        go: 'go',
        graphql: 'graphql',
        gql: 'graphql',
        hbs: 'handlebars',
        hcl: 'hcl',
        html: 'html',
        htm: 'html',
        ini: 'ini',
        conf: 'ini',
        java: 'java',
        js: 'javascript',
        jsx: 'javascriptreact',
        json: 'json',
        jsonc: 'jsonc',
        less: 'less',
        lexon: 'lexon',
        lua: 'lua',
        md: 'markdown',
        markdown: 'markdown',
        mips: 'mips',
        mysql: 'mysql',
        m: 'objective-c',
        mm: 'objective-c',
        pas: 'pascal',
        pp: 'pascal',
        pl: 'perl',
        pm: 'perl',
        pgsql: 'pgsql',
        php: 'php',
        txt: 'plaintext',
        'pom.xml': 'pom',
        ps1: 'powershell',
        pug: 'pug',
        py: 'python',
        r: 'r',
        cshtml: 'razor',
        razor: 'razor',
        rb: 'ruby',
        rs: 'rust',
        sb: 'sb',
        scss: 'scss',
        sh: 'shell',
        bash: 'shell',
        sol: 'sol',
        sql: 'sql',
        swift: 'swift',
        ts: 'typescript',
        tsx: 'typescriptreact',
        vb: 'vb',
        xml: 'xml',
        yaml: 'yaml',
        yml: 'yaml',
      },
      editorLanguage: 'plaintext',
      editorInstance: null,
      editorOptions: {
        automaticLayout: true,
        formatOnType: true,
        formatOnPaste: true,
        fontFamily: 'Consolas, "Courier New", monospace',
        fontSize: 14,
      },
      saving: false,
      contentLoaded: false,
      hasChanged: false,
      optionalInfoMessage: '',
      editDialogVisible: false,
      currentEditFile: '',
      editContent: '',
      additionalMessage: '',
      backendLoading: false,
      logoutTigger: false,
      diskUsagePercentage: '',
      diskBindLimit: '',
      buttonStats: false,
      noData: false,
      enableHistoryStatistics: false,
      selectedTimeRange: 1 * 24 * 60 * 60 * 1000,
      timeOptions: [
        { value: 15 * 60 * 1000, text: 'Last 15 Minutes' }, // 15 minutes in ms
        { value: 30 * 60 * 1000, text: 'Last 30 Minutes' }, // 30 minutes in ms
        { value: 1 * 60 * 60 * 1000, text: 'Last 1 Hour' }, // 1 hour in ms
        { value: 2 * 60 * 60 * 1000, text: 'Last 2 Hours' }, // 2 hours in ms
        { value: 3 * 60 * 60 * 1000, text: 'Last 3 Hours' }, // 3 hours in ms
        { value: 5 * 60 * 60 * 1000, text: 'Last 5 Hours' }, // 5 hours in ms
        { value: 1 * 24 * 60 * 60 * 1000, text: 'Last 1 Day' }, // 1 day in ms
        { value: 2 * 24 * 60 * 60 * 1000, text: 'Last 2 Days' }, // 2 days in ms
        { value: 3 * 24 * 60 * 60 * 1000, text: 'Last 3 Days' }, // 3 days in ms
        { value: 7 * 24 * 60 * 60 * 1000, text: 'Last 7 Days' }, // 7 days in ms
      ],
      selectedPoints: 500,
      pointsOptions: [5, 10, 25, 50, 100, 200, 300, 400, 500],
      search: '', // Search query
      currentPage: 1, // Current page for pagination
      perPage: 5, // Default items per page
      perPageOptions: [
        { value: 5, text: '5' },
        { value: 10, text: '10' },
        { value: 20, text: '20' },
        { value: 50, text: '50' },
      ],
      processes: [],
      titles: [
        { key: 'uid', label: 'UID' },
        { key: 'pid', label: 'PID' },
        { key: 'ppid', label: 'PPID' },
        { key: 'c', label: 'C' },
        { key: 'stime', label: 'STIME' },
        { key: 'tty', label: 'TTY' },
        { key: 'time', label: 'TIME' },
        { key: 'cmd', label: 'CMD' },
      ],
      selectedContainerMonitoring: null,
      refreshRateMonitoring: 5000,
      containerOptions: [],
      ioChart: null,
      memoryChart: null,
      networkChart: null,
      diskFileSystemChart: null,
      diskPersistentChart: null,
      cpuChart: null,
      refreshOptions: [
        { value: 5000, text: '5s' },
        { value: 10000, text: '10s' },
        { value: 30000, text: '30s' },
      ],
      errorMessage: null,
      timerStats: null,
      memoryLimit: 1,
      cpuSet: 1,
      logs: [],
      noLogs: false,
      manualInProgress: false,
      isLineByLineMode: false,
      selectedLog: [],
      downloadingLog: false,
      containers: [],
      selectedContainer: '',
      filterKeyword: '',
      refreshRate: 4000,
      lineCount: 100,
      sinceTimestamp: '',
      displayTimestamps: false,
      pollingInterval: null,
      pollingEnabled: false,
      autoScroll: true,
      fetchAllLogs: false,
      requestInProgress: false,
      copied: false,
      debounceTimeout: null,
      progressVisable: false,
      operationTitle: '',
      appInfoObject: [],
      tooltipText: 'Copy to clipboard',
      tableBackup: 0,
      tableKey: 0,
      isBusy: false,
      inputPathValue: '',
      fields: [
        { key: 'name', label: 'Name', sortable: true },
        // eslint-disable-next-line object-curly-newline
        { key: 'size', label: 'Size', sortable: true, thStyle: { width: '10%' } },
        // eslint-disable-next-line object-curly-newline
        { key: 'modifiedAt', label: 'Last modification', sortable: true, thStyle: { width: '15%' } },
        // { key: 'type', label: 'Type', sortable: true },
        // eslint-disable-next-line object-curly-newline
        { key: 'actions', label: 'Actions', sortable: false, thStyle: { width: '10%' } },
      ],
      timeoptions: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
      loadingFolder: false,
      folderView: [],
      currentFolder: '',
      uploadFilesDialog: false,
      filterFolder: '',
      createDirectoryDialogVisible: false,
      renameDialogVisible: false,
      newName: '',
      fileRenaming: '',
      newDirName: '',
      abortToken: {},
      downloaded: '',
      total: '',
      timeStamp: {},
      working: false,
      storage: {
        used: 0,
        total: 2,
        available: 2,
      },
      customColors: [
        { color: '#6f7ad3', percentage: 20 },
        { color: '#1989fa', percentage: 40 },
        { color: '#5cb87a', percentage: 60 },
        { color: '#e6a23c', percentage: 80 },
        { color: '#f56c6c', percentage: 100 },
      ],
      uploadTotal: '',
      uploadUploaded: '',
      uploadTimeStart: '',
      currentUploadTime: '',
      uploadFiles: [],
      fileProgressVolume: [],
      windowWidth: window.innerWidth,
      showTopUpload: false,
      showTopRemote: false,
      showTopFluxDrive: false,
      alertMessage: '',
      alertVariant: '',
      restoreFromUpload: false,
      restoreFromUploadStatus: '',
      restoreFromRemoteURLStatus: '',
      restoreFromFluxDriveStatus: '',
      downloadingFromUrl: false,
      restoringFromFluxDrive: false,
      files: [],
      backupProgress: false,
      uploadProgress: false,
      tarProgress: '',
      fileProgress: [],
      fileProgressFD: [],
      fluxDriveUploadStatus: '',
      showFluxDriveProgressBar: false,
      showProgressBar: false,
      showUploadProgressBar: false,
      uploadStatus: '',
      restoreOptions: [
        {
          value: 'FluxDrive',
          text: 'FluxDrive',
          disabled: false,
        },
        {
          value: 'Remote URL',
          text: 'Remote URL',
          disabled: false,
        },
        {
          value: 'Upload File',
          text: 'Upload File',
          disabled: false,
        },
      ],
      storageMethod: [
        {
          value: 'flux',
          disabled: false,
          text: 'FluxDrive',
        },
        {
          value: 'google',
          disabled: true,
          text: 'GoogleDrive',
        },
        {
          value: 'as3',
          disabled: true,
          text: 'AS3Storage',
        },
      ],
      components: [],
      selectedRestoreOption: null,
      selectedStorageMethod: null,
      selectedBackupComponents: [],
      items: [],
      items1: [],
      checkpoints: [],
      sigInPrivilage: true,
      backupList: [],
      backupToUpload: [],
      restoreRemoteUrl: '',
      restoreRemoteFile: null,
      restoreRemoteUrlComponent: null,
      restoreRemoteUrlItems: [],
      newComponents: [],
      itemKey: [],
      expandedDetails: [],
      itemValue: [],
      sortbackupTableKey: 'timestamp',
      sortbackupTableDesc: true,
      nestedTableFilter: '',
      backupTableFields: [
        { key: 'timestamp', label: 'Name', thStyle: { width: '65%' } },
        { key: 'time', label: 'Time' },
        {
          key: 'actions', label: 'Actions', thStyle: { width: '118px' }, class: 'text-center',
        },
      ],
      restoreComponents: [
        { value: '', text: 'all' },
        { value: 'lime', text: 'lime' },
        { value: 'orange', text: 'orange' },
      ],
      localBackupTableFields: [
        {
          key: 'isActive', label: '', thStyle: { width: '5%' }, class: 'text-center',
        },
        { key: 'component', label: 'Component Name', thStyle: { width: '40%' } },
        { key: 'create', label: 'CreateAt', thStyle: { width: '17%' } },
        { key: 'expire', label: 'ExpireAt', thStyle: { width: '17%' } },
        { key: 'file_size', label: 'Size', thStyle: { width: '8%' } },
      ],
      newComponentsTableFields: [
        { key: 'component', label: 'Component Name', thStyle: { width: '200px' } },
        { key: 'file_url', label: 'URL' },
        { key: 'timestamp', label: 'Timestamp', thStyle: { width: '200px' } },
        { key: 'file_size', label: 'Size', thStyle: { width: '100px' } },
        {
          key: 'actions',
          label: 'Actions',
          thStyle: { width: '117px' },
          class: 'text-center',
        },
      ],
      componentsTable() {
        return [
          { key: 'component', label: 'Component Name', thStyle: { width: '20%' } },
          { key: 'file_url', label: 'URL', thStyle: { width: '55%' } },
          { key: 'file_size', label: 'Size', thStyle: { width: '20%' } },
          {
            key: 'actions', label: 'Actions', thStyle: { width: '5%' }, class: 'text-center',
          },
        ];
      },
      socket: null,
      terminal: null,
      selectedCmd: null,
      selectedApp: null,
      selectedAppVolume: null,
      enableUser: false,
      userInputValue: '',
      customValue: '',
      envInputValue: '',
      enableEnvironment: false,
      isVisible: false,
      isConnecting: false,
      options: [
        {
          label: 'Linux',
          options: [
            '/bin/bash',
            '/bin/ash',
            '/bin/sh',
          ],
        },
        {
          label: 'Other',
          options: [
            'Custom',
          ],
        },
      ],
      output: [],
      downloadOutput: {},
      downloadOutputReturned: false,
      fluxCommunication: false,
      commandExecuting: false,
      commandExecutingMonitoring: false,
      commandExecutingStats: false,
      commandExecutingProcesses: false,
      commandExecutingChanges: false,
      commandExecutingInspect: false,
      getAllAppsResponse: {
        status: '',
        data: [],
      },
      updatetype: 'fluxappupdate',
      version: 1,
      dataForAppUpdate: {},
      dataToSign: '',
      timestamp: '',
      signature: '',
      updateHash: '',
      testError: false,
      websocket: null,
      selectedAppOwner: '',
      appSpecification: {},
      callResponseMonitoring: {
        status: '',
        data: '',
      },
      callResponseStats: {
        status: '',
        data: '',
      },
      callResponseProcesses: {
        status: '',
        data: '',
      },
      callResponseChanges: {
        status: '',
        data: '',
      },
      callResponseInspect: {
        status: '',
        data: '',
      },
      callResponse: { // general
        status: '',
        data: '',
      },
      callBResponse: { // general B
        status: '',
        data: [],
      },
      appExec: {
        cmd: '',
        env: '',
      },
      appUpdateSpecification: {
        version: 3,
        name: '',
        description: '',
        repotag: '',
        owner: '',
        ports: '', // []
        domains: '', // []
        enviromentParameters: '', // []
        commands: '', // []
        containerPorts: '', // []
        containerData: '',
        instances: 3,
        cpu: null,
        ram: null,
        hdd: null,
        tiered: false,
        cpubasic: null,
        rambasic: null,
        hddbasic: null,
        cpusuper: null,
        ramsuper: null,
        hddsuper: null,
        cpubamf: null,
        rambamf: null,
        hddbamf: null,
      },
      instances: {
        data: [],
        fields: [
          { key: 'show_details', label: '' },
          { key: 'ip', label: 'IP Address', sortable: true },
          { key: 'continent', label: 'Continent', sortable: true },
          { key: 'country', label: 'Country', sortable: true },
          // eslint-disable-next-line object-curly-newline
          { key: 'region', label: 'Region', sortable: true, thStyle: { width: '20%' } },
          { key: 'visit', label: 'Visit', thStyle: { width: '10%' } },
        ],
        perPage: 10,
        pageOptions: [10, 25, 50, 100],
        sortBy: '',
        sortDesc: false,
        sortDirection: 'asc',
        filter: '',
        filterOn: [],
        totalRows: 1,
        currentPage: 1,
      },
      downloadedSize: '',
      deploymentAddress: '',
      appPricePerSpecs: 0,
      appPricePerSpecsUSD: 0,
      applicationPriceFluxDiscount: '',
      applicationPriceFluxError: false,
      maxInstances: 100,
      minInstances: 3,
      globalZelidAuthorized: true,
      paymentId: '',
      paymentLoading: false,
      paymentReceived: false,
      transactionId: '',
      paymentWebsocket: null,
      monitoringStream: {},
      statsFields: [
        { key: 'timestamp', label: 'Date' },
        { key: 'cpu', label: 'CPU' },
        { key: 'memory', label: 'RAM' },
        { key: 'disk', label: 'DISK' },
        { key: 'net', label: 'NET I/O' },
        { key: 'block', label: 'BLOCK I/O' },
        { key: 'pids', label: 'PIDS' },
      ],
      possibleLocations: [],
      allowedGeolocations: {},
      forbiddenGeolocations: {},
      numberOfGeolocations: 1,
      numberOfNegativeGeolocations: 1,
      minExpire: 5000,
      maxExpire: 264000,
      extendSubscription: true,
      updateSpecifications: false,
      daemonBlockCount: -1,
      expirePosition: 2,
      minutesRemaining: 0,
      expireOptions: [
        {
          value: 5000,
          label: '1 week',
          time: 7 * 24 * 60 * 60 * 1000,
        },
        {
          value: 11000,
          label: '2 weeks',
          time: 14 * 24 * 60 * 60 * 1000,
        },
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
      ],
      tosAgreed: false,
      marketPlaceApps: [],
      generalMultiplier: 1,
      enterpriseNodes: [],
      selectedEnterpriseNodes: [],
      enterprisePublicKeys: [], // {nodeip, nodekey}
      maximumEnterpriseNodes: 120,
      entNodesTable: {
        fields: [
          { key: 'show_details', label: '' },
          { key: 'ip', label: 'IP Address', sortable: true },
          { key: 'payment_address', label: 'Node Address', sortable: true },
          { key: 'tier', label: 'Tier', sortable: true },
          { key: 'score', label: 'Score', sortable: true },
          { key: 'actions', label: 'Actions' },
        ],
        perPage: 10,
        pageOptions: [5, 10, 25, 50, 100],
        sortBy: '',
        sortDesc: false,
        sortDirection: 'asc',
        filter: '',
        filterOn: [],
        currentPage: 1,
      },
      entNodesSelectTable: {
        fields: [
          { key: 'show_details', label: '' },
          { key: 'ip', label: 'IP Address', sortable: true },
          { key: 'payment_address', label: 'Node Address', sortable: true },
          { key: 'tier', label: 'Tier', sortable: true },
          { key: 'score', label: 'Enterprise Score', sortable: true },
          { key: 'actions', label: 'Actions' },
        ],
        perPage: 25,
        pageOptions: [5, 10, 25, 50, 100],
        sortBy: '',
        sortDesc: false,
        sortDirection: 'asc',
        filter: '',
        filterOn: [],
        currentPage: 1,
        totalRows: 1,
      },
      chooseEnterpriseDialog: false,
      isPrivateApp: false,
      signClient: null,
      masterIP: '',
      selectedIp: null,
      masterSlaveApp: false,
      applicationManagementAndStatus: [],
      fiatCheckoutURL: '',
      stripeEnabled: true,
      paypalEnabled: true,
      checkoutLoading: false,
      isMarketplaceApp: false,
      ipAccess: false,
      freeUpdate: false,
    };
  },
  computed: {
    languageOptions() {
      return this.supportedLanguages.map((lang) => ({ value: lang, text: lang }));
    },
    targetAppName() {
      console.log('targetAppName');
      console.log(this.$store.state.flux.appSpecification);
      return this.$store.state.flux.appSpecification?.name;
    },
    infoMessage() {
      // Default message
      const defaultMessage = 'Waiting for the operation to be completed...';
      // If optional text is provided, append it
      return this.optionalInfoMessage.trim()
        ? `${this.optionalInfoMessage}`
        : defaultMessage;
    },
    tooltipContent() {
      const usedStorage = this.convertVolumeSize(this.storage.used, 'GB', 1, true);
      const totalStorage = this.convertVolumeSize(this.storage.total, 'GB', 1, true);

      return `
        <div class="no-wrap" style="text-align: center; padding: 2px;">
          <kbd style="
            background-color: #AEC6CF;
            color: #333;
            padding: 2px 2px 2px 2px;
            border-radius: 12px;
            margin-right: 5px;
            font-weight: bold;
            font-size: 1em;
            display: inline-block;
            width: 110px;
            height: 20px;
            text-overflow: ellipsis;
            overflow: hidden;
          ">
            Used: ${usedStorage} GB
          </kbd>
          <kbd style="
            background-color: #FFC1A6;
            color: #333;
            padding: 2px 2px 2px 2px;
            border-radius: 12px;
            font-weight: bold;
            font-size: 1em;
            display: inline-block;
            width: 110px;
            height: 20px;
            text-overflow: ellipsis;
            overflow: hidden;
          ">
            Total: ${totalStorage} GB
          </kbd>
        </div>
      `;
    },
    usagePercentage() {
      return (this.storage.used / this.storage.total) * 100;
    },
    overviewTitle() {
      return this.enableHistoryStatistics ? 'History Stats Overview' : 'Stats & Processes Overview';
    },
    filteredProcesses() {
      if (this.search) {
        return this.processes.filter((process) => Object.values(process).some((value) => String(value).toLowerCase().includes(this.search.toLowerCase())));
      }
      return this.processes;
    },
    paginatedProcesses() {
      const start = (this.currentPage - 1) * this.perPage;
      const end = start + this.perPage;
      return this.filteredProcesses.slice(start, end);
    },
    isDisabled() {
      return !!this.pollingEnabled || this.manualInProgress || this.backendLoading;
    },
    filteredLogs() {
      const keyword = this.filterKeyword.toLowerCase();
      return this.logs.filter((log) => log.toLowerCase().includes(keyword));
    },
    formattedLogs() {
      return this.filteredLogs.map((log) => this.formatLog(log));
    },
    mapLocations() {
      return this.instances.data.map((i) => i.ip);
    },
    appRunningTill() {
      const blockTime = 2 * 60 * 1000;
      // Use dynamic default expire based on block height (1 month)
      const multiplier = this.daemonBlockCount >= FORK_BLOCK_HEIGHT ? 4 : 1;
      const defaultExpire = 22000 * multiplier;
      const expires = this.callBResponse.data.expire || defaultExpire;
      const currentExpire = this.callBResponse.data.height + expires - this.daemonBlockCount;
      let newExpire = currentExpire;
      if (this.extendSubscription) {
        newExpire = this.expireOptions[this.expirePosition].value;
      }

      const now = this.timestamp || Date.now();

      const currentExpireTime = currentExpire * blockTime + now;
      const newExpireTime = newExpire * blockTime + now;

      const runningTill = {
        current: currentExpireTime,
        new: newExpireTime,
      };

      return runningTill;
    },
    skin() {
      return useAppConfig().skin.value;
    },
    zelidHeader() {
      const zelidauth = localStorage.getItem('zelidauth');
      const headers = {
        zelidauth,
      };
      return headers;
    },
    ipAddress() {
      const backendURL = store.get('backendURL');
      if (backendURL) {
        return `${store.get('backendURL').split(':')[0]}:${store.get('backendURL').split(':')[1]}`;
      }
      const { hostname } = window.location;
      return `${hostname}`;
    },
    filesToUpload() {
      return this.files.length > 0 && this.files.some((file) => !file.uploading && !file.uploaded && file.progress === 0);
    },
    computedFileProgress() {
      return this.fileProgress;
    },
    computedFileProgressFD() {
      return this.fileProgressFD;
    },
    computedFileProgressVolume() {
      return this.fileProgressVolume;
    },
    folderContentFilter() {
      const filteredFolder = this.folderView.filter((data) => JSON.stringify(data.name).toLowerCase().includes(this.filterFolder.toLowerCase()));
      const upButton = this.currentFolder ? { name: '..', symLink: true, isUpButton: true } : null;
      const filteredResults = [upButton, ...filteredFolder.filter((data) => data.name !== '.gitkeep')].filter(Boolean);
      return filteredResults;
    },
    downloadLabel() {
      // eslint-disable-next-line vue/no-side-effects-in-computed-properties
      this.totalMB = this.backupList.reduce((acc, backup) => acc + parseFloat(backup.file_size), 2);
      const progressMB = (this.downloadedSize / (1024 * 1024)).toFixed(2);
      // const totalMB = (this.total / (1024 * 1024)).toFixed(2);
      if (progressMB === this.totalMB) {
        // eslint-disable-next-line vue/no-async-in-computed-properties
        setTimeout(() => {
          this.showProgressBar = false;
        }, 5000);
      }
      return `${progressMB} / ${this.totalMB} MB`;
    },
    isValidUrl() {
      const urlRegex = /^(http|https):\/\/[^\s]+$/;
      const urlParts = this.restoreRemoteUrl.split('?');
      const firstPart = urlParts[0];
      // eslint-disable-next-line no-mixed-operators
      return this.restoreRemoteUrl === '' || (firstPart.endsWith('.tar.gz') && urlRegex.test(firstPart));
    },
    urlValidationState() {
      return this.isValidUrl ? null : false;
    },
    urlValidationMessage() {
      return this.isValidUrl ? null : 'Please enter a valid URL ending with .tar.gz';
    },
    computedRestoreRemoteURLFields() {
      return this.RestoreTableBuilder('URL');
    },
    computedRestoreUploadFileFields() {
      return this.RestoreTableBuilder('File_name');
    },
    checkpointsTable() {
      return [
        { key: 'name', label: 'Name', thStyle: { width: '70%' } },
        { key: 'date', label: 'Date', thStyle: { width: '20%' } },
        { key: 'action', label: 'Action', thStyle: { width: '5%' } },
      ];
    },
    componentsTable1() {
      return [
        { key: 'component', label: 'Component Name', thStyle: { width: '200px' } },
        { key: 'file_url', label: 'URL' },
        { key: 'file_size', label: 'Size', thStyle: { width: '100px' } },
        {
          key: 'actions',
          label: 'Actions',
          thStyle: { width: '117px' },
          class: 'text-center',
        },
      ];
    },
    componentAvailableOptions() {
      if (this.components.length === 1) {
        // eslint-disable-next-line vue/no-side-effects-in-computed-properties
        this.selectedBackupComponents = this.components;
      }
      return this.components.filter((opt) => this.selectedBackupComponents.indexOf(opt) === -1);
    },
    remoteFileComponents() {
      if (this.components.length === 1) {
        // eslint-disable-next-line vue/no-side-effects-in-computed-properties
        this.restoreRemoteFile = this.components[0];
        return true;
      }
      return false;
    },
    remoteUrlComponents() {
      if (this.components.length === 1) {
        // eslint-disable-next-line vue/no-side-effects-in-computed-properties
        this.restoreRemoteUrlComponent = this.components[0];
        return true;
      }
      return false;
    },
    isComposeSingle() {
      if (this.appSpecification.version <= 3) {
        return true;
      }
      return this.appSpecification.compose?.length === 1;
    },
    selectedOptionText() {
      const selectedOption = this.options
        .flatMap((group) => group.options)
        .find((option) => option === this.selectedCmd);
      return selectedOption || '';
    },
    selectedOptionTextStyle() {
      return {
        color: 'red',
        backgroundColor: 'rgba(128, 128, 128, 0.1)',
        fontWeight: 'bold',
        padding: '4px 8px',
        borderRadius: '4px',
        marginRight: '10px',
        marginLeft: '10px',
      };
    },
    ...mapState('flux', [
      'config',
      'privilege',
    ]),
    instancesLocked() {
      try {
        if (this.appUpdateSpecification.name && this.marketPlaceApps.length) {
          const marketPlaceApp = this.marketPlaceApps.find((app) => this.appUpdateSpecification.name.toLowerCase().startsWith(app.name.toLowerCase()));
          if (marketPlaceApp) {
            if (marketPlaceApp.lockedValues && marketPlaceApp.lockedValues.includes('instances')) {
              return true;
            }
          }
        }
        return false;
      } catch (error) {
        console.log(error);
        return false;
      }
    },
    priceMultiplier() {
      try {
        if (this.appUpdateSpecification.name && this.marketPlaceApps.length) {
          const marketPlaceApp = this.marketPlaceApps.find((app) => this.appUpdateSpecification.name.toLowerCase().startsWith(app.name.toLowerCase()));
          if (marketPlaceApp) {
            if (marketPlaceApp.multiplier > 1) {
              return marketPlaceApp.multiplier * this.generalMultiplier;
            }
          }
        }
        return this.generalMultiplier;
      } catch (error) {
        console.log(error);
        return this.generalMultiplier;
      }
    },
    callbackValue() {
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
          this.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          this.$store.commit('flux/setFluxPort', apiPort);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += this.config.apiPort;
      }
      const backendURL = store.get('backendURL') || mybackend;
      const url = `${backendURL}/id/providesign`;
      return encodeURI(url);
    },
    paymentCallbackValue() {
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
        if (typeof hostname === 'string') {
          this.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          this.$store.commit('flux/setFluxPort', apiPort);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += this.config.apiPort;
      }
      const backendURL = store.get('backendURL') || mybackend;
      const url = `${backendURL}/payment/verifypayment?paymentid=${this.paymentId}`;
      return encodeURI(url);
    },
    isAppOwner() {
      const zelidauth = localStorage.getItem('zelidauth');
      const zelidHeader = qs.parse(zelidauth);
      if (zelidauth && zelidHeader && zelidHeader.zelid && (this.selectedAppOwner === zelidHeader.zelid || this.privilege === 'fluxteam')) {
        return true;
      }
      return false;
    },
    validTill() {
      const expTime = this.timestamp + 60 * 60 * 1000; // 1 hour
      return expTime;
    },
    subscribedTill() {
      const expire = this.convertExpire();
      if (expire) {
        const timeFound = this.expireOptions.find((option) => option.value === expire);
        if (timeFound) {
          const expTime = Math.floor((this.timestamp + timeFound.time) / 1000000) * 1000000;
          return expTime;
        }
        const blocks = expire;
        // Calculate time based on current block height
        // Before fork (block 2020000): 2 minutes per block
        // After fork: 30 seconds per block
        const forkBlock = FORK_BLOCK_HEIGHT;
        const currentBlock = this.daemonBlockCount;

        let validTime = 0;
        if (currentBlock < forkBlock) {
          // Currently before fork: 2 minutes per block
          validTime = blocks * 2 * 60 * 1000;
        } else {
          // Currently after fork: 30 seconds per block
          validTime = blocks * 30 * 1000;
        }

        const expTime = Math.floor((this.timestamp + validTime) / 1000000) * 1000000;
        return expTime;
      }
      const expTime = Math.floor((this.timestamp + 30 * 24 * 60 * 60 * 1000) / 1000000) * 1000000; // 1 month
      return expTime;
    },
    isApplicationInstalledLocally() {
      if (this.installedApps) {
        const installed = this.installedApps.find((app) => app.name === this.appName);
        if (installed) {
          return true;
        }
        return false;
      }
      return false;
    },
    constructAutomaticDomainsGlobal() {
      if (!this.callBResponse.data) {
        return 'loading...';
      }

      console.log(this.callBResponse.data);

      if (!this.callBResponse.data.name) {
        return 'loading...';
      }

      const appName = this.callBResponse.data.name;

      const lowerCaseName = appName.toLowerCase();

      if (!this.callBResponse.data.compose) {
        const ports = JSON.parse(JSON.stringify(this.callBResponse.data.ports));
        const domains = [`${lowerCaseName}.app.runonflux.io`];
        // flux specs dont allow more than 10 ports so domainString is enough
        for (let i = 0; i < ports.length; i += 1) {
          const portDomain = `${lowerCaseName}_${ports[i]}.app.runonflux.io`;
          domains.push(portDomain);
        }
        return domains;
      }
      const domains = [`${lowerCaseName}.app.runonflux.io`];
      this.callBResponse.data.compose.forEach((component) => {
        for (let i = 0; i < component.ports.length; i += 1) {
          const portDomain = `${lowerCaseName}_${component.ports[i]}.app.runonflux.io`;
          domains.push(portDomain);
        }
      });
      return domains;
    },
    getExpireLabel() {
      if (this.expireOptions[this.expirePosition]) {
        return this.expireOptions[this.expirePosition].label;
      }
      return null;
    },
    minutesToString() {
      let value = this.minutesRemaining * 60;
      const units = {
        day: 24 * 60 * 60,
        hour: 60 * 60,
        minute: 60,
        second: 1,
      };
      const result = [];
      // eslint-disable-next-line no-restricted-syntax, guard-for-in
      for (const name in units) {
        const p = Math.floor(value / units[name]);
        if (p === 1) result.push(` ${p} ${name}`);
        if (p >= 2) result.push(` ${p} ${name}s`);
        value %= units[name];
      }
      return result;
    },
    getNewExpireLabel() {
      if (this.daemonBlockCount === -1) {
        return 'Not possible to calculate expiration';
      }
      // Use dynamic default expire based on block height (1 month)
      const multiplier = this.daemonBlockCount >= FORK_BLOCK_HEIGHT ? 4 : 1;
      const defaultExpire = 22000 * multiplier;
      const expires = this.callBResponse.data.expire || defaultExpire;
      const blocksToExpire = this.callBResponse.data.height + expires - this.daemonBlockCount;
      if (blocksToExpire < 1) {
        return 'Application Expired';
      }
      // Block time: 2 minutes before fork, 30 seconds (0.5 minutes) after fork
      const forkBlock = FORK_BLOCK_HEIGHT;
      const minutesPerBlock = this.daemonBlockCount >= forkBlock ? 0.5 : 2;
      // eslint-disable-next-line vue/no-side-effects-in-computed-properties
      this.minutesRemaining = blocksToExpire * minutesPerBlock;
      const result = this.minutesToString;
      if (result.length > 2) {
        return `${result[0]}, ${result[1]}, ${result[2]}`;
      }
      if (result.length > 1) {
        return `${result[0]}, ${result[1]}`;
      }
      return `${result[0]}`;
    },
  },
  watch: {
    selectedIp(newVal, oldVal) {
      // we only want to run this on changes, not on the initial load
      if (!oldVal || oldVal === newVal) return;

      this.selectedIpChanged();
    },
    skin() {
      if (this.memoryChart !== null) {
        this.updateCharts();
      }
    },
    noData() {
      if (this.memoryChart !== null) {
        this.updateCharts();
      }
    },
    filterKeyword() {
      if (this.logs?.length > 0) {
        this.$nextTick(() => {
          this.scrollToBottom();
        });
      }
    },
    isLineByLineMode() {
      if (!this.isLineByLineMode) {
        this.selectedLog = [];
      }
      if (this.logs?.length > 0) {
        this.$nextTick(() => {
          this.scrollToBottom();
        });
      }
    },
    fetchAllLogs() {
      this.restartPolling();
    },
    lineCount() {
      this.debounce(() => this.restartPolling(), 1000)();
    },
    sinceTimestamp() {
      this.restartPolling();
    },
    selectedApp(newValue, oldValue) {
      if (oldValue && oldValue !== newValue) {
        this.filterKeyword = '';
        this.sinceTimestamp = '';
        this.stopPolling();
        this.clearLogs();
      }
      if (newValue) {
        this.handleContainerChange();
        if (this.pollingEnabled) {
          this.startPolling();
        }
      }
    },
    selectedContainerMonitoring(newValue) {
      if (newValue) {
        this.buttonStats = false;
        if (!this.enableHistoryStatistics) {
          if (this.timerStats) this.stopPollingStats();
          if (this.selectedContainerMonitoring !== null) this.startPollingStats();
          this.clearCharts();
        } else {
          this.stopPollingStats();
          this.fetchStats();
        }
      }
    },
    refreshRateMonitoring() {
      if (!this.enableHistoryStatistics) {
        if (this.timerStats) this.stopPollingStats();
        this.startPollingStats();
      } else {
        this.stopPollingStats();
      }
    },
    isComposeSingle(value) {
      if (value) {
        if (this.appSpecification.version >= 4) {
          this.selectedApp = this.appSpecification.compose[0].name;
          this.selectedAppVolume = this.appSpecification.compose[0].name;
          this.selectedContainerMonitoring = this.appSpecification.compose[0].name;
        }
      }
    },
    appUpdateSpecification: {
      handler() {
        this.dataToSign = '';
        this.signature = '';
        this.timestamp = null;
        this.dataForAppUpdate = {};
        this.updateHash = '';
        this.testError = false;
        this.output = [];
        if (this.websocket !== null) {
          this.websocket.close();
          this.websocket = null;
        }
      },
      deep: true,
    },
    expirePosition: {
      handler() {
        this.dataToSign = '';
        this.signature = '';
        this.timestamp = null;
        this.dataForAppUpdate = {};
        this.updateHash = '';
        this.testError = false;
        this.output = [];
        if (this.websocket !== null) {
          this.websocket.close();
          this.websocket = null;
        }
      },
    },
    isPrivateApp(value) {
      if (this.appUpdateSpecification.version >= 7 && value === false) {
        this.appUpdateSpecification.nodes = [];
        this.appUpdateSpecification.compose.forEach((component) => {
          if (this.appUpdateSpecification.version === 7 && value === false) {
            // eslint-disable-next-line no-param-reassign
            component.secrets = '';
          }
          // eslint-disable-next-line no-param-reassign
          component.repoauth = '';
        });
        this.selectedEnterpriseNodes = [];
      }
      if (this.appUpdateSpecification.version === 7 && value === false) {
        // remove any geolocation
        this.allowedGeolocations = {};
        this.forbiddenGeolocations = {};
      }
      if (this.appUpdateSpecification.version === 8 && value === false) {
        this.appUpdateSpecification.enterprise = '';
      }
      this.dataToSign = '';
      this.signature = '';
      this.timestamp = null;
      this.dataForAppUpdate = {};
      this.updateHash = '';
      this.testError = false;
      this.output = [];
      if (this.websocket !== null) {
        this.websocket.close();
        this.websocket = null;
      }
    },
  },
  created() {
    this.fluxDriveUploadTask = [];
    this.fluxDriveEndPoint = 'https://mws.fluxdrive.runonflux.io';
  },
  mounted() {
    this.$nextTick(() => {
      setTimeout(() => {
        window.scrollTo({ top: 0, left: 0 });
      }, 200);
    });
    loader.init().then(() => {
      this.monacoReady = true;
      console.log('Monaco initialized:', !!window.monaco);
    });
    const { hostname } = window.location;
    const regex = /[A-Za-z]/g;
    if (hostname.match(regex)) {
      this.ipAccess = false;
    } else {
      this.ipAccess = true;
    }
    const self = this;
    this.$nextTick(() => {
      window.addEventListener('resize', self.onResize);
    });
    this.getZelidAuthority();
    this.initMMSDK();
    this.callBResponse.data = '';
    this.callBResponse.status = '';
    this.appSpecification = {};
    this.callResponse.data = '';
    this.callResponse.status = '';
    this.monitoringStream = {};
    this.appExec.cmd = '';
    this.appExec.env = '';
    this.checkFluxCommunication();
    this.getAppOwner();
    // this.getGlobalApplicationSpecifics();
    // this.getInstalledApplicationSpecifics();
    this.appsDeploymentInformation();
    this.getGeolocationData();
    this.getMarketPlace();
    this.getMultiplier();
    this.getEnterpriseNodes();
    this.getDaemonBlockCount();
    // this.initCharts();
  },
  beforeDestroy() {
    this.stopPolling();
    this.stopPollingStats();
    window.removeEventListener('resize', this.onResize);
    if (this.editorInstance) {
      this.editorInstance.dispose();
      this.editorInstance = null;
    }
    this.$store.commit('flux/setAppName', '');
  },
  methods: {
    /**
     *
     * @param {{local?: boolean}} options local - If the command is on the "selected node"
     * @returns {Promise<Object>}
     */
    async getDecryptedEnterpriseFields(options = {}) {
      const local = options.local ?? false;

      // this should be cached
      const ownerRes = await AppsService.getAppOriginalOwner(this.appName);

      const { data: { status: ownerStatus, data: originalOwner } } = ownerRes;

      if (ownerStatus !== 'success') {
        this.showToast('error', 'Unable to get app owner');
        return null;
      }

      const zelidauth = localStorage.getItem('zelidauth');

      const appPubKeyData = {
        name: this.appName,
        owner: originalOwner,
      };

      // this should be cached
      const pubkeyRes = await AppsService.getAppPublicKey(
        zelidauth,
        appPubKeyData,
      );

      const { data: { status: pubkeyStatus, data: pubkey } } = pubkeyRes;

      if (pubkeyStatus !== 'success') {
        this.showToast('error', 'Unable to get encryption pubkey');
        return null;
      }

      const rsaPubKey = await this.importRsaPublicKey(pubkey);

      const aesKey = crypto.getRandomValues(new Uint8Array(32));

      const encryptedEnterpriseKey = await this.encryptAesKeyWithRsaKey(
        aesKey,
        rsaPubKey,
      );
      console.log('Encrypted Enterprise key:', encryptedEnterpriseKey);

      const axiosConfig = {
        headers: {
          zelidauth,
          'enterprise-key': encryptedEnterpriseKey,
        },
      };

      const endpoint = `/apps/appspecifications/${this.appName}/true`;

      const executor = local
        ? () => this.executeLocalCommand(endpoint, null, axiosConfig)
        : () => AppsService.getAppEncryptedSpecifics(
          this.appName,
          zelidauth,
          encryptedEnterpriseKey,
        );

      const encryptedRes = await executor();

      const fetchType = local ? 'local' : 'global';

      console.log(`Get ${fetchType} encrypted fields`, encryptedRes);

      const { data: { status: encryptedStatus, data: specs } } = encryptedRes;

      if (encryptedStatus !== 'success') {
        this.showToast('danger', 'Unable to get encrypted app data');
        this.callBResponse.status = encryptedStatus;
        // should this also set the data? this whole using globals for this stuff
        // makes the control flow super hard to follow
        return null;
      }

      console.log('Enterprise field: ', specs.enterprise);

      const enterpriseDecrypted = await this.decryptEnterpriseWithAes(
        specs.enterprise,
        aesKey,
      ).catch((err) => {
        console.log('Error found:', err);
        return null;
      });

      if (!enterpriseDecrypted) {
        this.showToast('danger', 'Unable to decrypt app specs');
        return null;
      }

      const parsedDecrypted = JSON.parse(enterpriseDecrypted);

      return parsedDecrypted;
    },
    normalizeComponents(data) {
      if (!data) return [];
      return data.version >= 4 ? data.compose : [{ ...data, repoauth: false }];
    },
    updateEditorLanguage() {
      if (this.$refs?.monacoEditor) {
        this.$refs.monacoEditor.editor.updateOptions({ language: this.editorLanguage });
      }
    },
    getProgressVariant() {
      const percentage = this.usagePercentage;
      // eslint-disable-next-line no-nested-ternary
      return percentage >= 95 ? 'danger' : percentage >= 75 ? 'warning' : 'success';
    },
    async logout(expired) {
      if (!this.logoutTigger) {
        this.logoutTigger = true;
        const zelidauth = localStorage.getItem('zelidauth');
        const auth = qs.parse(zelidauth);
        localStorage.removeItem('zelidauth');
        this.$store.commit('flux/setPrivilege', 'none');
        this.$store.commit('flux/setZelid', '');
        console.log(auth);
        IDService.logoutCurrentSession(zelidauth)
          .then((response) => {
            console.log(response);
            if (response.data.status === 'error') {
              console.log(response.data.data.message);
            // SHOULD NEVER HAPPEN. Do not show any message.
            } else {
              if (expired) {
                this.showToast('warning', 'Session expired, logging out...');
              } else {
                this.showToast('success', response.data.data.message);
              }
              // Redirect to home page
              if (this.$route.path === '/') {
                window.location.reload();
              } else {
                this.$router.push({ name: 'home' });
              }
            }
          })
          .catch((e) => {
            console.log(e);
            this.showToast('danger', e.toString());
          });
        try {
          await firebase.auth().signOut();
        } catch (error) {
          console.log(error);
        }
      }
    },
    // Stats Section START
    enableHistoryStatisticsChange() {
      this.buttonStats = false;
      this.noData = false;
      if (this.enableHistoryStatistics) {
        this.stopPollingStats();
        this.clearCharts();
        this.fetchStats();
      } else {
        this.clearCharts();
        this.startPollingStats();
      }
    },
    LimitChartItems(chart) {
      const datasetLength = chart.data.datasets[0].data.length;
      if (datasetLength > this.selectedPoints) {
        const excess = datasetLength - this.selectedPoints;
        chart.data.labels = chart.data.labels.slice(excess);
        chart.data.datasets.forEach((dataset) => {
          dataset.data = dataset.data.slice(excess);
        });
        chart.update({
          duration: 800,
          lazy: false,
          easing: 'easeOutBounce',
        });
      }
    },
    async scrollToPagination() {
      await this.$nextTick();
      window.scrollTo(0, document.body.scrollHeight);
    },
    getHddByName(applications, appName) {
      if (applications?.compose) {
        const app = applications.compose.find((application) => application.name === appName);
        return app.hdd;
      // eslint-disable-next-line no-else-return
      } else {
        return applications.hdd;
      }
    },
    getCpuByName(applications, appName) {
      if (applications?.compose) {
        const app = applications.compose.find((application) => application.name === appName);
        return app.cpu;
      // eslint-disable-next-line no-else-return
      } else {
        return applications.cpu;
      }
    },
    processStatsData(statsData, timeStamp = null) {
      console.log(statsData);
      const memoryLimitBytes = statsData.memory_stats.limit;
      this.memoryLimit = memoryLimitBytes;
      const memoryUsageBytes = statsData.memory_stats?.usage ?? null;
      const memoryUsageMB = memoryUsageBytes;
      const memoryUsagePercentage = ((memoryUsageBytes / memoryLimitBytes) * 100).toFixed(1);
      const cpuUsage = statsData.cpu_stats.cpu_usage.total_usage - statsData.precpu_stats.cpu_usage.total_usage;
      const systemCpuUsage = statsData.cpu_stats.system_cpu_usage - statsData.precpu_stats.system_cpu_usage;
      const onlineCpus = statsData.cpu_stats.online_cpus;
      const { nanoCpus } = statsData;
      let cpuCores;
      if (this.appSpecification.version >= 4) {
        cpuCores = this.getCpuByName(this.appSpecification, this.selectedContainerMonitoring);
      } else {
        cpuCores = this.appSpecification.cpu;
      }
      const rawCpu = (((cpuUsage / systemCpuUsage) * onlineCpus)).toFixed(2) || 0;
      // eslint-disable-next-line no-mixed-operators
      const cpuSize = ((rawCpu / (nanoCpus / cpuCores / 1e9) * 100) / 100).toFixed(2);
      // eslint-disable-next-line no-mixed-operators
      const cpuPercent = ((rawCpu / (nanoCpus / cpuCores / 1e9) * 100) / cpuCores).toFixed(2);
      this.cpuSet = cpuCores;
      const ioReadBytes = statsData.blkio_stats.io_service_bytes_recursive ? statsData.blkio_stats.io_service_bytes_recursive.find((i) => i.op.toLowerCase() === 'read')?.value || 0 : null;
      const ioWriteBytes = statsData.blkio_stats.io_service_bytes_recursive ? statsData.blkio_stats.io_service_bytes_recursive.find((i) => i.op.toLowerCase() === 'write')?.value || 0 : null;
      const networkRxBytes = statsData.networks?.eth0?.rx_bytes ?? null;
      const networkTxBytes = statsData.networks?.eth0?.tx_bytes ?? null;
      const diskUsageMounts = statsData.disk_stats?.bind ?? null;
      let hddSize;
      if (this.appSpecification.version >= 4) {
        hddSize = this.getHddByName(this.appSpecification, this.selectedContainerMonitoring);
      } else {
        hddSize = this.appSpecification.hdd;
      }
      this.diskBindLimit = Number(hddSize) * 1024 * 1024 * 1024;
      this.diskUsagePercentage = (diskUsageMounts / this.diskBindLimit) * 100;
      const diskUsageDocker = statsData.disk_stats?.volume ?? null;
      const diskUsageRootFs = statsData.disk_stats?.rootfs ?? null;

      console.log('Resource Metrics:', {
        'CPU Size': cpuSize,
        'CPU Percent': cpuPercent,
        'Memory Usage (MB)': memoryUsageMB,
        'Memory Usage (%)': memoryUsagePercentage,
        'Network RX Bytes': networkRxBytes,
        'Network TX Bytes': networkTxBytes,
        'I/O Read Bytes': ioReadBytes,
        'I/O Write Bytes': ioWriteBytes,
        'Disk Usage Mounts': diskUsageMounts,
        'Disk Usage Volume': diskUsageDocker,
        'Disk Usage RootFS': diskUsageRootFs,
      });

      this.insertChartData(cpuPercent, memoryUsageMB, memoryUsagePercentage, networkRxBytes, networkTxBytes, ioReadBytes, ioWriteBytes, diskUsageMounts, diskUsageDocker, diskUsageRootFs, cpuSize, timeStamp);
    },
    async fetchStats() {
      try {
        if (this.appSpecification.version >= 4) {
          if (!this.selectedContainerMonitoring) {
            console.error('No container selected');
            if (this.timerStats) this.stopPollingStats();
            return;
          }
        }
        if (this.$refs.managementTabs?.currentTab !== 3) {
          return;
        }
        if (this.enableHistoryStatistics) {
          this.clearCharts();
        }
        const containerName = this.selectedContainerMonitoring;
        const appname = this.selectedContainerMonitoring ? `${this.selectedContainerMonitoring}_${this.appSpecification.name}` : this.appSpecification.name;
        let statsResponse;
        this.additionalMessage = '';
        if (this.enableHistoryStatistics) {
          statsResponse = await this.executeLocalCommand(`/apps/appmonitor/${appname}/${this.selectedTimeRange}`);
        } else {
          statsResponse = await this.executeLocalCommand(`/apps/appstats/${appname}`);
        }
        const inspectResponse = await this.executeLocalCommand(`/apps/appinspect/${appname}`);
        if (statsResponse.data.status === 'error') {
          this.showToast('danger', statsResponse.data.data.message || statsResponse.data.data);
        } else if (inspectResponse.data.status === 'error') {
          this.showToast('danger', inspectResponse.data.data.message || inspectResponse.data.data);
        } else {
          if (!this.enableHistoryStatistics) {
            this.fetchProcesses(appname, containerName);
          }
          const configData = inspectResponse.data;
          const status = configData.data?.State?.Status;
          if (status !== 'running' && !this.enableHistoryStatistics) {
            this.noData = true;
            if (status === 'exited') {
              this.additionalMessage = '(Container marked as stand by)';
            } else {
              this.additionalMessage = '(Container not running)';
            }
            this.stopPollingStats(true);
            return;
          }
          let statsData;
          if (statsResponse.data?.data?.lastDay) {
            statsData = statsResponse.data.data.lastDay.reverse();
          } else {
            statsData = statsResponse.data.data;
          }
          if (Array.isArray(statsData)) {
            statsData.forEach((stats) => {
              this.processStatsData(stats.data, stats.timestamp);
            });
          } else {
            this.processStatsData(statsData);
          }
          if (containerName === this.selectedContainerMonitoring) {
            this.updateCharts();
          } else {
            this.clearCharts();
          }
        }
      } catch (error) {
        console.error('Error fetching container data:', error);
        this.stopPollingStats(true);
      }
    },
    updateAxes() {
      // Check and update the Y-axis limits for the memory chart
      if (this.memoryChart.data.labels.length === 1) {
        this.memoryChart.options.scales.y.max = this.memoryLimit * 1.2;
        this.memoryChart.options.scales.y1.max = 120;
      }
      // Check and update the Y-axis limits for the CPU chart
      if (this.cpuChart.data.labels.length === 1) {
        this.cpuChart.options.scales.y.max = (this.cpuSet * 1.35).toFixed(1);
        this.cpuChart.options.scales.y1.max = 135;
      }
    },
    insertChartData(cpuPercent, memoryUsageMB, memoryUsagePercentage, networkRxBytes, networkTxBytes, ioReadBytes, ioWriteBytes, diskUsageMounts, diskUsageDocker, diskUsageRootFs, cpuSize, timeStamp = null) {
      const timeLabel = timeStamp === null ? new Date().toLocaleTimeString() : new Date(timeStamp).toLocaleTimeString();
      // Update memory chart
      if (memoryUsageMB !== null) {
        this.LimitChartItems(this.memoryChart);
        this.memoryChart.data.labels.push(timeLabel);
        this.memoryChart.data.datasets[0].data.push(memoryUsageMB);
        this.memoryChart.data.datasets[1].data.push(memoryUsagePercentage);
      }
      // Update CPU chart
      if (!Number.isNaN(Number(cpuSize)) && !Number.isNaN(Number(cpuPercent))) {
        this.LimitChartItems(this.cpuChart);
        this.cpuChart.data.labels.push(timeLabel);
        this.cpuChart.data.datasets[0].data.push(cpuSize);
        this.cpuChart.data.datasets[1].data.push(cpuPercent);
      }
      // Update Network chart
      if (networkRxBytes !== null && networkTxBytes !== null) {
        this.LimitChartItems(this.networkChart);
        this.networkChart.data.labels.push(timeLabel);
        this.networkChart.data.datasets[0].data.push(networkRxBytes);
        this.networkChart.data.datasets[1].data.push(networkTxBytes);
      }
      // Update I/O chart
      if (ioReadBytes !== null && ioWriteBytes !== null) {
        this.LimitChartItems(this.ioChart);
        this.ioChart.data.labels.push(timeLabel);
        this.ioChart.data.datasets[0].data.push(ioReadBytes);
        this.ioChart.data.datasets[1].data.push(ioWriteBytes);
      }
      // Update Persistent Storage chart
      if (diskUsageMounts !== null) {
        this.LimitChartItems(this.diskPersistentChart);
        this.diskPersistentChart.data.labels.push(timeLabel);
        this.diskPersistentChart.data.datasets[0].data.push(diskUsageMounts);
      }
      if (diskUsageDocker !== null) {
        this.diskPersistentChart.data.datasets[1].data.push(diskUsageDocker);
      }
      if (this.diskPersistentChart.data?.datasets[1]?.data) {
        const hasValuesGreaterThanZero = Array.isArray(this.diskPersistentChart.data.datasets[1].data) && this.diskPersistentChart.data.datasets[1].data.some((value) => value > 0);
        if (hasValuesGreaterThanZero) {
          this.diskPersistentChart.data.datasets[1].hidden = false;
        } else {
          this.diskPersistentChart.data.datasets[1].hidden = true;
        }
      }
      // Update File System chart
      if (diskUsageRootFs !== null) {
        this.LimitChartItems(this.diskFileSystemChart);
        this.diskFileSystemChart.data.labels.push(timeLabel);
        this.diskFileSystemChart.data.datasets[0].data.push(diskUsageRootFs);
      }
      this.noData = true;
      this.updateAxes();
    },
    updateCharts() {
      this.memoryChart.update();
      this.cpuChart.update();
      this.networkChart.update();
      this.ioChart.update();
      this.diskPersistentChart.update();
      this.diskFileSystemChart.update();
    },
    formatDataSize(bytes, options = { base: 10, round: 1 }) {
      if (bytes <= 5) {
        return `${bytes} B`;
      }
      const base = options.base === 10 ? 1000 : 1024; // Base 10 for SI, Base 2 for binary
      const labels = options.base === 10 ? ['B', 'KB', 'MB', 'GB'] : ['B', 'KiB', 'MiB', 'GiB'];
      if (bytes === 0) return '0 B';
      let size = bytes;
      let index = 0;
      while (size >= base && index < labels.length - 1) {
        size /= base;
        // eslint-disable-next-line no-plusplus
        index++;
      }
      return `${parseFloat(size.toFixed(options.round)).toString()} ${labels[index]}`;
    },
    async fetchProcesses(appname, continer) {
      try {
        const response = await this.executeLocalCommand(`/apps/apptop/${appname}`);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
          this.stopPollingStats(true);
          return;
        }
        if (this.selectedContainerMonitoring === continer) {
          this.processes = (response.data?.data?.Processes || []).map((proc) => ({
            uid: proc[0],
            pid: proc[1],
            ppid: proc[2],
            c: proc[3],
            stime: proc[4],
            tty: proc[5],
            time: proc[6],
            cmd: proc[7],
          }));
        } else {
          this.processes = [];
          console.error('Selected container has changed. Proccess list discarded.');
        }
      } catch (error) {
        console.error('Error fetching processes:', error);
      }
    },
    initCharts() {
      if (this.memoryChart) {
        this.memoryChart.destroy();
        this.cpuChart.destroy();
        this.networkChart.destroy();
        this.ioChart.destroy();
        this.diskPersistentChart.destroy();
        this.diskFileSystemChart.destroy();
      }
      const memoryCtx = document.getElementById('memoryChart').getContext('2d');
      const cpuCtx = document.getElementById('cpuChart').getContext('2d');
      const networkCtx = document.getElementById('networkChart').getContext('2d');
      const ioCtx = document.getElementById('ioChart').getContext('2d');
      const diskPersistentCtx = document.getElementById('diskPersistentChart').getContext('2d');
      const diskFileSystemCtx = document.getElementById('diskFileSystemChart').getContext('2d');

      const noDataPlugin = {
        id: 'noDataPlugin',
        beforeDraw: (chart) => {
          if (chart.data.datasets.every((dataset) => dataset.data.length === 0) && this.noData === true) {
            const { ctx, width, height } = chart;
            ctx.save();
            const fontSize = Math.min(width, height) / 14;
            ctx.font = `400 ${fontSize}px Arial`;
            if (this.skin === 'dark') {
              ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            } else {
              ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            }
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.translate(width / 2, height / 2);
            ctx.fillText('No Data Available', 0, 0);

            const additionalMessage = this.additionalMessage || '';
            const additionalFontSize = fontSize * 0.7;
            ctx.font = `400 ${additionalFontSize}px Arial`;
            ctx.fillText(additionalMessage, 0, fontSize);

            ctx.restore();
          }
        },
      };

      this.diskPersistentChart = new Chart(diskPersistentCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Bind',
              data: [],
              fill: true,
              backgroundColor: 'rgba(119,255,132,0.3)',
              borderColor: 'rgba(119,255,132,0.6)',
              tension: 0.4,
            },
            {
              label: 'Volume',
              data: [],
              borderColor: 'rgba(155,99,132,1)',
              borderDash: [5, 5],
              pointRadius: 2,
              borderWidth: 2,
              tension: 0.5,
              fill: false,
            },

          ],
        },
        options: {
          responsive: true,
          scales: {
            x: { title: { display: true, text: '' } },
            y: { title: { display: true, text: '' }, beginAtZero: true, ticks: { callback: (value) => this.formatDataSize(value, { base: 2, round: 0 }) } },
          },
          plugins: {
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: (tooltipItem) => {
                  const datasetLabel = tooltipItem.dataset.label;
                  const dataValue = tooltipItem.raw;
                  return `${datasetLabel}: ${this.formatDataSize(dataValue, { base: 2, round: 1 })}`;
                },
                footer: () => [
                  `Available Bind Size: ${this.formatDataSize(this.diskBindLimit, { base: 2, round: 1 })}`,
                  `Bind Usage (%): ${this.diskUsagePercentage.toFixed(2)}%`,
                ],
              },
            },
            legend: {
              display: true,
              labels: {
                filter: (item) => {
                  // Check if diskPersistentChart is null
                  if (!this.diskPersistentChart) return true; // If null, do not display any labels
                  if (item.datasetIndex === 1) {
                    const datasetData = this.diskPersistentChart.data.datasets[item.datasetIndex]?.data; // Get the data for dataset index 1
                    // Check if dataset exists and has values greater than zero
                    const hasValuesGreaterThanZero = Array.isArray(datasetData) && datasetData.some((value) => value > 0);
                    return hasValuesGreaterThanZero; // Return true to keep in legend
                  }
                  return true;
                },
              },
            },
          },
          // eslint-disable-next-line no-dupe-keys
        },
        plugins: [noDataPlugin],
      });

      this.diskFileSystemChart = new Chart(diskFileSystemCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'File System (RootFS)',
              data: [],
              fill: true,
              backgroundColor: 'rgba(159,155,132,0.3)',
              borderColor: 'rgba(159,155,132,0.6)',
              tension: 0.4,
            },

          ],
        },
        options: {
          responsive: true,
          scales: {
            x: { title: { display: true, text: '' } },
            y: { title: { display: true, text: '' }, beginAtZero: true, ticks: { callback: (value) => this.formatDataSize(value, { base: 2, round: 0 }) } },
          },
          plugins: {
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: (tooltipItem) => {
                  const datasetLabel = tooltipItem.dataset.label;
                  const dataValue = tooltipItem.raw;
                  return `${datasetLabel}: ${this.formatDataSize(dataValue, { base: 2, round: 1 })}`;
                },
              },
            },
          },
        },
        plugins: [noDataPlugin],
      });

      this.memoryChart = new Chart(memoryCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Memory Allocated',
              data: [],
              fill: true,
              backgroundColor: 'rgba(151,187,205,0.4)',
              borderColor: 'rgba(151,187,205,0.6)',
              yAxisID: 'y',
              pointRadius: 2,
              borderWidth: 2,
              tension: 0.4,
            },
            {
              label: 'Memory Utilization (%)',
              data: [],
              fill: false,
              borderColor: 'rgba(255,99,132,1)',
              borderDash: [5, 5],
              yAxisID: 'y1',
              pointRadius: 2,
              borderWidth: 2,
              tension: 0.4,
            },
          ],
        },
        options: {
          responsive: true,
          scales: {
            x: { title: { display: true } },
            y: {
              id: 'y',
              title: { display: true },
              beginAtZero: true,
              precision: 0,
              ticks: {
                callback: (value) => this.formatDataSize(value, { base: 2, round: 1 }),
              },
            },
            y1: {
              id: 'y1',
              title: {
                display: true,
              },
              beginAtZero: true,
              position: 'right',
              grid: {
                display: false,
              },
              ticks: {
                callback: (value) => `${value}%`,
              },
            },
          },
          plugins: {
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: (tooltipItem) => {
                  const datasetLabel = tooltipItem.dataset.label;
                  const dataValue = tooltipItem.raw;
                  if (datasetLabel.includes('%')) {
                    return `Memory Utilization: ${dataValue}%`;
                  }
                  return `${datasetLabel}: ${this.formatDataSize(dataValue, { base: 2, round: 1 })}`;
                },
                footer: () => `Available Memory: ${this.formatDataSize(this.memoryLimit, { base: 2, round: 1 })}`,
              },
            },
          },
        },
        plugins: [noDataPlugin],
      });

      this.cpuChart = new Chart(cpuCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'CPU Allocated',
              data: [],
              fill: true,
              backgroundColor: 'rgba(255,99,132,0.4)',
              borderColor: 'rgba(255,99,132,0.6)',
              tension: 0.4,
            },
            {
              label: 'CPU Utilization (%)',
              fill: false,
              borderColor: 'rgba(255,99,132,1)',
              borderDash: [5, 5],
              yAxisID: 'y1',
              pointRadius: 2,
              borderWidth: 2,
              tension: 0.4,
            },

          ],
        },
        options: {
          responsive: true,
          scales: {
            x: { title: { display: true } },
            y: {
              id: 'y',
              title: { display: true },
              beginAtZero: true,
              ticks: { callback: (value) => `${value} CPU` },
            },
            y1: {
              id: 'y1',
              title: {
                display: true,
              },
              beginAtZero: true,
              position: 'right',
              grid: {
                display: false,
              },
              ticks: {
                callback: (value) => `${value}%`,
              },
            },

          },
          plugins: {
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: (tooltipItem) => {
                  const datasetLabel = tooltipItem.dataset.label;
                  const dataValue = tooltipItem.raw;
                  if (datasetLabel.includes('%')) {
                    return `CPU Utilization: ${dataValue}%`;
                  }
                  return `CPU Allocated: ${dataValue} CPU`;
                },
                footer: () => `Available CPU Core(s): ${this.cpuSet}`,
              },
            },
          },
        },
        plugins: [noDataPlugin],
      });

      this.networkChart = new Chart(networkCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'RX on eth0',
              data: [],
              fill: true,
              backgroundColor: 'rgba(99,255,132,0.4)',
              borderColor: 'rgba(99,255,132,0.6)',
              tension: 0.4,
            },
            {
              label: 'TX on eth0',
              data: [],
              fill: false,
              borderColor: 'rgba(132,99,255,1)',
              tension: 0.4,
            },
          ],
        },
        options: {
          responsive: true,
          scales: {
            x: { title: { display: true, text: '' } },
            y: { title: { display: true, text: '' }, beginAtZero: true, ticks: { callback: (value) => this.formatDataSize(value, { base: 10, round: 0 }) } },
          },
          plugins: {
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: (tooltipItem) => {
                  const datasetLabel = tooltipItem.dataset.label;
                  const dataValue = tooltipItem.raw;
                  return `${datasetLabel}: ${this.formatDataSize(dataValue)}`;
                },
              },
            },
          },
        },
        plugins: [noDataPlugin],
      });

      this.ioChart = new Chart(ioCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Read',
              data: [],
              fill: false,
              borderColor: 'rgba(99,132,255,0.6)',
              tension: 0.4,
            },
            {
              label: 'Write',
              data: [],
              fill: true,
              backgroundColor: 'rgba(255,132,99,0.4)',
              borderColor: 'rgba(255,132,99,0.6)',
              tension: 0.4,
            },
          ],
        },
        options: {
          responsive: true,
          scales: {
            x: { title: { display: true } },
            y: { title: { display: true }, beginAtZero: true, ticks: { callback: (value) => this.formatDataSize(value, { base: 10, round: 0 }) } },
          },
          plugins: {
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: (tooltipItem) => {
                  const datasetLabel = tooltipItem.dataset.label;
                  const dataValue = tooltipItem.raw;
                  return `${datasetLabel}: ${this.formatDataSize(dataValue)}`;
                },
              },
            },
          },
        },
        plugins: [noDataPlugin],
      });
      this.updateAxes();
    },
    startPollingStats(action = false) {
      if (!this.timerStats) {
        this.timerStats = setInterval(() => {
          this.fetchStats();
        }, this.refreshRateMonitoring);
      }
      if (action === true) {
        this.buttonStats = false;
      }
    },
    stopPollingStats(action = false) {
      clearInterval(this.timerStats);
      this.timerStats = null;
      if (action === true) {
        this.buttonStats = true;
      } else {
        this.noData = false;
      }
    },
    clearCharts() {
      if (!this.memoryChart) {
        return;
      }
      // Clear memory chart data
      this.noData = false;
      this.memoryChart.data.labels = [];
      this.memoryChart.data.datasets.forEach((dataset) => {
        dataset.data = [];
      });
      this.memoryChart.options.scales.y.max = 1.2;
      this.memoryChart.options.scales.y1.max = 120;
      this.memoryChart.update();

      this.memoryChart.update();
      // Clear CPU chart data
      this.cpuChart.data.labels = [];
      this.cpuChart.data.datasets.forEach((dataset) => {
        dataset.data = [];
      });
      this.cpuChart.options.scales.y.max = 1.2;
      this.cpuChart.options.scales.y1.max = 120;
      this.cpuChart.update();
      // Clear Network chart data
      this.networkChart.data.labels = [];
      this.networkChart.data.datasets.forEach((dataset) => {
        dataset.data = [];
      });
      this.networkChart.update();
      // Clear I/O chart data
      this.ioChart.data.labels = [];
      this.ioChart.data.datasets.forEach((dataset) => {
        dataset.data = [];
      });
      this.ioChart.update();
      this.diskPersistentChart.data.labels = [];
      this.diskPersistentChart.data.datasets.forEach((dataset) => {
        dataset.data = [];
      });
      this.diskPersistentChart.update();
      this.diskFileSystemChart.data.labels = [];
      this.diskFileSystemChart.data.datasets.forEach((dataset) => {
        dataset.data = [];
      });
      this.diskFileSystemChart.update();
      this.processes = [];
    },
    // Stats Section END
    extractTimestamp(log) {
      return log.split(' ')[0];
    },
    toggleLogSelection(log) {
      const logTimestamp = this.extractTimestamp(log);
      if (this.selectedLog.includes(logTimestamp)) {
        this.selectedLog = this.selectedLog.filter((ts) => ts !== logTimestamp);
      } else {
        this.selectedLog.push(logTimestamp);
      }
    },
    unselectText() {
      this.selectedLog = [];
    },
    async copyCode() {
      try {
        let textToCopy = '';
        if (this.isLineByLineMode && this.selectedLog.length > 0) {
          textToCopy = this.filteredLogs
            .filter((log) => this.selectedLog.includes(this.extractTimestamp(log)))
            .map((log) => log)
            .join('\n');
        } else {
          textToCopy = this.logs.join('\n');
        }
        // eslint-disable-next-line no-control-regex
        const ansiRegex = /\u001b\[[0-9;]*[a-zA-Z]/g;
        textToCopy = textToCopy.replace(ansiRegex, '');
        if (!this.displayTimestamps) {
          const timestampRegex = /^[^\s]+\s*/;
          textToCopy = textToCopy
            .split(/\r?\n/)
            .map((line) => line.replace(timestampRegex, ''))
            .join('\n');
        }
        // Use the Clipboard API for HTTPS
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(textToCopy);
        } else {
          // Fallback for HTTP
          const textarea = document.createElement('textarea');
          textarea.value = textToCopy;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }
        this.copied = true;
        setTimeout(() => {
          this.copied = false;
        }, 2000);
      } catch (error) {
        console.error('Failed to copy code:', error);
      }
    },
    debounce(func, delay) {
      return (...args) => {
        if (this.debounceTimeout) {
          clearTimeout(this.debounceTimeout);
        }
        this.debounceTimeout = setTimeout(() => func(...args), delay);
      };
    },
    async manualFetchLogs() {
      this.manualInProgress = true;
      await this.fetchLogsForSelectedContainer();
      this.manualInProgress = false;
    },
    async fetchLogsForSelectedContainer() {
      if (this.$refs.managementTabs?.currentTab !== 5) {
        return;
      }
      console.log('fetchLogsForSelectedContainer in progress...');

      if (this.appSpecification.version >= 4) {
        if (!this.selectedApp) {
          console.error('No container selected');
          return;
        }
      }

      if (this.requestInProgress) {
        console.log('Request in progress, skipping this call.');
        return;
      }
      const appnama = this.selectedApp ? `${this.selectedApp}_${this.appSpecification.name}` : this.appSpecification.name;
      this.requestInProgress = true;
      this.noLogs = false;
      try {
        const containerName = this.selectedApp;
        const lines = this.fetchAllLogs ? 'all' : this.lineCount || 100;
        const response = await this.executeLocalCommand(`/apps/applogpolling/${appnama}/${lines}/${this.sinceTimestamp}`);
        if (this.selectedApp === containerName) {
          this.logs = response.data?.logs;
          if (response.data?.status === 'success' && this.logs?.length === 0) {
            this.noLogs = true;
          }
          if (this.logs.length > 0) {
            this.$nextTick(() => {
              if (this.autoScroll) {
                this.scrollToBottom();
              }
            });
          }
        } else {
          console.error('Selected container has changed. Logs discarded.');
        }
      } catch (error) {
        console.error('Error fetching logs:', error.message);
        this.clearLogs();
        if (this.pollingEnabled === true) {
          this.pollingEnabled = false;
          this.stopPolling();
        }
      } finally {
        console.log('fetchLogsForSelectedContainer completed...');
        this.requestInProgress = false;
      }
    },
    startPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
      }

      this.pollingInterval = setInterval(async () => {
        await this.fetchLogsForSelectedContainer();
      }, this.refreshRate);
    },
    stopPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
    },
    restartPolling() {
      this.stopPolling();
      this.fetchLogsForSelectedContainer();
      if (this.pollingEnabled) {
        this.startPolling();
      }
    },
    togglePolling() {
      if (this.pollingEnabled) {
        this.startPolling();
      } else {
        this.stopPolling();
      }
    },
    formatLog(log) {
      const ansiToHtml = new AnsiToHtml();
      if (this.displayTimestamps) {
        const [timestamp, ...rest] = log.split(' ');
        const formattedLog = rest.join(' ');
        return `<kbd class="alert-success" style="border-radius: 3px; padding: 1px 4px 1px 4px; width: 179px; text-align: center; font-family: monospace;">${timestamp}</kbd> - ${ansiToHtml.toHtml(formattedLog)}`;
      // eslint-disable-next-line no-else-return
      } else {
        const timestampRegex = /^[^\s]+\s*/;
        return ansiToHtml.toHtml(log.replace(timestampRegex, ''));
      }
    },
    scrollToBottom() {
      const container = this.$refs.logsContainer;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    },
    clearLogs() {
      this.logs = [];
    },
    clearDateFilter() {
      this.sinceTimestamp = '';
    },
    handleContainerChange() {
      const debouncedFetchLogs = this.debounce(this.fetchLogsForSelectedContainer, 300);
      debouncedFetchLogs();
    },
    async refreshInfo() {
      // this.$refs.BackendRefresh.blur();
      this.backendLoading = true;
      await this.getInstancesForDropDown();
      this.selectedIpChanged();
      this.getApplicationLocations().catch(() => {
        this.isBusy = false;
        this.showToast('danger', 'Error loading application locations');
      });
      setTimeout(() => {
        this.backendLoading = false;
      }, 1000);
    },
    copyMessageToSign() {
      const { copy } = useClipboard({ source: this.dataToSign, legacy: true });
      copy();
      this.tooltipText = 'Copied!';
      setTimeout(() => {
        if (this.$refs.copyButtonRef) {
          this.$refs.copyButtonRef.blur();
          this.tooltipText = '';
        }
      }, 1000);
      setTimeout(() => {
        this.tooltipText = 'Copy to clipboard';
      }, 1500);
    },
    sortNameFolder(a, b) {
      return (a.isDirectory ? `..${a.name}` : a.name).localeCompare(b.isDirectory ? `..${b.name}` : b.name);
    },
    sortTypeFolder(a, b) {
      if (a.isDirectory && b.isFile) return -1;
      if (a.isFile && b.isDirectory) return 1;
      return 0;
    },
    sort(a, b, key, sortDesc) {
      if (key === 'name') {
        return this.sortNameFolder(a, b, sortDesc);
      }
      if (key === 'type') {
        return this.sortTypeFolder(a, b, sortDesc);
      }
      if (key === 'modifiedAt') {
        if (a.modifiedAt > b.modifiedAt) return -1;
        if (a.modifiedAt < b.modifiedAt) return 1;
        return 0;
      }
      if (key === 'size') {
        if (a.size > b.size) return -1;
        if (a.size < b.size) return 1;
        return 0;
      }
      return 0;
    },
    async storageStats() {
      try {
        this.volumeInfo = await this.executeLocalCommand(`/backup/getvolumedataofcomponent/${this.appName}/${this.selectedAppVolume}/${'B'}/${2}/${'used,size'}`);
        this.volumePath = this.volumeInfo.data?.data;
        if (this.volumeInfo.data.status === 'success') {
          this.storage.total = this.getHddByName(this.appSpecification, this.selectedAppVolume) * 1024 * 1024 * 1024;
          this.storage.used = this.volumeInfo.data.data.used;
        } else {
          this.showToast('danger', this.volumeInfo.data.data.message || this.volumeInfo.data.data);
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    changeFolder(name) {
      if (name === '..') {
        const folderArrray = this.currentFolder.split('/');
        folderArrray.pop();
        this.currentFolder = folderArrray.join('/');
      } else if (this.currentFolder === '') {
        this.currentFolder = name;
      } else {
        this.currentFolder = `${this.currentFolder}/${name}`;
      }
      const segments = this.currentFolder.split('/').filter((segment) => segment !== '');
      const transformedPath = segments.map((segment) => `  ${segment}  `).join('/');
      this.inputPathValue = `/${transformedPath}`;
      this.loadFolder(this.currentFolder);
    },
    async loadFolder(path, soft = false) {
      try {
        this.filterFolder = '';
        if (!soft) {
          this.folderView = [];
        }
        this.loadingFolder = true;
        const response = await this.executeLocalCommand(`/apps/getfolderinfo/${this.appName}/${this.selectedAppVolume}/${encodeURIComponent(path)}`);
        this.loadingFolder = false;
        if (response.data.status === 'success') {
          this.folderView = response.data.data;
          console.log(this.folderView);
        } else {
          this.showToast('danger', response.data.data.message || response.data.data);
        }
      } catch (error) {
        this.loadingFolder = false;
        console.log(error.message);
        this.showToast('danger', error.message || error);
      }
    },
    async createFolder(path) {
      try {
        let folderPath = path;
        if (this.currentFolder !== '') {
          folderPath = `${this.currentFolder}/${path}`;
        }
        const response = await this.executeLocalCommand(`/apps/createfolder/${this.appName}/${this.selectedAppVolume}/${encodeURIComponent(folderPath)}`);
        if (response.data.status === 'error') {
          if (response.data.data.code === 'EEXIST') {
            this.showToast('danger', `Folder ${path} already exists`);
          } else {
            this.showToast('danger', response.data.data.message || response.data.data);
          }
        } else {
          this.loadFolder(this.currentFolder, true);
          this.createDirectoryDialogVisible = false;
        }
      } catch (error) {
        this.loadingFolder = false;
        console.log(error.message);
        this.showToast('danger', error.message || error);
      }
      this.newDirName = '';
    },
    cancelDownload(name) {
      this.abortToken[name].cancel(`Download of ${name} cancelled`);
      this.downloaded[name] = '';
      this.total[name] = '';
    },
    detectLanguage(content) {
      const result = hljs.highlightAuto(content);
      console.log('Detected language:', result.language);
      return result.language || 'plaintext';
    },
    getLanguageFromFileName(fileName) {
      const lowerFileName = fileName.toLowerCase();
      if (lowerFileName === 'dockerfile') {
        return this.supportedLanguages.includes('dockerfile') ? 'dockerfile' : 'plaintext';
      }
      if (lowerFileName === 'pom.xml') {
        return this.supportedLanguages.includes('pom') ? 'pom' : 'plaintext';
      }
      const parts = lowerFileName.split('.');
      if (parts.length <= 1) {
        return 'plaintext';
      }
      const ext = parts.pop();
      const language = this.extensionMapping[ext] || 'plaintext';
      return this.supportedLanguages.includes(language) ? language : 'plaintext';
    },
    mapDetectedLanguage(detected, fileName) {
      const aliasMapping = {
        'php-template': 'php',
        bash: 'shell',
        smalltalk: 'json',
      };

      const fileType = this.getLanguageFromFileName(fileName);
      if (fileType !== detected && fileType !== 'plaintext') {
        console.log('Selected by fileType');
        return fileType;
      }

      if (this.supportedLanguages.includes(detected)) {
        console.log('Selected by supportedLanguages');
        return detected;
      }

      if (aliasMapping[detected]) {
        const alias = aliasMapping[detected];
        console.log('Selected by aliasMapping');
        return alias;
      }

      return 'plaintext';
    },
    openEditDialog(fileName, size) {
      if (this.maxEditSize < size) {
        this.showToast(
          'warning',
          'The file exceeds the maximum size for browser-based editing. Please use a terminal-based editor for large files.',
        );
        return;
      }
      this.operationTitle = 'Initializing file editor...';
      this.optionalInfoMessage = `Loading ${fileName}... `;
      this.progressVisable = true;
      this.currentEditFile = fileName;
      this.download(fileName, false, true)
        .then((content) => {
          setTimeout(() => {
            this.optionalInfoMessage = '';
            this.operationTitle = '';
            this.contentLoaded = true;
          }, 2000);
          this.progressVisable = false;
          this.editContent = content;
          const threshold = 500;
          // eslint-disable-next-line no-param-reassign
          content = content.length > threshold
            ? content.slice(0, threshold)
            : content;
          const detectedLang = this.detectLanguage(content);
          const monacoLanguage = this.mapDetectedLanguage(detectedLang, fileName);
          console.log('Language set:', monacoLanguage);
          this.editorLanguage = monacoLanguage;
          this.editDialogVisible = true;
        })
        .catch((err) => {
          this.progressVisable = false;
          setTimeout(() => {
            this.optionalInfoMessage = '';
            this.operationTitle = '';
          }, 2000);
          console.error('Error loading file for editing:', err);
          this.showToast('danger', 'Error loading file for editing');
        });
    },
    closeEditor() {
      this.editContent = '';
      this.editDialogVisible = false;
      this.hasChanged = false;
      this.contentLoaded = false;
      if (this.editorInstance) {
        this.editorInstance.dispose();
        this.editorInstance = null;
      }
      window.removeEventListener('resize', this.onResizeMonacoEditor);
    },
    async saveContent() {
      const currentValue = this.editorInstance.getValue();
      const fileToUpload = {
        file_name: this.currentEditFile,
        content: currentValue,
      };

      this.saving = true;

      try {
        await this.upload(fileToUpload, true);
        this.showToast('success', 'File updated successfully!');
      } catch (error) {
        console.error('Upload failed:', error);
        this.showToast('danger', `Error saving file: ${error.message}`);
      } finally {
        this.hasChanged = false;
        this.saving = false;
      }
    },
    onEditorInput() {
      if (!this.hasChanged && this.contentLoaded) {
        this.hasChanged = true;
      }
    },
    handleMount(editor) {
      this.editorInstance = editor;
      const container = this.$refs.monacoEditor.$el.parentElement;
      setTimeout(() => {
        if (this.monacoReady) {
          editor.layout({ width: container.offsetWidth, height: container.offsetHeight });
          editor.updateOptions({}); // Force redraw
          console.log('Mount Layout:', editor.getLayoutInfo());
        } else {
          console.warn('Monaco not ready during mount');
        }
      }, 200);
      document.fonts.ready.then(() => {
        if (window.monaco && window.monaco.editor) {
          window.monaco.editor.remeasureFonts();
        }
      });
      this.editorInstance.onDidChangeModelContent(() => {
        this.onEditorInput();
      });
      window.addEventListener('resize', this.onResizeMonacoEditor);
    },
    onModalShown() {
      if (this.editorInstance && this.monacoReady) {
        const container = this.$refs.monacoEditor.$el.parentElement;
        setTimeout(() => {
          this.editorInstance.layout({ width: container.offsetWidth, height: container.offsetHeight });
          this.editorInstance.updateOptions({}); // Force redraw
          console.log('Modal Shown Layout:', this.editorInstance.getLayoutInfo());
        }, 200);
      }
    },
    onResizeMonacoEditor() {
      if (this.editorInstance && this.monacoReady && this.$refs.monacoEditor && this.$refs.monacoEditor.$el) {
        const container = this.$refs.monacoEditor.$el.parentElement;
        this.editorInstance.layout({ width: container.offsetWidth, height: container.offsetHeight });
        console.log('Resize Layout:', this.editorInstance.getLayoutInfo());
      }
    },
    // eslint-disable-next-line consistent-return
    async download(name, isFolder = false, silent = false) {
      try {
        const self = this;
        const folder = this.currentFolder;
        const fileName = folder ? `${folder}/${name}` : name;
        const axiosConfig = {
          headers: this.zelidHeader,
          responseType: 'blob',
          onDownloadProgress(progressEvent) {
            if (silent) return;
            const { loaded, total, lengthComputable } = progressEvent;
            if (lengthComputable) {
              const currentFileProgress = (loaded / total) * 100;
              if (isFolder) {
                self.updateFileProgressVolume(`${name}.zip`, currentFileProgress);
              } else {
                self.updateFileProgressVolume(name, currentFileProgress);
              }
            } else {
              console.log('Total file size is unknown. Cannot compute progress percentage.');
              if (isFolder) {
                self.updateFileProgressVolume(`${name}.zip`, 'Downloading...');
              } else {
                self.updateFileProgressVolume(name, 'Downloading...');
              }
            }
          },
        };

        if (!silent && isFolder) {
          this.showToast('info', 'Directory download initiated. Please wait...');
        }

        let response;
        if (isFolder) {
          response = await this.executeLocalCommand(
            `/apps/downloadfolder/${this.appName}/${this.selectedAppVolume}/${encodeURIComponent(fileName)}`,
            null,
            axiosConfig,
          );
        } else {
          response = await this.executeLocalCommand(
            `/apps/downloadfile/${this.appName}/${this.selectedAppVolume}/${encodeURIComponent(fileName)}`,
            null,
            axiosConfig,
          );
        }

        if (!silent && !isFolder && response.data && response.status === 200) {
          self.updateFileProgressVolume(name, 100);
        }

        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else if (silent) {
          return await this.blobToText(response.data);
        } else {
          const url = window.URL.createObjectURL(new Blob([response.data]));
          const link = document.createElement('a');
          link.href = url;
          if (isFolder) {
            link.setAttribute('download', `${name}.zip`);
          } else {
            link.setAttribute('download', name);
          }
          document.body.appendChild(link);
          link.click();
        }
      } catch (error) {
        console.log(error.message);
        if (error.message && !error.message.startsWith('Download')) {
          this.showToast('danger', error.message);
        } else {
          this.showToast('danger', error);
        }
      }
    },
    blobToText(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(blob, 'utf-8');
      });
    },
    beautifyValue(valueInText) {
      const str = valueInText.split('.');
      if (str[0].length >= 4) {
        str[0] = str[0].replace(/(\d)(?=(\d{3})+$)/g, '$1,');
      }
      return str.join('.');
    },
    refreshFolder() {
      const segments = this.currentFolder.split('/').filter((segment) => segment !== '');
      const transformedPath = segments.map((segment) => `  ${segment}  `).join('/');
      this.inputPathValue = `/${transformedPath}`;
      this.loadFolder(this.currentFolder, true);
      this.storageStats();
    },
    refreshFolderSwitch() {
      this.currentFolder = '';
      const segments = this.currentFolder.split('/').filter((segment) => segment !== '');
      const transformedPath = segments.map((segment) => `  ${segment}  `).join('/');
      this.inputPathValue = `/${transformedPath}`;
      this.loadFolder(this.currentFolder, true);
      this.storageStats();
    },
    async deleteFile(name) {
      try {
        const folder = this.currentFolder;
        const fileName = folder ? `${folder}/${name}` : name;
        const response = await this.executeLocalCommand(`/apps/removeobject/${this.appName}/${this.selectedAppVolume}/${encodeURIComponent(fileName)}`);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          this.refreshFolder();
          this.showToast('success', `${name} deleted`);
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    rename(name) {
      this.renameDialogVisible = true;
      let folderPath = name;
      if (this.currentFolder !== '') {
        folderPath = `${this.currentFolder}/${name}`;
      }
      this.fileRenaming = folderPath;
      this.newName = name;
    },
    async confirmRename() {
      this.renameDialogVisible = false;
      try {
        const oldpath = this.fileRenaming;
        const newname = this.newName;
        const response = await this.executeLocalCommand(`/apps/renameobject/${this.appName}/${this.selectedAppVolume}/${encodeURIComponent(oldpath)}/${newname}`);
        console.log(response);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          if (oldpath.includes('/')) {
            this.showToast('success', `${oldpath.split('/').pop()} renamed to ${newname}`);
          } else {
            this.showToast('success', `${oldpath} renamed to ${newname}`);
          }
          this.loadFolder(this.currentFolder, true);
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    upFolder() {
      this.changeFolder('..');
    },
    onResize() {
      this.windowWidth = window.innerWidth;
    },
    handleRadioClick() {
      if (this.selectedRestoreOption === 'Upload File') {
        this.loadBackupList(this.appName, 'upload', 'files');
      }
      if (this.selectedRestoreOption === 'FluxDrive') {
        this.getFluxDriveBackupList();
      }
      console.log('Radio button clicked. Selected option:', this.selectedOption);
    },
    // eslint-disable-next-line consistent-return
    getUploadFolder() {
      if (this.selectedIp) {
        const ip = this.selectedIp.split(':')[0];
        const port = this.selectedIp.split(':')[1] || 16127;
        if (this.currentFolder) {
          const folder = encodeURIComponent(this.currentFolder);
          if (this.ipAccess) {
            return `http://${ip}:${port}/ioutils/fileupload/volume/${this.appName}/${this.selectedAppVolume}/${folder}`;
          }
          return `https://${ip.replace(/\./g, '-')}-${port}.node.api.runonflux.io/ioutils/fileupload/volume/${this.appName}/${this.selectedAppVolume}/${folder}`;
        }
        if (this.ipAccess) {
          return `http://${ip}:${port}/ioutils/fileupload/volume/${this.appName}/${this.selectedAppVolume}`;
        }
        return `https://${ip.replace(/\./g, '-')}-${port}.node.api.runonflux.io/ioutils/fileupload/volume/${this.appName}/${this.selectedAppVolume}`;
      }
    },
    getUploadFolderBackup(saveAs) {
      const ip = this.selectedIp.split(':')[0];
      const port = this.selectedIp.split(':')[1] || 16127;
      const filename = encodeURIComponent(saveAs);
      if (this.ipAccess) {
        return `http://${ip}:${port}/ioutils/fileupload/backup/${this.appName}/${this.restoreRemoteFile}/null/${filename}`;
      }
      return `https://${ip.replace(/\./g, '-')}-${port}.node.api.runonflux.io/ioutils/fileupload/backup/${this.appName}/${this.restoreRemoteFile}/null/${filename}`;
    },
    convertVolumeSize(size, targetUnit = 'auto', decimal = 0, returnWithoutUnit = true) {
      const multiplierMap = {
        B: 1,
        KB: 1024,
        MB: 1024 * 1024,
        GB: 1024 * 1024 * 1024,
      };
      // eslint-disable-next-line no-shadow
      const getSizeWithMultiplier = (size, multiplier) => size / multiplierMap[multiplier.toUpperCase()];
      const formatResult = (result, unit) => {
        const formattedResult = unit === 'B' ? result.toFixed(0) : result.toFixed(decimal);
        return returnWithoutUnit ? formattedResult : `${formattedResult} ${unit}`;
      };

      const sizeInBytes = +size;
      // Validate input size
      if (Number.isNaN(sizeInBytes)) {
        console.error('Invalid size parameter');
        return 'N/A';
      }

      // Auto-select best unit if 'auto' is chosen
      if (targetUnit === 'auto') {
        let bestMatchUnit;
        let bestMatchResult = sizeInBytes;
        Object.keys(multiplierMap).forEach((unit) => {
          const result = getSizeWithMultiplier(sizeInBytes, unit);
          if (result >= 1 && (bestMatchResult === undefined || result < bestMatchResult)) {
            bestMatchResult = result;
            bestMatchUnit = unit;
          }
        });

        bestMatchUnit = bestMatchUnit || 'B';
        return formatResult(bestMatchResult, bestMatchUnit);
      // eslint-disable-next-line no-else-return
      } else {
        // Convert to specified target unit
        const result = getSizeWithMultiplier(sizeInBytes, targetUnit);
        return formatResult(result, targetUnit);
      }
    },
    addAndConvertFileSizes(sizes, targetUnit = 'auto', decimal = 2) {
      const multiplierMap = {
        B: 1,
        KB: 1024,
        MB: 1024 * 1024,
        GB: 1024 * 1024 * 1024,
      };
      const getSizeWithMultiplier = (size, multiplier) => size / multiplierMap[multiplier.toUpperCase()];
      const formatResult = (result, unit) => {
        const formattedResult = unit === 'B' ? result.toFixed(0) : result.toFixed(decimal);
        return `${formattedResult} ${unit}`;
      };
      let totalSizeInBytes;
      if (Array.isArray(sizes) && sizes.length > 0) {
        totalSizeInBytes = +sizes.reduce((total, fileInfo) => total + (fileInfo.file_size || 0), 0);
      } else if (typeof +sizes === 'number') {
        totalSizeInBytes = +sizes;
      } else {
        console.error('Invalid sizes parameter');
        return 'N/A';
      }
      // eslint-disable-next-line no-restricted-globals
      if (isNaN(totalSizeInBytes)) {
        console.error('Total size is not a valid number');
        return 'N/A';
      }
      if (targetUnit === 'auto') {
        let bestMatchUnit;
        let bestMatchResult = totalSizeInBytes;
        Object.keys(multiplierMap).forEach((unit) => {
          const result = getSizeWithMultiplier(totalSizeInBytes, unit);
          if (result >= 1 && (bestMatchResult === undefined || result < bestMatchResult)) {
            bestMatchResult = result;
            bestMatchUnit = unit;
          }
        });
        bestMatchUnit = bestMatchUnit || 'B';
        return formatResult(bestMatchResult, bestMatchUnit);
        // eslint-disable-next-line no-else-return
      } else {
        const result = getSizeWithMultiplier(totalSizeInBytes, targetUnit);
        return formatResult(result, targetUnit);
      }
    },
    selectFiles() {
      this.$refs.fileselector.value = '';
      this.$refs.fileselector.click();
    },
    handleFiles(ev) {
      if (this.restoreRemoteFile === null) {
        this.showToast('warning', 'Select component');
        return;
      }
      const { files } = ev.target;
      if (!files) return;
      this.addFiles(([...files]));
    },
    addFile(e) {
      const droppedFiles = e.dataTransfer.files;
      if (!droppedFiles) return;
      this.addFiles(([...droppedFiles]));
    },
    async addFiles(filesToAdd) {
      // eslint-disable-next-line no-restricted-syntax
      for (const f of filesToAdd) {
        // eslint-disable-next-line no-await-in-loop
        this.volumeInfo = await this.executeLocalCommand(`/backup/getvolumedataofcomponent/${this.appName}/${this.restoreRemoteFile}/${'B'}/${0}/${'mount,available,size'}`);
        this.volumePath = this.volumeInfo.data?.data?.mount;

        const existingFile = this.files.findIndex(
          (item) => item.file_name === filesToAdd[0].name && item.component !== this.restoreRemoteFile,
        );
        if (existingFile !== -1) {
          this.showToast('warning', `'${f.name}' is already in the upload queue for other component.`);
          return false;
        }
        const existingComponent = this.files.findIndex(
          (item) => item.component === this.restoreRemoteFile,
        );
        if (existingComponent !== -1) {
          this.$set(this.files, existingComponent, {
            selected_file: f,
            uploading: false,
            uploaded: false,
            progress: 0,
            path: `${this.volumePath}/backup/upload`,
            component: this.restoreRemoteFile,
            file_name: `backup_${this.restoreRemoteFile.toLowerCase()}.tar.gz`,
            file_size: f.size,
          });
        } else {
          this.files.push({
            selected_file: f,
            uploading: false,
            uploaded: false,
            progress: 0,
            path: `${this.volumePath}/backup/upload`,
            component: this.restoreRemoteFile,
            file_name: `backup_${this.restoreRemoteFile.toLowerCase()}.tar.gz`,
            file_size: f.size,
          });
        }
      }
      return true;
    },
    removeFile(file) {
      // eslint-disable-next-line camelcase
      this.files = this.files.filter((selected_file) => selected_file.selected_file.name !== file.selected_file.name);
    },
    async processChunks(chunks, type) {
      const typeToPropertyMap = {
        restore_upload: 'restoreFromUploadStatus',
        restore_remote: 'restoreFromRemoteURLStatus',
        backup: 'tarProgress',
        restore_fluxdrive: 'restoreFromFluxDriveStatus',
      };
      // eslint-disable-next-line no-restricted-syntax
      for (const chunk of chunks) {
        if (chunk !== '') {
          const propertyName = typeToPropertyMap[type];
          if (propertyName) {
            this[propertyName] = chunk;
            if (type === 'restore_upload' && chunk.includes('Error:')) {
              console.log(chunk);
              this.changeAlert('danger', chunk, 'showTopUpload', true);
            } else if (type === 'restore_upload' && chunk.includes('Finalizing')) {
              setTimeout(() => {
                this.changeAlert('success', 'Restore completed successfully', 'showTopUpload', true);
              }, 5000);
            } else if (type === 'restore_remote' && chunk.includes('Error:')) {
              this.changeAlert('danger', chunk, 'showTopRemote', true);
            } else if (type === 'restore_remote' && chunk.includes('Finalizing')) {
              setTimeout(() => {
                this.changeAlert('success', 'Restore completed successfully', 'showTopRemote', true);
                this.restoreRemoteUrlItems = [];
              }, 5000);
            } else if (type === 'restore_fluxdrive' && chunk.includes('Error:')) {
              this.changeAlert('danger', chunk, 'showTopFluxDrive', true);
            } else if (type === 'restore_fluxdrive' && chunk.includes('Finalizing')) {
              setTimeout(() => {
                this.changeAlert('success', 'Restore completed successfully', 'showTopFluxDrive', true);
                this.restoreRemoteUrlItems = [];
              }, 5000);
            }
          }
        }
      }
    },
    changeAlert(variant, text, element, state) {
      // Change variant and text through a function
      this.alertVariant = variant; // Change variant to 'danger' or any other desired variant
      this.alertMessage = text; // Change text to a new message
      this[element] = state; // Show the alert
    },
    startUpload() {
      this.showTopUpload = false;
      const self = this;
      // eslint-disable-next-line no-async-promise-executor
      return new Promise(async (resolve, reject) => {
        try {
          this.restoreFromUpload = true;
          this.restoreFromUploadStatus = 'Uploading...';
          // eslint-disable-next-line no-async-promise-executor
          const uploadPromises = this.files.map((f) => new Promise(async (resolveFile, rejectFile) => {
            if (!f.uploaded && !f.uploading && f.selected_file) {
              try {
                await this.upload(f);
                resolveFile();
              } catch (error) {
                rejectFile(error);
              }
            } else {
              resolveFile();
            }
          }));
          await Promise.all(uploadPromises);
          this.files.forEach((entry) => {
            entry.uploading = false;
            entry.uploaded = false;
            entry.progress = 0;
          });
          this.restoreFromUploadStatus = 'Initializing restore jobs...';
          const postLayout = this.buildPostBody(this.appSpecification, 'restore', 'upload');
          let postRestoreData;
          // eslint-disable-next-line no-restricted-syntax
          for (const componentName of this.files) {
            postRestoreData = this.updateJobStatus(postLayout, componentName.component, 'restore');
          }
          const zelidauth = localStorage.getItem('zelidauth');
          const headers = {
            zelidauth,
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            Connection: 'keep-alive',
          };
          const url = this.selectedIp.split(':')[0];
          const urlPort = this.selectedIp.split(':')[1] || 16127;
          let queryUrl = `https://${url.replace(/\./g, '-')}-${urlPort}.node.api.runonflux.io/apps/appendrestoretask`;
          if (this.ipAccess) {
            queryUrl = `http://${url}:${urlPort}/apps/appendrestoretask`;
          }
          const response = await fetch(queryUrl, {
            method: 'POST',
            body: JSON.stringify(postRestoreData),
            headers,
          });
          const reader = response.body.getReader();
          // eslint-disable-next-line no-unused-vars
          await new Promise((streamResolve, streamReject) => {
            function push() {
              reader.read().then(async ({ done, value }) => {
                if (done) {
                  streamResolve();
                  return;
                }
                const chunkText = new TextDecoder('utf-8').decode(value);
                const chunks = chunkText.split('\n');
                // eslint-disable-next-line no-restricted-globals
                await self.processChunks(chunks, 'restore_upload');
                push();
              });
            }
            push();
          });
          this.restoreFromUpload = false;
          this.restoreFromUploadStatus = '';
          this.loadBackupList(this.appName, 'upload', 'files');
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    },
    /* eslint no-param-reassign: ["error", { "props": false }] */
    async upload(file, isContentUpload = false) {
      // await this.splitAndUploadChunks(file);
      return new Promise((resolve, reject) => {
        const self = this;
        if (typeof XMLHttpRequest === 'undefined') {
          // eslint-disable-next-line prefer-promise-reject-errors
          reject('XMLHttpRequest is not supported.');
          return;
        }
        const xhr = new XMLHttpRequest();
        let action;
        if (isContentUpload) {
          action = this.getUploadFolder();
        } else {
          action = this.getUploadFolderBackup(file.file_name);
        }
        if (xhr.upload) {
          xhr.upload.onprogress = function progress(e) {
            if (e.total > 0) {
              e.percent = (e.loaded / e.total) * 100;
            }
            file.progress = e.percent;
          };
        }

        const formData = new FormData();
        if (isContentUpload) {
          const blob = new Blob([file.content], { type: 'text/plain' });
          formData.append(file.file_name, blob);
        } else {
          formData.append(file.selected_file.name, file.selected_file);
        }
        // const formData = new FormData();
        // formData.append(file.selected_file.name, file.selected_file);
        file.uploading = true;
        xhr.onerror = function error(e) {
          self.restoreFromUpload = false;
          self.restoreFromUploadStatus = '';
          self.files.forEach((entry) => {
            entry.uploading = false;
            entry.uploaded = false;
            entry.progress = 0;
          });
          self.showToast('danger', `An error occurred while uploading ${file.selected_file.name}, try to relogin`);
          reject(e);
        };
        xhr.onload = function onload() {
          if (xhr.status < 200 || xhr.status >= 300) {
            console.error(xhr.status);
            self.restoreFromUpload = false;
            self.restoreFromUploadStatus = '';
            self.files.forEach((entry) => {
              entry.uploading = false;
              entry.uploaded = false;
              entry.progress = 0;
            });
            self.showToast('danger', `An error occurred while uploading '${file.selected_file.name}' - Status code: ${xhr.status}`);
            reject(xhr.status);

            return;
          }
          file.uploaded = true;
          file.uploading = false;
          self.$emit('complete');
          resolve();
        };
        xhr.open('post', action, true);
        const headers = this.zelidHeader || {};
        const headerKeys = Object.keys(headers);
        for (let i = 0; i < headerKeys.length; i += 1) {
          const item = headerKeys[i];
          if (Object.prototype.hasOwnProperty.call(headers, item) && headers[item] !== null) {
            xhr.setRequestHeader(item, headers[item]);
          }
        }
        xhr.setRequestHeader('Access-Control-Allow-Origin', '*');
        xhr.send(formData);
      });
    },
    removeAllBackup() {
      this.backupList = [];
      this.backupToUpload = [];
    },
    totalArchiveFileSize(item) {
      return item.reduce((total, component) => total + parseFloat(component.file_size), 0);
    },
    RestoreTableBuilder(value) {
      const labelValue = value.toString();
      const labelWithoutUnderscore = labelValue.split('_')[0];
      return [
        { key: 'component', label: 'Component Name', thStyle: { width: '25%' } },
        { key: value.toString().toLowerCase(), label: labelWithoutUnderscore, thStyle: { width: '70%' } },
        { key: 'file_size', label: 'Size', thStyle: { width: '10%' } },
        { key: 'actions', label: 'Action', thStyle: { width: '5%' } },
      ];
    },
    addAllTags() {
      this.selectedBackupComponents = [...this.selectedBackupComponents, ...this.components];
    },
    clearSelected() {
      this.$refs.selectableTable.clearSelected();
    },
    selectAllRows() {
      this.$refs.selectableTable.selectAllRows();
    },
    selectStorageOption(value) {
      this.selectedStorageMethod = value;
    },
    buildPostBody(appSpecification, jobType, restoreType = '') {
      const updatedObject = {
        appname: appSpecification.name,
        ...(jobType === 'restore' ? { type: restoreType } : {}),
        [jobType]: appSpecification.compose.map((item) => ({
          component: item.name,
          [jobType]: false,
          ...(jobType === 'restore' && restoreType === 'remote' ? { url: '' } : {}),
        })),
      };
      return updatedObject;
    },
    updateJobStatus(appConfig, component, jobType, urlInfoArray = []) {
      const targetComponent = appConfig[jobType].find((item) => item.component === component);
      if (targetComponent) {
        targetComponent[jobType] = true;
        if (jobType === 'restore' && appConfig?.type === 'remote') {
          const urlInfo = urlInfoArray.find((info) => info.component === component);
          if (urlInfo) {
            targetComponent.url = urlInfo.url || ''; // Set default value if url doesn't exist
            console.log(`${urlInfo.url}`);
          } else {
            console.log(`URL info not found for component ${component}.`);
          }
        }
        console.log(`Status for ${component} set to true for ${jobType}.`);
      } else {
        console.log(`Component ${component} not found in the ${jobType} array.`);
      }
      return appConfig;
    },
    async createBackup(appname, componentNames) {
      if (this.selectedBackupComponents?.length === 0) {
        return;
      }
      this.backupProgress = true;
      this.tarProgress = 'Initializing backup jobs...';
      const zelidauth = localStorage.getItem('zelidauth');
      // eslint-disable-next-line no-unused-vars
      const headers = {
        zelidauth,
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        Connection: 'keep-alive',
      };
      const postLayout = this.buildPostBody(this.appSpecification, 'backup');
      let postBackupData;
      // eslint-disable-next-line no-restricted-syntax
      for (const componentName of componentNames) {
        postBackupData = this.updateJobStatus(postLayout, componentName, 'backup');
      }
      const url = this.selectedIp.split(':')[0];
      const urlPort = this.selectedIp.split(':')[1] || 16127;
      let queryUrl = `https://${url.replace(/\./g, '-')}-${urlPort}.node.api.runonflux.io/apps/appendbackuptask`;
      if (this.ipAccess) {
        queryUrl = `http://${url}:${urlPort}/apps/appendbackuptask`;
      }
      const response = await fetch(queryUrl, {
        method: 'POST',
        body: JSON.stringify(postBackupData),
        headers,
      });
      const self = this;
      const reader = response.body.getReader();
      // eslint-disable-next-line no-unused-vars
      await new Promise((streamResolve, streamReject) => {
        function push() {
          reader.read().then(async ({ done, value }) => {
            if (done) {
              streamResolve();
              return;
            }
            const chunkText = new TextDecoder('utf-8').decode(value);
            const chunks = chunkText.split('\n');
            await self.processChunks(chunks, 'backup');
            push();
          });
        }
        push();
      });
      setTimeout(() => {
        this.backupProgress = false;
      }, 5000);
      this.loadBackupList();
    },
    onRowSelected(itemOnRow) {
      this.backupToUpload = itemOnRow.map((item) => {
        const selectedComponentName = item.component;
        const selectedFile = this.backupList.find((file) => file.component === selectedComponentName);
        return {
          component: selectedComponentName,
          file: selectedFile ? selectedFile.file : null,
          file_size: selectedFile ? selectedFile.file_size : null,
          file_name: selectedFile ? selectedFile.file_name : null,
          create: selectedFile ? selectedFile.create : null,
        };
      }).filter((item) => item.file !== null);
    },
    applyFilter() {
      this.$nextTick(() => {
        this.checkpoints.forEach((row) => {
          // eslint-disable-next-line no-underscore-dangle, no-param-reassign
          row._showDetails = true;
        });
      });
      console.log(this.appSpecification.compose);
      this.components = this.appSpecification.compose.map((container) => container.name);
    },
    onFilteredBackup(filteredItems) {
      this.totalRows = filteredItems.length;
      this.currentPage = 1;
    },
    addAllBackupComponents(timestamp) {
      const checkpoint = this.checkpoints.find((cp) => cp.timestamp === timestamp);
      const filteredComponents = checkpoint.components.map((component) => ({
        component: component.component,
        file_url: component.file_url,
        timestamp: checkpoint.timestamp,
        file_size: component.file_size,
      }));
      this.newComponents = filteredComponents;
    },
    addComponent(selected, timestamp) {
      const existingIndex = this.newComponents.findIndex(
        (item) => item.component === selected.component,
      );
      if (existingIndex !== -1) {
        this.$set(this.newComponents, existingIndex, {
          timestamp,
          component: selected.component,
          file_url: selected.file_url,
          file_size: selected.file_size,
        });
      } else {
        this.newComponents.push({
          component: selected.component,
          timestamp,
          file_url: selected.file_url,
          file_size: selected.file_size,
        });
      }
    },
    formatName(checkpoint) {
      return `backup_${checkpoint.timestamp}`;
    },
    formatDateTime(timestamp, add24Hours = false) {
      const isMilliseconds = timestamp > 1e12;
      const date = isMilliseconds ? new Date(timestamp) : new Date(timestamp * 1000);
      if (add24Hours) {
        date.setHours(date.getHours() + 24);
      }
      return date.toLocaleString();
    },
    addRemoteFile() {
      this.selectFiles();
    },

    async restoreFromRemoteFile() {
      const zelidauth = localStorage.getItem('zelidauth');
      this.showTopRemote = false;
      this.downloadingFromUrl = true;
      this.restoreFromRemoteURLStatus = 'Initializing restore jobs...';
      // eslint-disable-next-line no-unused-vars
      const headers = {
        zelidauth,
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        Connection: 'keep-alive',
      };
      const postLayout = this.buildPostBody(this.appSpecification, 'restore', 'remote');
      let postBackupData;
      // eslint-disable-next-line no-restricted-syntax
      for (const componentName of this.restoreRemoteUrlItems) {
        postBackupData = this.updateJobStatus(postLayout, componentName.component, 'restore', this.restoreRemoteUrlItems);
      }
      const url = this.selectedIp.split(':')[0];
      const urlPort = this.selectedIp.split(':')[1] || 16127;
      let queryUrl = `https://${url.replace(/\./g, '-')}-${urlPort}.node.api.runonflux.io/apps/appendrestoretask`;
      if (this.ipAccess) {
        queryUrl = `http://${url}:${urlPort}/apps/appendrestoretask`;
      }
      const response = await fetch(queryUrl, {
        method: 'POST',
        body: JSON.stringify(postBackupData),
        headers,
      });
      const self = this;
      const reader = response.body.getReader();
      // eslint-disable-next-line no-unused-vars
      await new Promise((streamResolve, streamReject) => {
        function push() {
          reader.read().then(async ({ done, value }) => {
            if (done) {
              streamResolve(); // Resolve the stream promise when the response stream is complete
              return;
            }
            // Process each chunk of data separately
            const chunkText = new TextDecoder('utf-8').decode(value);
            const chunks = chunkText.split('\n');
            // eslint-disable-next-line no-restricted-globals
            await self.processChunks(chunks, 'restore_remote');
            // Check for new data immediately after processing each chunk
            push();
          });
        }
        push();
      });
      this.downloadingFromUrl = false;
      this.restoreFromRemoteURLStatus = '';
    },
    async addRemoteUrlItem(appname, component, fludDrive = false) {
      if (!fludDrive && !this.isValidUrl) {
        return;
      }
      if (this.restoreRemoteUrl.trim() !== '' && this.restoreRemoteUrlComponent !== null) {
        this.remoteFileSizeResponse = await this.executeLocalCommand(`/backup/getremotefilesize/${encodeURIComponent(this.restoreRemoteUrl.trim())}/${'B'}/${0}/${true}/${this.appName}`);
        if (this.remoteFileSizeResponse.data?.status !== 'success') {
          this.showToast('danger', this.remoteFileSizeResponse.data?.data.message || this.remoteFileSizeResponse.data?.massage);
          return;
        }
        this.volumeInfoResponse = await this.executeLocalCommand(`/backup/getvolumedataofcomponent/${appname}/${component}/${'B'}/${0}/${'size,available,mount'}`);
        if (this.volumeInfoResponse.data?.status !== 'success') {
          this.showToast('danger', this.volumeInfoResponse.data?.data.message || this.volumeInfoResponse.data?.data);
          return;
        }
        if (this.remoteFileSizeResponse.data.data > this.volumeInfoResponse.data.data.available) {
          this.showToast('danger', `File is too large (${this.addAndConvertFileSizes(this.remoteFileSizeResponse.data.data)})...`);
          return;
        }
        const existingURL = this.restoreRemoteUrlItems.findIndex((item) => item.url === this.restoreRemoteUrl);
        if (existingURL !== -1) {
          this.showToast('warning', `'${this.restoreRemoteUrl}' is already in the download queue for other component.`);
          return;
        }
        const existingItemIndex = this.restoreRemoteUrlItems.findIndex(
          (item) => item.component === this.restoreRemoteUrlComponent,
        );
        if (this.remoteFileSizeResponse.data.data === 0 || this.remoteFileSizeResponse.data.data === null) {
          return;
        }
        if (existingItemIndex !== -1) {
          this.restoreRemoteUrlItems[existingItemIndex].url = this.restoreRemoteUrl;
          this.restoreRemoteUrlItems[existingItemIndex].file_size = this.remoteFileSizeResponse.data.data;
        } else {
          this.restoreRemoteUrlItems.push({
            url: this.restoreRemoteUrl,
            component: this.restoreRemoteUrlComponent,
            file_size: this.remoteFileSizeResponse.data.data,
          });
        }
      }
    },
    async deleteItem(index, item, file = '', type = '') {
      const elementIndex = item.findIndex((obj) => obj.file === file);
      if (elementIndex !== -1) {
        if (!item[elementIndex]?.selected_file && type === 'upload') {
          console.log(item[elementIndex].file);
          await this.executeLocalCommand(`/backup/removebackupfile/${encodeURIComponent(item[elementIndex].file)}/${this.appName}`);
        }
      }
      item.splice(index, 1);
    },
    async loadBackupList(name = this.appName, type = 'local', itemsList = 'backupList') {
      const backupListTmp = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const componentItem of this.components) {
        // eslint-disable-next-line no-await-in-loop
        this.volumeInfo = await this.executeLocalCommand(`/backup/getvolumedataofcomponent/${name}/${componentItem}/${'B'}/${0}/${'mount'}`);
        this.volumePath = this.volumeInfo.data?.data;
        // eslint-disable-next-line no-await-in-loop
        this.backupFile = await this.executeLocalCommand(`/backup/getlocalbackuplist/${encodeURIComponent(`${this.volumePath.mount}/backup/${type}`)}/${'B'}/${0}/${true}/${name}`);
        this.backupItem = this.backupFile.data?.data;
        if (Array.isArray(this.backupItem)) {
          this.BackupItem = {
            isActive: false,
            component: componentItem,
            create: +this.backupItem[0].create,
            file_size: this.backupItem[0].size,
            file: `${this.volumePath.mount}/backup/${type}/${this.backupItem[0].name}`,
            file_name: `${this.backupItem[0].name}`,
          };
          backupListTmp.push(this.BackupItem);
        }
      }
      console.log(JSON.stringify(itemsList));
      // eslint-disable-next-line no-param-reassign, no-unused-vars
      this[itemsList] = backupListTmp;
    },
    allDownloadsCompleted() {
      return this.computedFileProgress.every((item) => item.progress === 100);
    },
    allDownloadsCompletedVolume() {
      if (this.computedFileProgressVolume.every((item) => item.progress === 100)) {
        setTimeout(() => {
          this.fileProgressVolume = this.fileProgressVolume.filter((item) => item.progress !== 100.00);
        }, 5000);
      }
      return this.computedFileProgressVolume.every((item) => item.progress === 100);
    },
    updateFileProgress(currentFileName, currentFileProgress, loaded, total, name) {
      this.$nextTick(() => {
        const currentIndex = this.fileProgress.findIndex((entry) => entry.fileName === name);
        if (currentIndex !== -1) {
          this.$set(this.fileProgress, currentIndex, { fileName: name, progress: currentFileProgress });
        } else {
          this.fileProgress.push({ fileName: name, progress: currentFileProgress });
        }
      });
    },
    updateFileProgressFD(currentFileName, currentFileProgress, loaded, total, name) {
      this.$nextTick(() => {
        const currentIndex = this.fileProgressFD.findIndex((entry) => entry.fileName === name);
        if (currentIndex !== -1) {
          this.$set(this.fileProgressFD, currentIndex, { fileName: name, progress: currentFileProgress });
        } else {
          this.fileProgressFD.push({ fileName: name, progress: currentFileProgress });
        }
      });
    },
    updateFileProgressVolume(currentFileName, currentFileProgress) {
      this.$nextTick(() => {
        const currentIndex = this.fileProgressVolume.findIndex((entry) => entry.fileName === currentFileName);
        if (currentIndex !== -1) {
          this.$set(this.fileProgressVolume, currentIndex, { fileName: currentFileName, progress: currentFileProgress });
        } else {
          this.fileProgressVolume.push({ fileName: currentFileName, progress: currentFileProgress });
        }
      });
    },
    rowClassFluxDriveBackups(item, type) {
      if (!item || type !== 'row') return 'table-no-padding';
      return '';
    },
    async deleteRestoreBackup(name, restoreItem, timestamp = 0) {
      if (timestamp !== 0) {
        this.newComponents = this.newComponents.filter((item) => item.timestamp !== timestamp);
        try {
          const zelidauth = localStorage.getItem('zelidauth');
          const axiosConfig = {
            headers: {
              zelidauth,
            },
          };
          const data = {
            appname: this.appName,
            timestamp,
          };
          const response = await axios.post(`${this.fluxDriveEndPoint}/removeCheckpoint`, data, axiosConfig);
          console.error(response.data);
          if (response && response.data && response.data.status === 'success') {
            const backupIndex = restoreItem.findIndex((item) => item.timestamp === timestamp);
            restoreItem.splice(backupIndex, 1);
            this.showToast('success', 'Checkpoint backup removed successfully.');
            return true;
          }
          this.showToast('danger', response.data.data.message);
          return false;
        } catch (error) {
          console.error('Error removing checkpoint', error);
          this.showToast('Error removing checkpoint');
        }
      }
      return false;
    },
    async deleteLocalBackup(name, restoreItem, filepath = 0) {
      if (filepath === 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const fileData of restoreItem) {
          const filePath = fileData.file;
          // eslint-disable-next-line no-await-in-loop
          await this.executeLocalCommand(`/backup/removebackupfile/${encodeURIComponent(filePath)}/${this.appName}`);
        }
        this.backupList = [];
        this.backupToUpload = [];
      } else {
        this.status = await this.executeLocalCommand(`/backup/removebackupfile/${encodeURIComponent(filepath)}/${this.appName}`);
        const backupIndex = restoreItem.findIndex((item) => item.component === name);
        restoreItem.splice(backupIndex, 1);
      }
    },
    async downloadAllBackupFiles(backupList) {
      try {
        this.showProgressBar = true;
        const zelidauth = localStorage.getItem('zelidauth');
        const self = this;
        const axiosConfig = {
          headers: {
            zelidauth,
          },
          responseType: 'blob',
          onDownloadProgress(progressEvent) {
            const { loaded, total, target } = progressEvent;
            const decodedUrl = decodeURIComponent(target.responseURL);
            const lastSlashIndex = decodedUrl.lastIndexOf('/');
            const normalizedUrl = lastSlashIndex !== -1 ? decodedUrl.slice(0, lastSlashIndex) : decodedUrl;
            const currentFileName = normalizedUrl.split('/').pop();
            const currentFileProgress = (loaded / total) * 100;
            const foundFile = self.backupList.find((file) => file.file.endsWith(currentFileName));
            self.updateFileProgress(currentFileName, currentFileProgress, loaded, total, foundFile.component);
          },
        };

        // eslint-disable-next-line no-restricted-syntax
        const downloadPromises = backupList.map(async (backup) => {
          try {
            const { file } = backup;
            const fileNameArray = file.split('/');
            const fileName = fileNameArray[fileNameArray.length - 1];
            const response = await this.executeLocalCommand(`/backup/downloadlocalfile/${encodeURIComponent(file)}/${self.appName}`, null, axiosConfig);
            const blob = new Blob([response.data]);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', fileName);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            return true;
          } catch (error) {
            console.error('Error downloading file:', error);
            return false;
          }
        });

        const downloadResults = await Promise.all(downloadPromises);
        // Check if all downloads were successful
        if (downloadResults.every((result) => result)) {
          console.log('All downloads completed successfully');
        } else {
          console.error('Some downloads failed. Check the console for details.');
        }
      } catch (error) {
        console.error('Error downloading files:', error);
        // Handle the error appropriately
      } finally {
        setTimeout(() => {
          this.showProgressBar = false;
          this.fileProgress = [];
        }, 5000);
      }
    },
    async checkFluxDriveUploadProgress() {
      const zelidauth = localStorage.getItem('zelidauth');
      const axiosConfig = {
        headers: {
          zelidauth,
        },
      };
      const fluxDriveUploadTaskTmp = [];
      let errorInStatusCheck = false;
      // eslint-disable-next-line no-restricted-syntax
      for (const task of this.fluxDriveUploadTask) {
        try {
          // eslint-disable-next-line no-restricted-syntax, no-await-in-loop
          const response = await axios.get(`${this.fluxDriveEndPoint}/gettaskstatus?taskId=${task.taskId}`, axiosConfig);
          if (response && response.data && response.data.status === 'success') {
            task.status = response.data.data.status.state;
            if (task.status === 'downloading') {
              task.progress = response.data.data.status.progress / 2;
            } else if (task.status === 'uploading') {
              task.progress = 50 + response.data.data.status.progress / 2;
            } else {
              task.progress = response.data.data.status.progress;
            }
            task.message = response.data.data.status.message;
            this.updateFileProgressFD(task.filename, task.progress, 0, 0, task.component);
            this.fluxDriveUploadStatus = response.data.data.status.message;
            if (task.status === 'finished') {
              this.showToast('success', `${task.component} backup uploaded to FluxDrive successfully.`);
            } else if (task.status === 'failed') {
              this.showToast('danger', `failed to upload ${task.component} backup to FluxDrive.${this.fluxDriveUploadStatus}`);
            } else {
              fluxDriveUploadTaskTmp.push(task);
            }
          } else {
            errorInStatusCheck = true;
          }
        } catch (error) {
          errorInStatusCheck = true;
          console.log('error fetching upload status');
        }
      }
      if (!errorInStatusCheck) this.fluxDriveUploadTask = fluxDriveUploadTaskTmp;
      if (this.fluxDriveUploadTask.length > 0) {
        setTimeout(() => {
          this.checkFluxDriveUploadProgress();
        }, 2000);
      } else {
        this.uploadProgress = false;
        this.showFluxDriveProgressBar = false;
        this.fluxDriveUploadStatus = '';
        this.fileProgressFD = [];
      }
    },
    async uploadToFluxDrive() {
      try {
        this.uploadProgress = true;
        const zelidauth = localStorage.getItem('zelidauth');
        const self = this;
        const axiosConfig = {
          headers: {
            zelidauth,
          },
        };
        let prevoiusTimestamp = 0;
        const uploadPromises = this.backupToUpload.map(async (backup) => {
          try {
            const { file } = backup;
            const { component } = backup;
            const { file_size } = backup;
            const { file_name } = backup;
            const { create } = backup;
            let timestamp = create;
            if (Math.abs(timestamp - prevoiusTimestamp) > 1000 * 60 * 60) {
              prevoiusTimestamp = timestamp;
            } else {
              timestamp = prevoiusTimestamp;
            }
            const url = this.selectedIp.split(':')[0];
            const urlPort = this.selectedIp.split(':')[1] || 16127;
            const hostUrl = `https://${url.replace(/\./g, '-')}-${urlPort}.node.api.runonflux.io/backup/downloadlocalfile/${encodeURIComponent(file)}/${self.appName}`;
            const data = {
              appname: self.appName,
              component,
              // eslint-disable-next-line camelcase
              filename: file_name,
              timestamp,
              host: hostUrl,
              // eslint-disable-next-line camelcase
              filesize: file_size,
            };
            const response = await axios.post(`${this.fluxDriveEndPoint}/registerbackupfile`, data, axiosConfig);
            if (response && response.data && response.data.status === 'success') {
              this.fluxDriveUploadTask.push({
                // eslint-disable-next-line camelcase
                taskId: response.data.data.taskId, filename: file_name, component, status: 'in queue', progress: 0,
              });
            } else {
              console.error(response.data);
              this.showToast('danger', response.data.data.message);
              return false;
            }

            return true;
          } catch (error) {
            console.error('Error registering file:', error);
            this.showToast('danger', 'Error registering file(s) for upload.');
            return false;
          }
        });

        const uploadResults = await Promise.all(uploadPromises);
        // Check if all downloads were successful
        if (uploadResults.every((result) => result)) {
          console.log('All uploads registered successfully');
          this.showFluxDriveProgressBar = true;
        } else {
          console.error('Some uploads failed. Check the console for details.');
        }
      } catch (error) {
        console.error('Error registering files:', error);
        this.showToast('danger', 'Error registering file(s) for upload.');
      } finally {
        setTimeout(() => {
          this.checkFluxDriveUploadProgress();
        }, 2000);
      }
    },
    async restoreFromFluxDrive(newComponents) {
      const restoreItems = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const item of newComponents) {
        // eslint-disable-next-line no-await-in-loop
        restoreItems.push({ component: item.component, file_size: item.file_size, url: item.file_url });
      }
      const zelidauth = localStorage.getItem('zelidauth');
      this.showTopFluxDrive = false;
      this.restoringFromFluxDrive = true;
      this.restoreFromFluxDriveStatus = 'Initializing restore jobs...';
      // eslint-disable-next-line no-unused-vars
      const headers = {
        zelidauth,
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        Connection: 'keep-alive',
      };
      const postLayout = this.buildPostBody(this.appSpecification, 'restore', 'remote');
      let postBackupData;
      // eslint-disable-next-line no-restricted-syntax
      for (const componentName of restoreItems) {
        postBackupData = this.updateJobStatus(postLayout, componentName.component, 'restore', restoreItems);
      }
      const url = this.selectedIp.split(':')[0];
      const urlPort = this.selectedIp.split(':')[1] || 16127;
      let queryUrl = `https://${url.replace(/\./g, '-')}-${urlPort}.node.api.runonflux.io/apps/appendrestoretask`;
      if (this.ipAccess) {
        queryUrl = `http://${url}:${urlPort}/apps/appendrestoretask`;
      }
      const response = await fetch(queryUrl, {
        method: 'POST',
        body: JSON.stringify(postBackupData),
        headers,
      });
      const self = this;
      const reader = response.body.getReader();
      // eslint-disable-next-line no-unused-vars
      await new Promise((streamResolve, streamReject) => {
        function push() {
          reader.read().then(async ({ done, value }) => {
            if (done) {
              streamResolve(); // Resolve the stream promise when the response stream is complete
              return;
            }
            // Process each chunk of data separately
            const chunkText = new TextDecoder('utf-8').decode(value);
            const chunks = chunkText.split('\n');
            // eslint-disable-next-line no-restricted-globals
            await self.processChunks(chunks, 'restore_fluxdrive');
            // Check for new data immediately after processing each chunk
            push();
          });
        }
        push();
      });
      this.restoringFromFluxDrive = false;
      this.restoreFromFluxDriveStatus = '';
    },
    async getFluxDriveBackupList() {
      try {
        const zelidauth = localStorage.getItem('zelidauth');
        const axiosConfig = {
          headers: {
            zelidauth,
          },
        };
        const response = await axios.get(`${this.fluxDriveEndPoint}/getbackuplist?appname=${this.appName}`, axiosConfig);
        if (response.data && response.data.status === 'success') {
          console.log(JSON.stringify(response.data.checkpoints));
          this.tableBackup += 1;
          const uniqueComponents = response.data.checkpoints.reduce((acc, { components }) => {
            components.forEach((component) => acc.add(component.component));
            return acc;
          }, new Set());
          const restoreComponentsTmp = [{ value: '', text: 'all' }];
          // eslint-disable-next-line no-restricted-syntax
          for (const item of uniqueComponents) {
            restoreComponentsTmp.push({ value: item, text: item });
          }
          this.restoreComponents = restoreComponentsTmp;
          this.applyFilter();
          this.checkpoints = response.data.checkpoints;
        } else if (response.data && response.data.status === 'error') this.showToast('danger', response.data.data.message);
      } catch (error) {
        console.error('Error receiving FluxDrive backup list', error);
        this.showToast('danger', 'Error receiving FluxDrive backup list');
      }
    },
    async initMMSDK() {
      try {
        await MMSDK.init();
        ethereum = MMSDK.getProvider();
      } catch (error) {
        console.log(error);
      }
    },
    connectTerminal(name) {
      if (this.appSpecification.version >= 4) {
        const composeValues = Object.values(this.appSpecification.compose);
        const foundInName = composeValues.some((obj) => obj.name === this.selectedApp);
        if (!foundInName) {
          this.showToast('danger', 'Please select a container app before connecting.');
          return;
        }
      }
      let consoleInit = 0;
      let skipToast = 0;
      if (this.selectedApp || this.appSpecification.version <= 3) {
        if (this.selectedCmd === null) {
          this.showToast('danger', 'No command selected.');
          return;
        }
        if (this.selectedCmd === 'Custom') {
          if (this.customValue) {
            console.log(`Custom command: ${this.customValue}`);
            console.log(`App name: ${name}`);
          } else {
            this.showToast('danger', 'Please enter a custom command.');
            return;
          }
        } else {
          console.log(`Selected command: ${this.selectedCmd}`);
          console.log(`App name: ${name}`);
        }
      } else {
        this.showToast('danger', 'Please select a container app before connecting.');
        return;
      }

      this.isConnecting = true;
      this.terminal = new Terminal({
        allowProposedApi: true,
        cursorBlink: true,
        theme: {
          foreground: 'white',
          background: 'black',
        },
      });

      const url = this.selectedIp.split(':')[0];
      const urlPort = this.selectedIp.split(':')[1] || 16127;
      const zelidauth = localStorage.getItem('zelidauth');

      let queryUrl = `https://${url.replace(/\./g, '-')}-${urlPort}.node.api.runonflux.io/terminal`;
      if (this.ipAccess) {
        queryUrl = `http://${url}:${urlPort}/terminal`;
      }
      this.socket = io.connect(queryUrl);

      let userValue = '';
      if (this.enableUser) {
        userValue = this.userInputValue;
      }

      if (this.customValue) {
        this.socket.emit('exec', zelidauth, name, this.customValue, this.envInputValue, userValue);
      } else {
        this.socket.emit('exec', zelidauth, name, this.selectedCmd, this.envInputValue, userValue);
      }

      this.terminal.open(this.$refs.terminalElement);
      const fitAddon = new FitAddon();
      this.terminal.loadAddon(fitAddon);
      const webLinksAddon = new WebLinksAddon();
      this.terminal.loadAddon(webLinksAddon);
      const unicode11Addon = new Unicode11Addon();
      this.terminal.loadAddon(unicode11Addon);
      const serializeAddon = new SerializeAddon();
      this.terminal.loadAddon(serializeAddon);
      // eslint-disable-next-line no-underscore-dangle
      this.terminal._initialized = true;

      this.terminal.onResize((event) => {
        const { cols, rows } = event;
        console.log('Resizing to', { cols, rows });
        this.socket.emit('resize', { cols, rows });
      });

      this.terminal.onTitleChange((event) => {
        console.log(event);
      });

      window.onresize = () => {
        fitAddon.fit();
      };

      this.terminal.onData((data) => {
        this.socket.emit('cmd', data);
      });

      this.socket.on('error', (error) => {
        this.showToast('danger', error);
        this.disconnectTerminal();
      });

      this.socket.on('show', (data) => {
        if (typeof data === 'string' && consoleInit === 0 && data.includes('OCI runtime exec')) {
          skipToast = 1;
          const failedCommand = this.customValue || this.selectedCmd;
          console.error(`Error: ${data}`);
          const errorMessage = `The command "${failedCommand}" is not supported in this container.`;
          this.showToast('danger', errorMessage);
          this.disconnectTerminal();
          return;
        }

        if (consoleInit === 0) {
          consoleInit = 1;
          if (!this.customValue) {
            // eslint-disable-next-line quotes
            this.socket.emit('cmd', "export TERM=xterm\n");
            if (this.selectedCmd === '/bin/bash') {
              // eslint-disable-next-line quotes
              this.socket.emit('cmd', "PS1=\"\\[\\033[01;31m\\]\\u\\[\\033[01;33m\\]@\\[\\033[01;36m\\]\\h \\[\\033[01;33m\\]\\w \\[\\033[01;35m\\]\\$ \\[\\033[00m\\]\"\n");
            }
            this.socket.emit('cmd', "alias ls='ls --color'\n");
            this.socket.emit('cmd', "alias ll='ls -alF'\n");
          }
          setTimeout(() => {
            this.$nextTick(() => {
              setTimeout(() => {
                this.isConnecting = false;
                this.isVisible = true;
                this.terminal.clear();
                this.$nextTick(() => {
                  this.terminal.focus();
                  setTimeout(() => {
                    fitAddon.fit();
                  }, 100);
                });
              }, 500);
            });
          }, 1400);
        }
        this.terminal.write(data);
      });

      this.socket.on('disconnect', () => {
        if (skipToast === 0) {
          this.showToast('warning', 'Disconnected from terminal.');
        }
        this.disconnectTerminal();
      });

      this.socket.on('end', () => {
        this.disconnectTerminal();
      });
    },
    disconnectTerminal() {
      if (this.socket) {
        this.socket.disconnect();
      }
      if (this.terminal) {
        this.terminal.dispose();
      }
      this.isVisible = false;
      this.isConnecting = false;
    },
    onSelectChangeCmd() {
      if (this.selectedCmd !== 'Custom') {
        this.customValue = '';
      }
    },
    onSelectChangeEnv() {
      if (!this.enableEnvironment) {
        this.envInputValue = '';
      }
    },
    onSelectChangeUser() {
      if (!this.enableUser) {
        this.userInputValue = '';
      }
    },
    onFilteredSelection(filteredItems) {
      // Trigger pagination to update the number of buttons/pages due to filtering
      this.entNodesSelectTable.totalRows = filteredItems.length;
      this.entNodesSelectTable.currentPage = 1;
    },
    async getMarketPlace() {
      try {
        const response = await axios.get('https://stats.runonflux.io/marketplace/listapps');
        if (response.data.status === 'success') {
          this.marketPlaceApps = response.data.data;
        }
      } catch (error) {
        console.log(error);
      }
    },
    async getMultiplier() {
      try {
        const response = await axios.get('https://stats.runonflux.io/apps/multiplier');
        if (response.data.status === 'success') {
          if (typeof response.data.data === 'number' && response.data.data >= 1) {
            this.generalMultiplier = response.data.data;
          }
        }
      } catch (error) {
        this.generalMultiplier = 10;
        console.log(error);
      }
    },
    async appsDeploymentInformation() {
      const response = await AppsService.appsDeploymentInformation();
      const { data } = response.data;
      if (response.data.status === 'success') {
        this.deploymentAddress = data.address;
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
    },
    async updateManagementTab(index) {
      await this.getZelidAuthority();
      if (!this.globalZelidAuthorized) {
        return;
      }
      window.scrollTo({ top: 0, left: 0 });
      if (index === 1) {
        this.callResponse.data = '';
        this.callBResponse.data = '';
      }
      this.noData = false;
      this.processes = [];
      this.enableHistoryStatistics = false;
      this.callResponseChanges.data = '';
      this.callResponseInspect.data = '';
      this.logs = [];
      this.selectedLog = [];
      this.appExec.cmd = '';
      this.appExec.env = '';
      this.output = [];
      this.downloadOutput = {};
      this.downloadOutputReturned = false;
      this.backupToUpload = [];
      const tabs = this.$refs.managementTabs.$children;

      let appsFetched = false;

      const tabTitle = tabs[index]?.title;
      if (tabTitle !== 'Interactive Terminal') {
        this.disconnectTerminal();
      }
      if (tabTitle !== 'Logs') {
        this.stopPolling();
        this.pollingEnabled = false;
      }
      if (tabTitle !== 'Monitoring') {
        this.stopPollingStats();
      }
      if (!this.selectedIp) {
        appsFetched = true;

        await this.getGlobalApplicationSpecifics();
        await this.getInstancesForDropDown();
        await this.$nextTick();
        this.getApplicationLocations().catch(() => {
          this.isBusy = false;
          this.showToast('danger', 'Error loading application locations');
        });
      }
      await this.getApplicationManagementAndStatus();
      await this.$nextTick();
      if (this.applicationManagementAndStatus?.length === 0) {
        console.log('Application not found. Instance switching...');
        await this.switchInstance();
        if (this.applicationManagementAndStatus?.length === 0) {
          // I have disabled this. This is a heavy call, especially for
          // enterprise apps. It makes no sense to get the global app sepcs again
          // as we just got them prior... this was causing us to fetch the pubkey
          // twice and decrypt the specs twice. If there was a reason for this,
          // we can look at doing it a different way.
          // await this.getGlobalApplicationSpecifics();
          this.noInstanceAvailable = true;
          return;
        }
      }
      this.noInstanceAvailable = false;
      // this should use a map so you can determine what is happening here
      switch (index) {
        case 1:
          // this was causing these function to run twice on page load
          if (!appsFetched) {
            await this.getInstalledApplicationSpecifics();
            await this.getGlobalApplicationSpecifics();
          }
          break;
        case 2:
          this.getApplicationInspect();
          break;
        case 3:
          this.$nextTick(() => {
            this.initCharts();
            setTimeout(this.startPollingStats(), 2000);
          });
          break;
        case 4:
          this.getApplicationChanges();
          break;
        case 5:
          this.fetchLogsForSelectedContainer();
          break;
        case 8:
          this.applyFilter();
          this.loadBackupList();
          break;
        case 9:
          if (!this.appSpecification?.compose || this.appSpecification?.compose?.length === 1) {
            this.refreshFolder();
          } else if (this.selectedAppVolume) {
            this.refreshFolder();
          }
          break;
        case 13:
          this.getZelidAuthority();
          this.cleanData();
          break;
        case 14:
          this.getZelidAuthority();
          this.cleanData();
          break;
        default:
          break;
      }
    },
    async appsGetListAllApps() {
      const response = await this.executeLocalCommand('/apps/listallapps', null, null, true);
      console.log(response);
      this.getAllAppsResponse.status = response?.data?.status;
      this.getAllAppsResponse.data = response?.data?.data;
      this.getApplicationManagementAndStatus(true);
      await this.$nextTick();
    },
    goBackToApps() {
      this.$emit('back');
    },
    async initSignFluxSSO() {
      try {
        const message = this.dataToSign;
        const firebaseUser = getUser();
        if (!firebaseUser) {
          this.showToast('warning', 'Not logged in as SSO. Login with SSO or use different signing method.');
          return;
        }
        const token = firebaseUser.auth.currentUser.accessToken;
        const headers = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        };
        const signSSO = await axios.post('https://service.fluxcore.ai/api/signMessage', { message }, { headers });
        if (signSSO.data?.status !== 'success' && signSSO.data?.signature) {
          this.showToast('warning', 'Failed to sign message, please try again.');
          return;
        }
        this.signature = signSSO.data.signature;
        this.showToast('success', 'Message signed.');
      } catch (error) {
        this.showToast('warning', 'Failed to sign message, please try again.');
      }
    },
    async initZelcorePay() {
      try {
        this.paymentLoading = true;
        this.paymentReceived = false;
        this.transactionId = '';

        // Request a payment ID from the backend
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
          if (typeof hostname === 'string') {
            this.$store.commit('flux/setUserIp', hostname);
          }
          if (+port > 16100) {
            const apiPort = +port + 1;
            this.$store.commit('flux/setFluxPort', apiPort);
          }
          mybackend += hostname;
          mybackend += ':';
          mybackend += this.config.apiPort;
        }
        const backendURL = store.get('backendURL') || mybackend;

        const paymentResponse = await axios.get(`${backendURL}/payment/paymentrequest`);
        if (paymentResponse.data.status !== 'success') {
          throw new Error('Failed to create payment request');
        }

        this.paymentId = paymentResponse.data.data.paymentId;

        // Set up WebSocket connection for payment confirmation
        this.initiatePaymentWS();

        // Build ZelCore protocol URL with callback
        const zelProtocol = `zel:?action=pay&coin=zelcash&address=${this.deploymentAddress}&amount=${this.appPricePerSpecs}&message=${this.updateHash}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2Fflux_banner.png&callback=${this.paymentCallbackValue()}`;

        if (window.zelcore) {
          window.zelcore.protocol(zelProtocol);
        } else {
          const hiddenLink = document.createElement('a');
          hiddenLink.href = zelProtocol;
          hiddenLink.style.display = 'none';
          document.body.appendChild(hiddenLink);
          hiddenLink.click();
          document.body.removeChild(hiddenLink);
        }
      } catch (error) {
        this.paymentLoading = false;
        this.showToast('error', 'Failed to initiate ZelCore payment. Please try again.');
        console.error(error);
      }
    },
    async initZelcore() {
      try {
        const protocol = `zel:?action=sign&message=${this.dataToSign}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${this.callbackValue}`;
        if (window.zelcore) {
          window.zelcore.protocol(protocol);
        } else if (this.dataToSign.length > 1800) {
          const message = this.dataToSign;
          // upload to flux storage
          const data = {
            publicid: Math.floor((Math.random() * 999999999999999)).toString(),
            public: message,
          };
          await axios.post(
            'https://storage.runonflux.io/v1/public',
            data,
          );
          const zelProtocol = `zel:?action=sign&message=FLUX_URL=https://storage.runonflux.io/v1/public/${data.publicid}&icon=https%3A%2F%2Fraw.githubusercontent.com%2Frunonflux%2Fflux%2Fmaster%2FzelID.svg&callback=${this.callbackValue}`;
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
        this.showToast('warning', 'Failed to sign message, please try again.');
      }
    },
    async initiateSignWSUpdate() {
      await this.initZelcore();
      const self = this;
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
          this.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          this.$store.commit('flux/setFluxPort', apiPort);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += this.config.apiPort;
      }
      let backendURL = store.get('backendURL') || mybackend;
      backendURL = backendURL.replace('https://', 'wss://');
      backendURL = backendURL.replace('http://', 'ws://');
      const signatureMessage = this.appUpdateSpecification.owner + this.timestamp;
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
    // Payment WebSocket handlers
    onPaymentError(evt) {
      console.log('Payment WebSocket error:', evt);
      this.paymentLoading = false;
    },
    onPaymentMessage(evt) {
      const data = qs.parse(evt.data);
      console.log('Payment WebSocket message:', data);

      if (data.status === 'success' && data.data) {
        const paymentData = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
        this.transactionId = paymentData.txid;
        this.paymentReceived = true;
        this.paymentLoading = false;
        this.showToast('success', `Payment received! Transaction ID: ${this.transactionId}`);
      } else if (data.status === 'error') {
        this.paymentLoading = false;
        const errorMsg = typeof data.data === 'string' ? data.data : (data.data?.message || data.message || 'Payment request expired or invalid');
        this.showToast('error', errorMsg);
      }
    },
    onPaymentClose(evt) {
      console.log('Payment WebSocket closed:', evt);
      if (!this.paymentReceived) {
        this.paymentLoading = false;
      }
    },
    onPaymentOpen(evt) {
      console.log('Payment WebSocket opened:', evt);
    },
    initiatePaymentWS() {
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
        if (typeof hostname === 'string') {
          this.$store.commit('flux/setUserIp', hostname);
        }
        if (+port > 16100) {
          const apiPort = +port + 1;
          this.$store.commit('flux/setFluxPort', apiPort);
        }
        mybackend += hostname;
        mybackend += ':';
        mybackend += this.config.apiPort;
      }
      let backendURL = store.get('backendURL') || mybackend;
      // Convert HTTP/HTTPS to WebSocket protocol
      backendURL = backendURL.replace('https://', 'wss://');
      backendURL = backendURL.replace('http://', 'ws://');
      const wsuri = `${backendURL}/ws/payment/${this.paymentId}`;
      const websocketConn = new WebSocket(wsuri);
      this.paymentWebsocket = websocketConn;

      const self = this;
      websocketConn.onopen = (evt) => { self.onPaymentOpen(evt); };
      websocketConn.onclose = (evt) => { self.onPaymentClose(evt); };
      websocketConn.onmessage = (evt) => { self.onPaymentMessage(evt); };
      websocketConn.onerror = (evt) => { self.onPaymentError(evt); };
    },

    async getInstalledApplicationSpecifics(silent = false) {
      const installedRes = await this.executeLocalCommand(
        `/apps/installedapps/${this.appName}`,
        null,
        null,
        true,
      );

      if (!installedRes) return;

      const { data: { status: installedStatus, data: appSpecs } } = installedRes;

      if (installedStatus !== 'success' || !appSpecs.length) {
        if (!silent) {
          this.showToast('danger', 'Unable to get installed app spec');
          return;
        }
      }

      const spec = appSpecs[0];

      const isEnterprise = spec.version >= 8 && spec.enterprise;

      const sameEnterpriseSpec = (
        spec.enterprise === this.callBResponse.data.enterprise
      );

      // this is the global spec we have already decrypted
      if (isEnterprise && sameEnterpriseSpec) {
        spec.contacts = this.callBResponse.data.contacts;
        spec.compose = this.callBResponse.data.compose;
      } else if (isEnterprise && !sameEnterpriseSpec) {
        const decrypted = await this.getDecryptedEnterpriseFields(
          { local: true },
        );

        const showToast = !decrypted && !silent;

        if (showToast) {
          this.showToast('danger', 'Unable to get decrypted app spec');
        }

        if (!decrypted) return;

        spec.contacts = decrypted.contacts;
        spec.compose = decrypted.compose;
      }

      this.callResponse.status = installedStatus;
      this.callResponse.data = spec;
      this.appSpecification = spec;
    },
    getExpireOptions() {
      this.expireOptions = [];
      const expires = this.callBResponse.data.expire || 22000;
      const currentExpire = this.callBResponse.data.height + expires - this.daemonBlockCount;

      // After block 2020000, the chain works 4x faster, so expire periods need to be multiplied by 4
      const multiplier = this.daemonBlockCount >= FORK_BLOCK_HEIGHT ? 4 : 1;
      const baseOneWeek = 5000 * multiplier;
      const baseTwoWeeks = 11000 * multiplier;
      const baseOneMonth = 22000 * multiplier;
      const baseThreeMonths = 66000 * multiplier;
      const baseSixMonths = 132000 * multiplier;
      const baseOneYear = 264000 * multiplier;

      if (currentExpire + baseOneWeek < baseOneYear) {
        this.expireOptions.push({
          value: baseOneWeek + currentExpire,
          label: '1 week',
          time: 7 * 24 * 60 * 60 * 1000,
        });
      }
      this.expirePosition = 0;
      if (currentExpire + baseTwoWeeks < baseOneYear) {
        this.expireOptions.push({
          value: baseTwoWeeks + currentExpire,
          label: '2 weeks',
          time: 14 * 24 * 60 * 60 * 1000,
        });
        this.expirePosition = 1;
      }
      if (currentExpire + baseOneMonth < baseOneYear) {
        this.expireOptions.push({
          value: baseOneMonth + currentExpire,
          label: '1 month',
          time: 30 * 24 * 60 * 60 * 1000,
        });
        this.expirePosition = 2;
      }
      if (currentExpire + baseThreeMonths < baseOneYear) {
        this.expireOptions.push({
          value: baseThreeMonths + currentExpire,
          label: '3 months',
          time: 90 * 24 * 60 * 60 * 1000,
        });
      }
      if (currentExpire + baseSixMonths < baseOneYear) {
        this.expireOptions.push({
          value: baseSixMonths + currentExpire,
          label: '6 months',
          time: 180 * 24 * 60 * 60 * 1000,
        });
      }
      this.expireOptions.push({
        value: baseOneYear,
        label: 'Up to one year',
        time: 365 * 24 * 60 * 60 * 1000,
      });
    },
    async decryptEnterpriseWithAes(base64nonceCiphertextTag, aesKey) {
      const nonceCiphertextTag = this.base64ToUint8Array(base64nonceCiphertextTag);

      const nonce = nonceCiphertextTag.slice(0, 12);
      const ciphertextTag = nonceCiphertextTag.slice(12);

      const aesCryptoKey = await crypto.subtle.importKey(
        'raw',
        aesKey,
        'AES-GCM',
        true,
        ['encrypt', 'decrypt'],
      );

      const plainTextBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce },
        aesCryptoKey,
        ciphertextTag,
      );

      const plainText = new TextDecoder().decode(plainTextBuf);

      return plainText;
    },
    async getGlobalApplicationSpecifics() {
      const appSpecRes = await AppsService.getAppSpecifics(this.appName);

      const { data: { status: appSpecStatus, data: appSpec } } = appSpecRes;

      if (appSpecStatus !== 'success') {
        this.showToast('danger', 'Unable to get global app spec');
        this.callBResponse.status = appSpecStatus;
        return;
      }

      const isEnterprise = appSpec.version >= 8 && appSpec.enterprise;

      if (isEnterprise) {
        const decrypted = await this.getDecryptedEnterpriseFields();

        if (!decrypted) return;

        const { contacts, compose } = decrypted;

        appSpec.contacts = contacts;
        appSpec.compose = compose;
      }

      // why are we doing this? We are storing a copy of this same object
      // at appUpdateSpecification
      this.callBResponse.status = 'success';
      this.callBResponse.data = appSpec;

      this.$store.commit('flux/setAppName', appSpec.name);

      // why do this? It's a new object anyway
      this.appUpdateSpecification = JSON.parse(JSON.stringify(appSpec));

      this.appUpdateSpecification.instances = appSpec.instances || 3;

      if (this.instancesLocked) {
        this.maxInstances = this.appUpdateSpecification.instances;
      }

      if (this.appUpdateSpecification.version <= 3) {
        this.appUpdateSpecification.version = 3; // enforce specs version 3
        this.appUpdateSpecification.ports = appSpec.port || this.ensureString(appSpec.ports); // v1 compatibility
        this.appUpdateSpecification.domains = this.ensureString(appSpec.domains);
        this.appUpdateSpecification.enviromentParameters = this.ensureString(appSpec.enviromentParameters);
        this.appUpdateSpecification.commands = this.ensureString(appSpec.commands);
        this.appUpdateSpecification.containerPorts = appSpec.containerPort || this.ensureString(appSpec.containerPorts); // v1 compatibility
      } else {
        if (this.appUpdateSpecification.version > 3 && this.appUpdateSpecification.compose.find((comp) => comp.containerData.includes('g:'))) {
          this.masterSlaveApp = true;
        }
        if (this.appUpdateSpecification.version <= 7) {
          this.appUpdateSpecification.version = 7;
        }
        this.appUpdateSpecification.contacts = this.ensureString([]);
        this.appUpdateSpecification.geolocation = this.ensureString([]);
        if (this.appUpdateSpecification.version >= 5) {
          this.appUpdateSpecification.contacts = this.ensureString(appSpec.contacts || []);
          this.appUpdateSpecification.geolocation = this.ensureString(appSpec.geolocation || []);
          try {
            this.decodeGeolocation(appSpec.geolocation || []);
          } catch (error) {
            console.log(error);
            this.appUpdateSpecification.geolocation = this.ensureString([]);
          }
        }
        this.appUpdateSpecification.compose.forEach((component) => {
          // eslint-disable-next-line no-param-reassign
          component.ports = this.ensureString(component.ports);
          // eslint-disable-next-line no-param-reassign
          component.domains = this.ensureString(component.domains);
          // eslint-disable-next-line no-param-reassign
          component.environmentParameters = this.ensureString(component.environmentParameters);
          // eslint-disable-next-line no-param-reassign
          component.commands = this.ensureString(component.commands);
          // eslint-disable-next-line no-param-reassign
          component.containerPorts = this.ensureString(component.containerPorts);
          // eslint-disable-next-line no-param-reassign
          component.secrets = this.ensureString(component.secrets || '');
          // eslint-disable-next-line no-param-reassign
          component.repoauth = this.ensureString(component.repoauth || '');
        });
        if (this.appUpdateSpecification.version >= 6) {
          this.getExpireOptions();
          this.appUpdateSpecification.expire = this.ensureNumber(this.expireOptions[this.expirePosition].value);
        }
        if (this.appUpdateSpecification.version === 7) {
          this.appUpdateSpecification.staticip = this.appUpdateSpecification.staticip ?? false;
          this.appUpdateSpecification.nodes = this.appUpdateSpecification.nodes || [];
          if (this.appUpdateSpecification.nodes && this.appUpdateSpecification.nodes.length) {
            this.isPrivateApp = true;
          }
          // fetch information about enterprise nodes, pgp keys
          this.appUpdateSpecification.nodes.forEach(async (node) => {
            // fetch pgp key
            const keyExists = this.enterprisePublicKeys.find((key) => key.nodeip === node);
            if (!keyExists) {
              const pgpKey = await this.fetchEnterpriseKey(node);
              if (pgpKey) {
                const pair = {
                  nodeip: node.ip,
                  nodekey: pgpKey,
                };
                const keyExistsB = this.enterprisePublicKeys.find((key) => key.nodeip === node);
                if (!keyExistsB) {
                  this.enterprisePublicKeys.push(pair);
                }
              }
            }
          });
          if (!this.enterpriseNodes) {
            await this.getEnterpriseNodes();
          }
          this.selectedEnterpriseNodes = [];
          this.appUpdateSpecification.nodes.forEach((node) => {
            // add to selected node list
            if (this.enterpriseNodes) {
              const nodeFound = this.enterpriseNodes.find((entNode) => entNode.ip === node || node === `${entNode.txhash}:${entNode.outidx}`);
              if (nodeFound) {
                this.selectedEnterpriseNodes.push(nodeFound);
              }
            } else {
              this.showToast('danger', 'Failed to load Enterprise Node List');
            }
          });
        }
        if (this.appUpdateSpecification.version >= 8) {
          this.appUpdateSpecification.staticip = this.appUpdateSpecification.staticip ?? false;
          this.appUpdateSpecification.nodes = this.appUpdateSpecification.nodes || [];
          if (this.appUpdateSpecification.enterprise) {
            this.isPrivateApp = true;
          }
          if (!this.enterpriseNodes) {
            await this.getEnterpriseNodes();
          }
          this.selectedEnterpriseNodes = [];
          this.appUpdateSpecification.nodes.forEach((node) => {
            // add to selected node list
            if (this.enterpriseNodes) {
              const nodeFound = this.enterpriseNodes.find((entNode) => entNode.ip === node || node === `${entNode.txhash}:${entNode.outidx}`);
              if (nodeFound) {
                this.selectedEnterpriseNodes.push(nodeFound);
              }
            } else {
              this.showToast('danger', 'Failed to load Priority Node List');
            }
          });
        }
      }
    },
    async testAppInstall(app) {
      if (this.downloading) {
        this.showToast('danger', 'Test install/launch was already initiated');
        return;
      }
      const self = this;
      this.output = [];
      this.downloadOutput = {};
      this.downloadOutputReturned = false;
      this.downloading = true;
      this.testError = false;
      this.showToast('warning', `Testing ${app} installation, please wait`);
      const zelidauth = localStorage.getItem('zelidauth');
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.event.target.response);
          self.output = JSON.parse(`[${progressEvent.event.target.response.replace(/}{/g, '},{')}]`);
        },
      };
      let response;
      try {
        if (this.appUpdateSpecification.nodes.length > 0) {
          const nodeip = this.appUpdateSpecification.nodes[Math.floor(Math.random() * this.appUpdateSpecification.nodes.length)];
          const ip = nodeip.split(':')[0];
          const port = Number(nodeip.split(':')[1] || 16127);
          const url = `https://${ip.replace(/\./g, '-')}-${port}.node.api.runonflux.io/apps/testappinstall/${app}`;
          response = await axios.get(url, axiosConfig);
        } else {
          response = await AppsService.justAPI().get(`/apps/testappinstall/${app}`, axiosConfig);
        }
        if (response.data.status === 'error') {
          this.testError = true;
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          console.log(response);
          this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
          console.log(this.output);
          for (let i = 0; i < this.output.length; i += 1) {
            if (this.output[i] && this.output[i].data && this.output[i].data.message && this.output[i].data.message.includes('Error occured')) {
              // error is defined one line above
              if (this.output[i - 1] && this.output[i - 1].data) {
                this.testError = true;
                this.showToast('danger', 'Error on Test, check logs');
                return;
              }
            }
          }
          if (this.output[this.output.length - 1].status === 'error') {
            this.showToast('danger', 'Error on Test, check logs');
            this.testError = true;
          } else if (this.output[this.output.length - 1].status === 'warning') {
            this.showToast('warning', 'Warning on Test, check logs');
            this.testError = true;
          } else {
            this.testError = false;
            this.showToast('success', 'Test passed, you can continue with app payment');
          }
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
      this.downloading = false;
    },

    async update() {
      const zelidauth = localStorage.getItem('zelidauth');
      const data = {
        type: this.updatetype,
        version: this.version,
        appSpecification: this.dataForAppUpdate,
        timestamp: this.timestamp,
        signature: this.signature,
      };
      this.progressVisable = true;
      this.operationTitle = 'Propagating message accross Flux network...';
      const response = await AppsService.updateApp(zelidauth, data).catch((error) => {
        this.showToast('danger', error.message || error);
      });
      console.log(response);
      if (response.data.status === 'success') {
        this.updateHash = response.data.data;
        console.log(this.updateHash);
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      const fiatGateways = await getPaymentGateways();
      if (fiatGateways) {
        this.stripeEnabled = fiatGateways.stripe;
        this.paypalEnabled = fiatGateways.paypal;
      }
      this.progressVisable = false;
    },
    async checkFluxCommunication() {
      const response = await AppsService.checkCommunication();
      if (response.data.status === 'success') {
        this.fluxCommunication = true;
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
    },
    convertExpire() {
      if (!this.extendSubscription) {
        const expires = this.callBResponse.data.expire || 22000;
        const blocksToExpire = this.callBResponse.data.height + expires - this.daemonBlockCount;
        // Use dynamic minExpire that adjusts based on block height
        if (blocksToExpire < this.minExpire) {
          throw new Error('Your application will expire in less than one week, you need to extend subscription to be able to update specifications');
        } else {
          return blocksToExpire;
        }
      }
      if (this.expireOptions[this.expirePosition]) {
        return this.expireOptions[this.expirePosition].value;
      }
      // Use dynamic default based on block height (1 month)
      const multiplier = this.daemonBlockCount >= FORK_BLOCK_HEIGHT ? 4 : 1;
      return 22000 * multiplier;
    },
    async importRsaPublicKey(base64SpkiDer) {
      const spkiDer = Buffer.from(base64SpkiDer, 'base64');
      // eslint-disable-next-line no-return-await
      return await crypto.subtle.importKey(
        'spki',
        spkiDer,
        {
          name: 'RSA-OAEP',
          hash: 'SHA-256',
        },
        false,
        ['encrypt'],
      );
    },
    base64ToUint8Array(base64) {
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);

      for (let i = 0; i < len; i += 1) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      return bytes;
    },
    arrayBufferToBase64(buffer) {
      const data = [];

      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;

      for (let i = 0; i < len; i += 1) {
        data.push(String.fromCharCode(bytes[i]));
      }

      return btoa(data.join(''));
    },
    async encryptAesKeyWithRsaKey(aesKey, rsaPubKey) {
      const base64AesKey = this.arrayBufferToBase64(aesKey);

      const rsaEncryptedBase64AesKey = await crypto.subtle.encrypt(
        {
          name: 'RSA-OAEP',
        },
        rsaPubKey,
        Buffer.from(base64AesKey),
      );

      const base64RsaEncryptedBase64AesKey = this.arrayBufferToBase64(
        rsaEncryptedBase64AesKey,
      );

      return base64RsaEncryptedBase64AesKey;
    },
    async encryptEnterpriseWithAes(
      plainText,
      aesKey,
      base64RsaEncryptedAesKey,
    ) {
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const plaintextEncoded = new TextEncoder().encode(plainText);
      const rsaEncryptedAesKey = this.base64ToUint8Array(base64RsaEncryptedAesKey);

      const aesCryptoKey = await crypto.subtle.importKey(
        'raw',
        aesKey,
        'AES-GCM',
        true,
        ['encrypt', 'decrypt'],
      );

      const ciphertextTagBuf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce },
        aesCryptoKey,
        plaintextEncoded,
      );

      const ciphertextTag = new Uint8Array(ciphertextTagBuf);

      const keyNonceCiphertextTag = new Uint8Array(
        rsaEncryptedAesKey.length + nonce.length + ciphertextTag.length,
      );

      keyNonceCiphertextTag.set(rsaEncryptedAesKey);
      keyNonceCiphertextTag.set(nonce, rsaEncryptedAesKey.byteLength);
      keyNonceCiphertextTag.set(
        ciphertextTag,
        rsaEncryptedAesKey.byteLength + nonce.length,
      );

      const keyNonceCiphertextTagBase64 = this.arrayBufferToBase64(
        keyNonceCiphertextTag.buffer,
      );

      return keyNonceCiphertextTagBase64;
    },
    async checkFluxUpdateSpecificationsAndFormatMessage() {
      try {
        if (this.appRunningTill.new < this.appRunningTill.current) {
          throw new Error('New subscription period cannot be lower than the current one.');
        }
        if (!this.tosAgreed) {
          throw new Error('Please agree to Terms of Service');
        }
        this.operationTitle = ' Compute update message...';
        this.progressVisable = true;
        const appSpecification = JSON.parse(JSON.stringify(this.appUpdateSpecification));
        let secretsPresent = false;
        if (appSpecification.version === 7) {
          // construct nodes
          this.constructNodes();
          // encryption
          // if we have secrets or repoauth
          this.appUpdateSpecification.compose.forEach((component) => {
            if (component.repoauth || component.secrets) {
              secretsPresent = true;
              // we must have some nodes
              if (!this.appUpdateSpecification.nodes.length) {
                throw new Error('Private repositories and secrets can only run on Enterprise Nodes');
              }
            }
          });
          if (secretsPresent) { // we do encryption
            this.showToast('info', 'Encrypting specifications, this will take a while...');
            const fetchedKeys = [];
            // eslint-disable-next-line no-restricted-syntax
            for (const node of this.appUpdateSpecification.nodes) {
              const keyExists = this.enterprisePublicKeys.find((key) => key.nodeip === node);
              if (keyExists) {
                fetchedKeys.push(keyExists.nodekey);
              } else {
              // eslint-disable-next-line no-await-in-loop
                const pgpKey = await this.fetchEnterpriseKey(node);
                if (pgpKey) {
                  const pair = {
                    nodeip: node.ip,
                    nodekey: pgpKey,
                  };
                  const keyExistsB = this.enterprisePublicKeys.find((key) => key.nodeip === node.ip);
                  if (!keyExistsB) {
                    this.enterprisePublicKeys.push(pair);
                  }
                  fetchedKeys.push(pgpKey);
                } // else silently fail
              }
            }
            // time to encrypt
            // eslint-disable-next-line no-restricted-syntax
            for (const component of this.appUpdateSpecification.compose) {
              component.environmentParameters = component.environmentParameters.replace('\\“', '\\"');
              component.commands = component.commands.replace('\\“', '\\"');
              component.domains = component.domains.replace('\\“', '\\"');
              if (component.secrets && !component.secrets.startsWith('-----BEGIN PGP MESSAGE')) {
              // need encryption
                component.secrets = component.secrets.replace('\\“', '\\"');
                // eslint-disable-next-line no-await-in-loop
                const encryptedMessage = await this.encryptMessage(component.secrets, fetchedKeys);
                if (!encryptedMessage) {
                  return;
                }
                component.secrets = encryptedMessage;
              }
              if (component.repoauth && !component.repoauth.startsWith('-----BEGIN PGP MESSAGE')) {
              // need encryption
              // eslint-disable-next-line no-await-in-loop
                const encryptedMessage = await this.encryptMessage(component.repoauth, fetchedKeys);
                if (!encryptedMessage) {
                  return;
                }
                component.repoauth = encryptedMessage;
              }
            }
          }
          // recheck if encryption ok
          if (secretsPresent) {
            this.appUpdateSpecification.compose.forEach((component) => {
              if (component.secrets && !component.secrets.startsWith('-----BEGIN PGP MESSAGE')) {
                throw new Error('Encryption failed');
              }
              if (component.repoauth && !component.repoauth.startsWith('-----BEGIN PGP MESSAGE')) {
                throw new Error('Encryption failed');
              }
            });
          }
        }

        if (appSpecification.version >= 5) {
          appSpecification.geolocation = this.generateGeolocations();
        }
        if (appSpecification.version >= 6) {
          await this.getDaemonBlockCount();
          appSpecification.expire = this.convertExpire();
        }
        if (appSpecification.version >= 8) {
          // construct nodes
          this.constructNodes();
          if (this.isPrivateApp) {
            const responseGetOriginalOwner = await AppsService.getAppOriginalOwner(this.appName);
            if (responseGetOriginalOwner.data.status === 'error') {
              throw new Error(responseGetOriginalOwner.data.data.message || responseGetOriginalOwner.data.data);
            }
            const zelidauth = localStorage.getItem('zelidauth');
            // call api to get RSA public key
            const appPubKeyData = {
              name: appSpecification.name,
              owner: responseGetOriginalOwner.data.data,
            };
            const responseGetPublicKey = await AppsService.getAppPublicKey(zelidauth, appPubKeyData);
            if (responseGetPublicKey.data.status === 'error') {
              throw new Error(responseGetPublicKey.data.data.message || responseGetPublicKey.data.data);
            }
            const pubkey = responseGetPublicKey.data.data;

            const rsaPubKey = await this.importRsaPublicKey(pubkey);
            const aesKey = crypto.getRandomValues(new Uint8Array(32));

            const encryptedEnterpriseKey = await this.encryptAesKeyWithRsaKey(
              aesKey,
              rsaPubKey,
            );
            const enterpriseSpecs = {
              contacts: appSpecification.contacts,
              compose: appSpecification.compose,
            };
            const encryptedEnterprise = await this.encryptEnterpriseWithAes(
              JSON.stringify(enterpriseSpecs),
              aesKey,
              encryptedEnterpriseKey,
            );
            appSpecification.enterprise = encryptedEnterprise;
            appSpecification.contacts = [];
            appSpecification.compose = [];
          }
        }
        // call api for verification of app registration specifications that returns formatted specs
        const responseAppSpecs = await AppsService.appUpdateVerification(appSpecification);
        if (responseAppSpecs.data.status === 'error') {
          throw new Error(responseAppSpecs.data.data.message || responseAppSpecs.data.data);
        }
        const appSpecFormatted = responseAppSpecs.data.data;
        this.appPricePerSpecs = 0;
        this.appPricePerSpecsUSD = 0;
        this.applicationPriceFluxDiscount = '';
        this.applicationPriceFluxError = false;
        this.freeUpdate = false;
        const response = await AppsService.appPriceUSDandFlux(appSpecFormatted);
        if (response.data.status === 'error') {
          throw new Error(response.data.data.message || response.data.data);
        }
        this.appPricePerSpecsUSD = +response.data.data.usd;
        console.log(response.data.data);

        if (this.appPricePerSpecsUSD === 0) {
          this.freeUpdate = true;
        } else if (Number.isNaN(+response.data.data.fluxDiscount)) {
          this.applicationPriceFluxError = true;
          this.showToast('danger', 'Not possible to complete payment with Flux crypto currency');
        } else {
          this.appPricePerSpecs = +response.data.data.flux;
          this.applicationPriceFluxDiscount = +response.data.data.fluxDiscount;
        }

        const marketPlaceApp = this.marketPlaceApps.find((app) => this.appUpdateSpecification.name.toLowerCase().startsWith(app.name.toLowerCase()));
        if (marketPlaceApp) {
          this.isMarketplaceApp = true;
        }
        this.timestamp = Date.now();
        this.dataForAppUpdate = appSpecFormatted;
        this.dataToSign = this.updatetype + this.version + JSON.stringify(appSpecFormatted) + this.timestamp;
        this.progressVisable = false;
      } catch (error) {
        this.progressVisable = false;
        console.log(error.message);
        console.error(error);
        this.showToast('danger', error.message || error);
      }
    },
    async checkFluxCancelSubscriptionAndFormatMessage() {
      try {
        this.progressVisable = true;
        this.operationTitle = 'Cancelling subscription...';
        const appSpecification = this.appUpdateSpecification;
        appSpecification.geolocation = this.generateGeolocations();
        appSpecification.expire = 100;
        // call api for verification of app registration specifications that returns formatted specs
        const responseAppSpecs = await AppsService.appUpdateVerification(appSpecification);
        this.progressVisable = false;
        if (responseAppSpecs.data.status === 'error') {
          throw new Error(responseAppSpecs.data.data.message || responseAppSpecs.data.data);
        }
        const appSpecFormatted = responseAppSpecs.data.data;
        this.timestamp = Date.now();
        this.dataForAppUpdate = appSpecFormatted;
        this.dataToSign = this.updatetype + this.version + JSON.stringify(appSpecFormatted) + this.timestamp;
      } catch (error) {
        this.progressVisable = false;
        console.log(error.message);
        console.error(error);
        this.showToast('danger', error.message || error);
      }
    },

    async appExecute(name = this.appSpecification.name) {
      try {
        if (!this.appExec.cmd) {
          this.showToast('danger', 'No commands specified');
          return;
        }
        const env = this.appExec.env ? this.appExec.env : '[]';
        const { cmd } = this.appExec;
        this.commandExecuting = true;
        const data = {
          appname: name,
          cmd: splitargs(cmd),
          env: JSON.parse(env),
        };
        const response = await this.executeLocalCommand('/apps/appexec/', data);
        console.log(response);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          this.commandExecuting = false;
          this.callResponse.status = response.status;
          if (!name.includes('_')) {
            this.callResponse.data = response.data;
          } else {
            if (!this.callResponse.data) {
              this.callResponse.data = [];
            } else if (!Array.isArray(this.callResponse.data)) {
              this.callResponse.data = [];
            }
            this.callResponse.data.unshift({
              name,
              data: response.data,
            });
          }
        }
      } catch (error) {
        this.commandExecuting = false;
        console.log(error);
        this.showToast('danger', error.message || error);
      }
    },
    async downloadApplicationLog(appName) {
      const self = this;
      this.downloaded = '';
      this.total = '';
      // this.abortToken = DaemonService.cancelToken();
      const zelidauth = localStorage.getItem('zelidauth');
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        responseType: 'blob',
        onDownloadProgress(progressEvent) {
          self.downloaded = progressEvent.loaded;
          self.total = progressEvent.total;
          if (self.downloaded === self.total) {
            setTimeout(() => {
              self.downloaded = '';
              self.total = '';
            }, 5000);
          }
        },
        // cancelToken: self.abortToken.token,
      };
      try {
        this.downloadingLog = true;
        const response = await this.executeLocalCommand(`/apps/applogpolling/${appName}/all`, null, axiosConfig);
        const text = await response.data.text();
        const responseData = JSON.parse(text);
        let logText = responseData.logs;
        if (!Array.isArray(logText)) {
          throw new Error('Log data is missing or is not in the expected format.');
        }

        if (logText.length === 0) {
          throw new Error('No logs available to download.');
        }

        // eslint-disable-next-line no-control-regex
        const ansiRegex = /\u001b\[[0-9;]*[a-zA-Z]/g;
        logText = logText.map((textlog) => textlog.replace(ansiRegex, ''));
        if (!this.displayTimestamps) {
          const timestampRegex = /^[^\s]+\s*/;
          logText = logText.map((line) => line.replace(timestampRegex, ''));
        }
        const logSplit = logText.join('\n');
        const logBlob = new Blob([logSplit], { type: 'text/plain' });
        const url = window.URL.createObjectURL(logBlob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'app.log');
        document.body.appendChild(link);
        link.click();
        this.downloadingLog = false;
        // Clean up the URL object
        window.URL.revokeObjectURL(url);
      } catch (error) {
        this.downloadingLog = false;
        console.error('Error occurred while handling logs:', error);
        this.showToast('danger', error);
      }
    },
    getAppIdentifier(appName = this.appName) {
      // this id is used for volumes, docker names so we know it reall belongs to flux
      if (appName && appName.startsWith('zel')) {
        return appName;
      }
      if (appName && appName.startsWith('flux')) {
        return appName;
      }
      if (appName === 'KadenaChainWebNode' || appName === 'FoldingAtHomeB') {
        return `zel${appName}`;
      }
      return `flux${appName}`;
    },
    getAppDockerNameIdentifier(appName) {
      // this id is used for volumes, docker names so we know it reall belongs to flux
      const name = this.getAppIdentifier(appName);
      if (name && name.startsWith('/')) {
        return name;
      }
      return `/${name}`;
    },

    async getApplicationInspect() {
      const callData = [];
      this.commandExecutingInspect = true;
      if (this.appSpecification.version >= 4) {
        // compose
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          // eslint-disable-next-line no-await-in-loop
          const response = await this.executeLocalCommand(`/apps/appinspect/${component.name}_${this.appSpecification.name}`);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            const appComponentInspect = {
              name: component.name,
              callData: response.data.data,
            };
            callData.push(appComponentInspect);
          }
        }
      } else {
        const response = await this.executeLocalCommand(`/apps/appinspect/${this.appName}`);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          const appComponentInspect = {
            name: this.appSpecification.name,
            callData: response.data.data,
          };
          callData.push(appComponentInspect);
        }
        console.log(response);
      }
      this.commandExecutingInspect = false;
      this.callResponseInspect.status = 'success';
      this.callResponseInspect.data = callData;
    },
    async stopMonitoring(appName, deleteData = false) {
      this.output = [];
      this.showToast('warning', `Stopping Monitoring of ${appName}`);
      let response;
      if (deleteData) {
        response = await this.executeLocalCommand(`/apps/stopmonitoring/${appName}/true`);
      } else {
        response = await this.executeLocalCommand(`/apps/stopmonitoring/${appName}`);
      }
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      console.log(response);
    },
    async startMonitoring(appName) {
      this.output = [];
      this.showToast('warning', `Starting Monitoring of ${appName}`);
      const response = await this.executeLocalCommand(`/apps/startmonitoring/${appName}`);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      console.log(response);
    },
    async getApplicationChanges() {
      const callData = [];
      this.commandExecutingChanges = true;
      if (this.appSpecification.version >= 4) {
        // compose
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          // eslint-disable-next-line no-await-in-loop
          const response = await this.executeLocalCommand(`/apps/appchanges/${component.name}_${this.appSpecification.name}`);
          if (response.data.status === 'error') {
            this.showToast('danger', response.data.data.message || response.data.data);
          } else {
            const appComponentInspect = {
              name: component.name,
              callData: response.data.data,
            };
            callData.push(appComponentInspect);
          }
        }
      } else {
        const response = await this.executeLocalCommand(`/apps/appchanges/${this.appName}`);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          const appComponentInspect = {
            name: this.appSpecification.name,
            callData: response.data.data,
          };
          callData.push(appComponentInspect);
        }
        console.log(response);
      }
      this.commandExecutingChanges = false;
      this.callResponseChanges.status = 'success';
      this.callResponseChanges.data = callData;
    },
    async getInstancesForDropDown() {
      const response = await AppsService.getAppLocation(this.appName);
      this.selectedIp = null;
      console.log(response);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.masterIP = null;
        this.instances.data = [];
        this.instances.data = response.data.data;
        if (this.masterSlaveApp) {
          const url = `https://${this.appName}.app.runonflux.io/fluxstatistics?scope=${this.appName}apprunonfluxio;json;norefresh`;
          let errorFdm = false;
          let fdmData = await axios.get(url).catch((error) => {
            errorFdm = true;
            console.log(`UImasterSlave: Failed to reach FDM with error: ${error}`);
            this.masterIP = 'Failed to Check';
          });
          if (!errorFdm) {
            fdmData = fdmData.data;
            if (fdmData && fdmData.length > 0) {
              console.log('FDM_Data_Received');
              // eslint-disable-next-line no-restricted-syntax
              for (const fdmServer of fdmData) {
                const serviceName = fdmServer.find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'pxname' && element.value.value.toLowerCase().startsWith(`${this.appName.toLowerCase()}apprunonfluxio`));
                if (serviceName) {
                  console.log('FDM_Data_Service_Found');
                  const ipElement = fdmServer.find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'svname');
                  if (ipElement) {
                    console.log('FDM_Data_IP_Found');
                    this.masterIP = ipElement.value.value.split(':')[0];
                    console.log(this.masterIP);
                    if (!this.selectedIp) {
                      if (ipElement.value.value.split(':')[1] === '16127') {
                        this.selectedIp = ipElement.value.value.split(':')[0];
                      } else {
                        this.selectedIp = ipElement.value.value;
                      }
                    }
                    return;
                  }
                  break;
                }
              }
            }
            if (!this.masterIP) {
              this.masterIP = 'Defining New Primary In Progress';
            }
            if (!this.selectedIp) {
              this.selectedIp = this.instances.data[0]?.ip;
            }
          }
        } else if (!this.selectedIp) {
          this.selectedIp = this.instances.data[0]?.ip;
        }
        console.log(this.ipAccess);
        if (this.ipAccess) {
          const withoutProtocol = this.ipAddress.replace('http://', '');
          const desiredIP = this.config.apiPort === 16127 ? withoutProtocol : `${withoutProtocol}:${this.config.apiPort}`;
          const matchingInstances = this.instances.data.filter((instance) => instance.ip === desiredIP);
          if (matchingInstances.length > 0) {
            this.selectedIp = desiredIP;
          }
        } else {
          const regex = /https:\/\/(\d+-\d+-\d+-\d+)-(\d+)/;
          const match = this.ipAddress.match(regex);
          if (match) {
            const ip = match[1].replace(/-/g, '.');
            const desiredIP = this.config.apiPort === 16127 ? ip : `${ip}:${this.config.apiPort}`;
            const matchingInstances = this.instances.data.filter((instance) => instance.ip === desiredIP);
            if (matchingInstances.length > 0) {
              this.selectedIp = desiredIP;
            }
          }
        }
        this.instances.totalRows = this.instances.data.length;
      }
    },
    async getApplicationLocations() {
      this.isBusy = true;
      const response = await AppsService.getAppLocation(this.appName);
      console.log(response);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        if (this.masterSlaveApp) {
          const url = `https://${this.appName}.app.runonflux.io/fluxstatistics?scope=${this.appName};json;norefresh`;
          let errorFdm = false;
          this.masterIP = null;
          let fdmData = await axios.get(url).catch((error) => {
            errorFdm = true;
            console.log(`UImasterSlave: Failed to reach FDM with error: ${error}`);
            this.masterIP = 'Failed to Check';
          });
          if (!errorFdm) {
            fdmData = fdmData.data;
            if (fdmData && fdmData.length > 0) {
              console.log('FDM_Data_Received');
              // eslint-disable-next-line no-restricted-syntax
              for (const fdmServer of fdmData) {
                const serviceName = fdmServer.find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'pxname' && element.value.value.toLowerCase().startsWith(`${this.appName.toLowerCase()}apprunonfluxio`));
                if (serviceName) {
                  console.log('FDM_Data_Service_Found');
                  const ipElement = fdmServer.find((element) => element.id === 1 && element.objType === 'Server' && element.field.name === 'svname');
                  if (ipElement) {
                    console.log('FDM_Data_IP_Found');
                    this.masterIP = ipElement.value.value?.split(':')[0];
                    console.log(this.masterIP);
                  } else {
                    this.masterIP = 'Defining New Primary In Progress';
                  }
                  break;
                }
              }
            }
            if (!this.masterIP) {
              this.masterIP = 'Defining New Primary In Progress';
            }
          }
        }
        this.instances.data = [];
        this.instances.data = response.data.data;
        const appsLocations = this.instances.data;
        setTimeout(async () => {
          // eslint-disable-next-line no-restricted-syntax
          for (const node of appsLocations) {
            const ip = node.ip?.split(':')[0];
            const port = node.ip?.split(':')[1] || 16127;
            let url = `https://${ip.replace(/\./g, '-')}-${port}.node.api.runonflux.io/flux/geolocation`;
            if (this.ipAccess) {
              url = `http://${ip}:${port}/flux/geolocation`;
            }
            let errorFluxOs = false;
            // eslint-disable-next-line no-await-in-loop
            const fluxGeo = await axios.get(url).catch((error) => {
              errorFluxOs = true;
              console.log(`Error geting geolocation from ${ip}:${port} : ${error}`);
              node.continent = 'N/A';
              node.country = 'N/A';
              node.region = 'N/A';
            });
            if (!errorFluxOs && fluxGeo.data?.status === 'success' && fluxGeo.data.data?.continent) {
              node.continent = fluxGeo.data.data.continent;
              node.country = fluxGeo.data.data.country;
              node.region = fluxGeo.data.data.regionName;
            } else {
              node.continent = 'N/A';
              node.country = 'N/A';
              node.region = 'N/A';
            }
          }
        }, 5);

        this.instances.totalRows = this.instances.data.length;
        this.tableKey += 1;
        this.isBusy = false;
      }
    },
    async getAppOwner() {
      const response = await AppsService.getAppOwner(this.appName);
      console.log(response);
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      this.selectedAppOwner = response.data.data;
    },
    async switchInstance() {
      if (!this.instances?.data?.length) {
        this.applicationManagementAndStatus = [];
        return;
      }
      // const tried = new Set();
      // eslint-disable-next-line no-restricted-syntax
      for (const instance of this.instances.data) {
        // eslint-disable-next-line no-continue
        // if (tried.has(instance.ip)) continue;
        // tried.add(instance.ip);
        // eslint-disable-next-line no-await-in-loop
        await this.getApplicationManagementAndStatus();
        // eslint-disable-next-line no-await-in-loop
        await this.$nextTick();
        if (this.applicationManagementAndStatus?.length > 0) {
          this.selectedIp = instance.ip;
          console.log(`✅ Instance switched to ${this.selectedIp}`);
          this.showToast('success', `Instance switched to ${this.selectedIp}.`);
          return;
        }
      }
      this.applicationManagementAndStatus = [];
    },
    async stopApp(app) {
      this.output = [];
      this.progressVisable = true;
      this.operationTitle = `Stopping ${app}...`;
      const response = await this.executeLocalCommand(`/apps/appstop/${app}`);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      await this.appsGetListAllApps();
      console.log(response);
      this.progressVisable = false;
    },
    async startApp(app) {
      this.output = [];
      this.progressVisable = true;
      this.operationTitle = `Starting ${app}...`;
      setTimeout(async () => {
        const response = await this.executeLocalCommand(`/apps/appstart/${app}`);
        if (response.data.status === 'success') {
          this.showToast('success', response.data.data.message || response.data.data);
        } else {
          this.showToast('danger', response.data.data.message || response.data.data);
        }
        await this.appsGetListAllApps();
        console.log(response);
        this.progressVisable = false;
      }, 3000);
    },
    async restartApp(app) {
      this.output = [];
      this.progressVisable = true;
      this.operationTitle = `Restarting ${app}...`;
      const response = await this.executeLocalCommand(`/apps/apprestart/${app}`);
      if (response.data.status === 'success') {
        this.showToast('success', response.data.data.message || response.data.data);
      } else {
        this.showToast('danger', response.data.data.message || response.data.data);
      }
      await this.appsGetListAllApps();
      console.log(response);
      this.progressVisable = false;
    },
    async pauseApp(app) {
      this.output = [];
      this.progressVisable = true;
      this.operationTitle = `Pausing ${app}...`;
      setTimeout(async () => {
        const response = await this.executeLocalCommand(`/apps/apppause/${app}`);
        if (response.data.status === 'success') {
          this.showToast('success', response.data.data.message || response.data.data);
        } else {
          this.showToast('danger', response.data.data.message || response.data.data);
        }
        await this.appsGetListAllApps();
        console.log(response);
        this.progressVisable = false;
      }, 2000);
    },
    async unpauseApp(app) {
      this.output = [];
      this.progressVisable = true;
      this.operationTitle = `Unpausing ${app}...`;
      setTimeout(async () => {
        const response = await this.executeLocalCommand(`/apps/appunpause/${app}`);
        if (response.data.status === 'success') {
          this.showToast('success', response.data.data.message || response.data.data);
        } else {
          this.showToast('danger', response.data.data.message || response.data.data);
        }
        await this.appsGetListAllApps();
        console.log(response);
        this.progressVisable = false;
      }, 2000);
    },
    redeployAppSoft(app) {
      this.redeployApp(app, false);
    },
    redeployAppHard(app) {
      this.redeployApp(app, true);
    },
    async redeployApp(app, force) {
      const self = this;
      this.output = [];
      this.operationTask = '';
      this.downloadOutput = {};
      this.downloadOutputReturned = false;
      this.progressVisable = true;
      this.operationTitle = `Redeploying ${app}...`;
      const zelidauth = localStorage.getItem('zelidauth');
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.event.target.response);
          self.output = JSON.parse(`[${progressEvent.event.target.response.replace(/}{/g, '},{')}]`);
          const latest = self.output[self.output.length - 1];
          self.operationTask = latest?.data?.message || latest?.data || latest?.status;
        },
      };
      const response = await this.executeLocalCommand(`/apps/redeploy/${app}/${force}`, null, axiosConfig);
      this.progressVisable = false;
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
        if (this.output[this.output.length - 1].status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else if (this.output[this.output.length - 1].status === 'warning') {
          this.showToast('warning', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          this.showToast('success', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        }
      }
    },
    async removeApp(app) {
      const self = this;
      this.output = [];
      this.operationTask = '';
      this.progressVisable = true;
      this.operationTitle = `Removing ${app}...`;
      const zelidauth = localStorage.getItem('zelidauth');
      const axiosConfig = {
        headers: {
          zelidauth,
        },
        onDownloadProgress(progressEvent) {
          console.log(progressEvent.event.target.response);
          self.output = JSON.parse(`[${progressEvent.event.target.response.replace(/}{/g, '},{')}]`);
          const latest = self.output[self.output.length - 1];
          self.operationTask = latest?.data?.message || latest?.data || latest?.status;
        },
      };
      const response = await this.executeLocalCommand(`/apps/appremove/${app}`, null, axiosConfig);
      this.progressVisable = false;
      if (response.data.status === 'error') {
        this.showToast('danger', response.data.data.message || response.data.data);
      } else {
        this.output = JSON.parse(`[${response.data.replace(/}{/g, '},{')}]`);
        if (this.output[this.output.length - 1].status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else if (this.output[this.output.length - 1].status === 'warning') {
          this.showToast('warning', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          this.showToast('success', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
          setTimeout(async () => {
            await this.switchInstance();
          }, 4000);
        }
      }
    },
    async getZelidAuthority() {
      const zelidauth = localStorage.getItem('zelidauth');
      const auth = qs.parse(zelidauth);
      const timestamp = Date.now();
      const maxTime = 1.5 * 60 * 60 * 1000;
      const mesTime = auth?.loginPhrase?.substring(0, 13) || 0;
      const expiryTime = +mesTime + maxTime;
      if (+mesTime > 0 && timestamp < expiryTime) {
        this.globalZelidAuthorized = true;
      } else {
        this.globalZelidAuthorized = false;
        console.log('Session expired, logging out...');
        await this.logout(true);
      }
    },
    async delay(ms) {
      return new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    },
    async executeLocalCommand(command, postObject, axiosConfigAux, skipCache = false) {
      try {
        const zelidauth = localStorage.getItem('zelidauth');
        let axiosConfig = axiosConfigAux;
        if (!axiosConfig) {
          axiosConfig = {
            headers: {
              zelidauth,
              ...(skipCache && { 'x-apicache-bypass': 'true' }),
            },
          };
        }
        this.getZelidAuthority();
        if (!this.globalZelidAuthorized) {
          return null;
        }

        const url = this.selectedIp?.split(':')[0];
        const urlPort = this.selectedIp?.split(':')[1] || 16127;

        if (!url) {
          throw new Error('Instance not found with deployed application.');
        }

        let response = null;
        let queryUrl = `https://${url.replace(/\./g, '-')}-${urlPort}.node.api.runonflux.io${command}`;
        if (this.ipAccess) {
          queryUrl = `http://${url}:${urlPort}${command}`;
        }
        if (postObject) {
          response = await axios.post(queryUrl, postObject, axiosConfig);
        } else {
          response = await axios.get(queryUrl, axiosConfig);
        }
        return response;
      } catch (error) {
        this.showToast('danger', error.message || error);
        return null;
      }
    },
    async executeCommand(app, command, warningText, parameter) {
      try {
        const zelidauth = localStorage.getItem('zelidauth');
        const axiosConfig = {
          headers: {
            zelidauth,
          },
        };
        this.getZelidAuthority();
        if (!this.globalZelidAuthorized) {
          return;
        }

        // get app instances
        this.showToast('warning', warningText);
        let urlPath = `/apps/${command}/${app}`;
        if (parameter) {
          urlPath += `/${parameter}`;
        }
        urlPath += '/true'; // global deploy
        const response = await AppsService.justAPI().get(urlPath, axiosConfig);
        await this.delay(500);
        if (response.data.status === 'success') {
          this.showToast('success', response.data.data.message || response.data.data);
        } else {
          this.showToast('danger', response.data.data.message || response.data.data);
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    async stopAppGlobally(app) {
      this.executeCommand(app, 'appstop', `Stopping ${app} globally. This will take a while...`);
    },
    async startAppGlobally(app) {
      this.executeCommand(app, 'appstart', `Starting ${app} globally. This will take a while...`);
    },
    async restartAppGlobally(app) {
      this.executeCommand(app, 'apprestart', `Restarting ${app} globally. This will take a while...`);
    },
    async pauseAppGlobally(app) {
      this.executeCommand(app, 'apppause', `Pausing ${app} globally. This will take a while...`);
    },
    async unpauseAppGlobally(app) {
      this.executeCommand(app, 'appunpause', `Unpausing ${app} globally. This will take a while...`);
    },
    async redeployAppSoftGlobally(app) {
      this.executeCommand(app, 'redeploy', `Soft redeploying ${app} globally. This will take a while...`, 'false');
      this.noInstanceAvailable = true;
    },
    async redeployAppHardGlobally(app) {
      this.executeCommand(app, 'redeploy', `Hard redeploying ${app} globally. This will take a while...`, 'true');
      this.noInstanceAvailable = true;
    },
    async removeAppGlobally(app) {
      this.executeCommand(app, 'appremove', `Reinstalling ${app} globally. This will take a while...`, 'true');
      this.noInstanceAvailable = true;
    },
    openApp(name, _ip, _port) {
      console.log(name, _ip, _port);
      if ((_port && _ip)) {
        const ip = _ip;
        const port = _port;
        const url = `http://${ip}:${port}`;
        this.openSite(url);
      } else {
        this.showToast('danger', 'Unable to open App :(, App does not have a port.');
      }
    },
    getProperPort(appSpecs = this.appUpdateSpecification) {
      if (appSpecs.port) {
        return appSpecs.port;
      }
      if (appSpecs.ports) {
        const ports = typeof appSpecs.ports === 'string' ? JSON.parse(appSpecs.ports) : appSpecs.ports;
        return ports[0];
      }
      for (let i = 0; i < appSpecs.compose.length; i += 1) {
        for (let j = 0; j < appSpecs.compose[i].ports.length; j += 1) {
          const ports = typeof appSpecs.compose[i].ports === 'string' ? JSON.parse(appSpecs.compose[i].ports) : appSpecs.compose[i].ports;
          if (ports[j]) return ports[j];
        }
      }
      return null;
    },
    openNodeFluxOS(_ip, _port) {
      console.log(_ip, _port);
      if ((_port && _ip)) {
        const ip = _ip;
        const port = _port;
        const url = `http://${ip}:${port}`;
        this.openSite(url);
      } else {
        this.showToast('danger', 'Unable to open App :(');
      }
    },
    openSite(url) {
      const win = window.open(url, '_blank');
      win.focus();
    },

    ensureBoolean(parameter) {
      let param;
      if (parameter === 'false' || parameter === 0 || parameter === '0' || parameter === false) {
        param = false;
      }
      if (parameter === 'true' || parameter === 1 || parameter === '1' || parameter === true) {
        param = true;
      }
      return param;
    },
    ensureNumber(parameter) {
      return typeof parameter === 'number' ? parameter : Number(parameter);
    },
    ensureObject(parameter) {
      if (typeof parameter === 'object') {
        return parameter;
      }
      let param;
      try {
        param = JSON.parse(parameter);
      } catch (e) {
        param = qs.parse(parameter);
      }
      return param;
    },
    ensureString(parameter) {
      return typeof parameter === 'string' ? parameter : JSON.stringify(parameter);
    },

    stringOutput() {
      let string = '';
      this.output.forEach((output) => {
        console.log(output);
        if (output.status === 'success') {
          string += `${output.data.message || output.data}\r\n`;
        } else if (output.status === 'Downloading') {
          this.downloadOutputReturned = true;
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: output.progressDetail,
            variant: 'danger',
          });
        } else if (output.status === 'Verifying Checksum') {
          this.downloadOutputReturned = true;
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: { current: 1, total: 1 },
            variant: 'warning',
          });
        } else if (output.status === 'Download complete') {
          this.downloadOutputReturned = true;
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: { current: 1, total: 1 },
            variant: 'info',
          });
        } else if (output.status === 'Extracting') {
          this.downloadOutputReturned = true;
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: output.progressDetail,
            variant: 'primary',
          });
        } else if (output.status === 'Pull complete') {
          this.downloadOutput[output.id] = ({
            id: output.id,
            detail: { current: 1, total: 1 },
            variant: 'success',
          });
        } else if (output.status === 'error') {
          string += `Error: ${JSON.stringify(output.data)}\r\n`;
        } else {
          string += `${output.status}\r\n`;
        }
      });
      return string;
    },

    showToast(variant, title, icon = 'InfoIcon') {
      this.$toast({
        component: ToastificationContent,
        props: {
          title,
          icon,
          variant,
        },
      });
    },

    decodeAsciiResponse(data) {
      if (typeof data === 'string') {
        return data.replace(/[^\x20-\x7E\t\r\n\v\f]/g, '');
      }
      return '';
    },
    getContinent(item) {
      const objItem = this.ensureObject(item);
      const appContinent = objItem.find((x) => x.startsWith('a'));
      if (appContinent) {
        const appContinentAux = this.continentsOptions.find((x) => x.value === appContinent.slice(1));
        if (appContinentAux) {
          return appContinentAux.text;
        }
        return 'All';
      }
      return 'All';
    },
    getCountry(item) {
      const objItem = this.ensureObject(item);
      const appCountry = objItem.find((x) => x.startsWith('b'));
      if (appCountry) {
        const appCountryAux = this.countriesOptions.find((x) => x.value === appCountry.slice(1));
        if (appCountryAux) {
          return appCountryAux.text;
        }
        return 'All';
      }
      return 'All';
    },
    continentChanged() {
      this.selectedCountry = null;
      if (this.selectedContinent) {
        const continent = this.continentsOptions.find((x) => x.value === this.selectedContinent);
        this.maxInstances = continent.maxInstances;
        if (this.appUpdateSpecification.instances > this.maxInstances) {
          this.appUpdateSpecification.instances = this.maxInstances;
        }
        this.showToast('warning', `The node type may fluctuate based upon system requirements for your application. For better results in ${continent.text}, please consider specifications more suited to ${continent.nodeTier} hardware.`);
      } else {
        this.maxInstances = this.appUpdateSpecificationv5template.maxInstances;
        this.showToast('info', 'No geolocation set you can define up to maximum of 100 instances and up to the maximum hardware specs available on Flux network to your app.');
      }
      if (this.instancesLocked) {
        this.maxInstances = this.appUpdateSpecification.instances;
      }
    },
    countryChanged() {
      if (this.selectedCountry) {
        const country = this.countriesOptions.find((x) => x.value === this.selectedCountry);
        this.maxInstances = country.maxInstances;
        if (this.appUpdateSpecification.instances > this.maxInstances) {
          this.appUpdateSpecification.instances = this.maxInstances;
        }
        this.showToast('warning', `The node type may fluctuate based upon system requirements for your application. For better results in ${country.text}, please consider specifications more suited to ${country.nodeTier} hardware.`);
      } else {
        const continent = this.continentsOptions.find((x) => x.value === this.selectedContinent);
        this.maxInstances = continent.maxInstances;
        if (this.appUpdateSpecification.instances > this.maxInstances) {
          this.appUpdateSpecification.instances = this.maxInstances;
        }
        this.showToast('warning', `The node type may fluctuate based upon system requirements for your application. For better results in ${continent.text}, please consider specifications more suited to ${continent.nodeTier} hardware.`);
      }
      if (this.instancesLocked) {
        this.maxInstances = this.appUpdateSpecification.instances;
      }
    },
    getTimestamps(statsData) {
      const timestamps = [];
      statsData.forEach((data) => {
        timestamps.push(data.timestamp);
      });
      return timestamps;
    },
    chartOptions(timestamps) {
      const chartOptions = {
        chart: {
          height: 350,
          type: 'area',
        },
        dataLabels: {
          enabled: false,
        },
        stroke: {
          curve: 'smooth',
        },
        xaxis: {
          type: 'timestamp',
          categories: timestamps,
        },
        tooltip: {
          x: {
            format: 'dd/MM/yy HH:mm',
          },
        },
      };
      return chartOptions;
    },
    decodeGeolocation(existingGeolocation) {
      // decode geolocation and push it properly numberOfGeolocations, numberOfNegativeGeolocations
      // selectedContinent1, selectedCountry1, selectedRegion1
      // existingGeolocation is an array that can contain older specs of a, b OR can contain new specs of ac (a!c);
      let isOldSpecs = false;
      existingGeolocation.forEach((location) => {
        if (location.startsWith('b')) {
          isOldSpecs = true;
        }
        if (location.startsWith('a') && location.startsWith('ac') && location.startsWith('a!c')) {
          isOldSpecs = true;
        }
      });
      let updatedNewSpecGeo = existingGeolocation;
      if (isOldSpecs) {
        const continentEncoded = existingGeolocation.find((location) => location.startsWith('a') && location.startsWith('ac') && location.startsWith('a!c'));
        const countryEncoded = existingGeolocation.find((location) => location.startsWith('b'));
        let newSpecLocation = `ac${continentEncoded.slice(1)}`;
        if (countryEncoded) {
          newSpecLocation += `_${countryEncoded.slice(1)}`;
        }
        updatedNewSpecGeo = [newSpecLocation];
      }
      // updatedNewSpecGeo is now geolocation according to new specs
      const allowedLocations = updatedNewSpecGeo.filter((locations) => locations.startsWith('ac'));
      const forbiddenLocations = updatedNewSpecGeo.filter((locations) => locations.startsWith('a!c'));
      for (let i = 1; i < allowedLocations.length + 1; i += 1) {
        this.numberOfGeolocations = i;
        const specifiedLocation = allowedLocations[i - 1].slice(2);
        const locations = specifiedLocation.split('_');
        const continentCode = locations[0];
        const countryCode = locations[1];
        const regionName = locations[2];
        this.allowedGeolocations[`selectedContinent${i}`] = continentCode;
        this.allowedGeolocations[`selectedCountry${i}`] = countryCode || 'ALL';
        this.allowedGeolocations[`selectedRegion${i}`] = regionName || 'ALL';
      }
      for (let i = 1; i < forbiddenLocations.length + 1; i += 1) {
        this.numberOfNegativeGeolocations = i;
        const specifiedLocation = forbiddenLocations[i - 1].slice(3);
        const locations = specifiedLocation.split('_');
        const continentCode = locations[0];
        const countryCode = locations[1];
        const regionName = locations[2];
        this.forbiddenGeolocations[`selectedContinent${i}`] = continentCode;
        this.forbiddenGeolocations[`selectedCountry${i}`] = countryCode || 'NONE';
        this.forbiddenGeolocations[`selectedRegion${i}`] = regionName || 'NONE';
      }
    },
    async getGeolocationData() {
      let possibleLocations = [];
      try {
        // go through our geolocations that are stored as available and construct, no restrictions on instances
        geolocations.continents.forEach((continent) => {
          possibleLocations.push({
            value: continent.code,
            instances: continent.available ? 100 : 0,
          });
        });
        geolocations.countries.forEach((country) => {
          possibleLocations.push({
            value: `${country.continent}_${country.code}`,
            instances: country.available ? 100 : 0,
          });
        });

        // fetch locations from stats
        const response = await axios.get('https://stats.runonflux.io/fluxinfo?projection=geo');
        if (response.data.status === 'success') {
          const geoData = response.data.data;
          if (geoData.length > 5000) { // all went well
            possibleLocations = [];
            geoData.forEach((flux) => {
              if (flux.geolocation && flux.geolocation.continentCode && flux.geolocation.regionName && flux.geolocation.countryCode) {
                const continentLocation = flux.geolocation.continentCode;
                const countryLocation = `${continentLocation}_${flux.geolocation.countryCode}`;
                const regionLocation = `${countryLocation}_${flux.geolocation.regionName}`;
                const continentLocationExists = possibleLocations.find((location) => location.value === continentLocation);
                if (continentLocationExists) {
                  continentLocationExists.instances += 1;
                } else {
                  possibleLocations.push({
                    value: continentLocation,
                    instances: 1,
                  });
                }
                const countryLocationExists = possibleLocations.find((location) => location.value === countryLocation);
                if (countryLocationExists) {
                  countryLocationExists.instances += 1;
                } else {
                  possibleLocations.push({
                    value: countryLocation,
                    instances: 1,
                  });
                }
                const regionLocationExists = possibleLocations.find((location) => location.value === regionLocation);
                if (regionLocationExists) {
                  regionLocationExists.instances += 1;
                } else {
                  possibleLocations.push({
                    value: regionLocation,
                    instances: 1,
                  });
                }
              }
            });
          }
        } else {
          this.showToast('info', 'Failed to get geolocation data from FluxStats, Using stored locations');
        }
      } catch (error) {
        console.log(error);
        this.showToast('info', 'Failed to get geolocation data from FluxStats, Using stored locations');
      }
      this.possibleLocations = possibleLocations;
    },
    continentsOptions(isNegative) {
      const continents = [{ value: isNegative ? 'NONE' : 'ALL', text: isNegative ? 'NONE' : 'ALL' }];
      this.possibleLocations.filter((options) => options.instances > (isNegative ? -1 : 3)).forEach((location) => {
        if (!location.value.includes('_')) {
          const existingContinent = geolocations.continents.find((continent) => continent.code === location.value);
          continents.push({ value: location.value, text: existingContinent ? existingContinent.name : location.value });
        }
      });
      return continents;
    },
    countriesOptions(continentCode, isNegative) {
      const countries = [{ value: isNegative ? 'ALL' : 'ALL', text: isNegative ? 'ALL' : 'ALL' }];
      this.possibleLocations.filter((options) => options.instances > (isNegative ? -1 : 3)).forEach((location) => {
        if (!location.value.split('_')[2] && location.value.startsWith(`${continentCode}_`)) {
          const existingCountry = geolocations.countries.find((country) => country.code === location.value.split('_')[1]);
          countries.push({ value: location.value.split('_')[1], text: existingCountry ? existingCountry.name : location.value.split('_')[1] });
        }
      });
      return countries;
    },
    regionsOptions(continentCode, countryCode, isNegative) {
      const regions = [{ value: isNegative ? 'ALL' : 'ALL', text: isNegative ? 'ALL' : 'ALL' }];
      this.possibleLocations.filter((options) => options.instances > (isNegative ? -1 : 3)).forEach((location) => {
        if (location.value.startsWith(`${continentCode}_${countryCode}_`)) {
          regions.push({ value: location.value.split('_')[2], text: location.value.split('_')[2] });
        }
      });
      return regions;
    },
    generateGeolocations() {
      const geo = [];
      for (let i = 1; i < this.numberOfGeolocations + 1; i += 1) {
        const continent = this.allowedGeolocations[`selectedContinent${i}`];
        const country = this.allowedGeolocations[`selectedCountry${i}`];
        const region = this.allowedGeolocations[`selectedRegion${i}`];
        if (continent && continent !== 'ALL') {
          let geolocation = `ac${continent}`;
          if (country && country !== 'ALL') {
            geolocation += `_${country}`;
            if (region && region !== 'ALL') {
              geolocation += `_${region}`;
            }
          }
          geo.push(geolocation);
        }
      }
      for (let i = 1; i < this.numberOfNegativeGeolocations + 1; i += 1) {
        const continent = this.forbiddenGeolocations[`selectedContinent${i}`];
        const country = this.forbiddenGeolocations[`selectedCountry${i}`];
        const region = this.forbiddenGeolocations[`selectedRegion${i}`];
        if (continent && continent !== 'NONE') {
          let geolocation = `a!c${continent}`;
          if (country && country !== 'ALL') {
            geolocation += `_${country}`;
            if (region && region !== 'ALL') {
              geolocation += `_${region}`;
            }
          }
          geo.push(geolocation);
        }
      }
      return geo;
    },
    getGeolocation(geo) {
      if (geo.startsWith('a') && !geo.startsWith('ac') && !geo.startsWith('a!c')) {
        // specific continent
        const continentCode = geo.slice(1);
        const continentExists = geolocations.continents.find((continent) => continent.code === continentCode) || { name: 'ALL' };
        return `Continent: ${continentExists.name || 'Unkown'}`;
      } if (geo.startsWith('b')) {
        // specific country
        const countryCode = geo.slice(1);
        const countryExists = geolocations.countries.find((country) => country.code === countryCode) || { name: 'ALL' };
        return `Country: ${countryExists.name || 'Unkown'}`;
      } if (geo.startsWith('ac')) {
        // allowed location
        const specifiedLocation = geo.slice(2);
        const locations = specifiedLocation.split('_');
        const continentCode = locations[0];
        const countryCode = locations[1];
        const regionName = locations[2];
        const continentExists = geolocations.continents.find((continent) => continent.code === continentCode) || { name: 'ALL' };
        const countryExists = geolocations.countries.find((country) => country.code === countryCode) || { name: 'ALL' };
        let locationString = `Allowed: Continent: ${continentExists.name}`;
        if (countryCode) {
          locationString += `, Country: ${countryExists.name}`;
        }
        if (regionName) {
          locationString += `, Region: ${regionName}`;
        }
        return locationString;
      } if (geo.startsWith('a!c')) {
        // forbidden location
        const specifiedLocation = geo.slice(3);
        const locations = specifiedLocation.split('_');
        const continentCode = locations[0];
        const countryCode = locations[1];
        const regionName = locations[2];
        const continentExists = geolocations.continents.find((continent) => continent.code === continentCode) || { name: 'ALL' };
        const countryExists = geolocations.countries.find((country) => country.code === countryCode) || { name: 'ALL' };
        let locationString = `Forbidden: Continent: ${continentExists.name}`;
        if (countryCode) {
          locationString += `, Country: ${countryExists.name}`;
        }
        if (regionName) {
          locationString += `, Region: ${regionName}`;
        }
        return locationString;
      }
      return 'Worldwide';
    },
    adjustMaxInstancesPossible() {
      const currentGeolocations = this.generateGeolocations();
      const positiveLocations = currentGeolocations.filter((location) => location.startsWith('ac'));
      console.log(currentGeolocations);
      let instances = 0;
      positiveLocations.forEach((location) => {
        const locFound = this.possibleLocations.find((l) => l.value === location.slice(2));
        if (locFound) {
          instances += locFound.instances;
        }
        if (location === 'ALL') {
          instances += 100;
        }
      });
      if (!positiveLocations.length) {
        instances += 100;
      }
      console.log(instances);
      instances = instances > 3 ? instances : 3;
      const maxInstances = instances > 100 ? 100 : instances;
      this.maxInstances = maxInstances;
      if (this.instancesLocked) {
        this.maxInstances = this.appUpdateSpecification.instances;
      }
    },
    constructAutomaticDomains(appPorts, appName, index = 0) {
      const ports = JSON.parse(JSON.stringify(appPorts));
      const lowerCaseName = appName.toLowerCase();
      if (index === 0) {
        const domains = [`${lowerCaseName}.app.runonflux.io`];
        // flux specs dont allow more than 10 ports so domainString is enough
        for (let i = 0; i < ports.length; i += 1) {
          const portDomain = `${lowerCaseName}_${ports[i]}.app.runonflux.io`;
          domains.push(portDomain);
        }
        return domains;
      }
      const domains = [];
      // flux specs dont allow more than 10 ports so domainString is enough
      for (let i = 0; i < ports.length; i += 1) {
        const portDomain = `${lowerCaseName}_${ports[i]}.app.runonflux.io`;
        domains.push(portDomain);
      }
      return domains;
    },
    async uploadEnvToFluxStorage(componentIndex) {
      try {
        const envid = Math.floor((Math.random() * 999999999999999)).toString();
        if (this.appUpdateSpecification.compose[componentIndex].environmentParameters.toString().includes('F_S_ENV=')) {
          this.showToast('warning', 'Environment parameters are already in Flux Storage');
          return;
        }
        const data = {
          envid,
          env: JSON.parse(this.appUpdateSpecification.compose[componentIndex].environmentParameters),
        };
        const resp = await axios.post('https://storage.runonflux.io/v1/env', data);
        if (resp.data.status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          this.showToast('success', 'Successful upload of Environment to Flux Storage');
          this.appUpdateSpecification.compose[componentIndex].environmentParameters = `["F_S_ENV=https://storage.runonflux.io/v1/env/${envid}"]`;
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    async uploadCmdToFluxStorage(componentIndex) {
      try {
        const cmdid = Math.floor((Math.random() * 999999999999999)).toString();
        if (this.appUpdateSpecification.compose[componentIndex].commands.toString().includes('F_S_CMD=')) {
          this.showToast('warning', 'Commands are already in Flux Storage');
          return;
        }
        const data = {
          cmdid,
          cmd: JSON.parse(this.appUpdateSpecification.compose[componentIndex].commands),
        };
        const resp = await axios.post('https://storage.runonflux.io/v1/cmd', data);
        if (resp.data.status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          this.showToast('success', 'Successful upload of Commands to Flux Storage');
          this.appUpdateSpecification.compose[componentIndex].commands = `["F_S_CMD=https://storage.runonflux.io/v1/cmd/${cmdid}"]`;
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    async uploadContactsToFluxStorage() {
      try {
        const contactsid = Math.floor((Math.random() * 999999999999999)).toString();
        if (this.appUpdateSpecification.contacts.toString().includes('F_S_CONTACTS=')) {
          this.showToast('warning', 'Contacts are already in Flux Storage');
          return;
        }
        const data = {
          contactsid,
          contacts: JSON.parse(this.appUpdateSpecification.contacts),
        };
        const resp = await axios.post('https://storage.runonflux.io/v1/contacts', data);
        if (resp.data.status === 'error') {
          this.showToast('danger', this.output[this.output.length - 1].data.message || this.output[this.output.length - 1].data);
        } else {
          this.showToast('success', 'Successful upload of Contacts to Flux Storage');
          this.appUpdateSpecification.contacts = `["F_S_CONTACTS=https://storage.runonflux.io/v1/contacts/${contactsid}"]`;
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    removeFluxNode(ip) {
      const nodeExists = this.selectedEnterpriseNodes.findIndex((node) => node.ip === ip);
      if (nodeExists > -1) {
        this.selectedEnterpriseNodes.splice(nodeExists, 1);
      }
    },
    async addFluxNode(ip) {
      try {
        const nodeExists = this.selectedEnterpriseNodes.find((node) => node.ip === ip);
        console.log(ip);
        if (!nodeExists) {
          const nodeToAdd = this.enterpriseNodes.find((node) => node.ip === ip);
          this.selectedEnterpriseNodes.push(nodeToAdd);
          console.log(this.selectedEnterpriseNodes);
          // fetch pgp key
          const keyExists = this.enterprisePublicKeys.find((key) => key.nodeip === ip);
          if (!keyExists) {
            const pgpKey = await this.fetchEnterpriseKey(ip);
            if (pgpKey) {
              const pair = {
                nodeip: ip,
                nodekey: pgpKey,
              };
              const keyExistsB = this.enterprisePublicKeys.find((key) => key.nodeip === ip);
              if (!keyExistsB) {
                this.enterprisePublicKeys.push(pair);
              }
            }
          }
        }
      } catch (error) {
        console.log(error);
      }
    },
    async autoSelectNodes() {
      const { instances } = this.appUpdateSpecification;
      const maxSamePubKeyNodes = +instances + 3;
      const maxNumberOfNodes = +instances + Math.ceil(Math.max(7, +instances * 0.15));
      const notSelectedEnterpriseNodes = this.enterpriseNodes.filter((node) => !this.selectedEnterpriseNodes.includes(node));
      const nodesToSelect = [];
      const kycNodes = notSelectedEnterpriseNodes.filter((x) => x.enterprisePoints > 0 && x.score > 1000); // allows to install multiple apps 3 to 4 only in kyc nodes
      for (let i = 0; i < kycNodes.length; i += 1) {
        // todo here check if max same pub key is satisfied
        const alreadySelectedPubKeyOccurances = this.selectedEnterpriseNodes.filter((node) => node.pubkey === kycNodes[i].pubkey).length;
        const toSelectPubKeyOccurances = nodesToSelect.filter((node) => node.pubkey === kycNodes[i].pubkey).length;
        if (alreadySelectedPubKeyOccurances + toSelectPubKeyOccurances < maxSamePubKeyNodes) {
          nodesToSelect.push(kycNodes[i]);
        }
        if (nodesToSelect.length + this.selectedEnterpriseNodes.length >= maxNumberOfNodes) {
          break;
        }
      }
      if (nodesToSelect.length < maxNumberOfNodes) {
        throw new Error('Not enough kyc nodes available to run your enterprise app.');
      }
      nodesToSelect.forEach(async (node) => {
        const nodeExists = this.selectedEnterpriseNodes.find((existingNode) => existingNode.ip === node.ip);
        if (!nodeExists) {
          this.selectedEnterpriseNodes.push(node);
          // fetch pgp key
          const keyExists = this.enterprisePublicKeys.find((key) => key.nodeip === node.ip);
          if (!keyExists) {
            const pgpKey = await this.fetchEnterpriseKey(node.ip);
            if (pgpKey) {
              const pair = {
                nodeip: node.ip,
                nodekey: pgpKey,
              };
              const keyExistsB = this.enterprisePublicKeys.find((key) => key.nodeip === node.ip);
              if (!keyExistsB) {
                this.enterprisePublicKeys.push(pair);
              }
            }
          }
        }
      });
    },
    constructNodes() {
      this.appUpdateSpecification.nodes = [];
      this.selectedEnterpriseNodes.forEach((node) => {
        this.appUpdateSpecification.nodes.push(node.ip);
      });
      if (this.appUpdateSpecification.nodes.length > this.maximumEnterpriseNodes) {
        throw new Error('Maximum of 120 Enterprise Nodes allowed');
      }
    },
    async getEnterpriseNodes() {
      const enterpriseList = sessionStorage.getItem('flux_enterprise_nodes');
      if (enterpriseList) {
        this.enterpriseNodes = JSON.parse(enterpriseList);
        this.entNodesSelectTable.totalRows = this.enterpriseNodes.length;
      }
      try {
        const entList = await AppsService.getEnterpriseNodes();
        if (entList.data.status === 'error') {
          this.showToast('danger', entList.data.data.message || entList.data.data);
        } else {
          this.enterpriseNodes = entList.data.data;
          this.entNodesSelectTable.totalRows = this.enterpriseNodes.length;
          sessionStorage.setItem('flux_enterprise_nodes', JSON.stringify(this.enterpriseNodes));
        }
      } catch (error) {
        console.log(error);
      }
    },
    async getDaemonBlockCount() {
      const response = await DaemonService.getBlockCount();
      if (response.data.status === 'success') {
        this.daemonBlockCount = response.data.data;
        this.adjustExpireOptionsForBlockHeight();
      }
    },
    adjustExpireOptionsForBlockHeight() {
      // After fork block, the chain works 4x faster, so expire periods need to be multiplied by 4
      if (this.daemonBlockCount >= FORK_BLOCK_HEIGHT) {
        this.minExpire = 20000;
        this.maxExpire = 1056000;
        this.expireOptions = [
          {
            value: 20000,
            label: '1 week',
            time: 7 * 24 * 60 * 60 * 1000,
          },
          {
            value: 44000,
            label: '2 weeks',
            time: 14 * 24 * 60 * 60 * 1000,
          },
          {
            value: 88000,
            label: '1 month',
            time: 30 * 24 * 60 * 60 * 1000,
          },
          {
            value: 264000,
            label: '3 months',
            time: 90 * 24 * 60 * 60 * 1000,
          },
          {
            value: 528000,
            label: '6 months',
            time: 180 * 24 * 60 * 60 * 1000,
          },
          {
            value: 1056000,
            label: '1 year',
            time: 365 * 24 * 60 * 60 * 1000,
          },
        ];
      } else {
        // Reset to original values if block height is below threshold
        this.minExpire = 5000;
        this.maxExpire = 264000;
        this.expireOptions = [
          {
            value: 5000,
            label: '1 week',
            time: 7 * 24 * 60 * 60 * 1000,
          },
          {
            value: 11000,
            label: '2 weeks',
            time: 14 * 24 * 60 * 60 * 1000,
          },
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
      }
    },
    async fetchEnterpriseKey(nodeip) { // we must have at least +5 nodes or up to 10% of spare keys
      try {
        const node = nodeip.split(':')[0];
        const port = Number(nodeip.split(':')[1] || 16127);
        // const agent = new https.Agent({
        //   rejectUnauthorized: false,
        // });
        let queryUrl = `https://${node.replace(/\./g, '-')}-${port}.node.api.runonflux.io/flux/pgp`;
        if (this.ipAccess) {
          queryUrl = `http://${node}:${port}/flux/pgp`;
        }
        const response = await axios.get(queryUrl); // ip with port
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          const pgpKey = response.data.data;
          return pgpKey;
        }
        return null;
      } catch (error) {
        console.log(error);
        return null;
      }
    },
    /**
     * To encrypt a message with an array of encryption public keys
     * @param {string} message Message to encrypt
     * @param {array} encryptionKeys Armored version of array of public key
     * @returns {string} Return armored version of encrypted message
     */
    async encryptMessage(message, encryptionKeys) {
      try {
        const openpgp = await getOpenPGP();
        const publicKeys = await Promise.all(encryptionKeys.map((armoredKey) => openpgp.readKey({ armoredKey })));
        console.log(encryptionKeys);
        console.log(message);
        const pgpMessage = await openpgp.createMessage({ text: message });
        const encryptedMessage = await openpgp.encrypt({
          message: pgpMessage, // input as Message object
          encryptionKeys: publicKeys,
        });
        // '-----BEGIN PGP MESSAGE ... END PGP MESSAGE-----'
        return encryptedMessage;
      } catch (error) {
        this.showToast('danger', 'Data encryption failed');
        return null;
      }
    },
    async onSessionConnect(session) {
      console.log(session);
      const result = await this.signClient.request({
        topic: session.topic,
        chainId: 'eip155:1',
        request: {
          method: 'personal_sign',
          params: [
            this.dataToSign,
            session.namespaces.eip155.accounts[0].split(':')[2],
          ],
        },
      });
      console.log(result);
      this.signature = result;
    },
    async initWalletConnect() {
      try {
        const signClient = await SignClient.init(walletConnectOptions);
        this.signClient = signClient;
        const lastKeyIndex = signClient.session.getAll().length - 1;
        const lastSession = signClient.session.getAll()[lastKeyIndex];
        if (lastSession) {
          this.onSessionConnect(lastSession);
        } else {
          throw new Error('WalletConnect session expired. Please log into FluxOS again');
        }
      } catch (error) {
        console.error(error);
        this.showToast('danger', error.message);
      }
    },
    async siwe(siweMessage, from) {
      try {
        const msg = `0x${Buffer.from(siweMessage, 'utf8').toString('hex')}`;
        const sign = await ethereum.request({
          method: 'personal_sign',
          params: [msg, from],
        });
        console.log(sign); // this is signature
        this.signature = sign;
      } catch (error) {
        console.error(error); // rejection occured
        this.showToast('danger', error.message);
      }
    },
    async initMetamask() {
      try {
        if (!ethereum) {
          this.showToast('danger', 'Metamask not detected');
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
        this.siwe(this.dataToSign, account);
      } catch (error) {
        this.showToast('danger', error.message);
      }
    },
    async initSSP() {
      try {
        if (!window.ssp) {
          this.showToast('danger', 'SSP Wallet not installed');
          return;
        }
        const responseData = await window.ssp.request('sspwid_sign_message', { message: this.dataToSign });
        if (responseData.status === 'ERROR') {
          throw new Error(responseData.data || responseData.result);
        }
        this.signature = responseData.signature;
      } catch (error) {
        this.showToast('danger', error.message);
      }
    },
    async initSSPpay() {
      try {
        if (!window.ssp) {
          this.showToast('danger', 'SSP Wallet not installed');
          return;
        }
        const data = {
          message: this.updateHash,
          amount: (+this.appPricePerSpecs || 0).toString(),
          address: this.deploymentAddress,
          chain: 'flux',
        };
        const responseData = await window.ssp.request('pay', data);
        if (responseData.status === 'ERROR') {
          throw new Error(responseData.data || responseData.result);
        } else {
          this.showToast('success', `${responseData.data}: ${responseData.txid}`);
        }
      } catch (error) {
        this.showToast('danger', error.message);
      }
    },
    async initStripePay(hash, name, price, description) {
      try {
        this.fiatCheckoutURL = '';
        this.checkoutLoading = true;
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
              marketplace: this.isMarketplaceApp,
              registration: false,
            },
          },
        };
        const checkoutURL = await axios.post(`${paymentBridge}/api/v1/stripe/checkout/create`, data);
        if (checkoutURL.data.status === 'error') {
          this.showToast('error', 'Failed to create stripe checkout');
          this.checkoutLoading = false;
          return;
        }
        this.fiatCheckoutURL = checkoutURL.data.data;
        this.checkoutLoading = false;
        try {
          this.openSite(checkoutURL.data.data);
        } catch (error) {
          console.log(error);
          this.showToast('error', 'Failed to open Stripe checkout, pop-up blocked?');
        }
      } catch (error) {
        console.log(error);
        this.showToast('error', 'Failed to create stripe checkout');
        this.checkoutLoading = false;
      }
    },
    async initPaypalPay(hash, name, price, description) {
      try {
        this.fiatCheckoutURL = '';
        this.checkoutLoading = true;
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
              marketplace: this.isMarketplaceApp,
              registration: false,
            },
          },
        };
        const checkoutURL = await axios.post(`${paymentBridge}/api/v1/paypal/checkout/create`, data);
        if (checkoutURL.data.status === 'error') {
          this.showToast('error', 'Failed to create PayPal checkout');
          this.checkoutLoading = false;
          return;
        }
        this.fiatCheckoutURL = checkoutURL.data.data;
        this.checkoutLoading = false;
        try {
          this.openSite(checkoutURL.data.data);
        } catch (error) {
          console.log(error);
          this.showToast('error', 'Failed to open Paypal checkout, pop-up blocked?');
        }
      } catch (error) {
        console.log(error);
        this.showToast('error', 'Failed to create PayPal checkout');
        this.checkoutLoading = false;
      }
    },
    getAlertClass(state, status) {
      if (!state) return 'alert-primary';
      const normalizedState = state.toLowerCase();
      if (normalizedState === 'running') {
        if (status && status.toLowerCase().includes('unhealthy')) {
          return 'alert-warning';
        }
        return 'alert-success';
      // eslint-disable-next-line no-else-return
      } else if (normalizedState === 'restarting') {
        return 'alert-warning';
      } else if (normalizedState === 'exited') {
        return 'alert-danger';
      } else {
        return 'alert-primary';
      }
    },
    getIconVariant(state, status) {
      if (!state) return 'primary';
      const normalized = state.toLowerCase();
      if (normalized === 'running') {
        if (status && status.toLowerCase().includes('unhealthy')) {
          return 'warning';
        }
        return 'success';
      // eslint-disable-next-line no-else-return
      } else if (normalized === 'restarting') {
        return 'warning';
      } else if (normalized === 'exited') {
        return 'danger';
      } else {
        return 'primary';
      }
    },
    getComponentInfo(appName) {
      const apps = this.getAllAppsResponse?.data;
      if (!Array.isArray(apps)) return false;
      const foundComponent = apps.find((app) => app.Names?.[0] === this.getAppDockerNameIdentifier(appName));
      if (!foundComponent) return false;

      return {
        name: appName.substring(0, appName.lastIndexOf('_')) || appName,
        state: foundComponent.State ?? 'N/A',
        status: foundComponent.Status?.toLowerCase() ?? 'N/A',
        image: foundComponent.Image ?? 'N/A',
      };
    },
    async getApplicationManagementAndStatus(skip = false) {
      if (!this.globalZelidAuthorized || !this.selectedIp) {
        return;
      }
      if (skip === false) {
        await this.appsGetListAllApps();
      }
      if (!this.appSpecification?.name) {
        await this.getInstalledApplicationSpecifics(true);
        if (!this.appSpecification?.name) {
          this.applicationManagementAndStatus = [];
          await this.$nextTick();
          return;
        }
        await this.$nextTick();
      }
      const appInfoArray = [];
      if (this.appSpecification && this.appSpecification.version >= 4) {
        // eslint-disable-next-line no-restricted-syntax
        for (const component of this.appSpecification.compose) {
          const infoObject = this.getComponentInfo(`${component.name}_${this.appSpecification.name}`);
          if (infoObject) appInfoArray.push(infoObject);
        }
      } else {
        const infoObject = this.getComponentInfo(this.appSpecification.name);
        if (infoObject) appInfoArray.push(infoObject);
      }

      this.applicationManagementAndStatus = appInfoArray;
    },
    async selectedIpChanged() {
      this.disconnectTerminal();
      await this.getInstalledApplicationSpecifics(true);
      this.updateManagementTab(this.$refs.managementTabs.currentTab);
    },
    cleanData() {
      this.dataToSign = '';
      this.timestamp = '';
      this.signature = '';
      this.updateHash = '';
      this.output = [];
    },
  },
};
