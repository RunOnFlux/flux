<template>
  <!-- 1. BootstrapVue <b-icon> -->
  <component
    :is="'b-icon'"
    v-if="iconType === 'b-icon'"
    :icon="icon"
    :scale="scale"
    :variant="variant"
    :class="finalClass"
    v-bind="passThroughAttrs"
    v-on="$listeners"
  />

  <!-- 2. Bootstrap Icon Font -->
  <i
    v-else-if="iconType === 'bi-font'"
    :class="[computedClass, finalClass]"
    :style="{ fontSize: scaleSize }"
    v-bind="passThroughAttrs"
    v-on="$listeners"
  />

  <!-- 3. Local SVG -->
  <img
    v-else-if="iconType === 'svg'"
    :src="svgPath"
    :alt="icon"
    :style="{ height: scaleSize, width: scaleSize }"
    :class="[svgClass, finalClass]"
    v-bind="passThroughAttrs"
    v-on="$listeners"
  />
</template>

<script>

import { BIcon } from 'bootstrap-vue';

const customSvgContext = require.context('@/assets/custom-icons', false, /\.svg$/);

export default {
  name: 'SmartIcon',
  inheritAttrs: false, // This prevents Vue from auto-applying $attrs to the root
  props: {
    icon: { type: String, required: true },
    scale: { type: [Number, String], default: 1 },
    variant: { type: String, default: null },
  },
  computed: {
    scaleSize() {
      return `${parseFloat(this.scale) || 1}em`;
    },
    svgPath() {
      const fileName = `./${this.icon}.svg`;
      return customSvgContext.keys().includes(fileName)
        ? customSvgContext(fileName)
        : null;
    },
    isBIconRegistered() {
      return !!BIcon?.options?.icons?.[this.icon];
    },
    iconType() {
      if (this.isBIconRegistered) return 'b-icon';
      if (this.svgPath) return 'svg';
      return 'bi-font';
    },
    computedClass() {
      return {
        [`bi bi-${this.icon}`]: true,
        [`text-${this.variant}`]: !!this.variant,
      };
    },
    svgClass() {
      return this.variant ? `text-${this.variant}` : '';
    },
    finalClass() {
      // Extract only class from $attrs to apply manually
      return this.$attrs.class || '';
    },
    passThroughAttrs() {
      // Filter out class so it doesn't get double-applied
      const { class: _class, ...rest } = this.$attrs;
      return rest;
    },
  },
};
</script>
