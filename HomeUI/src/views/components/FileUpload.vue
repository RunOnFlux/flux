<template>
  <div
    class="flux-share-upload"
    :style="cssProps"
  >
    <b-row>
      <b-col xs="8">
        <div
          v-cloak
          id="dropTarget"
          class="flux-share-upload-drop text-center"
          @drop.prevent="addFile"
          @dragover.prevent
          @click="selectFiles"
        >
          <v-icon name="cloud-upload-alt" />
          <p>Drop files here or <em>click to upload</em></p>
          <p class="upload-footer">
            (File size is limited to 5GB)
          </p>
        </div>
        <input
          id="file-selector"
          ref="fileselector"
          class="flux-share-upload-input"
          type="file"
          multiple
          @change="handleFiles"
        >
      </b-col>
      <b-col
        xs="4"
        class="upload-column"
      >
        <div
          v-for="file in files"
          :key="file.file.name"
          class="upload-item mb-1"
        >
          <p>{{ file.file.name }}</p>
          <b-button
            class="delete"
            variant="outline-primary"
            size="sm"
            aria-label="Close"
            :disabled="file.uploading"
            @click="removeFile(file)"
          >
            <span
              class="d-inline-block text-white"
              aria-hidden="true"
            >&times;</span>
          </b-button>
          <b-progress
            :value="file.progress"
            max="100"
            striped
            height="3px"
            :class="file.uploading || file.uploaded ? '' : 'hidden'"
          />
        </div>
      </b-col>
    </b-row>
    <b-row>
      <b-col
        xs="12"
        class="text-center"
      >
        <b-button
          class="delete mt-1"
          variant="primary"
          :disabled="!filesToUpload"
          size="sm"
          aria-label="Close"
          @click="startUpload()"
        >
          Upload Files
        </b-button>
      </b-col>
    </b-row>
  </div>
</template>

<script>
import { computed } from "vue";
import {
  BRow,
  BCol,
  BProgress,
  BButton,
} from 'bootstrap-vue';

import { $themeColors } from '@themeConfig';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';

export default {
  components: {
    BRow,
    BCol,
    BProgress,
    BButton,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  props: {
    uploadFolder: {
      type: String,
      required: true,
    },
    headers: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      files: [],
      primaryColor: $themeColors.primary,
      secondaryColor: $themeColors.secondary,
    };
  },
  setup() {
    const cssProps = computed(() => {
      return {
        '--primary-color': this.primaryColor,
        '--secondary-color': this.secondaryColor,
      };
    });

    const filesToUpload = computed(() => {
      return this.files.length > 0 && this.files.some((file) => !file.uploading && !file.uploaded && file.progress === 0);
    });

    return {
      cssProps,
      filesToUpload
    }
  },
  methods: {
    selectFiles() {
      console.log('select files');
      this.$refs.fileselector.click();
    },
    handleFiles(ev) {
      const { files } = ev.target;
      if (!files) return;
      console.log(files);
      this.addFiles(([...files]));
    },
    addFile(e) {
      const droppedFiles = e.dataTransfer.files;
      if (!droppedFiles) return;
      this.addFiles(([...droppedFiles]));
    },
    addFiles(filesToAdd) {
      filesToAdd.forEach((f) => {
        const existingFiles = this.files.some((file) => file.file.name === f.name);
        console.log(existingFiles);
        if (existingFiles) {
          this.showToast('warning', `'${f.name}' is already in the upload queue`);
        } else {
          this.files.push({
            file: f,
            uploading: false,
            uploaded: false,
            progress: 0,
          });
        }
      });
    },
    removeFile(file) {
      this.files = this.files.filter((f) => f.file.name !== file.file.name);
    },
    startUpload() {
      console.log(this.uploadFolder);
      console.log(this.files);
      this.files.forEach((f) => {
        console.log(f);
        if (!f.uploaded && !f.uploading) {
          this.upload(f);
        }
      });
    },
    /* eslint no-param-reassign: ["error", { "props": false }] */
    upload(file) {
      const self = this;
      if (typeof XMLHttpRequest === 'undefined') {
        return;
      }

      const xhr = new XMLHttpRequest();
      const action = this.uploadFolder;

      if (xhr.upload) {
        xhr.upload.onprogress = function progress(e) {
          console.log(e);
          if (e.total > 0) {
            e.percent = (e.loaded / e.total) * 100;
          }
          file.progress = e.percent;
        };
      }

      const formData = new FormData();

      formData.append(file.file.name, file.file);
      file.uploading = true;

      xhr.onerror = function error(e) {
        console.log(e);
        self.showToast('danger', `An error occurred while uploading '${file.file.name}' - ${e}`);
      };

      xhr.onload = function onload() {
        if (xhr.status < 200 || xhr.status >= 300) {
          console.log('error');
          console.log(xhr.status);
          self.showToast('danger', `An error occurred while uploading '${file.file.name}' - Status code: ${xhr.status}`);
          return;
        }

        file.uploaded = true;
        file.uploading = false;
        self.$emit('complete');

        self.showToast('success', `'${file.file.name}' has been uploaded`);
      };

      xhr.open('post', action, true);

      const headers = this.headers || {};

      const headerKeys = Object.keys(headers);
      for (let i = 0; i < headerKeys.length; i += 1) {
        const item = headerKeys[i];
        if (Object.prototype.hasOwnProperty.call(headers, item) && headers[item] !== null) {
          xhr.setRequestHeader(item, headers[item]);
        }
      }
      xhr.send(formData);
    },
    showToast(variant, title, icon = 'InfoIcon') {
      this.$bvToast.toast({
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

<style scoped>
.flux-share-upload-drop {
  height: 250px;
  width: 400px;
  border-style: dotted;
  border-color: var(--secondary-color);
  cursor: pointer;
}
.flux-share-upload-drop:hover {
  border-color: var(--primary-color);
}
.flux-share-upload-drop svg {
  width: 100px;
  height: 100px;
  margin: 50px 0 10px 0;
}
.flux-share-upload-input {
  display: none;
}
.upload-footer {
  font-size: 10px;
  position: relative;
  top: 20px;
}
.upload-column {
  overflow-y: auto;
  height: 250px;
}
.upload-item {
  overflow: hidden;
  white-space: nowrap;
  position: relative;
  height: 40px;
  padding: 0 0 0 3px;
}
.upload-item:hover {
  border-style: none none none double;
  border-color: var(--primary-color);
}
.upload-item p {
  text-overflow: ellipsis;
  overflow: hidden;
  margin: 0 0 10px;
  padding: 0 40px 0 0;
}
.upload-item .delete {
  position: absolute;
  top: 0;
  right: 0;
}
</style>
