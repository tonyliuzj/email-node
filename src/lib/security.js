import crypto from 'crypto'
import net from 'net'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const MAX_BUCKETS = 10_000
const MAX_FAILURE_KEYS = 10_000
const SWEEP_INTERVAL_MS = 60_000
const buckets = new Map()
const failures = new Map()
let nextSweepAt = 0

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function validIp(value) {
  const candidate = String(value || '').trim()
  return net.isIP(candidate) ? candidate : null
}

// Addresses a reverse proxy on the same machine or network connects from. A request that arrives from
// anywhere else did not pass through a proxy of yours, so whatever forwarding headers it carries were typed
// by the client.
const PRIVATE_PEERS = new net.BlockList()
PRIVATE_PEERS.addSubnet('127.0.0.0', 8, 'ipv4')
PRIVATE_PEERS.addSubnet('10.0.0.0', 8, 'ipv4')
PRIVATE_PEERS.addSubnet('172.16.0.0', 12, 'ipv4')
PRIVATE_PEERS.addSubnet('192.168.0.0', 16, 'ipv4')
PRIVATE_PEERS.addSubnet('169.254.0.0', 16, 'ipv4')
PRIVATE_PEERS.addSubnet('100.64.0.0', 10, 'ipv4')
PRIVATE_PEERS.addAddress('::1', 'ipv6')
PRIVATE_PEERS.addSubnet('fc00::', 7, 'ipv6')
PRIVATE_PEERS.addSubnet('fe80::', 10, 'ipv6')

function isPrivatePeer(address) {
  const candidate = String(address || '').replace(/^::ffff:/i, '')
  const family = net.isIP(candidate)
  if (!family) return false
  return PRIVATE_PEERS.check(candidate, family === 6 ? 'ipv6' : 'ipv4')
}

// TRUST_PROXY_HEADERS: "false" never reads forwarding headers, "true" always does, and anything else (the
// default) reads them only when the connection comes from a private address, i.e. a proxy beside the app.
function proxyTrust() {
  const setting = String(process.env.TRUST_PROXY_HEADERS ?? '').trim().toLowerCase()
  if (['false', '0', 'no', 'off'].includes(setting)) return 'never'
  if (['true', '1', 'yes', 'on'].includes(setting)) return 'always'
  return 'auto'
}

const CLIENT_IP_HEADERS = new Set(['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip'])

// Exactly one header is read, never a list of them: with a list, a client can send the one the proxy does not
// overwrite. X-Forwarded-For is the default because every proxy appends to it, so the entry counted from
// the right is the address your own proxy saw. Entries to its left were sent by the client and can be forged.
// Set CLIENT_IP_HEADER=cf-connecting-ip behind Cloudflare, and TRUSTED_PROXY_HOPS when more than one proxy
// of yours appends to X-Forwarded-For.
function forwardedAddress(req) {
  const configured = String(process.env.CLIENT_IP_HEADER || '').trim().toLowerCase()
  const header = CLIENT_IP_HEADERS.has(configured) ? configured : 'x-forwarded-for'
  const value = String(firstHeaderValue(req.headers[header]) || '')

  if (header !== 'x-forwarded-for') return validIp(value)

  const hops = Math.max(1, Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '', 10) || 1)
  const entries = value.split(',').map(entry => entry.trim()).filter(Boolean)
  if (entries.length === 0) return null
  return validIp(entries[Math.max(0, entries.length - hops)])
}

export function getClientIp(req) {
  const socketAddress = req.socket?.remoteAddress || 'unknown'
  const trust = proxyTrust()

  if (trust === 'never') return socketAddress
  if (trust === 'auto' && !isPrivatePeer(socketAddress)) return socketAddress

  return forwardedAddress(req) || socketAddress
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

// Per-account failure counting, independent of the client IP. The per-IP limit stops one machine, but
// not many machines guessing the same account, so repeated failures lock that account for a while.
function pruneFailures(now) {
  for (const [key, entry] of failures) {
    if (entry.resetAt <= now) failures.delete(key)
  }
  for (const key of failures.keys()) {
    if (failures.size < MAX_FAILURE_KEYS) break
    failures.delete(key)
  }
}

export function isLockedOut(key, { max = 8 } = {}) {
  const entry = failures.get(key)
  return Boolean(entry) && entry.resetAt > Date.now() && entry.count >= max
}

export function recordFailure(key, { windowMs = 15 * 60_000 } = {}) {
  const now = Date.now()
  const entry = failures.get(key)

  if (!entry || entry.resetAt <= now) {
    if (failures.size >= MAX_FAILURE_KEYS) pruneFailures(now)
    failures.set(key, { count: 1, resetAt: now + windowMs })
    return 1
  }

  entry.count += 1
  return entry.count
}

export function clearFailures(key) {
  failures.delete(key)
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
  failures.clear()
  nextSweepAt = 0
}

export function rateLimitBucketCountForTests() {
  return buckets.size
}
