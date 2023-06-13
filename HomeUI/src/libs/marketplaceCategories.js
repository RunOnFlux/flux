const categories = [
  { name: 'Games', variant: 'success', icon: 'gamepad' },
  { name: 'Productivity', variant: 'danger', icon: 'file-alt' },
  { name: 'Hosting', variant: 'success', icon: 'server' },
  { name: 'Blockchain', variant: 'success', icon: 'coins' },
  { name: 'Blockbook', variant: 'success', icon: 'book' },
  { name: 'Front-end', variant: 'success', icon: 'desktop' },
  { name: 'RPC Node', variant: 'success', icon: 'satellite-dish' },
];
const defaultCategory = { name: 'App', variant: 'success', icon: 'cog' };

module.exports = {
  categories,
  defaultCategory,
};
