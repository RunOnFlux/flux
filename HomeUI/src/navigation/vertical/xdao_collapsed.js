import useAppConfig from '@core/app-config/useAppConfig';

const { xdaoOpenProposals } = useAppConfig();

export default [
  {
    title: 'XDAO',
    icon: 'id-card',
    tag: xdaoOpenProposals,
    spacing: true,
    children: [
      {
        title: 'XDAO ',
        icon: 'clipboard-list',
        route: 'xdao-app',
      },
    ],
  },
];
