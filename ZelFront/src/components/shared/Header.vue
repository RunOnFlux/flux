<template>
  <div class="header-grid">
    <div class="header-logo">
      <span class="helper"></span>
      <img src="@/assets/img/ZelNodes.svg">
    </div>
    <div class="header-menu">
      {{ privilage }}
    </div>
  </div>
</template>

<script>

export default {
  name: 'Header',
  props: {
    privilage: String,
  },
};
</script>
