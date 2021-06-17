<template>
  <dl class="row mb-1">
    <dt class="col-sm-3">
      {{ title }}
    </dt>
    <dd
      class="col-sm-9 mb-0"
      :class="`text-${variant}`"
    >
      {{ (data || number) || 'No Data' }}
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
    },
    number: {
      type: Number,
      required: false,
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
