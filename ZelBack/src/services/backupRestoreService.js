const df = require('node-df').promises;
const log = require('../lib/log');
const messageHelper = require('./messageHelper');
const verificationHelper = require('./verificationHelper');

async function getAvailableSpaceOfApp(req, res) {
  try {
    let { appname } = req.params;
    appname = appname || req.query.appname;
    let { component } = req.params;
    component = component || req.query.component;
    if (appname) {
      throw new Error('appname parameter is mandatory');
    }
    const authorized = res ? await verificationHelper.verifyPrivilege('adminandfluxteam', req) : true;
    if (authorized === true) {
      let regex;
      const options = {
        prefixMultiplier: 'MB',
        isDisplayPrefixMultiplier: false,
        precision: 0,
      };
      const dfData = await df(options);

      if (component === null) {
        regex = new RegExp(`_${appname}$`);
      } else {
        regex = new RegExp(`${component}_${appname}$`);
      }
      const matchingEntry = dfData.find((entry) => regex.test(entry.mount));
      if (matchingEntry) {
        const appsResponse = messageHelper.createDataMessage(matchingEntry.available);
        return res ? res.json(appsResponse) : appsResponse;
      }
      const errorResponse = messageHelper.createErrorMessage('No matching entry found');
      return res ? res.json(errorResponse) : errorResponse;
    // eslint-disable-next-line no-else-return
    } else {
      const errorResponse = messageHelper.errUnauthorizedMessage();
      return res ? res.json(errorResponse) : errorResponse;
    }
  } catch (error) {
    log.error(error);
    const errorResponse = messageHelper.createErrorMessage(
      error.message || error,
      error.name,
      error.code,
    );
    return res ? res.json(errorResponse) : errorResponse;
  }
}

module.exports = {
  getAvailableSpaceOfApp,
};
