import { withSessionRoute } from '../../lib/session'
import { createInitialAdmin, getAdmin, getAdminPath, isSetupRequired } from '../../lib/db'
import { isSetupTokenValid, protectMutation } from '../../lib/security'
import { startAdminSession } from '../../lib/session-auth'

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

  const { username, password, confirmPassword, setupToken } = req.body || {}

  if (!isSetupTokenValid(setupToken)) {
    return res.status(403).json({ error: 'The setup token is missing or incorrect.' })
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' })
  }

  const result = await createInitialAdmin(username, password)
  if (!result.success) {
    return res.status(400).json({ error: result.error })
  }

  await startAdminSession(req, getAdmin(result.username))

  return res.status(200).json({
    ok: true,
    adminPath: getAdminPath(),
  })
})
