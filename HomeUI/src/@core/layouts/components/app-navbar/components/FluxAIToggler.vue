<template>
  <b-button
    id="flux-ai-button"
    v-b-tooltip.hover
    title="Ask FluxAI"
    variant="outline-primary"
    size="sm"
    class="ml-2 d-flex align-items-center"
  >
    <feather-icon size="16" icon="MessageCircleIcon" />
    <span class="d-none d-lg-inline">&nbsp; Ask FluxAI</span>
  </b-button>
</template>

<script>
import { BButton, VBTooltip } from 'bootstrap-vue';

export default {
  components: {
    BButton,
  },
  directives: {
    'b-tooltip': VBTooltip,
  },
};
</script>
