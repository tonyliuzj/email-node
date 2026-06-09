import bcrypt from 'bcryptjs'
import { withSessionRoute } from '../../../lib/session'
import { getAdmin, getAdminPath, isSetupRequired } from '../../../lib/db'
import { protectMutation } from '../../../lib/security'

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

  const { username, password } = req.body
  const admin = getAdmin(username)

  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  req.session.set('admin', { username })
  await req.session.save()

  return res.status(200).json({ ok: true })
})
