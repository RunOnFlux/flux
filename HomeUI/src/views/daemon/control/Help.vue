<template>
  <div>
    <b-card
      v-if="callResponse.data"
    >
      <app-collapse
        v-model="activeHelpNames"
        accordion
      >
        <div
          v-for="help of helpResponse"
          :key="help"
        >
          <div v-if="help.startsWith('=')">
            <br>
            <h2>
              {{ help.split(' ')[1] }}
            </h2>
          </div>
          <app-collapse-item
            v-if="!help.startsWith('=')"
            :title="help"
            @visible="updateActiveHelpNames($event, help)"
          >
            <p class="helpSpecific">
              {{ currentHelpResponse || 'Loading help message...' }}
            </p>
            <hr>
          </app-collapse-item>
        </div>
      </app-collapse>
    </b-card>
  </div>
</template>

<script>
import { computed } from "vue";
import {
  BCard,
} from 'bootstrap-vue';
import ToastificationContent from '@core/components/toastification/ToastificationContent.vue';
import AppCollapse from '@core/components/app-collapse/AppCollapse.vue';
import AppCollapseItem from '@core/components/app-collapse/AppCollapseItem.vue';
import DaemonService from '@/services/DaemonService';

export default {
  components: {
    BCard,
    AppCollapse,
    AppCollapseItem,
    // eslint-disable-next-line vue/no-unused-components
    ToastificationContent,
  },
  data() {
    return {
      callResponse: {
        status: '',
        data: '',
      },
      activeHelpNames: '',
      currentHelpResponse: '',
    };
  },
  setup() {
    const helpResponse = computed(() => {
      if (this.callResponse.data) {
        return this.callResponse.data.split('\n').filter((el) => el !== '').map((el) => (el.startsWith('=') ? el : el.split(' ')[0]));
      }
      return [];
    });

    return (
      helpResponse
    )
  },
  mounted() {
    this.daemonHelp();
  },
  methods: {
    async daemonHelp() {
      const response = await DaemonService.help();
      if (response.data.status === 'error') {
        this.$bvToast.toast({
          component: ToastificationContent,
          props: {
            title: response.data.data.message || response.data.data,
            icon: 'InfoIcon',
            variant: 'danger',
          },
        });
      } else {
        this.callResponse.status = response.data.status;
        this.callResponse.data = response.data.data;
      }
    },
    updateActiveHelpNames(_, name) {
      this.activeHelpNames = name;
      this.daemonHelpSpecific();
    },
    async daemonHelpSpecific() {
      this.currentHelpResponse = '';
      console.log(this.activeHelpNames);
      const response = await DaemonService.helpSpecific(this.activeHelpNames);
      console.log(response);
      if (response.data.status === 'error') {
        this.$bvToast.toast({
          component: ToastificationContent,
          props: {
            title: response.data.data.message || response.data.data,
            icon: 'InfoIcon',
            variant: 'danger',
          },
        });
      } else {
        const modifiedHelp = response.data.data.split('\n');
        const ml = modifiedHelp.length;
        let spaces = 0;
        for (let i = 0; i < ml; i += 1) {
          let whiteSpaceAdd = '';
          if (modifiedHelp[i].trim() === '{' || modifiedHelp[i].trim() === '[') {
            spaces += 4;
            for (let j = 0; j < spaces; j += 1) {
              whiteSpaceAdd += '\u00A0';
            }
            modifiedHelp[i] = whiteSpaceAdd + modifiedHelp[i];
            spaces += 4;
          } else if (modifiedHelp[i].trim() === '}' || modifiedHelp[i].trim() === ']') {
            spaces -= 4;
            for (let j = 0; j < spaces; j += 1) {
              whiteSpaceAdd += '\u00A0';
            }
            modifiedHelp[i] = whiteSpaceAdd + modifiedHelp[i];
            spaces -= 4;
          } else {
            for (let j = 0; j < spaces; j += 1) {
              whiteSpaceAdd += '\u00A0';
            }
            modifiedHelp[i] = whiteSpaceAdd + modifiedHelp[i];
          }
        }
        this.currentHelpResponse = modifiedHelp.join('\n');
        console.log(this.currentHelpResponse);
      }
    },
  },
};
</script>

<style>
.helpSpecific {
  margin-left: 20px;
  font-family: monospace;
  white-space: pre-line;
}
</style>
