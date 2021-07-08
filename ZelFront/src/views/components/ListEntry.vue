<template>
  <dl
    class="row"
    :class="classes"
  >
    <dt class="col-sm-3">
      {{ title }}
    </dt>
    <dd
      v-if="href.length > 0"
      class="col-sm-9 mb-0"
      :class="`text-${variant}`"
    >
      <b-link
        v-if="href.length > 0"
        :href="href"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ (data.length > 0 ? data : (number !== Number.MAX_VALUE ? number : '' )) }}
      </b-link>
    </dd>
    <dd
      v-if="click"
      class="col-sm-9 mb-0"
      :class="`text-${variant}`"
      @click="$emit('click')"
    >
      <b-link>
        {{ (data.length > 0 ? data : (number !== Number.MAX_VALUE ? number : '' )) }}
      </b-link>
    </dd>
    <dd
      v-else
      class="col-sm-9 mb-0"
      :class="`text-${variant}`"
    >
      {{ (data.length > 0 ? data : (number !== Number.MAX_VALUE ? number : '' )) }}
    </dd>
  </dl>
</template>

<script>
import {
  BLink,
} from 'bootstrap-vue'

export default {
  components: {
    BLink,
  },
  props: {
    title: {
      type: String,
      required: true,
    },
    classes: {
      type: String,
      required: false,
      default: 'mb-1',
    },
    data: {
      type: String,
      required: false,
      default: '',
    },
    number: {
      type: Number,
      required: false,
      default: Number.MAX_VALUE,
    },
    variant: {
      type: String,
      required: false,
      default: 'secondary',
    },
    href: {
      type: String,
      required: false,
      default: '',
    },
    click: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
}
</script>

<style>
</style>
