import bcrypt from 'bcryptjs'
import {
  consumeRecoveryCode,
  getAdmin,
  spendPasswordCheckTime,
  updateTotpLastStep,
} from './db.js'
import { clearFailures, isLockedOut, recordFailure } from './security.js'
import { decryptSecret } from './secret-store.js'
import { hashRecoveryCode, looksLikeTotpCode, normalizeRecoveryCode, verifyTotp } from './totp.js'

// Failures are counted per account name (whether or not it exists, so the lockout reveals nothing).
const lockKey = username => `admin:${String(username || '').trim().toLowerCase()}`

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
export function authenticateAdmin({ username, password, code }) {
  const key = lockKey(username)
  if (isLockedOut(key)) return { status: 'locked' }

  const admin = typeof username === 'string' ? getAdmin(username) : null

  // An unknown username takes as long to reject as a wrong password, so the two can't be told apart.
  if (!admin || typeof password !== 'string') {
    spendPasswordCheckTime(password)
    recordFailure(key)
    return { status: 'invalid' }
  }

  if (!bcrypt.compareSync(password, admin.password_hash)) {
    recordFailure(key)
    return { status: 'invalid' }
  }

  if (admin.totp_enabled) {
    // The password was right; asking for the code is not a failure.
    if (!code) return { status: 'totp-required' }

    if (!checkSecondFactor(admin, code)) {
      recordFailure(key)
      return { status: 'invalid-code' }
    }
  }

  clearFailures(key)
  return { status: 'ok', admin }
}

// Re-checks the password of someone who is already signed in, before a sensitive change.
export function confirmAdminPassword(username, password) {
  const key = lockKey(username)
  if (isLockedOut(key)) return 'locked'

  const admin = getAdmin(username)
  if (!admin || typeof password !== 'string' || !bcrypt.compareSync(password, admin.password_hash)) {
    recordFailure(key)
    return 'invalid'
  }

  return 'ok'
}
