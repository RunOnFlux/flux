<template>
  <div v-if="data">
    <list-entry title="Name" :data="data.name" title-icon="box-seam-fill" title-icon-scale="1.3" kbd-variant="secondary" />
    <list-entry title="Description" :data="data.description" title-icon="journal-text" title-icon-scale="1.3" kbd-variant="secondary" :hide-if-empty="true" />
    <list-entry title="Owner" :data="data.owner" title-icon="person-bounding-box" title-icon-scale="1.3" kbd-variant="secondary" />
    <list-entry title="Hash" :data="data.hash" title-icon="code-square" title-icon-scale="1.3" kbd-variant="secondary" />
    <list-entry
      v-if="data?.contacts && data.contacts.length > 0"
      title="Contacts"
      :data="sanitized(data.contacts)"
      :title-icon="contactIcon(sanitized(data.contacts))"
      title-icon-scale="1.3"
      kbd-variant="secondary"
      :hide-if-empty="true"
    />
    <list-entry
      title="Geolocation"
      title-icon="globe-americas"
      title-icon-scale="1.3"
      kbd-variant="secondary"
      :hide-if-empty="true"
    >
      <template #default>
        <div class="kbd-list">
          <div
            v-for="(location, index) in (data?.geolocation?.length > 0 ? data.geolocation : ['Worldwide'])"
            :key="index"
            class="d-inline-block"
            style="margin-right: 5px;"
          >
            <kbd
              :class="[
                'resource-kbd',
                {
                  'alert-info': getGeolocation(location).toLowerCase().includes('allowed'),
                  'alert-danger': getGeolocation(location).toLowerCase().includes('forbidden'),
                  'alert-secondary': !['allowed', 'forbidden'].some(keyword => getGeolocation(location).toLowerCase().includes(keyword)),
                },
              ]"
            >
              {{ getGeolocation(location) }}
            </kbd>
          </div>
        </div>
      </template>
    </list-entry>
    <list-entry
      title="Instances"
      :data="data?.instances || 3"
      title-icon="geo-alt-fill"
      title-icon-scale="1.3"
      kbd-variant="success"
    />
    <list-entry
      title="Specifications version"
      :data="data.version"
      title-icon="file-earmark-binary-fill"
      title-icon-scale="1.3"
      kbd-variant="success"
    />
    <list-entry
      title="Registered on Blockheight"
      :data="data.height"
      title-icon="calendar-check-fill"
      title-icon-scale="1.2"
      kbd-variant="success"
    />
    <list-entry
      v-if="data.hash && data.hash.length === 64"
      title="Expires on Blockheight"
      :data="data.height + (data.expire || 22000)"
      title-icon="hourglass-split"
      title-icon-scale="1.2"
      kbd-variant="success"
    />
    <list-entry
      title="Expires in"
      :data="getNewExpireLabel"
      title-icon="clock"
      title-icon-scale="1.2"
      :kbd-variant="isExpiringSoon('getNewExpireLabel') ? 'danger' : 'success'"
    />
    <list-entry
      title="Enterprise Nodes"
      :data="data?.nodes && data?.nodes.length > 0 ? data.nodes.join(', ') : 'Not scoped'"
      title-icon="hdd-network-fill"
      title-icon-scale="1.2"
      kbd-variant="secondary"
    />
    <list-entry
      title="Static IP"
      :data="data.staticip ? 'Yes, Running only on Static IP nodes' : 'No, Running on all nodes'"
      title-icon="pin-map"
      title-icon-scale="1.2"
      kbd-variant="secondary"
    />
  </div>
</template>

<script>
export default {
  name: 'AppInfo',
  props: {
    data: {
      type: [Object, Array],
      required: true,
    },
    getGeolocation: {
      type: Function,
      required: true,
    },
    getNewExpireLabel: {
      type: [String, Number, Function],
      required: true,
    },
  },
  methods: {
    isExpiringSoon(label) {
      const timeParts = label.match(/\d+\s*(day|hour|minute)/gi);
      if (!timeParts) return false;

      const totalMinutes = timeParts.reduce((sum, part) => {
        const [num, unit] = part.match(/\d+|\D+/g).map((s) => s.trim());
        const value = parseInt(num, 10);
        if (unit.startsWith('day')) return sum + value * 1440;
        if (unit.startsWith('hour')) return sum + value * 60;
        if (unit.startsWith('minute')) return sum + value;
        return sum;
      }, 0);

      return totalMinutes < 2880;
    },
    contactIcon() {
      return this.data.contacts.some((contact) => typeof contact === 'string' && contact.includes('@'))
        ? 'envelope-at-fill'
        : 'envelope-arrow-down-fill';
    },
    sanitized(value) {
      if (!value) return [];

      if (Array.isArray(value)) {
        return value
          .flatMap((item) => (typeof item === 'string' ? item.split(',').map((i) => i.trim()) : [item])).filter((v) => v);
      }

      if (typeof value === 'string') {
        return value
          .split(',')
          .map((i) => i.trim())
          .filter((v) => v);
      }

      return [];
    },
  },
};
</script>
