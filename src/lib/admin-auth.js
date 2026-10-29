import {
  consumeRecoveryCode,
  getAdmin,
  spendPasswordCheckTime,
  updateTotpLastStep,
} from './db.js'
import { verifyPassword } from './password.js'
import { clearFailures, getRateLimitSubject, isLockedOut, recordFailure } from './security.js'
import { decryptSecret } from './secret-store.js'
import { hashRecoveryCode, looksLikeTotpCode, normalizeRecoveryCode, verifyTotp } from './totp.js'

// Failures are counted whether or not the account exists, so the lockout reveals nothing about which names
// are real. They are counted twice:
//   - per account and client address: 8 wrong guesses lock that address out of that account for a while.
//     Anyone can type a username, so a lock that covered everybody would let a stranger keep the real
//     administrator out forever just by guessing wrongly. This way they only lock themselves out.
//   - per account, across all addresses: a much higher ceiling, so guesses spread over many machines still
//     run into a wall.
const CLIENT_MAX_FAILURES = 8
const ACCOUNT_MAX_FAILURES = 60

const accountName = username => String(username || '').trim().toLowerCase()
const accountKey = username => `admin:${accountName(username)}`
const clientKey = (username, ip) => `admin:${accountName(username)}@${getRateLimitSubject(ip)}`

function isLocked(username, ip) {
  return (
    isLockedOut(clientKey(username, ip), { max: CLIENT_MAX_FAILURES }) ||
    isLockedOut(accountKey(username), { max: ACCOUNT_MAX_FAILURES })
  )
}

function failed(username, ip) {
  recordFailure(clientKey(username, ip))
  recordFailure(accountKey(username))
}

function succeeded(username, ip) {
  clearFailures(clientKey(username, ip))
  clearFailures(accountKey(username))
}

export function checkSecondFactor(admin, code) {
  if (looksLikeTotpCode(code)) {
    const secret = decryptSecret(admin.totp_secret || '')
    if (!secret) return false

    const step = verifyTotp(secret, code, { lastStep: Number(admin.totp_last_step || 0) })
    if (step === null) return false

    updateTotpLastStep(admin.username, step)
    return true
  }

  // Not six digits, so treat it as a recovery code. Those work once each.
  if (normalizeRecoveryCode(code).length < 8) return false
  return consumeRecoveryCode(admin.username, hashRecoveryCode(code))
}

// status: 'ok' | 'invalid' | 'locked' | 'totp-required' | 'invalid-code'
export async function authenticateAdmin({ username, password, code, ip = 'unknown' }) {
  if (isLocked(username, ip)) return { status: 'locked' }

  const admin = typeof username === 'string' ? getAdmin(username) : null

  // An unknown username takes as long to reject as a wrong password, so the two can't be told apart.
  if (!admin || typeof password !== 'string') {
    await spendPasswordCheckTime(password)
    failed(username, ip)
    return { status: 'invalid' }
  }

  if (!(await verifyPassword(password, admin.password_hash))) {
    failed(username, ip)
    return { status: 'invalid' }
  }

  if (admin.totp_enabled) {
    // The password was right; asking for the code is not a failure.
    if (!code) return { status: 'totp-required' }

    if (!checkSecondFactor(admin, code)) {
      failed(username, ip)
      return { status: 'invalid-code' }
    }
  }

  succeeded(username, ip)
  return { status: 'ok', admin }
}

// Re-checks the password (and, when two-factor is on, a code) of someone who is already signed in, before a
// sensitive change. A stolen session cookie alone is then not enough to download the database or change the
// password. Returns 'ok' | 'invalid' | 'locked' | 'code-required' | 'invalid-code'.
//
// This has its own failure count: strangers guessing at the login form must not be able to lock a signed-in
// administrator out of changing their own password.
export async function confirmAdminPassword(username, password, { code } = {}) {
  const key = `admin-confirm:${accountName(username)}`
  if (isLockedOut(key, { max: CLIENT_MAX_FAILURES })) return 'locked'

  const admin = getAdmin(username)
  if (!admin || !(await verifyPassword(password, admin.password_hash))) {
    recordFailure(key)
    return 'invalid'
  }

  if (admin.totp_enabled) {
    if (!code) return 'code-required'
    if (!checkSecondFactor(admin, code)) {
      recordFailure(key)
      return 'invalid-code'
    }
  }

  clearFailures(key)
  return 'ok'
}
