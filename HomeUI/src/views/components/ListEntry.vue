<template>
  <dl class="row" :class="[classes, { 'd-none': shouldHide }]">
    <dt class="col-sm-3 d-flex align-items-center">
      <slot name="title">
        <template v-if="titleIcon">
          <smart-icon :icon="titleIcon" :scale="titleIconScale" style="margin-right: 5px;" />
        </template>
        {{ title }}
      </slot>
    </dt>

    <!-- External link -->
    <dd v-if="href.length > 0" class="col-sm-9 mb-0">
      <b-link
        :href="href"
        target="_blank"
        rel="noopener noreferrer"
      >
        <kbd
          v-if="kbdVariant"
          :class="['resource-kbd', `alert-${kbdVariant}`]"
        >
          {{ displayValue }}
        </kbd>
        <span v-else :class="`text-${variant}`">{{ displayValue }}</span>
      </b-link>
    </dd>

    <!-- Emit-on-click link -->
    <dd v-else-if="click" class="col-sm-9 mb-0" @click="$emit('click')">
      <b-link>
        <kbd
          v-if="kbdVariant"
          :class="['resource-kbd', `alert-${kbdVariant}`]"
        >
          {{ displayValue }}
        </kbd>
        <span v-else :class="`text-${variant}`">{{ displayValue }}</span>
      </b-link>
    </dd>

    <!-- Default content or fallback -->
    <dd v-else class="col-sm-9 mb-0">
      <slot>
        <kbd
          v-if="kbdVariant"
          :class="['resource-kbd', `alert-${kbdVariant}`]"
        >
          {{ displayValue }}
        </kbd>
        <span v-else :class="`text-${variant}`">
          {{ displayValue }}
        </span>
      </slot>
    </dd>
  </dl>
</template>

<script>
import { BLink } from 'bootstrap-vue';
import SmartIcon from '@/views/components/SmartIcon.vue'; // Adjust path as needed

export default {
  name: 'ListEntry',
  components: {
    BLink,
    SmartIcon,
  },
  props: {
    title: {
      type: String,
      default: '',
    },
    titleIcon: {
      type: String,
      default: null,
    },
    titleIconScale: {
      type: [Number, String],
      default: 1.2,
    },
    classes: {
      type: String,
      default: 'mb-1',
    },
    data: {
      type: [String, Array, Number],
      default: '',
    },
    number: {
      type: Number,
      default: Number.MAX_VALUE,
    },
    variant: {
      type: String,
      default: 'secondary',
    },
    href: {
      type: String,
      default: '',
    },
    click: {
      type: Boolean,
      default: false,
    },
    hideIfEmpty: {
      type: Boolean,
      default: false,
    },
    kbdVariant: {
      type: String,
      default: null,
    },
  },
  computed: {
    displayValue() {
      if (Array.isArray(this.data)) {
        return this.data.join(', ');
      }

      if (typeof this.data === 'string' && this.data.trim().length > 0) {
        return this.data;
      }

      if (typeof this.data === 'number' && !Number.isNaN(this.data)) {
        return this.data;
      }

      if (this.number !== Number.MAX_VALUE) {
        return this.number;
      }

      return '';
    },
    isEmpty() {
      const isVisiblyEmpty = (node, depth = 0) => {
        const text = node?.text?.trim() ?? '';
        const isTag = !!node?.tag;
        const hasChildren = Array.isArray(node?.children) && node.children.length > 0;

        if (!isTag && text === '') return false;
        if (isTag && !hasChildren && text === '') return false;
        if (hasChildren) return node.children.some((child) => isVisiblyEmpty(child, depth + 1));

        return true;
      };

      const slotNodes = this.$slots.default || [];
      const hasVisibleContent = slotNodes.some((node) => isVisiblyEmpty(node));

      const hasData = String(this.data || '').trim() !== '';
      const hasNumber = this.number !== undefined && this.number !== Number.MAX_VALUE;

      return !(hasVisibleContent || hasData || hasNumber);
    },
    shouldHide() {
      return this.hideIfEmpty && this.isEmpty;
    },
  },
};
</script>

<style scoped>
  dl.row {
    display: flex;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }

  dl.row > dt,
  dl.row > dd {
    display: flex;
    align-items: baseline; /* Align first lines of text */
    margin-bottom: 0;
  }

  dl.row > dt.col-sm-3 {
    width: 25%;
    font-weight: 600;
    padding-top: 2px; /* Optional: fine-tune vertical spacing */
  }

  dl.row > dd.col-sm-9 {
    width: 75%;
  }

  .resource-kbd {
    display: inline-block;
    max-width: 100%;
    padding: 4px 12px;
    margin-bottom: 4px;
    border-radius: 15px;
    font-family: monospace;
    font-size: 14px;
    white-space: normal;
    word-break: break-word;
    line-height: 1.5;
  }

  @media (max-width: 576px) {
    dl.row > dt.col-sm-3,
    dl.row > dd.col-sm-9 {
      width: 100% !important; /* Force full width */
    }

    dl.row > dt.col-sm-3 {
      margin-bottom: 0.25rem;
    }
  }
</style>
