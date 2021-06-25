<template>
  <b-popover
    ref="popover"
    :target="`${target}`"
    triggers="click blur"
    :show.sync="show"
    placement="auto"
    container="my-container"
  >
    <template v-slot:title>
      <div class="d-flex justify-content-between align-items-center">
        <span>{{ title }}</span>
        <b-button
          v-ripple.400="'rgba(255, 255, 255, 0.15)'"
          class="close"
          variant="transparent"
          aria-label="Close"
          @click="show = false"
        >
          <span
            class="d-inline-block text-white"
            aria-hidden="true"
          >&times;</span>
        </b-button>
      </div>
    </template>

    <div>
      <b-button
        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
        size="sm"
        variant="danger"
        class="mr-1"
        @click="show = false"
      >
        {{ cancelButton }}
      </b-button>
      <b-button
        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
        size="sm"
        variant="primary"
        @click="confirm()"
      >
        {{ confirmButton }}
      </b-button>
    </div>
  </b-popover>

</template>

<script>
import {
  BButton,
  BPopover,
} from 'bootstrap-vue'
import Ripple from 'vue-ripple-directive'

export default {
  components: {
    BButton,
    BPopover,
  },
  directives: {
    Ripple,
  },
  props: {
    target: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: false,
      default: 'Are You Sure?',
    },
    cancelButton: {
      type: String,
      required: false,
      default: 'Cancel',
    },
    confirmButton: {
      type: String,
      required: true,
    },
  },
  data() {
    return {
      show: false,
    }
  },
  methods: {
    confirm() {
      this.show = false
      this.$emit('confirm')
    },
  },
}
</script>

<style>

</style>
