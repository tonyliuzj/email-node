import { withSessionRoute } from '../../lib/session'
import { createInitialAdmin, getAdminPath, isSetupRequired } from '../../lib/db'
import { protectMutation } from '../../lib/security'

export default withSessionRoute(async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  if (!protectMutation(req, res, { key: 'setup', max: 5, windowMs: 10 * 60 * 1000 })) {
    return
  }

  if (!isSetupRequired()) {
    return res.status(409).json({ error: 'Setup has already been completed.' })
  }

  const { username, password, confirmPassword } = req.body || {}
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' })
  }

  const result = createInitialAdmin(username, password)
  if (!result.success) {
    return res.status(400).json({ error: result.error })
  }

  req.session.set('admin', { username: result.username })
  await req.session.save()

  return res.status(200).json({
    ok: true,
    adminPath: getAdminPath(),
  })
})
