import bcrypt from 'bcryptjs'
import { withSessionRoute } from '../../../lib/session'
import { getAdmin, getAdminPath, updateAdminPassword } from '../../../lib/db'
import { protectMutation } from '../../../lib/security'

export default withSessionRoute(async (req, res) => {
  const { adminPath } = req.query
  if (adminPath !== getAdminPath()) {
    return res.status(404).json({ error: 'Not found' })
  }

  const admin = req.session.get('admin')
  if (!admin) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  if (!protectMutation(req, res, { key: 'admin-write', max: 30, windowMs: 60 * 1000 })) {
    return
  }

  const { currentPassword, newPassword } = req.body || {}
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' })
  }

  const adminRecord = getAdmin(admin.username)
  if (!adminRecord || !bcrypt.compareSync(currentPassword, adminRecord.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' })
  }

  const result = updateAdminPassword(admin.username, newPassword)
  if (!result.success) {
    return res.status(400).json({ error: result.error || 'Unable to update password' })
  }

  return res.status(200).json({ ok: true })
})
