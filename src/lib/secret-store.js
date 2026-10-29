import crypto from 'crypto'

const PREFIX = 'enc:v1:'
let warnedAboutFallbackKey = false

// Values that ship in example files, or that anyone would try first. The app refuses to start with one of
// them: a secret that is written in the README protects nothing.
const PLACEHOLDER_SECRETS = [
  'auto_generated_during_installation',
  'changeme',
  'change-me',
  'change_me',
  'replace-me',
  'replace_me',
  'your-secret',
  'your_secret',
]

// Throws when a secret is a published placeholder or has almost no variety. Returns the value otherwise.
export function assertUsableSecret(name, value) {
  const text = String(value ?? '')
  const lowered = text.toLowerCase()

  if (PLACEHOLDER_SECRETS.some(placeholder => lowered.includes(placeholder))) {
    throw new Error(
      `${name} is still a placeholder. Set it to a random value, for example: openssl rand -base64 32`
    )
  }
  if (new Set(text).size < 6) {
    throw new Error(`${name} is too simple. Set it to a random value, for example: openssl rand -base64 32`)
  }

  return text
}

function getKeyMaterial() {
  if (process.env.DATA_ENCRYPTION_KEY) {
    return assertUsableSecret('DATA_ENCRYPTION_KEY', process.env.DATA_ENCRYPTION_KEY)
  }

  if (process.env.NODE_ENV === 'production' && process.env.SESSION_PASSWORD && !warnedAboutFallbackKey) {
    warnedAboutFallbackKey = true
    console.warn('DATA_ENCRYPTION_KEY is not set; falling back to SESSION_PASSWORD for stored secret encryption.')
  }

  return process.env.SESSION_PASSWORD ? assertUsableSecret('SESSION_PASSWORD', process.env.SESSION_PASSWORD) : ''
}

function getKey() {
  const material = getKeyMaterial()
  if (!material) return null
  return crypto.createHash('sha256').update(material).digest()
}

export function isEncryptedSecret(value) {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

export function encryptSecret(value) {
  if (typeof value !== 'string' || value.length === 0 || isEncryptedSecret(value)) {
    return value || ''
  }

  // Storing the secret unencrypted because no key is configured would hide a broken setup until the day
  // the database leaks. Refuse instead.
  const key = getKey()
  if (!key) {
    throw new Error('Set DATA_ENCRYPTION_KEY (or SESSION_PASSWORD) before saving IMAP, Turnstile or two-factor secrets.')
  }

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    PREFIX.slice(0, -1),
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':')
}

export function decryptSecret(value) {
  if (typeof value !== 'string' || value.length === 0) return ''
  if (!isEncryptedSecret(value)) return value

  const key = getKey()
  if (!key) return ''

  const [, , ivText, tagText, encryptedText] = value.split(':')
  if (!ivText || !tagText || !encryptedText) return ''

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ])
    return decrypted.toString('utf8')
  } catch {
    return ''
  }
}
