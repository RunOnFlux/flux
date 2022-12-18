<template>
  <li
    v-if="hasPrivilegeLevel(item)"
    class="nav-item"
    :class="{
      'active': isActive,
      'disabled': item.disabled
    }"
  >
    <b-link
      v-bind="linkProps"
      class="d-flex align-items-center"
    >
      <v-icon :name="item.icon || 'regular/circle'" />
      <span class="menu-title text-truncate">{{ t(item.title) }}</span>
      <b-badge
        v-if="item.tag && item.tag.value > 0"
        pill
        :variant="item.tagVariant || 'primary'"
        class="mr-1 ml-auto"
      >
        {{ item.tag.value }}
      </b-badge>
    </b-link>
  </li>
</template>

<script>
import { BLink, BBadge } from 'bootstrap-vue';
import { useUtils as useI18nUtils } from '@core/libs/i18n';
import { mapState } from 'pinia';
import useVerticalNavMenuLink from './useVerticalNavMenuLink';
import mixinVerticalNavMenuLink from './mixinVerticalNavMenuLink';

export default {
  components: {
    BLink,
    BBadge,
  },
  mixins: [mixinVerticalNavMenuLink],
  props: {
    item: {
      type: Object,
      required: true,
    },
  },
  setup(props) {
    const { isActive, linkProps, updateIsActive } = useVerticalNavMenuLink(props.item);
    const { t } = useI18nUtils();

    return {
      isActive,
      linkProps,
      updateIsActive,

      // i18n
      t,
    };
  },
  computed: {
    ...mapState('flux', [
      'privilege',
    ]),
  },
  methods: {
    hasPrivilegeLevel(item) {
      if (item.privilege) {
        return item.privilege.some((value) => value === this.privilege);
      }
      return true;
    },
  },
};
</script>
