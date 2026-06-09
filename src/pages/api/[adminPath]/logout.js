import { withSessionRoute } from '../../../lib/session'
import { getAdminPath } from '../../../lib/db'
import { protectMutation } from '../../../lib/security'

export default withSessionRoute(async (req, res) => {
  const { adminPath } = req.query
  if (adminPath !== getAdminPath()) {
    return res.status(404).json({ error: 'Not found' })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  if (!protectMutation(req, res, { key: 'admin-write', max: 30, windowMs: 60 * 1000 })) {
    return
  }

  req.session.destroy()
  return res.status(200).json({ ok: true })
})
