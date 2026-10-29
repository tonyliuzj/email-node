import { withSessionRoute } from '../../../lib/session'
import { getAdminPath, isSetupRequired } from '../../../lib/db'
import { authenticateAdmin } from '../../../lib/admin-auth'
import { startAdminSession } from '../../../lib/session-auth'
import { getClientIp, protectMutation } from '../../../lib/security'

export default withSessionRoute(async (req, res) => {
  if (isSetupRequired()) {
    return res.status(409).json({ error: 'Setup is required.', setupRequired: true })
  }

  const { adminPath } = req.query
  if (adminPath !== getAdminPath()) {
    return res.status(404).json({ error: 'Not found' })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  if (!protectMutation(req, res, { key: 'admin-login', max: 10, windowMs: 10 * 60 * 1000 })) {
    return
  }

  const { username, password, code } = req.body || {}
  const result = await authenticateAdmin({ username, password, code, ip: getClientIp(req) })

  if (result.status === 'locked') {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' })
  }
  if (result.status === 'totp-required') {
    return res.status(401).json({ error: 'Enter the code from your authenticator app.', totpRequired: true })
  }
  if (result.status === 'invalid-code') {
    return res.status(401).json({ error: 'That code is not correct.', totpRequired: true })
  }
  if (result.status !== 'ok') {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  await startAdminSession(req, result.admin)

  return res.status(200).json({ ok: true })
})
