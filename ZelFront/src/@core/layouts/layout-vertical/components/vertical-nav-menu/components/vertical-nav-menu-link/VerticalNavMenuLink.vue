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
        v-if="item.tag"
        pill
        :variant="item.tagVariant || 'primary'"
        class="mr-1 ml-auto"
      >
        {{ item.tag }}
      </b-badge>
    </b-link>
  </li>
</template>

<script>
import { useUtils as useAclUtils } from '@core/libs/acl'
import { BLink, BBadge } from 'bootstrap-vue'
import { useUtils as useI18nUtils } from '@core/libs/i18n'
import { mapState } from 'vuex'
import useVerticalNavMenuLink from './useVerticalNavMenuLink'
import mixinVerticalNavMenuLink from './mixinVerticalNavMenuLink'

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
  computed: {
    ...mapState('flux', [
      'privilege',
    ]),
  },
  setup(props) {
    const { isActive, linkProps, updateIsActive } = useVerticalNavMenuLink(props.item)
    const { t } = useI18nUtils()
    const { canViewVerticalNavMenuLink } = useAclUtils()

    return {
      isActive,
      linkProps,
      updateIsActive,

      // ACL
      canViewVerticalNavMenuLink,

      // i18n
      t,
    }
  },
  methods: {
    hasPrivilegeLevel(item) {
      if (item.privilege) {
        return item.privilege.some(value => value === this.privilege)
      }
      return true
    },
  },
}
</script>
