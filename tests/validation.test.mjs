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

test('remote images are parked so nothing loads until the reader asks', async () => {
  const { hasBlockedRemoteImages, restoreRemoteImages } = await import('../src/lib/remote-images.js')
  const clean = sanitizeEmailHtml('<p>Hi</p><img src="https://tracker.test/pixel.gif?id=42" alt="logo" width="1">')

  assert.doesNotMatch(clean, /\ssrc=/i, 'no src means the browser requests nothing')
  assert.match(clean, /data-remote-src="https:\/\/tracker\.test\/pixel\.gif\?id=42"/)
  assert.equal(hasBlockedRemoteImages(clean), true)

  const restored = restoreRemoteImages(clean)
  assert.match(restored, /<img[^>]*\ssrc="https:\/\/tracker\.test\/pixel\.gif\?id=42"/)
  assert.doesNotMatch(restored, /data-remote-src/)
})

test('a sender cannot smuggle their own data-remote-src past the blocking', async () => {
  const { restoreRemoteImages } = await import('../src/lib/remote-images.js')
  const clean = sanitizeEmailHtml('<img data-remote-src="https://evil.test/x.gif" alt="a"><img data-remote-src="javascript:alert(1)">')

  assert.doesNotMatch(clean, /evil\.test/, 'a sender-supplied value is dropped, not honoured')
  assert.doesNotMatch(restoreRemoteImages(clean), /javascript:|evil\.test/)
})

test('non-http images and message text are left alone by blocking and restoring', async () => {
  const { hasBlockedRemoteImages, restoreRemoteImages } = await import('../src/lib/remote-images.js')

  assert.equal(hasBlockedRemoteImages(sanitizeEmailHtml('<img src="cid:logo123" alt="inline">')), false)
  assert.match(sanitizeEmailHtml('<img src="cid:logo123" alt="inline">'), /src="cid:logo123"/)
  assert.doesNotMatch(sanitizeEmailHtml('<img src="javascript:alert(1)">'), /javascript:/)

  const text = '<p>the attribute data-remote-src= is mentioned in this text</p>'
  assert.equal(restoreRemoteImages(text), text)
  assert.equal(hasBlockedRemoteImages(text), false)
})

test('blocking can be switched off for callers that want the images', () => {
  const html = sanitizeEmailHtml('<img src="https://example.test/a.png">', { blockRemoteImages: false })
  assert.match(html, /\ssrc="https:\/\/example\.test\/a\.png"/)
  assert.doesNotMatch(html, /data-remote-src/)
})
