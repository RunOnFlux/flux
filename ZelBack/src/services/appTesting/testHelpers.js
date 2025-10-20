/**
 * Test Helpers Module
 *
 * This module contains helper functions for testing applications,
 * particularly for cleaning up test resources like ports and servers.
 */

const log = require('../../lib/log');

/**
 * Handle test shutdown - cleanup resources after testing
 * @param {number} testingPort - Port used for testing
 * @param {object} testHttpServer - HTTP server instance used for testing
 * @param {object} options - Shutdown options
 * @param {boolean} options.skipFirewall - Skip firewall rule removal
 * @param {boolean} options.skipUpnp - Skip UPnP port mapping removal
 * @param {boolean} options.skipHttpServer - Skip HTTP server shutdown
 * @param {Function} isFirewallActive - Function to check if firewall is active
 * @param {Function} deleteAllowPortRule - Function to delete firewall port rule
 * @param {Function} removeMapUpnpPort - Function to remove UPnP port mapping
 * @returns {Promise<void>}
 */
async function handleTestShutdown(
  testingPort,
  testHttpServer,
  options,
  isFirewallActive,
  deleteAllowPortRule,
  removeMapUpnpPort,
) {
  const {
    skipFirewall = false,
    skipUpnp = false,
    skipHttpServer = false,
  } = options || {};

  const isArcane = Boolean(process.env.FLUXOS_PATH);

  const updateFirewall = skipFirewall
    ? false
    : isArcane
    || await isFirewallActive().catch(() => true);

  if (updateFirewall) {
    await deleteAllowPortRule(testingPort)
      .catch((e) => log.error(e));
  }

  if (!skipUpnp) {
    await removeMapUpnpPort(testingPort, 'Flux_Test_App')
      .catch((e) => log.error(e));
  }

  if (!skipHttpServer) {
    testHttpServer.close((err) => {
      if (err) {
        log.error(`testHttpServer shutdown failed: ${err.message}`);
      }
    });
  }
}

module.exports = {
  handleTestShutdown,
};
