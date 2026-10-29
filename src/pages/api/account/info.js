import { getSafeUserEmailsByUserId } from '../../../lib/db.js'
import { withSessionRoute } from '../../../lib/session.js'
import { getSessionEmail } from '../../../lib/session-auth.js'

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const userEmail = await getSessionEmail(req)

    if (!userEmail) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const userEmails = getSafeUserEmailsByUserId(userEmail.id)
    const emailsWithPasskey = userEmails.map(email => ({
      ...email,
      passkey: null,
    }))

    return res.status(200).json({
      success: true,
      userId: userEmail.id,
      emails: emailsWithPasskey
    })

  } catch (error) {
    console.error('Account info error:', error)
    return res.status(500).json({ error: 'Failed to fetch account information' })
  }
}

export default withSessionRoute(handler)
