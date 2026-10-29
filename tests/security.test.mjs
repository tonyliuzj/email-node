import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyRateLimit,
  getClientIp,
  getRateLimitSubject,
  isSetupTokenValid,
  rateLimitBucketCountForTests,
  resetRateLimitsForTests,
  secretsMatch,
} from '../src/lib/security.js'
import { createRequest, createResponse } from './helpers.mjs'

test.beforeEach(() => {
  resetRateLimitsForTests()
  delete process.env.TRUST_PROXY_HEADERS
  delete process.env.SETUP_TOKEN
})

test('client IP prefers the headers a trusted proxy sets', () => {
  const socketOnly = createRequest({ ip: '10.0.0.1' })
  assert.equal(getClientIp(socketOnly), '10.0.0.1')

  assert.equal(getClientIp(createRequest({ headers: { 'cf-connecting-ip': '198.51.100.4' } })), '198.51.100.4')
  assert.equal(getClientIp(createRequest({ headers: { 'x-real-ip': '198.51.100.5' } })), '198.51.100.5')
  assert.equal(
    getClientIp(createRequest({ headers: { 'cf-connecting-ip': '198.51.100.4', 'x-real-ip': '198.51.100.5' } })),
    '198.51.100.4'
  )
})

test('client IP uses the LAST X-Forwarded-For entry, which the proxy added, not the first, which the client can forge', () => {
  const req = createRequest({ headers: { 'x-forwarded-for': '6.6.6.6, 198.51.100.9' } })
  assert.equal(getClientIp(req), '198.51.100.9')
})

test('client IP ignores values that are not IP addresses', () => {
  const req = createRequest({ ip: '10.0.0.1', headers: { 'x-real-ip': 'not-an-ip', 'x-forwarded-for': 'evil, <script>' } })
  assert.equal(getClientIp(req), '10.0.0.1')
})

test('TRUST_PROXY_HEADERS=false always uses the socket address', () => {
  process.env.TRUST_PROXY_HEADERS = 'false'
  const req = createRequest({
    ip: '10.0.0.1',
    headers: { 'cf-connecting-ip': '198.51.100.4', 'x-forwarded-for': '198.51.100.9' },
  })
  assert.equal(getClientIp(req), '10.0.0.1')
})

test('forging X-Forwarded-For cannot dodge the rate limit', () => {
  const limit = { key: 'forge', max: 3, windowMs: 60_000 }
  const results = []

  for (let attempt = 0; attempt < 6; attempt += 1) {
    // Different forged first entry every time; the proxy-appended last entry never changes.
    const req = createRequest({ headers: { 'x-forwarded-for': `1.1.1.${attempt}, 198.51.100.9` } })
    results.push(applyRateLimit(req, createResponse(), limit))
  }

  assert.deepEqual(results, [true, true, true, false, false, false])
})

test('rate limit answers 429 with Retry-After', () => {
  const limit = { key: 'retry', max: 1, windowMs: 60_000 }
  const req = createRequest()
  assert.equal(applyRateLimit(req, createResponse(), limit), true)

  const res = createResponse()
  assert.equal(applyRateLimit(req, res, limit), false)
  assert.equal(res.statusCode, 429)
  assert.ok(Number(res.getHeader('retry-after')) >= 1)
})

test('addresses in the same IPv6 /64 share one rate-limit bucket', () => {
  assert.equal(getRateLimitSubject('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), getRateLimitSubject('2001:db8:1:2::1'))
  assert.notEqual(getRateLimitSubject('2001:db8:1:2::1'), getRateLimitSubject('2001:db8:1:3::1'))
  assert.equal(getRateLimitSubject('2001:DB8:1:2::1'), '2001:0db8:0001:0002::/64')
})

test('IPv4 and IPv4-mapped IPv6 addresses are limited per address', () => {
  assert.equal(getRateLimitSubject('203.0.113.7'), '203.0.113.7')
  assert.equal(getRateLimitSubject('::ffff:203.0.113.7'), '203.0.113.7')
  assert.notEqual(getRateLimitSubject('203.0.113.7'), getRateLimitSubject('203.0.113.8'))
})

test('the rate-limit map stays bounded when flooded with distinct clients', () => {
  const limit = { key: 'flood', max: 5, windowMs: 60_000 }

  for (let index = 0; index < 25_000; index += 1) {
    const req = createRequest({ ip: `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}` })
    applyRateLimit(req, createResponse(), limit)
  }

  assert.ok(rateLimitBucketCountForTests() <= 10_000, `map grew to ${rateLimitBucketCountForTests()}`)
})

test('when the map is full, expired buckets are swept rather than live ones dropped', async () => {
  const limit = { key: 'expire', max: 5, windowMs: 1 }
  const ipFor = index => `172.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`

  for (let index = 0; index < 10_000; index += 1) {
    applyRateLimit(createRequest({ ip: ipFor(index) }), createResponse(), limit)
  }
  assert.equal(rateLimitBucketCountForTests(), 10_000)
  await new Promise(resolve => setTimeout(resolve, 10))

  // The map is at its cap, so this call sweeps; every bucket above has expired by now.
  applyRateLimit(createRequest({ ip: '192.0.2.1' }), createResponse(), { key: 'live', max: 5, windowMs: 60_000 })

  assert.ok(rateLimitBucketCountForTests() <= 2, `map still holds ${rateLimitBucketCountForTests()} buckets`)
})

test('secretsMatch compares in constant time and handles different lengths', () => {
  assert.equal(secretsMatch('abc', 'abc'), true)
  assert.equal(secretsMatch('abc', 'abd'), false)
  assert.equal(secretsMatch('abc', 'abcd'), false)
  assert.equal(secretsMatch(undefined, 'abc'), false)
})

test('setup token is only enforced when SETUP_TOKEN is set', () => {
  assert.equal(isSetupTokenValid(undefined), true)

  process.env.SETUP_TOKEN = 'correct-token'
  assert.equal(isSetupTokenValid(undefined), false)
  assert.equal(isSetupTokenValid(''), false)
  assert.equal(isSetupTokenValid('wrong'), false)
  assert.equal(isSetupTokenValid(42), false)
  assert.equal(isSetupTokenValid('correct-token'), true)
  assert.equal(isSetupTokenValid('  correct-token  '), true)
})
