import appLogoImage from '@/assets/images/logo/logo_light.svg'
import appLogoImageDark from '@/assets/images/logo/logo.svg'

// Theme Colors
// Initially this will be blank. Later on when app is initialized we will assign bootstrap colors to this from CSS variables.
export const $themeColors = {};

// App Breakpoints
// Initially this will be blank. Later on when app is initialized we will assign bootstrap breakpoints to this object from CSS variables.
export const $themeBreakpoints = {};

// APP CONFIG
export const $themeConfig = {
  app: {
    appName: 'FluxOS', // Will update name in navigation menu (Branding)
    // eslint-disable-next-line global-require
    appLogoImageDark: appLogoImageDark, // Will update logo in navigation menu (Branding)
    // eslint-disable-next-line global-require
    appLogoImage: appLogoImage, // Will update logo in navigation menu (Branding)
  },
  layout: {
    isRTL: false,
    skin: 'dark', // light, dark, bordered, semi-dark
    routerTransition: 'zoom-fade', // zoom-fade, slide-fade, fade-bottom, fade, zoom-out, none
    type: 'vertical', // vertical only
    contentWidth: 'full', // full, boxed
    menu: {
      hidden: false,
      isCollapsed: false,
      itemsCollapsed: true,
    },
    navbar: {
      // ? For horizontal menu, navbar type will work for navMenu type
      type: 'sticky', // static , sticky , floating, hidden
      backgroundColor: '', // BS color options [primary, success, etc]
    },
    footer: {
      type: 'static', // static, sticky, hidden
    },
    customizer: true,
    enableScrollToTop: true,
  },
};
