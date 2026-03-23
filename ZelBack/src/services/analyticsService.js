const config = require('config');
const axios = require('axios');
const log = require('../lib/log');
const fluxNetworkHelper = require('./fluxNetworkHelper');

// Buffer: Map<zelidauthString, Array<event>>
let eventBuffer = new Map();
let bufferTotal = 0;
let isFlushing = false;
let consecutiveFailures = 0;
let lastFailureTime = 0;
let cachedNodeIp = null;

const MAX_BUFFER_SIZE = 10000;
const FLUSH_INTERVAL = 5000;
const FLUSH_THRESHOLD = 15;
const REQUEST_TIMEOUT = 10000;
const MAX_BACKOFF = 300000; // 5 minutes
const NODE_IP_REFRESH_INTERVAL = 600000; // 10 minutes

/**
 * Get the analytics URL from config. Returns empty string if disabled.
 */
function getAnalyticsUrl() {
  try {
    return config.analytics.url || '';
  } catch {
    return '';
  }
}

/**
 * Refresh cached node IP address.
 */
async function refreshNodeIp() {
  try {
    const ip = await fluxNetworkHelper.getMyFluxIPandPort();
    if (ip) {
      cachedNodeIp = ip;
    }
  } catch (error) {
    log.warn(`Analytics: failed to get node IP: ${error.message}`);
  }
}

/**
 * Add an event to the buffer, keyed by zelidauth string.
 * @param {string} zelidauth - Raw zelidauth header string
 * @param {object} event - Event data
 */
function addEvent(zelidauth, event) {
  if (bufferTotal >= MAX_BUFFER_SIZE) {
    // Drop oldest events from the largest group
    let largestKey = null;
    let largestSize = 0;
    for (const [key, events] of eventBuffer) {
      if (events.length > largestSize) {
        largestSize = events.length;
        largestKey = key;
      }
    }
    if (largestKey) {
      const dropped = eventBuffer.get(largestKey).shift();
      bufferTotal--;
      if (dropped) {
        log.warn('Analytics: buffer full, dropped oldest event');
      }
    }
  }

  if (!eventBuffer.has(zelidauth)) {
    eventBuffer.set(zelidauth, []);
  }
  eventBuffer.get(zelidauth).push(event);
  bufferTotal++;

  if (bufferTotal >= FLUSH_THRESHOLD && !isFlushing) {
    flushEvents();
  }
}

/**
 * Flush buffered events to the analytics server.
 * Groups events by zelidauth and sends each group with the user's own auth.
 */
async function flushEvents() {
  const analyticsUrl = getAnalyticsUrl();
  if (!analyticsUrl || isFlushing || eventBuffer.size === 0) return;

  // Exponential backoff check
  if (consecutiveFailures > 0) {
    const backoffMs = Math.min(FLUSH_INTERVAL * (2 ** consecutiveFailures), MAX_BACKOFF);
    if (Date.now() - lastFailureTime < backoffMs) return;
  }

  isFlushing = true;

  // Atomic swap — new events during flush go to fresh Map
  const snapshot = eventBuffer;
  eventBuffer = new Map();
  bufferTotal = 0;

  let anyFailed = false;

  try {
    const promises = [];

    for (const [zelidauth, events] of snapshot) {
      // Analytics server caps at 100 events per batch — chunk to avoid silent truncation
      for (let i = 0; i < events.length; i += 100) {
        const chunk = events.slice(i, i + 100);
        const promise = axios.post(
          `${analyticsUrl}/api/v1/events`,
          { events: chunk },
          {
            headers: { zelidauth },
            timeout: REQUEST_TIMEOUT,
          },
        ).catch((error) => {
          log.warn(`Analytics: flush failed for batch of ${chunk.length} events: ${error.message}`);
          anyFailed = true;

          // Re-merge failed chunk back into current buffer
          if (eventBuffer.has(zelidauth)) {
            const current = eventBuffer.get(zelidauth);
            eventBuffer.set(zelidauth, [...chunk, ...current]);
          } else {
            eventBuffer.set(zelidauth, [...chunk]);
          }
          bufferTotal += chunk.length;
        });

        promises.push(promise);
      }
    }

    await Promise.allSettled(promises);

    if (anyFailed) {
      consecutiveFailures++;
      lastFailureTime = Date.now();
      const backoffMs = Math.min(FLUSH_INTERVAL * (2 ** consecutiveFailures), MAX_BACKOFF);
      log.warn(`Analytics: ${consecutiveFailures} consecutive failures, next retry in ${Math.round(backoffMs / 1000)}s`);
    } else {
      if (consecutiveFailures > 0) {
        log.info('Analytics: flush recovered after failures');
      }
      consecutiveFailures = 0;
    }
  } finally {
    isFlushing = false;
  }
}

/**
 * Express middleware that captures request/response metadata for analytics.
 * Non-blocking — calls next() immediately, records on res 'finish'.
 */
function analyticsMiddleware(req, res, next) {
  const analyticsUrl = getAnalyticsUrl();
  if (!analyticsUrl) {
    next();
    return;
  }

  const startTime = Date.now();

  res.on('finish', () => {
    try {
      const zelidauth = req.headers.zelidauth;
      if (!zelidauth) return; // unauthenticated requests not tracked

      const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;

      const event = {
        apiEndpoint: req.originalUrl || req.url,
        httpMethod: req.method,
        responseCode: res.statusCode,
        responseStatus: res.statusCode < 400 ? 'success' : 'error',
        responseTimeMs: Date.now() - startTime,
        nodeIp: cachedNodeIp,
        ipAddress: clientIp,
        timestamp: new Date().toISOString(),
      };

      addEvent(zelidauth, event);
    } catch (error) {
      log.warn(`Analytics middleware error: ${error.message}`);
    }
  });

  next();
}

/**
 * Track terminal session open/close events.
 * @param {string} zelidauth - Raw zelidauth string from the socket event
 * @param {string} appName - Application name
 * @param {string} action - 'open' or 'close'
 * @param {string} [ipAddress] - Client IP address
 */
function trackTerminalSession(zelidauth, appName, action, ipAddress) {
  const analyticsUrl = getAnalyticsUrl();
  if (!analyticsUrl || !zelidauth) return;

  const event = {
    apiEndpoint: `/terminal/${action}/${appName}`,
    httpMethod: 'WS',
    responseCode: 200,
    responseStatus: 'success',
    responseTimeMs: 0,
    nodeIp: cachedNodeIp,
    ipAddress: ipAddress || null,
    timestamp: new Date().toISOString(),
  };

  addEvent(zelidauth, event);
}

/**
 * Start the analytics flush timer and cache node IP.
 * Call once at server startup.
 */
function startFlushTimer() {
  const analyticsUrl = getAnalyticsUrl();
  if (!analyticsUrl) {
    log.info('Analytics: disabled (no analytics.url configured)');
    return;
  }

  log.info(`Analytics: enabled, sending events to ${analyticsUrl}`);

  // Cache node IP and refresh periodically
  refreshNodeIp();
  setInterval(refreshNodeIp, NODE_IP_REFRESH_INTERVAL);

  // Start flush timer
  setInterval(flushEvents, FLUSH_INTERVAL);
}

module.exports = {
  analyticsMiddleware,
  trackTerminalSession,
  startFlushTimer,
};
