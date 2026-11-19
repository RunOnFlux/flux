const sinon = require('sinon');
const appInstaller = require('../../../ZelBack/src/services/appLifecycle/appInstaller');
const generalService = require('../../../ZelBack/src/services/generalService');

/**
 * Starts a real install of `name` through appInstaller and holds it at its tier
 * lookup, after the install has taken its app. Resolves once the install is
 * held there; `finish()` answers the lookup with no tier, so the install
 * declines and ends, and resolves with its outcome.
 *
 * Stubs generalService.nodeTier for as long as the install runs.
 * @param {string} name The app being installed.
 * @returns {Promise<{finish: function(): Promise<string>}>}
 */
async function installInFlight(name) {
  let reachedTier;
  const atTier = new Promise((resolve) => { reachedTier = resolve; });
  let answerTier;
  const nodeTier = sinon.stub(generalService, 'nodeTier').callsFake(() => {
    reachedTier();
    return new Promise((resolve) => { answerTier = resolve; });
  });
  const install = appInstaller.registerAppLocally({ name, version: 3, ports: [] }, false, null);
  await atTier;
  return {
    async finish() {
      answerTier(undefined);
      try {
        return await install;
      } finally {
        nodeTier.restore();
      }
    },
  };
}

module.exports = { installInFlight };
