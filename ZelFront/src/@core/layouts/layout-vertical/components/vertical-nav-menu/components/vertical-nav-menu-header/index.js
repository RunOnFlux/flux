import { useUtils as useI18nUtils } from '@core/libs/i18n'
import { useUtils as useAclUtils } from '@core/libs/acl'
import { mapState } from 'vuex'

const { t } = useI18nUtils()
const { canViewVerticalNavMenuHeader } = useAclUtils()

export default {
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
  methods: {
    hasPrivilegeLevel(item) {
      if (item.privilege) {
        return item.privilege.some(value => value === this.privilege)
      }
      return true
    },
  },
  render(h) {
    if (this.hasPrivilegeLevel(this.item)) {
      const span = h('span', {}, t(this.item.header))
      // const icon = h('v-icon', { props: { name: 'ellipsis-h', size: '18' } })
      if (canViewVerticalNavMenuHeader(this.item)) {
        return h('li', { class: 'navigation-header text-truncate' }, [span])
      }
    }
    return h()
  },
}
