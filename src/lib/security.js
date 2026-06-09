const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const buckets = new Map()

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value
}

export function getClientIp(req) {
  const forwardedFor = firstHeaderValue(req.headers['x-forwarded-for'])
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}

export function requireSameOrigin(req, res) {
  if (!MUTATING_METHODS.has(req.method)) return true

  const host = firstHeaderValue(req.headers['x-forwarded-host']) || firstHeaderValue(req.headers.host)
  const origin = firstHeaderValue(req.headers.origin)
  const fetchSite = firstHeaderValue(req.headers['sec-fetch-site'])

  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        res.status(403).json({ error: 'Cross-origin request blocked' })
        return false
      }
      return true
    } catch {
      res.status(403).json({ error: 'Invalid origin header' })
      return false
    }
  }

  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
    res.status(403).json({ error: 'Cross-origin request blocked' })
    return false
  }

  return true
}

export function applyRateLimit(req, res, { key, max = 20, windowMs = 60_000 } = {}) {
  const now = Date.now()
  const bucketKey = `${key || 'global'}:${getClientIp(req)}`
  const bucket = buckets.get(bucketKey)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs })
    return true
  }

  bucket.count += 1
  if (bucket.count > max) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    res.setHeader('Retry-After', String(retryAfter))
    res.status(429).json({ error: 'Too many requests. Please try again later.' })
    return false
  }

  return true
}

export function protectMutation(req, res, rateLimitOptions) {
  return requireSameOrigin(req, res) && applyRateLimit(req, res, rateLimitOptions)
}

export function resetRateLimitsForTests() {
  buckets.clear()
}
