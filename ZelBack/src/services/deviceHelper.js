const serviceHelper = require('./serviceHelper');

function escapeRegExp(string) {
  // $& means the whole matched string
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getDfDevice(directory) {
  const { stdout } = await serviceHelper.runCommand('df', {
    params: ['--output=source,target', directory],
  });

  const lines = stdout.trim().split('\n');
  for (let i = 1; i < lines.length; i += 1) {
    const columns = lines[i].split(/\s+/);
    if (columns[0] !== '') {
      return columns[0];
    }
  }
  return false;
}

async function hasQuotaOptionForDevice(device) {
  const { stdout } = await serviceHelper.runCommand('mount');

  // assuming device is at the start of the line
  const lookahead = '(?=.*quota)'
  const re = new RegExp(lookahead + escapeRegExp(device))

  return Boolean(stdout.match(re));

  // const command = `mount | grep "${device}"`;
  // const response = await cmdAsync(command);
  // const mountInfo = response.trim();
  // if (mountInfo.includes('quota')) {
  //   return true;
  // }
  // return false;
}
module.exports = {
  getDfDevice,
  hasQuotaOptionForDevice,
};
