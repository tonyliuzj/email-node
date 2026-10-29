import { withSessionRoute } from '../../../lib/session.js'
import { getSessionEmail } from '../../../lib/session-auth.js'

async function handler(req, res) {
  const user = await getSessionEmail(req)
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' })
  }
  return res.status(200).json({ email: user.email_address })
}

export default withSessionRoute(handler)
