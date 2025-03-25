<template>
  <div v-if="data">
    <list-entry title="Name" :data="data.name" title-icon="box-seam-fill" title-icon-scale="1.3" kbd-variant="secondary" />
    <list-entry title="Description" :data="data.description" title-icon="journal-text" title-icon-scale="1.3" kbd-variant="secondary" :hide-if-empty="true" />
    <list-entry title="Owner" :data="data.owner" title-icon="person-bounding-box" title-icon-scale="1.3" kbd-variant="secondary" />
    <list-entry title="Hash" :data="data.hash" title-icon="code-square" title-icon-scale="1.3" kbd-variant="secondary" />
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
      kbd-variant="success"
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
};
</script>
