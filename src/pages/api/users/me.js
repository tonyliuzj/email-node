import { withSessionRoute } from '../../../lib/session.js'

function handler(req, res) {
  const user = req.session.get('email')
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' })
  }
  return res.status(200).json({ email: user.email_address })
}

export default withSessionRoute(handler)
