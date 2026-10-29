import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import path from 'path'
import fs from 'fs'
import { decryptSecret, encryptSecret, isEncryptedSecret } from './secret-store.js'
import {
  normalizeDomainName,
  normalizeEmailAddress,
  normalizeEmailLocalPart,
  normalizeSiteTitle,
  isStrongAdminPassword,
} from './validation.js'

export const DEFAULT_BLOCKED_EMAIL_PREFIXES = [
  'abuse',
  'admin',
  'administrator',
  'billing',
  'contact',
  'help',
  'hostmaster',
  'info',
  'mailer-daemon',
  'no-reply',
  'noreply',
  'postmaster',
  'privacy',
  'root',
  'sales',
  'security',
  'support',
  'system',
  'webmaster',
]

const dbPath = path.resolve(process.cwd(), process.env.DATABASE_URL || path.join('data', 'temp-mail.db'))
fs.mkdirSync(path.dirname(dbPath), { recursive: true })
const db = new Database(dbPath)

db.prepare(`
  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE,
    password_hash TEXT
  )
`).run()

db.prepare(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`).run()

db.prepare(`
  CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE,
    imap_host TEXT,
    imap_port INTEGER,
    imap_user TEXT,
    imap_password TEXT,
    imap_tls INTEGER,
    is_active INTEGER DEFAULT 1
  )
`).run()

db.prepare(`
  INSERT OR IGNORE INTO settings (key, value)
  VALUES ('admin_path', 'admin'),
         ('site_title', 'Email Node'),
         ('inbox_refresh_seconds', '10'),
         ('turnstile_site_key', ''),
         ('turnstile_secret_key', ''),
         ('turnstile_registration_enabled', '0'),
         ('turnstile_login_enabled', '0'),
         ('blocked_email_prefixes', ?)
`).run(JSON.stringify(DEFAULT_BLOCKED_EMAIL_PREFIXES))

db.prepare(`
  CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY,
    email_address TEXT UNIQUE NOT NULL,
    passkey_hash TEXT NOT NULL,
    domain_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run()

function migrateStoredSecrets() {
  const turnstileSecret = db.prepare('SELECT value FROM settings WHERE key = ?').get('turnstile_secret_key')
  if (turnstileSecret?.value && !isEncryptedSecret(turnstileSecret.value)) {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?')
      .run(encryptSecret(turnstileSecret.value), 'turnstile_secret_key')
  }

  const domains = db.prepare('SELECT id, imap_password FROM domains').all()
  const updateDomainSecret = db.prepare('UPDATE domains SET imap_password = ? WHERE id = ?')
  const migrateDomains = db.transaction(rows => {
    for (const row of rows) {
      if (row.imap_password && !isEncryptedSecret(row.imap_password)) {
        updateDomainSecret.run(encryptSecret(row.imap_password), row.id)
      }
    }
  })
  migrateDomains(domains)
}

migrateStoredSecrets()

// Older versions saved admin usernames exactly as typed, but lookups trim them, so a name with stray
// spaces could never log in again.
db.prepare('UPDATE admin SET username = TRIM(username) WHERE username != TRIM(username)').run()

const TIMING_HASH = bcrypt.hashSync('timing-placeholder', 10)

export function isSetupRequired() {
  const row = db.prepare('SELECT COUNT(*) as count FROM admin').get()
  return Number(row?.count || 0) === 0
}

export function createInitialAdmin(username, password) {
  if (!isSetupRequired()) {
    return { success: false, error: 'Setup has already been completed.' }
  }

  const normalizedUsername = String(username || '').trim()
  if (normalizedUsername.length < 3) {
    return { success: false, error: 'Username must be at least 3 characters.' }
  }
  if (!isStrongAdminPassword(password)) {
    return { success: false, error: 'Password must be at least 12 characters.' }
  }

  const hash = bcrypt.hashSync(password, 10)
  db.prepare('INSERT INTO admin (username, password_hash) VALUES (?, ?)')
    .run(normalizedUsername, hash)

  return { success: true, username: normalizedUsername }
}

export function getAdmin(username) {
  return db
    .prepare('SELECT * FROM admin WHERE username = ?')
    .get(String(username || '').trim())
}

export function updateAdminPassword(username, newPass) {
  if (!isStrongAdminPassword(newPass)) {
    return { success: false, error: 'Password must be at least 12 characters.' }
  }
  const hash = bcrypt.hashSync(newPass, 10)
  const result = db
    .prepare('UPDATE admin SET password_hash = ? WHERE username = ?')
    .run(hash, username)
  return { success: result.changes > 0 }
}

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : null
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT OR REPLACE INTO settings (key, value)
    VALUES (?, ?)
  `).run(key, value)
}

export function getAdminPath() {
  return getSetting('admin_path') || 'admin'
}

export function setAdminPath(newPath) {
  setSetting('admin_path', newPath)
}

export function updateAdminUsername(oldUsername, newUsername) {
  const username = String(newUsername || '').trim()
  if (username.length < 3) {
    return { success: false, error: 'Username must be at least 3 characters.' }
  }

  try {
    const result = db
      .prepare('UPDATE admin SET username = ? WHERE username = ?')
      .run(username, oldUsername)
    return { success: result.changes > 0, username }
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { success: false, error: 'Username already exists.' }
    }
    throw error
  }
}

export function getFirstActiveDomain() {
  return db.prepare(`
    SELECT name 
    FROM domains 
    WHERE is_active = 1 
    ORDER BY id 
    LIMIT 1
  `).get() || { name: 'example.com' }
}

export function getSiteTitle() {
  return getSetting('site_title') || 'Email Node'
}

export function setSiteTitle(title) {
  const normalizedTitle = normalizeSiteTitle(title)
  if (!normalizedTitle) {
    return { success: false, error: 'Site title must be 1-80 characters.' }
  }
  setSetting('site_title', normalizedTitle)
  return { success: true }
}

export function getInboxRefreshSeconds() {
  const seconds = Number.parseInt(getSetting('inbox_refresh_seconds') || '10', 10)
  if (!Number.isInteger(seconds) || seconds < 5) return 10
  return seconds
}

export function setInboxRefreshSeconds(value) {
  const seconds = Number.parseInt(value, 10)
  if (!Number.isInteger(seconds) || seconds < 5) {
    return { success: false, error: 'Refresh time must be at least 5 seconds.' }
  }

  setSetting('inbox_refresh_seconds', String(seconds))
  return { success: true, value: seconds }
}

export function normalizeBlockedEmailPrefixes(value) {
  const rawPrefixes = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[\n,]+/)

  const prefixes = []
  const seen = new Set()

  for (const rawPrefix of rawPrefixes) {
    const normalizedPrefix = normalizeEmailLocalPart(rawPrefix)
    if (!normalizedPrefix || seen.has(normalizedPrefix)) continue
    seen.add(normalizedPrefix)
    prefixes.push(normalizedPrefix)
  }

  return prefixes
}

export function getBlockedEmailPrefixes() {
  const rawValue = getSetting('blocked_email_prefixes')
  if (rawValue === null || typeof rawValue === 'undefined') return DEFAULT_BLOCKED_EMAIL_PREFIXES

  try {
    const parsedValue = JSON.parse(rawValue)
    if (Array.isArray(parsedValue)) return normalizeBlockedEmailPrefixes(parsedValue)
    return normalizeBlockedEmailPrefixes(rawValue)
  } catch {
    return normalizeBlockedEmailPrefixes(rawValue)
  }
}

export function setBlockedEmailPrefixes(value) {
  const prefixes = normalizeBlockedEmailPrefixes(value)
  setSetting('blocked_email_prefixes', JSON.stringify(prefixes))
  return { success: true, value: prefixes }
}

export function isEmailPrefixBlocked(value) {
  const normalizedPrefix = normalizeEmailLocalPart(value)
  if (!normalizedPrefix) return false
  return getBlockedEmailPrefixes().includes(normalizedPrefix)
}

export function getTurnstileConfig() {
  const rawRegistration = getSetting('turnstile_registration_enabled')
  const rawLogin = getSetting('turnstile_login_enabled')
  return {
    siteKey: getSetting('turnstile_site_key') || '',
    secretKey: decryptSecret(getSetting('turnstile_secret_key') || ''),
    registrationEnabled: rawRegistration ? rawRegistration === '1' : false,
    loginEnabled: rawLogin ? rawLogin === '1' : false,
  }
}

export function setTurnstileConfig({
  siteKey,
  secretKey,
  registrationEnabled,
  loginEnabled,
} = {}) {
  if (typeof siteKey === 'string') {
    setSetting('turnstile_site_key', siteKey.trim())
  }
  if (typeof secretKey === 'string') {
    const trimmedSecret = secretKey.trim()
    if (trimmedSecret) {
      setSetting('turnstile_secret_key', encryptSecret(trimmedSecret))
    }
  }
  if (typeof registrationEnabled === 'boolean') {
    setSetting('turnstile_registration_enabled', registrationEnabled ? '1' : '0')
  }
  if (typeof loginEnabled === 'boolean') {
    setSetting('turnstile_login_enabled', loginEnabled ? '1' : '0')
  }
}

export function createEmail(emailAddress, passkey, domainName) {
  const normalizedEmail = normalizeEmailAddress(emailAddress)
  const normalizedDomain = normalizeDomainName(domainName)
  if (!normalizedEmail || !normalizedDomain || !normalizedEmail.endsWith(`@${normalizedDomain}`)) {
    return { success: false, error: 'Invalid email address' }
  }

  const localPart = normalizedEmail.split('@')[0]
  if (isEmailPrefixBlocked(localPart)) {
    return { success: false, error: 'This email prefix is reserved and cannot be created' }
  }

  const passkeyHash = bcrypt.hashSync(passkey, 10);
  try {
    const result = db.prepare(`
      INSERT INTO emails (email_address, passkey_hash, domain_name)
      VALUES (?, ?, ?)
    `).run(normalizedEmail, passkeyHash, normalizedDomain);
    return { success: true, emailId: result.lastInsertRowid };
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { success: false, error: 'Email address already taken' };
    }
    return { success: false, error: 'Failed to create email address' };
  }
}

export function getEmailByAddress(emailAddress) {
  const normalizedEmail = normalizeEmailAddress(emailAddress)
  if (!normalizedEmail) return null
  return db.prepare('SELECT * FROM emails WHERE email_address = ?').get(normalizedEmail);
}

export function verifyEmail(emailAddress, passkey) {
  const email = getEmailByAddress(emailAddress);
  if (!email) {
    spendPasswordCheckTime(passkey);
    return { success: false, error: 'Email address not found' };
  }

  const isValid = typeof passkey === 'string' && bcrypt.compareSync(passkey, email.passkey_hash);
  if (!isValid) {
    return { success: false, error: 'Invalid passkey' };
  }

  return { success: true, email };
}

export function regeneratePasskey(emailId, newPasskey) {
  const passkeyHash = bcrypt.hashSync(newPasskey, 10);
  const result = db.prepare('UPDATE emails SET passkey_hash = ? WHERE id = ?').run(passkeyHash, emailId);
  return result.changes > 0;
}

export function deleteEmail(emailId) {
  const result = db.prepare('DELETE FROM emails WHERE id = ?').run(emailId);
  return result.changes > 0;
}

export function getUserEmailsByUserId(emailId) {
  const email = db.prepare('SELECT * FROM emails WHERE id = ?').get(emailId);
  return email ? [email] : [];
}

export function getSafeUserEmailsByUserId(emailId) {
  return db
    .prepare('SELECT id, email_address, domain_name, created_at FROM emails WHERE id = ?')
    .all(emailId)
}

export function getActiveDomainByName(domainName) {
  const normalizedDomain = normalizeDomainName(domainName)
  if (!normalizedDomain) return null
  return db.prepare('SELECT * FROM domains WHERE name = ? AND is_active = 1').get(normalizedDomain)
}

export function getDomainForImap(domainName) {
  const normalizedDomain = normalizeDomainName(domainName)
  if (!normalizedDomain) return null
  const domain = db.prepare('SELECT * FROM domains WHERE name = ?').get(normalizedDomain)
  if (!domain) return null
  return {
    ...domain,
    imap_password: decryptSecret(domain.imap_password || ''),
  }
}

export function getEmailById(emailId) {
  return db.prepare('SELECT * FROM emails WHERE id = ?').get(emailId)
}

export function getPublicDomains() {
  return db.prepare('SELECT id, name FROM domains WHERE is_active = 1 ORDER BY name').all()
}

export function getAdminDomains() {
  return db.prepare(`
    SELECT id, name, imap_host, imap_port, imap_user, imap_password, imap_tls, is_active
    FROM domains
    ORDER BY name
  `).all().map(domain => ({
    ...domain,
    imap_password: undefined,
    has_imap_password: Boolean(decryptSecret(domain.imap_password || '')),
  }))
}

export function countAddressesForDomain(domainName) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM emails WHERE domain_name = ?').get(domainName)
  return Number(row?.count || 0)
}

// Addresses on a removed domain can no longer fetch mail, so they are removed with it.
export function deleteDomainWithAddresses(domainId) {
  const remove = db.transaction(id => {
    const domain = db.prepare('SELECT name FROM domains WHERE id = ?').get(id)
    if (!domain) return null

    const removed = db.prepare('DELETE FROM emails WHERE domain_name = ?').run(domain.name)
    db.prepare('DELETE FROM domains WHERE id = ?').run(id)
    return { removedAddresses: removed.changes }
  })

  return remove(domainId)
}

// Checks a secret against a throwaway hash so a failed lookup takes as long as a real check instead of
// revealing whether the account exists.
export function spendPasswordCheckTime(secret) {
  bcrypt.compareSync(typeof secret === 'string' ? secret : '', TIMING_HASH)
}

export { db }
