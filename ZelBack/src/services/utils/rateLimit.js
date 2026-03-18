const cacheManager = require('./cacheManager').default;

const lruRateCache = cacheManager.rateLimitCache;

/**
 * Rate limit inbound / outbound messages on websockets. Using buckets, you
 * can only send limitPerSecond messages every second. If you go over, you are
 * limited for the rest of the second.
 * @param {string} ip IP address.
 * @param {number} limitPerSecond Defaults to value of 20
 * @returns {boolean} True if a ip is allowed to do a request, otherwise false
 */
function lruRateLimit(ip, limitPerSecond = 20) {
  const rateLimit = lruRateCache.get(ip);
  const now = process.hrtime.bigint();

  if (!rateLimit) {
    const limit = {
      lastUpdate: now,
      tokenBucket: limitPerSecond,
    };
    lruRateCache.set(ip, limit);

    return true;
  }

  const { lastUpdate, tokenBucket } = rateLimit;

  const elapsedMs = Number(now - lastUpdate) / 1_000_000;

  // This splits the token allocation into buckets. So you literally get 120
  // tokens once every second. For 120 tokens per second, this means you can
  // send one req every 8ms, and you will never run out of tokens. If you move
  // down to 7ms, you will get rate limited for the last part of the second, until
  // you get more tokens, if you send @ 6ms, you would get rate limited for more
  // of the second, etc.
  if (elapsedMs >= 1_000) {
    rateLimit.tokenBucket = limitPerSecond;
    rateLimit.lastUpdate = now;
  }

  if (rateLimit.tokenBucket < 0) {
    // We don't remove any tokens if rate limited
    return false;
  }

  // we log on the trigger edge only
  if (tokenBucket === 0) {
    const remaining = Math.round(((1_000 - elapsedMs) + Number.EPSILON) * 100) / 100;
    console.log(`${ip}: Rate Limited for: ${remaining} ms`);
  }

  rateLimit.tokenBucket -= 1;

  return true;
}

module.exports = { lruRateLimit };
