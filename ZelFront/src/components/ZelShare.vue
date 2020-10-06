<template>
  <div>
    <el-table
      ref="shareTable"
      :data="folderContentFilter"
      style="width: 100%"
      :default-sort="{prop: 'name', order: 'ascending'}"
      :default-sort-method="sortNameFolder"
    >
      <div slot="empty">
        <p v-if="loadingFolder">
          Loading folder <i class="el-icon-loading"></i>
        </p>
        <p v-else-if="filterFolder">
          No files found
        </p>
        <p v-else>
          Folder is empty
        </p>
      </div>
      <el-table-column
        label="Name"
        prop="name"
        sortable
        :sort-orders="['ascending','descending']"
        :sort-method="sortNameFolder"
      >
        <template slot="header">
          <el-button
            style="padding: 5px; margin-right: 20px;"
            circle
            icon="el-icon-top"
            type="info"
            size="mini"
            @click="changeFolder('..'); sortTableByNameManual();"
          >
          </el-button>
          Name
        </template>
        <template slot-scope="scope">
          <p v-if="scope.row.isDirectory">
            <el-link
              type="primary"
              @click="changeFolder(scope.row.name);"
            >
              {{ scope.row.name }}
            </el-link>
          </p>
          <p v-else>
            {{ scope.row.name }}
          </p>
        </template>
      </el-table-column>
      <el-table-column
        label="Changed"
        prop="modifiedAt"
        :sort-orders="['ascending','descending']"
        sortable
      >
        <template slot-scope="scope">
          {{ new Date(scope.row.modifiedAt).toLocaleString('en-GB', timeoptions) }}
        </template>
      </el-table-column>
      <el-table-column
        label="Type"
        prop="type"
        sortable
        :sort-orders="['ascending','descending']"
        :sort-method="sortTypeFolder"
      >
        <template slot-scope="scope">
          <p v-if="scope.row.isDirectory">
            Folder
          </p>
          <p v-else-if="scope.row.isFile">
            File
          </p>
          <p v-else-if="scope.row.isSymbolicLink">
            File
          </p>
          <p v-else>
            Other
          </p>
        </template>
      </el-table-column>
      <el-table-column
        label="Size"
        prop="size"
        :sort-orders="['ascending','descending']"
        sortable
      >
        <template slot-scope="scope">
          <p v-if="scope.row.size > 0 && scope.row.isFile">
            {{ beautifyValue((scope.row.size / 1000).toFixed(0)) }} KB
          </p>
        </template>
      </el-table-column>
      <el-table-column
        align="right"
        width="200px"
      >
        <template slot="header">
          <p style="text-align: center">
            <el-input
              v-model="filterFolder"
              size="mini"
              placeholder="Type to search"
            />
          </p>
        </template>
        <template slot-scope="scope">
          <div style="text-align: center">
            <el-button
              v-if="scope.row.isFile && !downloaded[scope.row.name]"
              icon="el-icon-download"
              size="mini"
              type="info"
              @click="download(scope.row.name)"
            >Download</el-button>
            <p v-if="total[scope.row.name] && downloaded[scope.row.name]">
              {{ (downloaded[scope.row.name] / 1e6).toFixed(2) + " / " + (total[scope.row.name] / 1e6).toFixed(2) }} MB
              <br>
              {{ ((downloaded[scope.row.name] / total[scope.row.name]) * 100).toFixed(2) + "%" }}
              <i
                v-if="total[scope.row.name] && downloaded[scope.row.name] && total[scope.row.name] === downloaded[scope.row.name]"
                class="el-icon-success"
              ></i>
              <el-tooltip
                v-if="total[scope.row.name] && downloaded[scope.row.name] && total[scope.row.name] !== downloaded[scope.row.name]"
                content="Cancel Download"
                placement="top"
              >
                <el-button
                  v-if="total[scope.row.name] && downloaded[scope.row.name] && total[scope.row.name] !== downloaded[scope.row.name]"
                  type="danger"
                  icon="el-icon-close"
                  circle
                  size="mini"
                  @click="cancelDownload(scope.row.name)"
                ></el-button>
              </el-tooltip>
            </p>
          </div>
        </template>
      </el-table-column>
      <el-table-column
        align="right"
        width="165px"
      >
        <template slot="header">
          <p style="text-align: center">
            <el-button
              icon="el-icon-upload"
              size="mini"
              type="info"
              @click="uploadFilesDialog = true"
            >
              Upload
            </el-button>
            <el-button
              style="padding: 5px;"
              icon="el-icon-folder-add"
              circle
              size="mini"
              type="info"
              @click="createDirectoryDialogVisible = true"
            >
            </el-button>
          </p>
        </template>
        <template slot-scope="scope">
          <p style="text-align: center">
            <el-popconfirm
              v-if="scope.row.isFile"
              confirmButtonText='Delete'
              cancelButtonText='No, Thanks'
              icon="el-icon-delete"
              iconColor="red"
              title="Permanently delete file?"
              confirmButtonType="danger"
              cancelButtonType="info"
              @onConfirm="deleteFile(scope.row.name)"
            >
              <el-button
                slot="reference"
                icon="el-icon-delete"
                size="mini"
                type="danger"
              >
                Delete
              </el-button>
            </el-popconfirm>
            <el-popconfirm
              v-if="scope.row.isDirectory"
              confirmButtonText='Delete'
              cancelButtonText='No, Thanks'
              icon="el-icon-delete"
              iconColor="red"
              title="Only empty directories can be deleted for security reasons. Delete directory?"
              confirmButtonType="danger"
              cancelButtonType="info"
              @onConfirm="deleteFolder(scope.row.name)"
            >
              <el-button
                slot="reference"
                icon="el-icon-delete"
                size="mini"
                type="danger"
              >
                Delete
              </el-button>
            </el-popconfirm>
          </p>
        </template>
      </el-table-column>
    </el-table>
    <el-dialog
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="true"
      title="Upload files"
      :visible.sync="uploadFilesDialog"
      @close="refreshFolder"
      width="75%"
    >
      <el-upload
        drag
        :headers="zelidHeader"
        :action="getUploadFolder"
        :on-error="uploadError"
        :on-success="uploadSuccess"
        :before-upload="beforeUpload"
        thumbnail-mode="true"
        multiple
      >
        <i class="el-icon-upload"></i>
        <div class="el-upload__text">Drop file here or <em>click to upload</em></div>
        <div
          class="el-upload__tip"
          slot="tip"
        >File size is limited to 5GB</div>
      </el-upload>
    </el-dialog>
    <el-dialog
      :close-on-click-modal="true"
      :close-on-press-escape="true"
      :show-close="true"
      title="Create Directory"
      :visible.sync="createDirectoryDialogVisible"
      width="75%"
      @close="newDirName = ''"
    >
      <ElInput
        type="text"
        placeholder="Write new direcotry name..."
        v-model="newDirName"
      >
        <template slot="prepend">Directory Name</template>
      </ElInput>
      <br><br>
      <el-button
        type="info"
        @click="createFolder(newDirName);"
      >
        Create Directory
      </el-button>
    </el-dialog>
  </div>
</template>

<script>
import Vuex, { mapState } from 'vuex';
import Vue from 'vue';
import axios from 'axios';

import ZelAppsService from '@/services/ZelAppsService';

const store = require('store');

Vue.use(Vuex);
const vue = new Vue();

export default {
  name: 'ZelShare',
  data() {
    return {
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
      newDirName: '',
      abortToken: {},
      downloaded: {},
      total: {},
      working: false,
      storage: {
        used: 0,
        total: 2,
        available: 2,
      },
    };
  },
  computed: {
    ...mapState([
      'userconfig',
    ]),
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
      return `http://${this.userconfig.externalip}`;
    },
    folderContentFilter() {
      const filteredFolder = this.folderView.filter((data) => JSON.stringify(data.name).toLowerCase().includes(this.filterFolder.toLowerCase()));
      return filteredFolder.filter((data) => data.name !== '.gitkeep');
    },
    getUploadFolder() {
      if (this.currentFolder) {
        const folder = encodeURIComponent(this.currentFolder);
        console.log(this.currentFolder);
        console.log(folder);
        console.log(`${this.ipAddress}:16127/zelapps/zelshare/uploadfile/${folder}`);
        return `${this.ipAddress}:16127/zelapps/zelshare/uploadfile/${folder}`;
      }
      return `${this.ipAddress}:16127/zelapps/zelshare/uploadfile`;
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
      if (a.isDirectory && b.isFile) return 1;
      if (a.isFile && b.isDirectory) return -1;
      return 0;
    },
    sortTableByNameManual() {
      this.$refs.shareTable.clearSort();
    },
    async storageStats() {
      try {
        const response = await ZelAppsService.storageStats(this.zelidHeader.zelidauth);
        console.log(response);
        if (response.data.status === 'success') {
          this.folderView = response.data.data;
          this.storage.total = response.data.data.total;
          this.storage.used = response.data.data.used;
          this.storage.available = response.data.data.available;
        } else {
          vue.$customMes.error(response.data.data.message || response.data.data);
        }
      } catch (error) {
        vue.$customMes.error(error.message || error);
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
        const response = await ZelAppsService.getFolder(this.zelidHeader.zelidauth, encodeURIComponent(path));
        this.loadingFolder = false;
        if (response.data.status === 'success') {
          this.folderView = response.data.data;
        } else {
          vue.$customMes.error(response.data.data.message || response.data.data);
        }
      } catch (error) {
        this.loadingFolder = false;
        console.log(error.message);
        vue.$customMes.error(error.message || error);
      }
    },
    async createFolder(path) {
      try {
        let folderPath = path;
        if (this.currentFolder !== '') {
          folderPath = `${this.currentFolder}/${path}`;
        }
        const response = await ZelAppsService.createFolder(this.zelidHeader.zelidauth, encodeURIComponent(folderPath));
        if (response.data.status === 'error') {
          if (response.data.data.code === 'EEXIST') {
            vue.$customMes.error(`Folder ${path} already exists`);
          } else {
            vue.$customMes.error(response.data.data.message || response.data.data);
          }
        } else {
          this.loadFolder(this.currentFolder, true);
          this.createDirectoryDialogVisible = false;
        }
      } catch (error) {
        this.loadingFolder = false;
        console.log(error.message);
        vue.$customMes.error(error.message || error);
      }
    },
    cancelDownload(name) {
      this.abortToken[name].cancel(`Download of ${name} cancelled`);
      this.downloaded[name] = '';
      this.total[name] = '';
    },
    async download(name) {
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
        const axiosConfig = {
          headers: this.zelidHeader,
          responseType: 'blob',
          onDownloadProgress(progressEvent) {
            Vue.set(self.downloaded, name, progressEvent.loaded);
            Vue.set(self.total, name, progressEvent.total);
          },
          cancelToken: self.abortToken[name].token,
        };
        const response = await ZelAppsService.justAPI().get(`/zelapps/zelshare/getfile/${encodeURIComponent(fileName)}`, axiosConfig);
        if (response.data.status === 'error') {
          vue.$customMes.error(response.data.data.message || response.data.data);
        } else {
          const url = window.URL.createObjectURL(new Blob([response.data]));
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', name);
          document.body.appendChild(link);
          link.click();
        }
      } catch (error) {
        console.log(error.message);
        if (error.message) {
          if (!error.message.startsWith('Download')) {
            vue.$customMes.error(error.message);
          }
        } else {
          vue.$customMes.error(error);
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
    uploadError(error, file) {
      vue.$customMes.error(`Error uploading ${file.name}`);
    },
    uploadSuccess() {
      const self = this;
      if (!this.working) {
        this.working = true;
        this.loadFolder(this.currentFolder, true);
        setTimeout(() => {
          self.working = false;
        }, 500);
      }
    },
    refreshFolder() {
      this.loadFolder(this.currentFolder, true);
      this.storageStats();
    },
    async deleteFile(name) {
      try {
        const folder = this.currentFolder;
        const fileName = folder ? `${folder}/${name}` : name;
        const response = await ZelAppsService.removeFile(this.zelidHeader.zelidauth, encodeURIComponent(fileName));
        if (response.data.status === 'error') {
          vue.$customMes.error(response.data.data.message || response.data.data);
        } else {
          this.loadFolder(this.currentFolder, true);
          vue.$customMes.success(`${name} deleted`);
        }
      } catch (error) {
        vue.$customMes.error(error.message || error);
      }
    },
    async deleteFolder(foldername) {
      try {
        let folderPath = foldername;
        if (this.currentFolder !== '') {
          folderPath = `${this.currentFolder}/${foldername}`;
        }
        const response = await ZelAppsService.removeFolder(this.zelidHeader.zelidauth, encodeURIComponent(folderPath));
        console.log(response.data);
        if (response.data.status === 'error') {
          if (response.data.data.code === 'ENOTEMPTY') {
            vue.$customMes.error(`Directory ${foldername} is not empty!`);
          } else {
            vue.$customMes.error(response.data.data.message || response.data.data);
          }
        } else {
          this.loadFolder(this.currentFolder, true);
          vue.$customMes.success(`${foldername} deleted`);
        }
      } catch (error) {
        vue.$customMes.error(error.message || error);
      }
    },
    beforeUpload(file) {
      // check if file already exists
      if (this.storage.available <= 0) {
        vue.$message.error('Storage space is full');
        return false;
      }
      const fileExists = this.folderView.find((currentFile) => currentFile.name === file.name);
      if (fileExists) {
        vue.$message.info(`File ${file.name} already exists`);
        return false;
      }
      return true;
    },
  },
};
</script>
