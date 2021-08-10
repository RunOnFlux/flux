import { $themeConfig } from '@themeConfig'

export default {
  namespaced: true,
  state: {
    isVerticalMenuCollapsed: localStorage.getItem('menu-isCollapsed') === 'true' || $themeConfig.layout.menu.isCollapsed,
  },
  getters: {},
  mutations: {
    UPDATE_VERTICAL_MENU_COLLAPSED(state, val) {
      state.isVerticalMenuCollapsed = val
      localStorage.setItem('menu-isCollapsed', val)
    },
  },
  actions: {},
}
