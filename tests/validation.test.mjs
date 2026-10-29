import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeEmailHtml } from '../src/lib/email-sanitizer.js'
import { normalizeAdminPath, normalizeEmailAddress, normalizeDomainName } from '../src/lib/validation.js'

test('admin paths that match real pages are rejected, because the page would win and lock the admin out', () => {
  for (const reserved of ['setup', 'inbox', 'account', 'api', '_next', 'SETUP', ' Inbox ']) {
    assert.equal(normalizeAdminPath(reserved), null, reserved)
  }
})

test('ordinary admin paths are accepted and lowercased', () => {
  assert.equal(normalizeAdminPath('admin'), 'admin')
  assert.equal(normalizeAdminPath('My-Control_Panel'), 'my-control_panel')
  assert.equal(normalizeAdminPath('ab'), null)
  assert.equal(normalizeAdminPath('../etc'), null)
})

test('email and domain normalisation rejects malformed input', () => {
  assert.equal(normalizeEmailAddress('John@Example.COM'), 'john@example.com')
  assert.equal(normalizeEmailAddress('a@b@example.com'), null)
  assert.equal(normalizeEmailAddress('john@@example.com'), null)
  assert.equal(normalizeDomainName('example'), null)
  assert.equal(normalizeDomainName('exa mple.com'), null)
})

test('sanitizer strips scripts, event handlers and javascript: links', () => {
  const dirty = [
    '<p onclick="steal()">hi</p>',
    '<script>alert(1)</script>',
    '<a href="javascript:alert(1)">x</a>',
    '<img src="x" onerror="alert(1)">',
    '<iframe src="https://evil.test"></iframe>',
  ].join('')
  const clean = sanitizeEmailHtml(dirty)

  assert.doesNotMatch(clean, /script|onclick|onerror|javascript:|iframe/i)
  assert.match(clean, /hi/)
})

test('sanitizer forces links to open safely', () => {
  const clean = sanitizeEmailHtml('<a href="https://example.com">x</a>')
  assert.match(clean, /rel="noopener noreferrer"/)
  assert.match(clean, /target="_blank"/)
})
