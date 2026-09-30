// Minimal in-memory sliding-window rate limiter.
//
// No dependency, and single-process — Render runs one instance, so a Map is
// enough. If this ever scales beyond one instance it needs a shared store,
// otherwise each instance keeps its own count.
//
// Added for guest checkout: POST /api/checkout creates an order and deducts
// stock, and it can no longer require a login, so it needs some brake.
function rateLimit({ windowMs = 10 * 60 * 1000, max = 5, message } = {}) {
  const hits = new Map(); // ip -> timestamps of recent requests

  // Drop stale entries so the map can't grow unbounded on a long-lived process
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, times] of hits) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length) hits.set(ip, kept);
      else hits.delete(ip);
    }
  }, windowMs);
  if (sweep.unref) sweep.unref(); // don't hold the process open

  return (req, res, next) => {
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;
    const times = (hits.get(ip) || []).filter((t) => t > cutoff);

    if (times.length >= max) {
      const retryAfter = Math.ceil((times[0] + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: message || 'Too many attempts — please wait a minute and try again.'
      });
    }

    times.push(now);
    hits.set(ip, times);
    next();
  };
}

module.exports = { rateLimit };
