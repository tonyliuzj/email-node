import { withSessionRoute } from '../../../lib/session.js'
import { protectMutation } from '../../../lib/security.js'

function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!protectMutation(req, res, { key: 'user-logout', max: 30, windowMs: 60 * 1000 })) {
    return
  }

  req.session.destroy()
  res.status(200).json({ success: true })
}

export default withSessionRoute(handler)
