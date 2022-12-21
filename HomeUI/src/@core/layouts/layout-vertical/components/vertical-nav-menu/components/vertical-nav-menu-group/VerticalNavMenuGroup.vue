<template>
  <li
    v-if="hasPrivilegeLevel(item)"
    class="nav-item has-sub"
    :class="{
      'open': isOpen,
      'disabled': item.disabled,
      'sidebar-group-active': isActive,
      'sidebar-group-spacing': item.spacing,
    }"
  >
    <b-link
      class="d-flex align-items-center"
      @click="() => updateGroupOpen(!isOpen)"
    >
      <v-icon
        v-if="item.icon"
        :name="item.icon || 'regular/circle'"
      />
      <b-img
        v-if="item.image"
        :src="item.image"
        class="sidebar-menu-image"
      />
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
    <b-collapse
      v-model="isOpen"
      class="menu-content"
      tag="ul"
    >
      <component
        :is="resolveNavItemComponent(child)"
        v-for="child in item.children"
        :key="child.header || child.title"
        ref="groupChild"
        :item="child"
      />
    </b-collapse>
  </li>
</template>

<script>
import { computed } from "vue";
import {
  BLink,
  BBadge,
  BCollapse,
  BImg,
} from 'bootstrap-vue';
import { resolveVerticalNavMenuItemComponent as resolveNavItemComponent } from '@core/layouts/utils';
import { useUtils as useI18nUtils } from '@core/libs/i18n';
import { mapState } from 'vuex';
import VerticalNavMenuHeader from '../vertical-nav-menu-header';
import VerticalNavMenuLink from '../vertical-nav-menu-link/VerticalNavMenuLink.vue';

// Composition Function
import useVerticalNavMenuGroup from './useVerticalNavMenuGroup';
import mixinVerticalNavMenuGroup from './mixinVerticalNavMenuGroup';

export default {
  name: 'VerticalNavMenuGroup',
  components: {
    VerticalNavMenuHeader,
    VerticalNavMenuLink,
    BLink,
    BBadge,
    BCollapse,
    BImg,
  },
  mixins: [mixinVerticalNavMenuGroup],
  props: {
    item: {
      type: Object,
      required: true,
    },
    setup(props) {
      const {
        isOpen,
        isActive,
        updateGroupOpen,
        updateIsActive,
      } = useVerticalNavMenuGroup(props.item);

      const { t } = useI18nUtils();

      return {
        resolveNavItemComponent,
        isOpen,
        isActive,
        updateGroupOpen,
        updateIsActive,

        // i18n
        t,
      };
    },
  },
  setup() {
    const { ...mapState } = ('flux', [
      'privilege',
    ]);

    return {
      mapState
    }
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

<style>
.sidebar-group-spacing {
  margin-top: 1rem;
}
.sidebar-menu-image {
  width: 20px;
  margin-right: 1.1rem;
}
</style>
