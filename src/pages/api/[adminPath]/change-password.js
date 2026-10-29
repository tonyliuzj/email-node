import { withSessionRoute } from '../../../lib/session'
import { getAdmin, getAdminPath, updateAdminPassword } from '../../../lib/db'
import { confirmAdminPassword } from '../../../lib/admin-auth'
import { requireAdmin, startAdminSession } from '../../../lib/session-auth'
import { protectMutation } from '../../../lib/security'

export default withSessionRoute(async (req, res) => {
  const { adminPath } = req.query
  if (adminPath !== getAdminPath()) {
    return res.status(404).json({ error: 'Not found' })
  }

  const admin = requireAdmin(req, res)
  if (!admin) return

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  if (!protectMutation(req, res, { key: 'admin-write', max: 30, windowMs: 60 * 1000 })) {
    return
  }

  const { currentPassword, newPassword } = req.body || {}
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' })
  }

  const check = confirmAdminPassword(admin.username, currentPassword)
  if (check === 'locked') {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' })
  }
  if (check !== 'ok') {
    return res.status(401).json({ error: 'Current password is incorrect' })
  }

  const result = updateAdminPassword(admin.username, newPassword)
  if (!result.success) {
    return res.status(400).json({ error: result.error || 'Unable to update password' })
  }

  // The new password signs every other session out; keep this one signed in.
  await startAdminSession(req, getAdmin(admin.username))

  return res.status(200).json({ ok: true })
})
