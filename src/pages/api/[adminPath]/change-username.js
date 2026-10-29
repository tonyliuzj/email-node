import { getAdmin, updateAdminUsername, getAdminPath } from '../../../lib/db'
import { requireAdmin, startAdminSession } from '../../../lib/session-auth'
import { withSessionRoute } from '../../../lib/session'
import { protectMutation } from '../../../lib/security'

export default withSessionRoute(async (req, res) => {
  const { adminPath } = req.query
  if (adminPath !== getAdminPath()) {
    return res.status(404).json({ error: 'Not found' })
  }

  const adminSession = requireAdmin(req, res)
  if (!adminSession) return
  if (req.method !== 'POST') {
    res.status(405).end()
    return
  }
  if (!protectMutation(req, res, { key: 'admin-write', max: 30, windowMs: 60 * 1000 })) {
    return
  }
  const { newUsername } = req.body || {}
  const username = typeof newUsername === 'string' ? newUsername.trim() : ''
  if (username.length < 3) {
    return res.status(400).json({ error: 'Invalid username (min 3 chars).' })
  }
  if (getAdmin(username)) {
    return res.status(409).json({ error: 'Username already exists.' })
  }

  const result = updateAdminUsername(adminSession.username, username)
  if (!result.success) {
    return res.status(409).json({ error: result.error || 'Unable to update username' })
  }

  await startAdminSession(req, getAdmin(result.username))
  res.json({ ok: true, newUsername: result.username })
})
