const categories = [
  { name: 'Games', variant: 'success', icon: 'gamepad' },
  { name: 'Productivity', variant: 'danger', icon: 'file-alt' },
  { name: 'Hosting', variant: 'success', icon: 'server' },
  { name: 'Crypto', variant: 'success', icon: 'coins' },
  { name: 'Blockbook', variant: 'success', icon: 'server' },
  { name: 'Front-end', variant: 'success', icon: 'coins' },
];
const defaultCategory = { name: 'App', variant: 'success', icon: 'cog' };

module.exports = {
  categories,
  defaultCategory,
};
