<template>
  <b-popover
    ref="popover"
    :target="`${target}`"
    triggers="click blur"
    :show="show"
    placement="auto"
    container="my-container"
    :custom-class="`confirm-dialog-${width}`"
  >
    <template #title>
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

    <div class="text-center">
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
} from 'bootstrap-vue';
import Ripple from 'vue-ripple-directive';

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
    width: {
      type: Number,
      required: false,
      default: 300,
    },
  },
  data() {
    return {
      show: false,
    };
  },
  methods: {
    confirm() {
      this.show = false;
      this.$emit('confirm');
    },
  },
};
</script>

<style>
.popover {
  max-width: 400px;
}
.confirm-dialog-250 {
  width: 250px;
}
.confirm-dialog-275 {
  width: 275px;
}
.confirm-dialog-300 {
  width: 300px;
}
.confirm-dialog-350 {
  width: 350px;
}
.confirm-dialog-400 {
  width: 400px;
}
</style>
