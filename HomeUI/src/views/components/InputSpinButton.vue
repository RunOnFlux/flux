<template>
  <b-input-group>
    <b-input-group-prepend>
      <b-button
        variant="outline-dark"
        class="py-0"
        size="sm"
        @click="valueChange(value - 1)"
      >
        <b-icon
          icon="dash"
          font-scale="1.6"
        />
      </b-button>
    </b-input-group-prepend>

    <b-form-input
      :id="id"
      :size="size"
      :value="value"
      type="number"
      min="0"
      class="border-secondary text-center"
      number
      @update="valueChange"
    />

    <b-input-group-append>
      <b-button
        variant="outline-dark"
        class="py-0"
        size="sm"
        @click="valueChange(value + 1)"
      >
        <b-icon
          icon="plus"
          font-scale="1.6"
        />
      </b-button>
    </b-input-group-append>
  </b-input-group>
</template>

<script>
import {
  BIcon,
  BButton,
  BFormInput,
  BIconDash,
  BIconPlus,
  BInputGroup,
  BInputGroupPrepend,
  BInputGroupAppend,
} from 'bootstrap-vue';

export default {
  name: 'InputSpinButton',

  components: {
    BIcon,
    BButton,
    BFormInput,
    /* eslint-disable vue/no-unused-components */
    BIconDash,
    BIconPlus,
    BInputGroup,
    BInputGroupPrepend,
    BInputGroupAppend,
  },

  props: {
    id: {
      type: String,
      required: true,
    },

    size: {
      type: String,
      required: false,
      default: 'md',
      validator(value) {
        return ['sm', 'md', 'lg'].includes(value);
      },
    },

    value: {
      type: Number,
      required: true,
    },
  },

  methods: {
    valueChange(newValue) {
      if (newValue <= 0) {
        this.$emit('input', 0);
      } else {
        this.$emit('input', newValue);
      }
    },
  },
};
</script>

<style scoped>
/* Remove up and down arrows inside number input */
/* Chrome, Safari, Edge, Opera */
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Firefox */
input[type="number"] {
  -moz-appearance: textfield;
}
</style>
