import crypto from 'crypto'
import net from 'net'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const MAX_BUCKETS = 10_000
const SWEEP_INTERVAL_MS = 60_000
const buckets = new Map()
let nextSweepAt = 0

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function validIp(value) {
  const candidate = String(value || '').trim()
  return net.isIP(candidate) ? candidate : null
}

// Client IPs come from CF-Connecting-IP, X-Real-IP or the last X-Forwarded-For entry. Entries a client
// sends itself come first in X-Forwarded-For and can be forged; the proxy in front of the app appends
// the address it actually saw, so the last entry is the one to trust. Run the app behind a proxy that
// sets one of these headers, or set TRUST_PROXY_HEADERS=false to always use the socket address.
export function getClientIp(req) {
  if (process.env.TRUST_PROXY_HEADERS !== 'false') {
    const cloudflareIp = validIp(firstHeaderValue(req.headers['cf-connecting-ip']))
    if (cloudflareIp) return cloudflareIp

    const realIp = validIp(firstHeaderValue(req.headers['x-real-ip']))
    if (realIp) return realIp

    const forwarded = String(firstHeaderValue(req.headers['x-forwarded-for']) || '')
      .split(',')
      .map(validIp)
      .filter(Boolean)
    if (forwarded.length > 0) return forwarded[forwarded.length - 1]
  }

  return req.socket?.remoteAddress || 'unknown'
}

// One person can rotate through a whole IPv6 /64, so those addresses share a rate-limit bucket.
export function getRateLimitSubject(ip) {
  const address = String(ip || 'unknown').replace(/^::ffff:/i, '')
  if (!net.isIPv6(address)) return address

  const [head, tail = ''] = address.split('::')
  const headGroups = head ? head.split(':') : []
  const tailGroups = tail ? tail.split(':') : []
  const missing = 8 - headGroups.length - tailGroups.length
  const groups = address.includes('::')
    ? [...headGroups, ...Array(Math.max(missing, 0)).fill('0'), ...tailGroups]
    : headGroups

  return `${groups.slice(0, 4).map(group => group.toLowerCase().padStart(4, '0')).join(':')}::/64`
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

// Expired buckets are never read again, so without this the map would grow with every new client.
function sweepBuckets(now) {
  if (now < nextSweepAt && buckets.size < MAX_BUCKETS) return
  nextSweepAt = now + SWEEP_INTERVAL_MS

  for (const [bucketKey, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(bucketKey)
  }

  // Still full of live buckets: drop the oldest (Map iterates in insertion order).
  for (const bucketKey of buckets.keys()) {
    if (buckets.size < MAX_BUCKETS) break
    buckets.delete(bucketKey)
  }
}

export function applyRateLimit(req, res, { key, max = 20, windowMs = 60_000 } = {}) {
  const now = Date.now()
  sweepBuckets(now)

  const bucketKey = `${key || 'global'}:${getRateLimitSubject(getClientIp(req))}`
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

// Constant-time comparison for secrets typed by a user. Hashing first makes the lengths equal.
export function secretsMatch(provided, expected) {
  const digest = value => crypto.createHash('sha256').update(String(value ?? '')).digest()
  return crypto.timingSafeEqual(digest(provided), digest(expected))
}

// First-run setup creates the admin account for whoever gets there first. When SETUP_TOKEN is set,
// the person finishing setup has to know it.
export function isSetupTokenRequired() {
  return Boolean(process.env.SETUP_TOKEN)
}

export function isSetupTokenValid(provided) {
  if (!isSetupTokenRequired()) return true
  return typeof provided === 'string' && secretsMatch(provided.trim(), process.env.SETUP_TOKEN)
}

export function protectMutation(req, res, rateLimitOptions) {
  return requireSameOrigin(req, res) && applyRateLimit(req, res, rateLimitOptions)
}

export function resetRateLimitsForTests() {
  buckets.clear()
  nextSweepAt = 0
}

export function rateLimitBucketCountForTests() {
  return buckets.size
}
