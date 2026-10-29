import { withSessionRoute } from '../../../lib/session.js'
import { protectMutation } from '../../../lib/security.js'

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!protectMutation(req, res, { key: 'user-logout', max: 30, windowMs: 60 * 1000 })) {
    return
  }

  // Visitors and the admin share one session cookie, so only the visitor's part is removed. Signing out
  // here must not sign the admin out of the same browser.
  delete req.session.email
  await req.session.save()
  res.status(200).json({ success: true })
}

export default withSessionRoute(handler)
