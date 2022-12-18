<template>
  <b-nav-item-dropdown
    class="dropdown-notification mr-25"
    menu-class="dropdown-menu-media"
    right
  >
    <template #button-content>
      <feather-icon
        badge="6"
        badge-classes="bg-danger"
        class="text-body"
        icon="BellIcon"
        size="21"
      />
    </template>

    <!-- Header -->
    <li class="dropdown-menu-header">
      <div class="dropdown-header d-flex">
        <h4 class="notification-title mb-0 mr-auto">
          Notifications
        </h4>
        <b-badge
          pill
          variant="light-primary"
        >
          6 New
        </b-badge>
      </div>
    </li>

    <!-- Notifications -->
    <vue-perfect-scrollbar
      v-once
      :settings="perfectScrollbarSettings"
      class="scrollable-container media-list scroll-area"
      tagname="li"
    >
      <!-- Account Notification -->
      <b-link
        v-for="notification in notifications"
        :key="notification.subtitle"
      >
        <b-media>
          <template #aside>
            <b-avatar
              size="32"
              :src="notification.avatar"
              :text="notification.avatar"
              :variant="notification.type"
            />
          </template>
          <p class="media-heading">
            <span class="font-weight-bolder">
              {{ notification.title }}
            </span>
          </p>
          <small class="notification-text">{{ notification.subtitle }}</small>
        </b-media>
      </b-link>

      <!-- System Notification Toggler -->
      <div class="media d-flex align-items-center">
        <h6 class="font-weight-bolder mr-auto mb-0">
          System Notifications
        </h6>
        <b-form-checkbox
          :checked="true"
          switch
        />
      </div>

      <!-- System Notifications -->
      <b-link
        v-for="notification in systemNotifications"
        :key="notification.subtitle"
      >
        <b-media>
          <template #aside>
            <b-avatar
              size="32"
              :variant="notification.type"
            >
              <feather-icon :icon="notification.icon" />
            </b-avatar>
          </template>
          <p class="media-heading">
            <span class="font-weight-bolder">
              {{ notification.title }}
            </span>
          </p>
          <small class="notification-text">{{ notification.subtitle }}</small>
        </b-media>
      </b-link>
    </vue-perfect-scrollbar>

    <!-- Cart Footer -->
    <li class="dropdown-menu-footer">
      <b-button
        v-ripple.400="'rgba(255, 255, 255, 0.15)'"
        variant="primary"
        block
      >
        Read all notifications
      </b-button>
    </li>
  </b-nav-item-dropdown>
</template>

<script>
import {
  BNavItemDropdown, BBadge, BMedia, BLink, BAvatar, BButton, BFormCheckbox,
} from 'bootstrap-vue';
import VuePerfectScrollbar from 'vue3-perfect-scrollbar';
import Ripple from 'vue-ripple-directive';

export default {
  components: {
    BNavItemDropdown,
    BBadge,
    BMedia,
    BLink,
    BAvatar,
    VuePerfectScrollbar,
    BButton,
    BFormCheckbox,
  },
  directives: {
    Ripple,
  },
  setup() {
    /* eslint-disable global-require */
    const notifications = [];
    /* eslint-disable global-require */

    const systemNotifications = [];

    const perfectScrollbarSettings = {
      maxScrollbarLength: 60,
      wheelPropagation: false,
    };

    return {
      notifications,
      systemNotifications,
      perfectScrollbarSettings,
    };
  },
};
</script>

<style>

</style>
