import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  base32Decode,
  base32Encode,
  buildOtpAuthUrl,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  hotp,
  looksLikeTotpCode,
  normalizeRecoveryCode,
  totpAt,
  verifyTotp,
} from '../src/lib/totp.js'

// RFC 6238 Appendix B: the shared secret is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'))

test('base32 round-trips and matches the RFC 4648 vectors', () => {
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI')
  assert.equal(base32Decode('MZXW6YTBOI').toString(), 'foobar')
  assert.equal(base32Decode('mzxw 6ytb-oi==').toString(), 'foobar', 'tolerates case, spaces, dashes and padding')
  assert.throws(() => base32Decode('not*base32'))

  const random = generateSecret()
  assert.match(random, /^[A-Z2-7]{32}$/)
  assert.equal(base32Encode(base32Decode(random)), random)
})

test('HOTP matches the RFC 4226 test vectors', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
  expected.forEach((code, counter) => assert.equal(hotp(RFC_SECRET, counter), code, `counter ${counter}`))
})

test('TOTP matches the RFC 6238 test vectors (last six digits of the 8-digit codes)', () => {
  assert.equal(totpAt(RFC_SECRET, 59_000), '287082')
  assert.equal(totpAt(RFC_SECRET, 1_111_111_109_000), '081804')
  assert.equal(totpAt(RFC_SECRET, 1_111_111_111_000), '050471')
  assert.equal(totpAt(RFC_SECRET, 1_234_567_890_000), '005924')
  assert.equal(totpAt(RFC_SECRET, 2_000_000_000_000), '279037')
})

test('a code is accepted in its own step and one step either side, not further', () => {
  const now = 1_234_567_890_000
  const code = totpAt(RFC_SECRET, now)

  assert.ok(verifyTotp(RFC_SECRET, code, { now }))
  assert.ok(verifyTotp(RFC_SECRET, code, { now: now + 30_000 }), 'one step late')
  assert.ok(verifyTotp(RFC_SECRET, code, { now: now - 30_000 }), 'one step early')
  assert.equal(verifyTotp(RFC_SECRET, code, { now: now + 90_000 }), null, 'three steps late')
  assert.equal(verifyTotp(RFC_SECRET, code, { now: now - 90_000 }), null, 'three steps early')
})

test('a code that was already used cannot be used again', () => {
  const now = 1_234_567_890_000
  const code = totpAt(RFC_SECRET, now)

  const step = verifyTotp(RFC_SECRET, code, { now })
  assert.ok(step)
  assert.equal(verifyTotp(RFC_SECRET, code, { now, lastStep: step }), null, 'replay is refused')
  assert.equal(verifyTotp(RFC_SECRET, code, { now: now + 15_000, lastStep: step }), null, 'also within the drift window')
})

test('malformed codes are rejected without being compared', () => {
  const now = 1_234_567_890_000
  for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5', null, undefined, 123456.5, {}]) {
    assert.equal(verifyTotp(RFC_SECRET, bad, { now }), null, String(bad))
  }
  assert.ok(verifyTotp(RFC_SECRET, '005 924', { now }), 'spaces typed into the box are ignored')
  assert.equal(looksLikeTotpCode('123 456'), true)
  assert.equal(looksLikeTotpCode('abcde-fghij'), false)
})

test('the otpauth URL carries what authenticator apps need', () => {
  const url = buildOtpAuthUrl({ secret: 'JBSWY3DPEHPK3PXP', account: 'root admin', issuer: 'Email Node' })
  assert.match(url, /^otpauth:\/\/totp\/Email%20Node:root%20admin\?/)
  assert.match(url, /secret=JBSWY3DPEHPK3PXP/)
  assert.match(url, /issuer=Email%20Node/)
  assert.match(url, /digits=6/)
  assert.match(url, /period=30/)
})

test('recovery codes are unique, readable and hash the same however they are typed', () => {
  const codes = generateRecoveryCodes(8)
  assert.equal(codes.length, 8)
  assert.equal(new Set(codes).size, 8)
  for (const code of codes) assert.match(code, /^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/)

  const [code] = codes
  assert.equal(hashRecoveryCode(code), hashRecoveryCode(code.toUpperCase()))
  assert.equal(hashRecoveryCode(code), hashRecoveryCode(code.replace('-', ' ')))
  assert.equal(normalizeRecoveryCode(' AB-cd 12 '), 'abcd12')
  assert.notEqual(hashRecoveryCode(codes[0]), hashRecoveryCode(codes[1]))
})
