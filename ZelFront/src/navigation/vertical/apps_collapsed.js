export default [
  {
    title: 'Apps',
    icon: 'laptop-code',
    spacing: true,
    children: [
      {
        title: 'Local Apps',
        icon: 'upload',
        route: 'apps-localapps',
      },
      {
        title: 'Global Apps',
        icon: 'globe',
        route: 'apps-globalapps',
      },
      {
        title: 'Register Flux App',
        icon: 'regular/plus-square',
        route: 'apps-registerapp',
      },
      {
        title: 'My FluxShare',
        icon: 'regular/hdd',
        route: 'apps-fluxsharestorage',
        privilege: ['admin'],
      },
    ],
  },
]
