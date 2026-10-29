import { setMessageStates } from '../../../lib/db.js'
import { withSessionRoute } from '../../../lib/session.js'
import { getSessionEmail } from '../../../lib/session-auth.js'
import { protectMutation } from '../../../lib/security.js'

const ACTIONS = new Set(['read', 'unread', 'delete'])
const MAX_UIDS = 100

// Marks messages read or unread, or removes them from this address's inbox. Nothing is changed on the mail
// server: one message there can belong to several addresses, so it is only hidden for this one.
async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!protectMutation(req, res, { key: 'message-state', max: 120, windowMs: 60 * 1000 })) {
    return
  }

  const userEmail = await getSessionEmail(req)
  if (!userEmail) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const { action, uids, uidValidity } = req.body || {}
  if (!ACTIONS.has(action)) {
    return res.status(400).json({ error: 'Unknown action.' })
  }
  if (!Array.isArray(uids) || uids.length === 0 || uids.length > MAX_UIDS || !uids.every(uid => Number.isInteger(uid) && uid > 0)) {
    return res.status(400).json({ error: `Choose between 1 and ${MAX_UIDS} messages.` })
  }
  if (!/^\d{1,20}$/.test(String(uidValidity ?? ''))) {
    return res.status(400).json({ error: 'Missing mailbox generation.' })
  }

  const changed = setMessageStates(userEmail.id, String(uidValidity), uids, action)
  return res.status(200).json({ success: true, changed })
}

export default withSessionRoute(handler)
