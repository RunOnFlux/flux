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
let flushTimer = null;
let analyticsUrlCached = '';
let initialized = false;

const MAX_BUFFER_SIZE = 5000;
const FLUSH_TIMEOUT = 5000;
const FLUSH_THRESHOLD = 15;
const REQUEST_TIMEOUT = 10000;
const MAX_BACKOFF = 300000; // 5 minutes
const NODE_IP_REFRESH_INTERVAL = 600000; // 10 minutes

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
    // Drop oldest 20% from each group proportionally — keeps fresh events, amortized O(1)
    let dropped = 0;
    for (const [key, events] of eventBuffer) {
      const toDrop = Math.ceil(events.length * 0.2);
      events.splice(0, toDrop);
      dropped += toDrop;
      if (events.length === 0) eventBuffer.delete(key);
    }
    bufferTotal -= dropped;
    log.warn(`Analytics: buffer full, dropped ${dropped} oldest events`);
  }

  if (!eventBuffer.has(zelidauth)) {
    eventBuffer.set(zelidauth, []);
  }
  eventBuffer.get(zelidauth).push(event);
  bufferTotal++;

  if (bufferTotal >= FLUSH_THRESHOLD && !isFlushing) {
    clearTimeout(flushTimer);
    flushTimer = null;
    flushEvents();
  } else if (!flushTimer && !isFlushing) {
    flushTimer = setTimeout(flushEvents, FLUSH_TIMEOUT);
  }
}

/**
 * Flush buffered events to the analytics server.
 * Groups events by zelidauth and sends each group with the user's own auth.
 */
async function flushEvents() {
  clearTimeout(flushTimer);
  flushTimer = null;

  if (!analyticsUrlCached || isFlushing || eventBuffer.size === 0) return;

  // Exponential backoff check — schedule retry at backoff expiry
  if (consecutiveFailures > 0) {
    const backoffMs = Math.min(FLUSH_TIMEOUT * (2 ** consecutiveFailures), MAX_BACKOFF);
    const elapsed = Date.now() - lastFailureTime;
    if (elapsed < backoffMs) {
      flushTimer = setTimeout(flushEvents, backoffMs - elapsed);
      return;
    }
  }

  isFlushing = true;

  // Atomic swap — new events during flush go to fresh Map
  const snapshot = eventBuffer;
  const snapshotTotal = bufferTotal;
  eventBuffer = new Map();
  bufferTotal = 0;

  log.info(`Analytics: flushing ${snapshotTotal} events from ${snapshot.size} users`);

  let anyFailed = false;

  try {
    const promises = [];

    for (const [zelidauth, events] of snapshot) {
      // Analytics server caps at 100 events per batch — chunk to avoid silent truncation
      for (let i = 0; i < events.length; i += 100) {
        const chunk = events.slice(i, i + 100);
        const promise = axios.post(
          `${analyticsUrlCached}/api/v1/events`,
          { events: chunk },
          {
            headers: { zelidauth },
            timeout: REQUEST_TIMEOUT,
          },
        ).catch((error) => {
          const status = error.response?.status;
          if (status && status >= 400 && status < 500 && status !== 429) {
            // 4xx — bad request, retrying won't help, drop batch
            log.warn(`Analytics: dropping ${chunk.length} events (${status} response)`);
            return 0;
          }
          // 5xx, 429, or network error — re-merge for retry if space available
          log.warn(`Analytics: flush failed for ${chunk.length} events: ${error.message}`);
          anyFailed = true;
          const available = MAX_BUFFER_SIZE - bufferTotal;
          if (available > 0) {
            // Keep newest events from failed chunk if only partial space
            const remerge = chunk.length <= available ? chunk : chunk.slice(-available);
            if (eventBuffer.has(zelidauth)) {
              const current = eventBuffer.get(zelidauth);
              eventBuffer.set(zelidauth, [...remerge, ...current]);
            } else {
              eventBuffer.set(zelidauth, [...remerge]);
            }
            bufferTotal += remerge.length;
          }
          return 0;
        });

        promises.push(promise);
      }
    }

    await Promise.allSettled(promises);

    if (anyFailed) {
      consecutiveFailures++;
      lastFailureTime = Date.now();
      const backoffMs = Math.min(FLUSH_TIMEOUT * (2 ** consecutiveFailures), MAX_BACKOFF);
      log.warn(`Analytics: ${consecutiveFailures} consecutive failures, next retry in ${Math.round(backoffMs / 1000)}s`);
    } else {
      if (consecutiveFailures > 0) {
        log.info('Analytics: flush recovered after failures');
      }
      consecutiveFailures = 0;
    }
  } finally {
    isFlushing = false;
    // Schedule flush for events that arrived during flush or were re-merged
    if (eventBuffer.size > 0 && !flushTimer) {
      flushTimer = setTimeout(flushEvents, FLUSH_TIMEOUT);
    }
  }
}

/**
 * Express middleware that captures request/response metadata for analytics.
 * Non-blocking — calls next() immediately, records on res 'finish'.
 */
function analyticsMiddleware(req, res, next) {
  if (!analyticsUrlCached) {
    next();
    return;
  }

  const zelidauth = req.headers.zelidauth;
  if (!zelidauth) {
    next();
    return;
  }

  const startTime = Date.now();

  res.once('finish', () => {
    try {
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

      // For POST endpoints, extract appname from body (parsed by express.json())
      if (req.body) {
        const name = req.body.appname
          || (req.body.appSpecification && typeof req.body.appSpecification === 'object' && req.body.appSpecification.name)
          || null;
        if (name && typeof name === 'string') {
          event.appName = name.toLowerCase();
        }
      }

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
 * @param {string} [component] - Component name for multi-component apps
 */
function trackTerminalSession(zelidauth, appName, action, ipAddress, component) {
  if (!analyticsUrlCached || !zelidauth) return;

  const terminalTarget = component ? `${component}_${appName}` : appName;
  const event = {
    apiEndpoint: `/terminal/${action}/${terminalTarget}`,
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
 * Initialize analytics — cache config and node IP.
 * Call once at server startup.
 */
function startFlushTimer() {
  // Guard against multiple calls (FluxServer creates HTTP + HTTPS instances)
  if (initialized) return;
  initialized = true;

  try {
    analyticsUrlCached = config.analytics.url || '';
  } catch {
    analyticsUrlCached = '';
  }

  if (!analyticsUrlCached) {
    log.info('Analytics: disabled (no analytics.url configured)');
    return;
  }

  log.info(`Analytics: enabled, sending events to ${analyticsUrlCached}`);

  // Cache node IP and refresh periodically
  refreshNodeIp();
  setInterval(refreshNodeIp, NODE_IP_REFRESH_INTERVAL);
}

module.exports = {
  analyticsMiddleware,
  trackTerminalSession,
  startFlushTimer,
};
