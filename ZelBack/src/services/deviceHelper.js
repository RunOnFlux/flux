const nodecmd = require('node-cmd');
// eslint-disable-next-line import/no-extraneous-dependencies
const util = require('util');

const cmdAsync = util.promisify(nodecmd.get);

async function getDfDevice(directory) {
  const command = `df --output=source,target ${directory}`;
  const response = await cmdAsync(command);
  const lines = response.trim().split('\n');
  for (let i = 1; i < lines.length; i += 1) {
    const columns = lines[i].split(/\s+/);
    if (columns[0] !== '') {
      return columns[0];
    }
  }
  return false;
}

async function hasQuotaOptionForDevice(device) {
  const command = `mount | grep "${device}"`;
  const response = await cmdAsync(command);
  const mountInfo = response.trim();
  if (mountInfo.includes('quota')) {
    return true;
  }
  return false;
}
module.exports = {
  getDfDevice,
  hasQuotaOptionForDevice,
};
