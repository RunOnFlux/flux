/**
 * Node Connectivity Service
 *
 * This service monitors node connectivity and detects when nodes go down.
 * - Runs every 10 minutes to check a random node location
 * - Implements retry logic with 5-minute delay
 * - Removes offline nodes from database
 * - Broadcasts 'nodedown' messages to peers
 */

const net = require('net');
const config = require('config');
const log = require('../lib/log');
const dbHelper = require('./dbHelper');
const fluxCommunicationMessagesSender = require('./fluxCommunicationMessagesSender');
const serviceHelper = require('./serviceHelper');
const messageHelper = require('./messageHelper');
const {
  outgoingPeers, incomingPeers,
} = require('./utils/establishedConnections');

const globalAppsLocations = config.database.appsglobal.collections.appsLocations;

let connectivityInterval = null;
let isServiceRunning = false;

/**
 * Check if a node is reachable via TCP connection
 * @param {string} ip - Node IP address
 * @param {number} port - Node port
 * @param {number} timeout - Connection timeout in milliseconds
 * @returns {Promise<boolean>} - True if node is reachable, false otherwise
 */
async function checkNodeConnectivity(ip, port, timeout = 5000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isResolved = false;

    const cleanup = () => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
      }
    };

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      if (!isResolved) {
        isResolved = true;
        socket.end();
        resolve(true);
      }
    });

    socket.on('error', () => {
      cleanup();
      resolve(false);
    });

    socket.on('timeout', () => {
      cleanup();
      resolve(false);
    });

    try {
      socket.connect(port, ip);
    } catch (error) {
      cleanup();
      resolve(false);
    }
  });
}

/**
 * Get a random app location from database
 * @returns {Promise<object|null>} - Random app location or null if none found
 */
async function getRandomAppLocation() {
  try {
    const database = dbHelper.databaseConnection();
    const pipeline = [
      { $sample: { size: 1 } },
      { $project: { ip: 1, name: 1, hash: 1 } },
    ];

    const locations = await dbHelper.aggregateInDatabase(database, globalAppsLocations, pipeline);
    return locations.length > 0 ? locations[0] : null;
  } catch (error) {
    log.error(`nodeConnectivityService: Error getting random app location: ${error.message}`);
    return null;
  }
}

/**
 * Remove all app locations for a specific IP from database
 * @param {string} ip - IP address to remove
 * @returns {Promise<number>} - Number of removed documents
 */
async function removeAppLocationsByIp(ip) {
  try {
    const database = dbHelper.databaseConnection();
    const result = await dbHelper.removeDocumentsFromCollection(database, globalAppsLocations, { ip });
    log.info(`nodeConnectivityService: Removed ${result.deletedCount} app locations for IP ${ip}`);
    return result.deletedCount;
  } catch (error) {
    log.error(`nodeConnectivityService: Error removing app locations for IP ${ip}: ${error.message}`);
    return 0;
  }
}

/**
 * API endpoint for peers to check if they can reach a specific node
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
async function checkNodeConnectivityApi(req, res) {
  try {
    const { ip, port = 16127, timeout = 5000 } = req.params.ip ? req.params : req.body;

    if (!ip) {
      const errMessage = messageHelper.createErrorMessage('Missing required parameter: ip');
      return res.json(errMessage);
    }

    log.info(`nodeConnectivityService: API request to check connectivity for ${ip}:${port}`);
    const isReachable = await checkNodeConnectivity(ip, port, timeout);

    const message = messageHelper.createDataMessage({
      ip,
      port,
      reachable: isReachable,
      checkedAt: Date.now(),
    });

    return res.json(message);
  } catch (error) {
    log.error(`nodeConnectivityService: Error in API connectivity check: ${error.message}`);
    const errMessage = messageHelper.createErrorMessage(`Failed to check connectivity: ${error.message}`);
    return res.json(errMessage);
  }
}

/**
 * Ask random peers to verify if they can reach a node
 * @param {string} ip - IP address to check
 * @param {number} port - Port to check
 * @returns {Promise<boolean>} - True if any peer reports node as reachable
 */
async function askPeersToVerifyNode(ip, port = 16127) {
  try {
    // Get 3 random outgoing peers
    const randomOutgoing = serviceHelper.getRandomElements(outgoingPeers, 3);
    // Get 3 random incoming peers
    const randomIncoming = serviceHelper.getRandomElements(incomingPeers, 3);

    const allPeers = [...randomOutgoing, ...randomIncoming];

    if (allPeers.length === 0) {
      log.warn('nodeConnectivityService: No peers available for verification');
      return false;
    }

    log.info(`nodeConnectivityService: Asking ${allPeers.length} peers to verify connectivity for ${ip}:${port}`);

    // Check peers one at a time - return early if any reports node as reachable
    for (const peer of allPeers) {
      try {
        const peerUrl = `http://${peer.ip}:16127/flux/checkconnectivity`;
        const response = await serviceHelper.axiosPost(peerUrl, { ip, port }, {
          timeout: 10000,
        });

        if (response.data && response.data.status === 'success' && response.data.data) {
          const isReachable = response.data.data.reachable;
          log.info(`nodeConnectivityService: Peer ${peer.ip} reports ${ip} as ${isReachable ? 'reachable' : 'unreachable'}`);

          if (isReachable) {
            log.info(`nodeConnectivityService: Early return - peer ${peer.ip} confirms ${ip} is reachable`);
            return true;
          }
        } else {
          log.warn(`nodeConnectivityService: Invalid response from peer ${peer.ip}`);
        }
      } catch (error) {
        log.warn(`nodeConnectivityService: Failed to contact peer ${peer.ip}: ${error.message}`);
      }
    }

    log.info(`nodeConnectivityService: All contacted peers report ${ip} as unreachable`);
    return false;
  } catch (error) {
    log.error(`nodeConnectivityService: Error during peer verification: ${error.message}`);
    return false;
  }
}

/**
 * Broadcast nodedown message to all peers
 * @param {string} ip - IP of the node that is down
 */
async function broadcastNodeDownMessage(ip) {
  try {
    const nodeDownMessage = {
      type: 'nodedown',
      ip,
      broadcastAt: Date.now(),
    };

    log.info(`nodeConnectivityService: Broadcasting nodedown message for IP ${ip}`);
    await fluxCommunicationMessagesSender.broadcastMessageToOutgoing(nodeDownMessage);
    await fluxCommunicationMessagesSender.broadcastMessageToIncoming(nodeDownMessage);
  } catch (error) {
    log.error(`nodeConnectivityService: Error broadcasting nodedown message for IP ${ip}: ${error.message}`);
  }
}

/**
 * Check connectivity for a specific node with retry logic and peer verification
 * @param {object} location - App location object with ip property
 * @returns {Promise<boolean>} - True if node is reachable after retries
 */
async function checkNodeWithRetry(location) {
  const { ip } = location;
  const port = 16127; // Default Flux API port

  log.info(`nodeConnectivityService: Checking connectivity for node ${ip}:${port}`);

  // First connectivity check
  const firstCheck = await checkNodeConnectivity(ip, port);
  if (firstCheck) {
    log.info(`nodeConnectivityService: Node ${ip} is reachable`);
    return true;
  }

  log.warn(`nodeConnectivityService: Node ${ip} not reachable, waiting 5 minutes for retry`);

  // Wait 5 minutes before retry
  await serviceHelper.delay(5 * 60 * 1000);

  // Check if location still exists in database before second connectivity check
  try {
    const database = dbHelper.databaseConnection();
    const locationStillExists = await dbHelper.findOneInDatabase(database, globalAppsLocations, { ip });
    
    if (!locationStillExists) {
      log.info(`nodeConnectivityService: Location for IP ${ip} no longer exists in database, skipping further checks`);
      return true; // Return true to prevent removal since it's already gone
    }
  } catch (error) {
    log.error(`nodeConnectivityService: Error checking location existence for IP ${ip}: ${error.message}`);
    // Continue with connectivity check if database check fails
  }

  // Second connectivity check
  const secondCheck = await checkNodeConnectivity(ip, port);
  if (secondCheck) {
    log.info(`nodeConnectivityService: Node ${ip} is reachable after retry`);
    return true;
  }

  log.warn(`nodeConnectivityService: Node ${ip} still unreachable after retry, asking peers to verify`);

  // Ask peers to verify if they can reach the node
  const peerVerification = await askPeersToVerifyNode(ip, port);
  if (peerVerification) {
    log.info(`nodeConnectivityService: Peers report node ${ip} as reachable, not marking as down`);
    return true;
  }

  log.error(`nodeConnectivityService: Node ${ip} confirmed as unreachable by peers`);
  return false;
}

/**
 * Main connectivity monitoring function
 */
async function performConnectivityCheck() {
  if (isServiceRunning) {
    log.info('nodeConnectivityService: Connectivity check already running, skipping');
    return;
  }

  isServiceRunning = true;

  try {
    log.info('nodeConnectivityService: Starting connectivity check');

    const randomLocation = await getRandomAppLocation();
    if (!randomLocation) {
      log.info('nodeConnectivityService: No app locations found in database');
      return;
    }

    const isReachable = await checkNodeWithRetry(randomLocation);

    if (!isReachable) {
      const removedCount = await removeAppLocationsByIp(randomLocation.ip);
      if (removedCount > 0) {
        await broadcastNodeDownMessage(randomLocation.ip);
      }
    }
  } catch (error) {
    log.error(`nodeConnectivityService: Error during connectivity check: ${error.message}`);
  } finally {
    isServiceRunning = false;
  }
}

/**
 * Start the connectivity monitoring service
 */
function startConnectivityMonitoring() {
  if (connectivityInterval) {
    log.warn('nodeConnectivityService: Service already running');
    return;
  }

  log.info('nodeConnectivityService: Starting connectivity monitoring service (10-minute intervals)');

  // Run immediately on start
  setImmediate(() => performConnectivityCheck());

  // Then run every 10 minutes
  connectivityInterval = setInterval(() => {
    performConnectivityCheck();
  }, 10 * 60 * 1000); // 10 minutes
}

/**
 * Stop the connectivity monitoring service
 */
function stopConnectivityMonitoring() {
  if (connectivityInterval) {
    clearInterval(connectivityInterval);
    connectivityInterval = null;
    log.info('nodeConnectivityService: Connectivity monitoring service stopped');
  }
}

/**
 * Get service status
 * @returns {object} - Service status information
 */
function getServiceStatus() {
  return {
    isRunning: connectivityInterval !== null,
    isPerformingCheck: isServiceRunning,
  };
}

module.exports = {
  startConnectivityMonitoring,
  stopConnectivityMonitoring,
  performConnectivityCheck,
  checkNodeConnectivity,
  checkNodeConnectivityApi,
  askPeersToVerifyNode,
  getServiceStatus,
  removeAppLocationsByIp,
  broadcastNodeDownMessage,
};
