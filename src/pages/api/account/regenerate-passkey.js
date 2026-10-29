import { regeneratePasskey, getEmailById } from '../../../lib/db.js'
import { withSessionRoute } from '../../../lib/session.js'
import { getSessionEmail, startUserSession } from '../../../lib/session-auth.js'
import { nanoid } from 'nanoid'
import { protectMutation } from '../../../lib/security.js'

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    if (!protectMutation(req, res, { key: 'passkey-regenerate', max: 10, windowMs: 10 * 60 * 1000 })) {
      return
    }

    const userEmail = await getSessionEmail(req)

    if (!userEmail) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const emailId = Number.parseInt(req.body?.emailId, 10)

    if (!Number.isInteger(emailId) || emailId <= 0) {
      return res.status(400).json({ error: 'Email ID is required' })
    }

    if (emailId !== userEmail.id) {
      return res.status(403).json({ error: 'Unauthorized access to this email' })
    }

    // Generate new passkey
    const newPasskey = nanoid(24)

    // Update passkey in database
    const success = regeneratePasskey(emailId, newPasskey)

    if (!success) {
      return res.status(500).json({ error: 'Failed to regenerate passkey' })
    }

    // Every session is bound to the old passkey, so this signs out all other devices. Re-issue this one.
    await startUserSession(req, getEmailById(emailId))

    return res.status(200).json({
      success: true,
      newPasskey: newPasskey
    })

  } catch (error) {
    console.error('Passkey regeneration error:', error)
    return res.status(500).json({ error: 'Failed to regenerate passkey' })
  }
}

export default withSessionRoute(handler)
