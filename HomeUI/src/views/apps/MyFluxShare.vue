<template>
  <div>
    <div class="mb-2">
      <h6 class="progress-label">
        {{ storage.used.toFixed(2) + ' / ' + storage.total.toFixed(2) }} GB
      </h6>
      <b-progress
        :value="percentage"
        max="100"
        striped
        height="2rem"
      />
    </div>
    <b-button-toolbar justify>
      <b-button-group size="sm" />
      <b-button-group size="sm">
        <b-button
          variant="outline-primary"
          @click="uploadFilesDialog = true"
        >
          <v-icon name="cloud-upload-alt" />
        </b-button>
        <b-button
          variant="outline-primary"
          @click="createDirectoryDialogVisible = true"
        >
          <v-icon name="folder-plus" />
        </b-button>
        <b-modal
          v-model="createDirectoryDialogVisible"
          title="Create Folder"
          size="lg"
          centered
          ok-only
          ok-title="Create Folder"
          @ok="createFolder(newDirName)"
        >
          <b-form-group
            label="Folder Name"
            label-for="folderNameInput"
          >
            <b-form-input
              id="folderNameInput"
              v-model="newDirName"
              size="lg"
              placeholder="New Folder Name"
            />
          </b-form-group>
        </b-modal>
        <b-modal
          v-model="uploadFilesDialog"
          title="Upload Files"
          size="lg"
          centered
          hide-footer
          @close="refreshFolder()"
        >
          <file-upload
            :upload-folder="getUploadFolder"
            :headers="zelidHeader"
            @complete="refreshFolder"
          />
        </b-modal>
      </b-button-group>
    </b-button-toolbar>
    <b-table
      class="fluxshare-table"
      hover
      responsive
      :items="folderContentFilter"
      :fields="fields"
      :busy="loadingFolder"
      :sort-compare="sort"
      sort-by="name"
    >
      <template #table-busy>
        <div class="text-center text-danger my-2">
          <b-spinner class="align-middle mx-2" />
          <strong>Loading...</strong>
        </div>
      </template>
      <template #head(name)="data">
        <b-button
          v-if="currentFolder"
          aria-label="Up"
          class="btn up-button"
          variant="flat-secondary"
          @click="upFolder()"
        >
          <span
            class="d-inline-block"
            aria-hidden="true"
          >
            <v-icon name="arrow-alt-circle-up" />
          </span>
        </b-button>
        {{ data.label.toUpperCase() }}
      </template>
      <template #cell(name)="data">
        <div v-if="data.item.isDirectory">
          <b-link @click="changeFolder(data.item.name)">
            {{ data.item.name }}
          </b-link>
        </div>
        <div v-else>
          {{ data.item.name }}
        </div>
      </template>
      <template #cell(modifiedAt)="data">
        {{ new Date(data.item.modifiedAt).toLocaleString('en-GB', timeoptions) }}
      </template>
      <template #cell(type)="data">
        <div v-if="data.item.isDirectory">
          Folder
        </div>
        <div v-else-if="data.item.isFile">
          File
        </div>
        <div v-else-if="data.item.isSymbolicLink">
          File
        </div>
        <div v-else>
          Other
        </div>
      </template>
      <template #cell(size)="data">
        <div v-if="data.item.size > 0">
          {{ beautifyValue((data.item.size / 1000).toFixed(0)) }} KB
        </div>
      </template>
      <template #cell(delete)="data">
        <b-button
          :id="`delete-${data.item.name}`"
          v-b-tooltip.hover.left="'Delete'"
          v-ripple.400="'rgba(255, 255, 255, 0.15)'"
          variant="gradient-danger"
          class="btn-icon action-icon"
        >
          <v-icon name="trash-alt" />
        </b-button>
        <confirm-dialog
          :target="`delete-${data.item.name}`"
          :confirm-button="data.item.isFile ? 'Delete File' : 'Delete Folder'"
          @confirm="data.item.isFile ? deleteFile(data.item.name) : deleteFolder(data.item.name)"
        />
      </template>
      <template #cell(actions)="data">
        <b-button-group size="sm">
          <b-button
            :id="`download-${data.item.name}`"
            v-b-tooltip.hover.bottom="data.item.isFile ? 'Download' : 'Download zip of folder'"
            v-ripple.400="'rgba(255, 255, 255, 0.15)'"
            variant="outline-secondary"
          >
            <v-icon :name="data.item.isFile ? 'file-download' : 'file-archive'" />
          </b-button>
          <b-button
            :id="`rename-${data.item.name}`"
            v-b-tooltip.hover.bottom="'Rename'"
            v-ripple.400="'rgba(255, 255, 255, 0.15)'"
            variant="outline-secondary"
            @click="rename(data.item.name)"
          >
            <v-icon name="edit" />
          </b-button>
          <b-button
            :id="`share-${data.item.name}`"
            v-b-tooltip.hover.bottom="data.item.shareToken ? 'Unshare file' : 'Share file'"
            v-ripple.400="'rgba(255, 255, 255, 0.15)'"
            :variant="data.item.shareToken ? 'gradient-primary' : 'outline-secondary'"
            @click="data.item.shareToken ? unshareFile(data.item.name) : shareFile(data.item.name)"
          >
            <v-icon name="share-alt" />
          </b-button>
          <b-button
            v-if="data.item.shareToken"
            :id="`sharelink-${data.item.name}`"
            v-ripple.400="'rgba(255, 255, 255, 0.15)'"
            variant="outline-secondary"
          >
            <v-icon name="envelope" />
          </b-button>
        </b-button-group>
        <confirm-dialog
          :target="`download-${data.item.name}`"
          :confirm-button="data.item.isFile ? 'Download File' : 'Download Folder'"
          @confirm="data.item.isFile ? download(data.item.name) : download(data.item.name, true, data.item.size)"
        />
        <b-popover
          v-if="data.item.shareToken"
          :target="`sharelink-${data.item.name}`"
          placement="bottom"
          triggers="hover focus"
        >
          <template #title>
            <b-button
              v-b-tooltip.hover.top="'Copy to Clipboard'"
              aria-label="Copy to Clipboard"
              class="btn copy-button"
              variant="flat-warning"
              @click="copyLinkToClipboard(createfluxshareLink(data.item.shareFile, data.item.shareToken))"
            >
              <span
                class="d-inline-block"
                aria-hidden="true"
              >
                <v-icon name="clipboard" />
              </span>
            </b-button>
            Share Link
          </template>
          <div>
            <b-link :href="createfluxshareLink(data.item.shareFile, data.item.shareToken)">
              {{ createfluxshareLink(data.item.shareFile, data.item.shareToken) }}
            </b-link>
          </div>
        </b-popover>
        <b-modal
          v-model="renameDialogVisible"
          title="Rename"
          size="lg"
          centered
          ok-only
          ok-title="Rename"
          @ok="confirmRename()"
        >
          <b-form-group
            label="Name"
            label-for="nameInput"
          >
            <b-form-input
              id="nameInput"
              v-model="newName"
              size="lg"
              placeholder="Name"
            />
          </b-form-group>
        </b-modal>
      </template>
    </b-table>
  </div>
</template>

<script>
import {
  BProgress,
  BTable,
  BSpinner,
  BButton,
  BButtonToolbar,
  BButtonGroup,
  VBTooltip,
  BModal,
  BFormGroup,
  BFormInput,
  BPopover,
  BLink,
} from 'bootstrap-vue';

import { mapState } from 'vuex';
import Ripple from 'vue-ripple-directive';
import axios from 'axios';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import ConfirmDialog from '@/views/components/ConfirmDialog.vue';
import FileUpload from '@/views/components/FileUpload.vue';
import AppsService from '@/services/AppsService';

import store from 'store';

export default {
  components: {
    BProgress,
    BTable,
    BSpinner,
    BButton,
    BModal,
    BFormGroup,
    BFormInput,
    BPopover,
    BLink,
    BButtonToolbar,
    BButtonGroup,
    ConfirmDialog,
    FileUpload,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  directives: {
    'b-tooltip': VBTooltip,
    Ripple,
  },
  data() {
    return {
      fields: [
        { key: 'name', label: 'Name', sortable: true },
        { key: 'modifiedAt', label: 'Modified', sortable: true },
        { key: 'type', label: 'Type', sortable: true },
        { key: 'size', label: 'Size', sortable: true },
        { key: 'actions', label: '' },
        { key: 'delete', label: '' },
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
      downloaded: {},
      total: {},
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
    };
  },
  computed: {
    ...mapState('flux', [
      'userconfig',
      'config',
    ]),
    percentage() {
      const perc = (this.storage.used / this.storage.total) * 100;
      return Number(perc.toFixed(2));
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
      return `http://${hostname}`;
    },
    folderContentFilter() {
      const filteredFolder = this.folderView.filter((data) => JSON.stringify(data.name).toLowerCase().includes(this.filterFolder.toLowerCase()));
      return filteredFolder.filter((data) => data.name !== '.gitkeep');
    },
    getUploadFolder() {
      const port = this.config.apiPort;
      if (this.currentFolder) {
        const folder = encodeURIComponent(this.currentFolder);
        return `${this.ipAddress}:${port}/apps/fluxshare/uploadfile/${folder}`;
      }
      return `${this.ipAddress}:${port}/apps/fluxshare/uploadfile`;
    },
  },
  mounted() {
    this.loadingFolder = true;
    this.loadFolder(this.currentFolder); // empty string for main folder
    this.storageStats();
  },
  methods: {
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
        const response = await AppsService.storageStats(this.zelidHeader.zelidauth);
        console.log(response);
        if (response.data.status === 'success') {
          this.storage.total = response.data.data.total;
          this.storage.used = response.data.data.used;
          this.storage.available = response.data.data.available;
        } else {
          this.showToast('danger', response.data.data.message || response.data.data);
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
      this.loadFolder(this.currentFolder);
    },
    async loadFolder(path, soft = false) {
      try {
        this.filterFolder = '';
        if (!soft) {
          this.folderView = [];
        }
        this.loadingFolder = true;
        const response = await AppsService.getFolder(this.zelidHeader.zelidauth, encodeURIComponent(path));
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
        const response = await AppsService.createFolder(this.zelidHeader.zelidauth, encodeURIComponent(folderPath));
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
    },
    cancelDownload(name) {
      this.abortToken[name].cancel(`Download of ${name} cancelled`);
      this.downloaded[name] = '';
      this.total[name] = '';
    },
    async download(name, isFolder = false, maxTotalSize = 0) {
      try {
        const self = this;
        if (self.abortToken[name]) {
          self.abortToken[name].cancel();
        }
        const sourceCancelToken = axios.CancelToken;
        const cancelToken = sourceCancelToken.source();
        this.$set(this.abortToken, name, cancelToken);
        const folder = this.currentFolder;
        const fileName = folder ? `${folder}/${name}` : name;
        let initialTime;
        const axiosConfig = {
          headers: this.zelidHeader,
          responseType: 'blob',
          onDownloadProgress(progressEvent) {
            if (!initialTime) {
              initialTime = progressEvent.timeStamp;
            }
            self.$set(self.downloaded, name, progressEvent.loaded);
            if (progressEvent.total) {
              self.$set(self.total, name, progressEvent.total);
            } else if (progressEvent.target && progressEvent.target.response && progressEvent.target.response.size) {
              self.$set(self.total, name, progressEvent.target.response.size);
            } else {
              self.$set(self.total, name, maxTotalSize);
            }
            self.$set(self.timeStamp, name, progressEvent.timeStamp - initialTime);
          },
          cancelToken: self.abortToken[name].token,
        };
        let response;
        if (isFolder) {
          response = await AppsService.justAPI().get(`/apps/fluxshare/downloadfolder/${encodeURIComponent(fileName)}`, axiosConfig);
        } else {
          response = await AppsService.justAPI().get(`/apps/fluxshare/getfile/${encodeURIComponent(fileName)}`, axiosConfig);
        }
        console.log(response);
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
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
        if (error.message) {
          if (!error.message.startsWith('Download')) {
            this.showToast('danger', error.message);
          }
        } else {
          this.showToast('danger', error);
        }
      }
    },
    beautifyValue(valueInText) {
      const str = valueInText.split('.');
      if (str[0].length >= 4) {
        str[0] = str[0].replace(/(\d)(?=(\d{3})+$)/g, '$1,');
      }
      return str.join('.');
    },
    refreshFolder() {
      this.loadFolder(this.currentFolder, true);
      this.storageStats();
    },
    async deleteFile(name) {
      try {
        const folder = this.currentFolder;
        const fileName = folder ? `${folder}/${name}` : name;
        const response = await AppsService.removeFile(this.zelidHeader.zelidauth, encodeURIComponent(fileName));
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
    async shareFile(name) {
      try {
        const folder = this.currentFolder;
        const fileName = folder ? `${folder}/${name}` : name;
        const response = await AppsService.shareFile(this.zelidHeader.zelidauth, encodeURIComponent(fileName));
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          this.loadFolder(this.currentFolder, true);
          this.showToast('success', `${name} shared`);
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    async unshareFile(name) {
      try {
        const folder = this.currentFolder;
        const fileName = folder ? `${folder}/${name}` : name;
        const response = await AppsService.unshareFile(this.zelidHeader.zelidauth, encodeURIComponent(fileName));
        if (response.data.status === 'error') {
          this.showToast('danger', response.data.data.message || response.data.data);
        } else {
          this.loadFolder(this.currentFolder, true);
          this.showToast('success', `${name} unshared`);
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    async deleteFolder(foldername) {
      try {
        let folderPath = foldername;
        if (this.currentFolder !== '') {
          folderPath = `${this.currentFolder}/${foldername}`;
        }
        const response = await AppsService.removeFolder(this.zelidHeader.zelidauth, encodeURIComponent(folderPath));
        console.log(response.data);
        if (response.data.status === 'error') {
          if (response.data.data.code === 'ENOTEMPTY') {
            this.showToast('danger', `Directory ${foldername} is not empty!`);
          } else {
            this.showToast('danger', response.data.data.message || response.data.data);
          }
        } else {
          this.loadFolder(this.currentFolder, true);
          this.showToast('success', `${foldername} deleted`);
        }
      } catch (error) {
        this.showToast('danger', error.message || error);
      }
    },
    beforeUpload(file) {
      // check if file already exists
      if (this.storage.available <= 0) {
        this.showToast('danger', 'Storage space is full');
        return false;
      }
      const fileExists = this.folderView.find((currentFile) => currentFile.name === file.name);
      if (fileExists) {
        this.showToast('info', `File ${file.name} already exists`);
        return false;
      }
      return true;
    },
    createfluxshareLink(name, token) {
      const port = this.config.apiPort;
      return `${this.ipAddress}:${port}/apps/fluxshare/getfile/${name}?token=${token}`;
    },
    copyLinkToClipboard(link) {
      const el = document.createElement('textarea');
      el.value = link;
      el.setAttribute('readonly', '');
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      this.showToast('success', 'Link copied to Clipboard');
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
        const response = await AppsService.renameFileFolder(this.zelidHeader.zelidauth, encodeURIComponent(oldpath), newname);
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
      this.sortTableByNameManual();
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
  },
};
</script>

<style>
.progress-label {
  float: right;
  margin-left: 1em;
  margin-top: 5px;
}
.action-icon {
  height: 40px;
  margin-right: 3px;
}
.copy-button {
  float: right;
  height: 20px;
  width: 20px;
  padding: 0;
}
.up-button {
  float: left;
  height: 20px;
  width: 20px;
  padding: 0;
  margin: 0 10px 0 0;
}
.fluxshare-table td:nth-child(5) {
  width: 230px;
}
.fluxshare-table th:nth-child(5) {
  width: 230px;
}
.fluxshare-table td:nth-child(6) {
  width: 50px;
}
.fluxshare-table th:nth-child(6) {
  width: 50px;
}
</style>
