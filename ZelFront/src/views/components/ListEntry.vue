<template>
  <dl class="row mb-1">
    <dt class="col-sm-3">
      {{ title }}
    </dt>
    <dd
      class="col-sm-9 mb-0"
      :class="`text-${variant}`"
    >
      {{ (data.length > 0 ? data : (number !== Number.MAX_VALUE ? number : '' )) }}
    </dd>
  </dl>
</template>

<script>

export default {
  props: {
    title: {
      type: String,
      required: true,
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
  },
}
</script>

<style>
</style>
