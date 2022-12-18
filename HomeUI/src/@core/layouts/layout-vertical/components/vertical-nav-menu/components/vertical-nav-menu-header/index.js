import { useUtils as useI18nUtils } from '@core/libs/i18n';
import { mapState } from 'pinia';

const { t } = useI18nUtils();

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
        return item.privilege.some((value) => value === this.privilege);
      }
      return true;
    },
  },
  render(h) {
    if (this.hasPrivilegeLevel(this.item)) {
      const span = h('span', {}, t(this.item.header));
      return h('li', { class: 'navigation-header text-truncate' }, [span]);
    }
    return h();
  },
};
