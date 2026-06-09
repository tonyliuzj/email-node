import { getAdmin, updateAdminUsername, getAdminPath } from '../../../lib/db'
import { withSessionRoute } from '../../../lib/session'
import { protectMutation } from '../../../lib/security'

export default withSessionRoute(async (req, res) => {
  const { adminPath } = req.query
  if (adminPath !== getAdminPath()) {
    return res.status(404).json({ error: 'Not found' })
  }

  const adminSession = req.session.get('admin')
  if (!adminSession) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (req.method !== 'POST') {
    res.status(405).end()
    return
  }
  if (!protectMutation(req, res, { key: 'admin-write', max: 30, windowMs: 60 * 1000 })) {
    return
  }
  const { newUsername } = req.body
  if (
    typeof newUsername !== 'string' ||
    !newUsername.trim() ||
    newUsername.length < 3
  ) {
    return res.status(400).json({ error: 'Invalid username (min 3 chars).' })
  }
  if (getAdmin(newUsername)) {
    return res.status(409).json({ error: 'Username already exists.' })
  }
  updateAdminUsername(adminSession.username, newUsername)
  req.session.set('admin', { username: newUsername })
  await req.session.save()
  res.json({ ok: true, newUsername })
})
