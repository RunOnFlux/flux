<template>
  <span :class="spanClasses">
    &nbsp;&nbsp;<b-icon scale="1.2" icon="hourglass-split" />
    {{ expireTime }}&nbsp;&nbsp;
  </span>
</template>

<script>
export default {
  components: {},
  props: {
    expireTime: {
      type: String,
      required: true,
    },
  },
  data() {
    return {};
  },
  computed: {
    spanClasses() {
      return {
        'red-text': this.isLessThanTwoDays(this.expireTime),
        'no-wrap': true,
      };
    },
  },
  methods: {
    isLessThanTwoDays(expireTime) {
      if (!expireTime) return true;
      const parts = expireTime.split(',').map((str) => str.trim());
      let days = 0;
      let hours = 0;
      let minutes = 0;

      parts.forEach((part) => {
        if (part.includes('days')) {
          days = parseInt(part, 10);
        } else if (part.includes('hours')) {
          hours = parseInt(part, 10);
        } else if (part.includes('minutes')) {
          minutes = parseInt(part, 10);
        }
      });

      const totalMinutes = days * 24 * 60 + hours * 60 + minutes;
      return totalMinutes < 2880;
    },
  },
};
</script>

<style lang="scss">
.red-text {
  background-color: rgba(255, 0, 0, 0.25);
  border-radius: 15px;
  display: inline-block;
  margin: 0 0.1em;
  padding: 0.1em 0.6em;
  font-weight: 800;
  color: #ff0000;
}
</style>
