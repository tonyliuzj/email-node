import { deleteEmail } from '../../../lib/db.js'
import { withSessionRoute } from '../../../lib/session.js'
import { getSessionEmail } from '../../../lib/session-auth.js'
import { protectMutation } from '../../../lib/security.js'

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    if (!protectMutation(req, res, { key: 'account-delete', max: 10, windowMs: 10 * 60 * 1000 })) {
      return
    }

    const userEmail = await getSessionEmail(req)
    if (!userEmail) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    if (Number.parseInt(req.body?.emailId, 10) !== userEmail.id) {
      return res.status(403).json({ error: 'Unauthorized access to this email' })
    }

    if (!deleteEmail(userEmail.id)) {
      return res.status(404).json({ error: 'Address not found' })
    }

    // The address is gone, and so is every session for it (they are checked against the database).
    delete req.session.email
    await req.session.save()

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Account deletion error:', error)
    return res.status(500).json({ error: 'Failed to delete address' })
  }
}

export default withSessionRoute(handler)
