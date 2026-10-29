import crypto from 'crypto'

// Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 second steps), which is what
// Google Authenticator, Authy, 1Password, Bitwarden and the like all generate.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30
const DIGITS = 6
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export function base32Encode(buffer) {
  let bits = 0
  let value = 0
  let output = ''

  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]

  return output
}

export function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[\s=-]/g, '')
  const bytes = []
  let bits = 0
  let value = 0

  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character)
    if (index === -1) throw new Error('Invalid base32 character')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }

  return Buffer.from(bytes)
}

export function generateSecret() {
  return base32Encode(crypto.randomBytes(20))
}

export function hotp(secret, counter) {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))

  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(message).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3]

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

export function stepAt(timeMs) {
  return Math.floor(timeMs / 1000 / STEP_SECONDS)
}

export function totpAt(secret, timeMs = Date.now()) {
  return hotp(secret, stepAt(timeMs))
}

function sameText(a, b) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

// Accepts the current 30 second step and one either side, to allow for clock drift. A step that was
// already used (lastStep) is refused, so a code seen over a shoulder cannot be replayed.
// Returns the step that matched, or null.
export function verifyTotp(secret, code, { now = Date.now(), lastStep = 0, window = 1 } = {}) {
  const submitted = String(code || '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(submitted)) return null

  const current = stepAt(now)
  for (let step = current - window; step <= current + window; step += 1) {
    if (step > lastStep && sameText(hotp(secret, step), submitted)) return step
  }
  return null
}

export function buildOtpAuthUrl({ secret, account, issuer }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
}

export function formatSecret(secret) {
  return String(secret).replace(/(.{4})/g, '$1 ').trim()
}

export function normalizeRecoveryCode(input) {
  return String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function hashRecoveryCode(input) {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(input)).digest('hex')
}

// Ten characters from an alphabet without look-alikes (no 0/o, 1/l/i), shown as xxxxx-xxxxx.
export function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const characters = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)])
    return `${characters.slice(0, 5).join('')}-${characters.slice(5).join('')}`
  })
}

export function looksLikeTotpCode(input) {
  return /^\d{6}$/.test(String(input || '').replace(/\s+/g, ''))
}
