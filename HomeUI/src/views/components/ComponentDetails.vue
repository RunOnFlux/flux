<template>
  <div v-if="component" :key="index" class="mb-2">
    <div style="margin-left: 20px;">
      <list-entry title="Name" :data="component.name" title-icon="box-fill" title-icon-scale="1.3" kbd-variant="secondary" />
      <list-entry title="Description" :data="component.description" title-icon="journal-text" title-icon-scale="1.3" kbd-variant="secondary" :hide-if-empty="true" />
      <list-entry title="Repository" title-icon="docker" title-icon-scale="1.5">
        <template #default>
          <b-link
            :href="getRepositoryLink(component.repotag)"
            target="_blank"
            rel="noopener noreferrer"
            class="mr-1 d-inline-block"
            :class="{ disabled: component.repoauth, 'resource-kbd-disabled': component.repoauth }"
            :aria-disabled="component.repoauth ? 'true' : 'false'"
            @click="(e) => { if (component.repoauth) e.preventDefault() }"
          >
            <kbd :class="['alert-danger', 'resource-kbd', { 'animated-link': !component.repoauth }]">
              {{ component.repotag }}
            </kbd>
          </b-link>
        </template>
      </list-entry>
      <list-entry title="Repository Authentication" title-icon="person-fill-lock" title-icon-scale="1.4">
        <template #default>
          <kbd class="alert-secondary resource-kbd">
            <b-icon v-if="component?.repoauth" icon="eye-slash-fill" scale="1.2" />
            <b-icon v-else icon="eye-fill" scale="1.2" />
            {{ component?.repoauth ? 'Private' : 'Public' }}
          </kbd>
        </template>
      </list-entry>
      <list-entry
        title="Custom Domains"
        :data="sanitized(component?.domains) || ''"
        :hide-if-empty="true"
        title-icon="link-45deg"
        title-icon-scale="1.3"
      >
        <template #default>
          <div class="kbd-list">
            <b-link
              v-for="(domain, dIndex) in sanitized(component?.domains)"
              :key="dIndex"
              :href="`https://${domain}`"
              target="_blank"
              rel="noopener noreferrer"
              class="d-inline-block"
            >
              <kbd class="alert-info resource-kbd animated-link">{{ domain }}</kbd>
            </b-link>
          </div>
        </template>
      </list-entry>
      <list-entry
        title="Automatic Domains"
        :data="constructAutomaticDomains(component?.ports, appName, index)"
        title-icon="globe"
        title-icon-scale="1.2"
        :hide-if-empty="true"
      >
        <template #default>
          <div class="kbd-list">
            <b-link
              v-for="(domain, aIndex) in constructAutomaticDomains(component?.ports, appName, index)"
              :key="aIndex"
              :href="`https://${domain}`"
              target="_blank"
              rel="noopener noreferrer"
            >
              <kbd class="alert-info resource-kbd animated-link">{{ domain }}</kbd>
            </b-link>
          </div>
        </template>
      </list-entry>
      <list-entry title="Ports" :data="sanitized(component?.ports) || ''" :hide-if-empty="true" title-icon="plug-fill" title-icon-scale="1.3">
        <template #default>
          <div class="kbd-list">
            <div v-for="(port, pIndex) in sanitized(component?.ports)" :key="pIndex">
              <kbd class="alert-success resource-kbd">{{ port }}</kbd>
            </div>
          </div>
        </template>
      </list-entry>
      <list-entry title="Container Ports" :data="component?.containerPorts || ''" :hide-if-empty="true" title-icon="plug" title-icon-scale="1.3">
        <template #default>
          <div class="kbd-list">
            <div v-for="(containerPort, pIndex) in sanitized(component?.containerPorts)" :key="pIndex">
              <kbd class="alert-success resource-kbd">{{ containerPort }}</kbd>
            </div>
          </div>
        </template>
      </list-entry>
      <list-entry
        title="Container Data"
        :data="component?.containerData"
        title-icon="folder"
        title-icon-scale="1.3"
        kbd-variant="secondary"
      >
        <template #default>
          <kbd class="alert-secondary resource-kbd d-flex align-items-center">
            <smart-icon
              v-if="/s:|r:|g:/i.test(component?.containerData)"
              v-b-tooltip.hover.top="'Syncthing Enabled.'"
              icon="sync"
              scale="1.3"
              style="margin-right: 7px; color:forestgreen;"
            />
            {{ component?.containerData }}
          </kbd>
        </template>
      </list-entry>
      <list-entry title="Environment Parameters" :data="Array.isArray(component?.environmentParameters) && component?.environmentParameters?.length > 0 ? component.environmentParameters.toString() : ''" :hide-if-empty="true" title-icon="gear" title-icon-scale="1.3" kbd-variant="secondary" />
      <list-entry title="Commands" :data="Array.isArray(component?.commands) && component.commands.length > 0 ? component.commands.toString() : ''" :hide-if-empty="true" title-icon="terminal" title-icon-scale="1.2" kbd-variant="secondary" />
      <list-entry
        v-if="component?.secrets"
        title="Secret Environment Parameters"
        title-icon="database-fill-lock"
        title-icon-scale="1.2"
        kbd-variant="secondary"
      >
        <template #default>
          <kbd class="alert-secondary resource-kbd d-inline-flex align-items-center">
            <smart-icon icon="lock-fill" scale="1.2" style="margin-right: 3px;" />
            Content Encrypted
          </kbd>
        </template>
      </list-entry>
      <list-entry
        v-for="(resource, rIndex) in buildResources(component)"
        :key="rIndex"
        :class="resource.class || ''"
        :title-icon="resource.icon"
        title-icon-scale="1.2"
        :title="resource.label"
      >
        <template #default>
          <div v-if="component?.tiered" class="tiered-inline">
            <div v-for="(value, name) in resource.tiers" :key="name">
              <kbd class="alert alert-success resource-kbd">{{ name }}: {{ value }}</kbd>
            </div>
          </div>
          <div v-else>
            <kbd class="alert alert-success resource-kbd">{{ resource.flat }}</kbd>
          </div>
        </template>
      </list-entry>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ComponentDetails',
  props: {
    component: { type: Object, required: true },
    index: { type: Number, required: true },
    appName: { type: String, required: true },
  },
  methods: {
    sanitized(value) {
      if (!value) return [];

      const removeProtocol = (url) => url.replace(/^https?:\/\//, '');

      if (Array.isArray(value)) {
        return value
          .flatMap((item) => (typeof item === 'string'
            ? item.split(',').map((i) => removeProtocol(i.trim()))
            : [item]))
          .filter((v) => v);
      }

      if (typeof value === 'string') {
        return value
          .split(',')
          .map((i) => removeProtocol(i.trim()))
          .filter((v) => v);
      }

      return [];
    },
    getRepositoryLink(tag) {
      if (!tag) return null;

      const [repo] = tag.split(':');

      if (repo.startsWith('ghcr.io/')) {
        return `https://${repo}`;
      }
      if (repo.startsWith('registry.gitlab.com/')) {
        return `https://${repo}`;
      }
      if (repo.startsWith('docker.io/')) {
        return `https://hub.docker.com/r/${repo.replace('docker.io/', '')}`;
      }
      if (!repo.includes('/')) {
        return `https://hub.docker.com/_/${repo}`;
      }

      return `https://hub.docker.com/r/${repo}`;
    },
    buildResources(component) {
      return [
        {
          label: 'CPU',
          icon: 'speedometer2',
          flat: `${component.cpu} Cores`,
          tiers: {
            Cumulus: `${component.cpubasic} Cores`,
            Nimbus: `${component.cpusuper} Cores`,
            Stratus: `${component.cpubamf} Cores`,
          },
        },
        {
          label: 'RAM',
          icon: 'cpu',
          flat: `${component.ram} MB`,
          tiers: {
            Cumulus: `${component.rambasic} MB`,
            Nimbus: `${component.ramsuper} MB`,
            Stratus: `${component.rambamf} MB`,
          },
        },
        {
          label: 'SSD',
          icon: 'hdd',
          flat: `${component.hdd} GB`,
          tiers: {
            Cumulus: `${component.hddbasic} GB`,
            Nimbus: `${component.hddsuper} GB`,
            Stratus: `${component.hddbamf} GB`,
          },
          class: 'force-mb-0',
        },
      ];
    },
    constructAutomaticDomains(ports, name, index = 0) {
      if (!Array.isArray(ports) || !name) return [];

      const lowerCaseName = name.toLowerCase();
      const domains = [];

      // Add base domain for first component
      if (index === 0) {
        domains.push(`${lowerCaseName}.app.runonflux.io`);
      }

      // eslint-disable-next-line no-restricted-syntax
      for (const port of ports) {
        domains.push(`${lowerCaseName}_${port}.app.runonflux.io`);
      }

      return domains;
    },
  },
};
</script>

<style scoped>
    .kbd-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .resource-kbd {
        display: inline-block;
        max-width: 100%;
        padding: 4px 12px;
        margin-bottom: 4px;
        border-radius: 15px;
        font-family: monospace;
        font-size: 14px;
        white-space: normal;
        word-break: break-word;
        line-height: 1.5;
    }

    .tiered-inline {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .animated-link {
        position: relative;
        display: inline-block;
        color: inherit;
        text-decoration: none;
        transition: transform 0.2s ease, filter 0.2s ease;
    }

    .animated-link:hover {
        transform: scale(1.03);
        filter: brightness(1.1);
    }

    /* Simulated underline */
    .animated-link::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        bottom: 2px;
        height: 2px;
        background-color: currentColor;
        transform: scaleX(0);
        transform-origin: left;
        transition: transform 0.2s ease;
    }

    .animated-link:hover::after {
        transform: scaleX(1);
    }

    .resource-kbd-disabled {
        cursor: default;
        pointer-events: none;
    }
</style>
