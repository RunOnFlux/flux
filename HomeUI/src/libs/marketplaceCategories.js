const categories = [
  { name: 'Minecraft', variant: 'success', icon: 'gamepad' },
  { name: 'Games', variant: 'success', icon: 'gamepad' },
  { name: 'Productivity', variant: 'danger', icon: 'file-alt' },
  { name: 'Hosting', variant: 'success', icon: 'server' },
  { name: 'Blockchain', variant: 'success', icon: 'coins' },
  { name: 'Blockbook', variant: 'success', icon: 'book' },
  { name: 'Front-end', variant: 'success', icon: 'desktop' },
  { name: 'RPC Node', variant: 'success', icon: 'satellite-dish' },
  { name: 'Masternode', variant: 'success', icon: 'wallet' },
];
const defaultCategory = { name: 'App', variant: 'success', icon: 'cog' };

module.exports = {
  categories,
  defaultCategory,
};
