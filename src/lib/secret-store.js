import crypto from 'crypto'

const PREFIX = 'enc:v1:'
let warnedAboutFallbackKey = false

function getKeyMaterial() {
  if (process.env.DATA_ENCRYPTION_KEY) {
    return process.env.DATA_ENCRYPTION_KEY
  }

  if (process.env.NODE_ENV === 'production' && process.env.SESSION_PASSWORD && !warnedAboutFallbackKey) {
    warnedAboutFallbackKey = true
    console.warn('DATA_ENCRYPTION_KEY is not set; falling back to SESSION_PASSWORD for stored secret encryption.')
  }

  return process.env.SESSION_PASSWORD || ''
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

  const key = getKey()
  if (!key) return value

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
