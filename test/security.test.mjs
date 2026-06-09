import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sanitizeEmailHtml } from '../src/lib/email-sanitizer.js'
import {
  buildEmailAddress,
  normalizeAdminPath,
  normalizeDomainName,
  normalizeEmailAddress,
  normalizeEmailLocalPart,
  normalizeHost,
  normalizePort,
} from '../src/lib/validation.js'
import {
  applyRateLimit,
  requireSameOrigin,
  resetRateLimitsForTests,
} from '../src/lib/security.js'

function makeReq(headers = {}, method = 'POST') {
  return {
    method,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
  }
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
    setHeader(name, value) {
      this.headers[name] = value
    },
  }
}

describe('validation helpers', () => {
  it('normalizes safe domains, local parts, and addresses', () => {
    assert.equal(normalizeDomainName(' Example.COM '), 'example.com')
    assert.equal(normalizeEmailLocalPart('User.Name-1'), 'user.name-1')
    assert.equal(normalizeEmailAddress(' User.Name-1@Example.COM '), 'user.name-1@example.com')
    assert.equal(buildEmailAddress('Inbox_1', 'Example.com'), 'inbox_1@example.com')
  })

  it('rejects malformed domains, addresses, hosts, ports, and admin paths', () => {
    assert.equal(normalizeDomainName('example..com'), null)
    assert.equal(normalizeDomainName('-example.com'), null)
    assert.equal(normalizeEmailLocalPart('.start'), null)
    assert.equal(normalizeEmailAddress('not-an-email'), null)
    assert.equal(normalizeHost('imap.example.com/path'), null)
    assert.equal(normalizePort('70000'), null)
    assert.equal(normalizeAdminPath('../admin'), null)
  })
})

describe('email sanitizer', () => {
  it('removes scripts, event handlers, unsafe URLs, and unsafe attributes', () => {
    const sanitized = sanitizeEmailHtml(`
      <div onclick="alert(1)">
        <script>alert(1)</script>
        <a href="javascript:alert(1)">bad link</a>
        <img src="https://example.com/image.png" onerror="alert(1)" />
      </div>
    `)

    assert.equal(sanitized.includes('<script'), false)
    assert.equal(sanitized.includes('onclick'), false)
    assert.equal(sanitized.includes('onerror'), false)
    assert.equal(sanitized.includes('javascript:'), false)
    assert.equal(sanitized.includes('https://example.com/image.png'), true)
  })

  it('adds safe link attributes to anchors', () => {
    const sanitized = sanitizeEmailHtml('<a href="https://example.com">example</a>')

    assert.equal(sanitized.includes('rel="noopener noreferrer"'), true)
    assert.equal(sanitized.includes('target="_blank"'), true)
  })
})

describe('security helpers', () => {
  it('allows same-origin mutation requests', () => {
    const res = makeRes()
    const allowed = requireSameOrigin(makeReq({
      host: 'example.com',
      origin: 'https://example.com',
    }), res)

    assert.equal(allowed, true)
    assert.equal(res.statusCode, 200)
  })

  it('blocks cross-origin mutation requests', () => {
    const res = makeRes()
    const allowed = requireSameOrigin(makeReq({
      host: 'example.com',
      origin: 'https://evil.example',
    }), res)

    assert.equal(allowed, false)
    assert.equal(res.statusCode, 403)
  })

  it('rate limits by key and client IP', () => {
    resetRateLimitsForTests()

    const first = makeRes()
    const second = makeRes()
    const req = makeReq({ 'x-forwarded-for': '203.0.113.10' })

    assert.equal(applyRateLimit(req, first, { key: 'test', max: 1, windowMs: 60_000 }), true)
    assert.equal(applyRateLimit(req, second, { key: 'test', max: 1, windowMs: 60_000 }), false)
    assert.equal(second.statusCode, 429)

    resetRateLimitsForTests()
  })
})
