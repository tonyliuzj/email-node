import { getSafeUserEmailsByUserId } from '../../../lib/db.js'
import { withSessionRoute } from '../../../lib/session.js'

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Get user data from iron-session
    const userEmail = req.session.get('email')
    
    if (!userEmail) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    // Validate that userEmail has the expected structure
    const emailId = userEmail.id || userEmail.email_id
    if (!emailId) {
      console.error('User email object missing ID:', userEmail)
      return res.status(401).json({ error: 'Invalid session data' })
    }

    const userEmails = getSafeUserEmailsByUserId(emailId)
    const emailsWithPasskey = userEmails.map(email => ({
      ...email,
      passkey: null,
    }))

    return res.status(200).json({
      success: true,
      userId: emailId,
      emails: emailsWithPasskey
    })

  } catch (error) {
    console.error('Account info error:', error)
    return res.status(500).json({ error: 'Failed to fetch account information' })
  }
}

export default withSessionRoute(handler)
