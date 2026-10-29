import { withSessionRoute } from '../../../lib/session'
import {
  beginTotpEnrollment,
  disableTotp,
  enableTotp,
  getAdmin,
  getAdminPath,
  getRecoveryCodeHashes,
  getSiteTitle,
} from '../../../lib/db'
import { authenticateAdmin, confirmAdminPassword } from '../../../lib/admin-auth'
import { getClientIp, protectMutation } from '../../../lib/security'
import { decryptSecret, encryptSecret } from '../../../lib/secret-store'
import { requireAdmin, startAdminSession } from '../../../lib/session-auth'
import {
  buildOtpAuthUrl,
  formatSecret,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  verifyTotp,
} from '../../../lib/totp'

const LOCKED_MESSAGE = 'Too many failed attempts. Try again in a few minutes.'

export default withSessionRoute(async function handler(req, res) {
  const { adminPath } = req.query
  if (adminPath !== getAdminPath()) {
    return res.status(404).json({ error: 'Not found' })
  }

  const session = requireAdmin(req, res)
  if (!session) return

  try {
    const admin = getAdmin(session.username)

    if (req.method === 'GET') {
      return res.status(200).json({
        enabled: Boolean(admin.totp_enabled),
        recoveryCodesRemaining: admin.totp_enabled ? getRecoveryCodeHashes(admin).length : 0,
      })
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['GET', 'POST'])
      return res.status(405).end()
    }

    if (!protectMutation(req, res, { key: 'admin-write', max: 30, windowMs: 60 * 1000 })) {
      return
    }

    const { action, password, code } = req.body || {}

    // Starting enrollment needs the password again, so a stolen session can't attach its own device.
    if (action === 'begin') {
      if (admin.totp_enabled) {
        return res.status(409).json({ error: 'Two-factor authentication is already on.' })
      }

      const check = await confirmAdminPassword(admin.username, password)
      if (check === 'locked') return res.status(429).json({ error: LOCKED_MESSAGE })
      if (check !== 'ok') return res.status(401).json({ error: 'Password is incorrect.' })

      const secret = generateSecret()
      beginTotpEnrollment(admin.username, encryptSecret(secret))

      return res.status(200).json({
        secret: formatSecret(secret),
        otpauthUrl: buildOtpAuthUrl({ secret, account: admin.username, issuer: getSiteTitle() || 'Email Node' }),
      })
    }

    if (action === 'enable') {
      const pendingSecret = !admin.totp_enabled && admin.totp_secret ? decryptSecret(admin.totp_secret) : ''
      if (!pendingSecret) {
        return res.status(409).json({ error: 'Start setup first.' })
      }

      const step = verifyTotp(pendingSecret, code)
      if (step === null) {
        return res.status(400).json({ error: 'That code is not correct. Check the time on your device and try again.' })
      }

      const recoveryCodes = generateRecoveryCodes()
      enableTotp(admin.username, recoveryCodes.map(hashRecoveryCode), step)

      // Turning it on signs out every other session; keep this one.
      await startAdminSession(req, getAdmin(admin.username))

      return res.status(200).json({ success: true, recoveryCodes })
    }

    if (action === 'disable') {
      if (!admin.totp_enabled) {
        return res.status(409).json({ error: 'Two-factor authentication is not on.' })
      }

      const result = await authenticateAdmin({ username: admin.username, password, code, ip: getClientIp(req) })
      if (result.status === 'locked') return res.status(429).json({ error: LOCKED_MESSAGE })
      if (result.status !== 'ok') {
        return res.status(401).json({ error: 'Password or code is incorrect.' })
      }

      disableTotp(admin.username)
      await startAdminSession(req, getAdmin(admin.username))

      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: 'Unknown action.' })
  } catch (error) {
    console.error('Two-factor API error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})
