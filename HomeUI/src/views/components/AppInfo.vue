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
      v-if="data.hash && data.hash.length === 64 && expiresOnBlockheight"
      title="Expires on Blockheight"
      :data="expiresOnBlockheight"
      title-icon="hourglass-split"
      title-icon-scale="1.2"
      kbd-variant="success"
    />
    <list-entry
      title="Expires in"
      :data="expiresInLabel"
      title-icon="clock"
      title-icon-scale="1.2"
      :kbd-variant="isExpiringSoon(expiresInLabel) ? 'danger' : 'success'"
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
// PON (Proof of Node) Fork configuration - block height where chain speed increases 4x
const FORK_BLOCK_HEIGHT = 2020000;

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
      required: false,
      default: null,
    },
    currentBlockHeight: {
      type: Number,
      required: false,
      default: -1,
    },
  },
  computed: {
    expiresOnBlockheight() {
      if (!this.data.height || !this.data.hash || this.data.hash.length !== 64) {
        return null;
      }

      // After PON fork (block 2020000), default expire is 88000 blocks (4x22000)
      const defaultExpire = this.data.height >= FORK_BLOCK_HEIGHT ? 88000 : 22000;
      const expireIn = this.data.expire || defaultExpire;
      const originalExpirationHeight = this.data.height + expireIn;

      // If app was registered before PON fork AND expiration extends past the fork,
      // the blocks AFTER the fork will be 4x faster, so multiply those by 4
      if (this.data.height < FORK_BLOCK_HEIGHT
          && originalExpirationHeight > FORK_BLOCK_HEIGHT) {
        // Calculate blocks that were supposed to live after fork block
        const blocksAfterFork = originalExpirationHeight - FORK_BLOCK_HEIGHT;
        // Multiply by 4 to account for 4x faster chain
        const adjustedBlocksAfterFork = blocksAfterFork * 4;
        // New expiration = fork block + adjusted blocks
        const adjustedExpiration = FORK_BLOCK_HEIGHT + adjustedBlocksAfterFork;

        return adjustedExpiration;
      }

      return originalExpirationHeight;
    },
    expiresInLabel() {
      if (!this.expiresOnBlockheight || this.currentBlockHeight < 0) {
        return 'Not available';
      }

      const blocksRemaining = this.expiresOnBlockheight - this.currentBlockHeight;

      if (blocksRemaining < 1) {
        return 'Application Expired';
      }

      let totalMinutes = 0;

      // Before fork: 2 minutes per block
      // After fork: 0.5 minutes per block (30 seconds)
      if (this.currentBlockHeight < FORK_BLOCK_HEIGHT) {
        // We're currently before the fork
        if (this.expiresOnBlockheight <= FORK_BLOCK_HEIGHT) {
          // Expiration is before fork - all blocks at 2 min/block
          totalMinutes = blocksRemaining * 2;
        } else {
          // Expiration is after fork - split calculation
          const blocksUntilFork = FORK_BLOCK_HEIGHT - this.currentBlockHeight;
          const blocksAfterFork = this.expiresOnBlockheight - FORK_BLOCK_HEIGHT;
          totalMinutes = (blocksUntilFork * 2) + (blocksAfterFork * 0.5);
        }
      } else {
        // We're currently after fork - all remaining blocks at 0.5 min/block
        totalMinutes = blocksRemaining * 0.5;
      }

      // Convert minutes to human-readable format
      const days = Math.floor(totalMinutes / 1440);
      const hours = Math.floor((totalMinutes % 1440) / 60);
      const minutes = Math.floor(totalMinutes % 60);

      const parts = [];
      if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
      if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
      if (minutes > 0 || parts.length === 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);

      return parts.slice(0, 3).join(', ');
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
