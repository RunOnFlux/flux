<template>
  <b-nav-item-dropdown
    id="dropdown-grouped"
    variant="link"
    class="dropdown-language"
    right
  >
    <template #button-content>
      <b-img
        :src="currentLocale.img"
        height="14px"
        width="22px"
        :alt="currentLocale.locale"
      />
      <span class="ml-50 text-body">{{ currentLocale.name }}</span>
    </template>
    <b-dropdown-item
      v-for="localeObj in locales"
      :key="localeObj.locale"
      @click="$i18n.locale = localeObj.locale"
    >
      <b-img
        :src="localeObj.img"
        height="14px"
        width="22px"
        :alt="localeObj.locale"
      />
      <span class="ml-50">{{ localeObj.name }}</span>
    </b-dropdown-item>
  </b-nav-item-dropdown>
</template>

<script>
import { computed } from "vue";
import { BNavItemDropdown, BDropdownItem, BImg } from 'bootstrap-vue';
import en from '@/assets/images/flags/en.png';
import fr from '@/assets/images/flags/fr.png';
import de from '@/assets/images/flags/de.png';
import pt from '@/assets/images/flags/pt.png';

export default {
  components: {
    BNavItemDropdown,
    BDropdownItem,
    BImg,
  },
  setup() {
    /* eslint-disable global-require */
    const locales = [
      {
        locale: 'en',
        img: en,
        name: 'English',
      },
      {
        locale: 'fr',
        img: fr,
        name: 'French',
      },
      {
        locale: 'de',
        img: de,
        name: 'German',
      },
      {
        locale: 'pt',
        img: pt,
        name: 'Portuguese',
      },
    ];
    /* eslint-disable global-require */

    return {
      locales,
    };
  },
  setup() {
    const currentLocale = computed(() => {
      return this.locales.find((l) => l.locale === this.$i18n.locale);
    });
      
    return {
      currentLocale
    }
  },
};
</script>

<style>

</style>
