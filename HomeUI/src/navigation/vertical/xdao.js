import useAppConfig from '@core/app-config/useAppConfig';

const { xdaoOpenProposals } = useAppConfig();

export default [
  {
    header: 'XDAO',
  },
  {
    title: 'XDAO ',
    icon: 'clipboard-list',
    tag: xdaoOpenProposals,
    route: 'xdao-app',
  },
];
