import crypto from 'crypto'
import { getAdmin, getEmailById, purgeInactiveAddresses, touchAddressActivity } from './db.js'

const ACTIVITY_TOUCH_MS = 60 * 60 * 1000

// Sessions are sealed cookies, so by themselves they stay valid until they expire. Each one also
// carries a fingerprint of the credential it was issued for. Every request compares it with the
// database, so changing a passkey or password, or deleting the address, signs everything else out.

export function credentialFingerprint(hash) {
  return crypto.createHash('sha256').update(String(hash || '')).digest('hex').slice(0, 24)
}

export function buildUserSession(email) {
  return {
    id: email.id,
    email_id: email.id,
    email_address: email.email_address,
    domain_name: email.domain_name,
    v: credentialFingerprint(email.passkey_hash),
  }
}

// Turning two-factor on or off changes this too, so it also signs out the other sessions.
function adminCredential(admin) {
  return `${admin.password_hash}|${admin.totp_enabled ? admin.totp_secret : ''}`
}

export function buildAdminSession(admin) {
  return {
    username: admin.username,
    v: credentialFingerprint(adminCredential(admin)),
  }
}

// Last activity only needs to be roughly right, so write it at most once an hour per address.
function recordActivity(email) {
  const last = Date.parse(`${String(email.last_active_at || '').replace(' ', 'T')}Z`)
  if (!Number.isFinite(last) || Date.now() - last > ACTIVITY_TOUCH_MS) {
    touchAddressActivity(email.id)
  }
}

export async function startUserSession(req, email) {
  req.session.set('email', buildUserSession(email))
  await req.session.save()
}

export async function startAdminSession(req, admin) {
  req.session.set('admin', buildAdminSession(admin))
  await req.session.save()
}

async function dropStoredEmail(req) {
  try {
    delete req.session.email
    await req.session.save()
  } catch (error) {
    console.error('Failed to clear stale session:', error)
  }
}

// Returns the signed-in address as it is in the database, or null if the cookie no longer matches it.
export async function getSessionEmail(req) {
  const stored = req.session.get('email')
  if (!stored) return null

  purgeInactiveAddresses()

  const id = Number(stored.id ?? stored.email_id)
  const email = Number.isInteger(id) ? getEmailById(id) : null

  // SQLite reuses the id of the newest row after it is deleted, so the address has to match as well.
  if (!email || email.email_address !== stored.email_address) {
    await dropStoredEmail(req)
    return null
  }

  if (typeof stored.v === 'undefined') {
    // Issued before sessions were bound to a credential: accept it once and bind it now.
    await startUserSession(req, email)
  } else if (stored.v !== credentialFingerprint(email.passkey_hash)) {
    await dropStoredEmail(req)
    return null
  }

  recordActivity(email)

  return {
    id: email.id,
    email_id: email.id,
    email_address: email.email_address,
    domain_name: email.domain_name,
  }
}

// Admin sessions must carry a fingerprint; ones issued before this existed just have to sign in again.
export function getSessionAdmin(req) {
  const stored = req.session.get('admin')
  if (!stored || typeof stored.username !== 'string' || typeof stored.v !== 'string') return null

  const admin = getAdmin(stored.username)
  if (!admin || admin.username !== stored.username) return null
  if (stored.v !== credentialFingerprint(adminCredential(admin))) return null

  return { username: admin.username }
}

export function requireAdmin(req, res) {
  const admin = getSessionAdmin(req)
  if (!admin) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  return admin
}
