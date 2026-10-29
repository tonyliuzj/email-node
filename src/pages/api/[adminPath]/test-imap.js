import { db, getAdminPath, getDomainForImap } from '../../../lib/db'
import { imapLimiter } from '../../../lib/imap-limit'
import {
  CONNECT_TIMEOUT_MS,
  createImapSession,
  isTimeoutError,
  withTimeout,
} from '../../../lib/imap-session'
import { withSessionRoute } from '../../../lib/session'
import { protectMutation } from '../../../lib/security'
import { requireAdmin } from '../../../lib/session-auth'

// Says why a connection failed in words an administrator can act on, without passing along raw server output.
function describeFailure(error) {
  if (error?.authenticationFailed) return 'The mail server rejected the IMAP user name or password.'
  if (isTimeoutError(error)) return 'The mail server did not answer in time. Check the host, the port and any firewall.'

  switch (error?.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'The IMAP host name could not be found.'
    case 'ECONNREFUSED':
      return 'The mail server refused the connection. Check the port.'
    case 'ECONNRESET':
    case 'EPROTO':
    case 'ERR_SSL_WRONG_VERSION_NUMBER':
      return 'The connection was cut off during the secure handshake. Check the port and the TLS setting.'
    default:
      if (/certificate|self[- ]signed|issuer/i.test(String(error?.code || error?.message))) {
        return 'The mail server\'s certificate is not trusted (expired, self-signed or for another name).'
      }
      return 'Could not connect to the mail server.'
  }
}

// Logs in to a saved domain's catch-all mailbox and opens INBOX, so a wrong host or password shows up when
// the domain is added instead of as an empty inbox later.
export default withSessionRoute(async function handler(req, res) {
  const { adminPath } = req.query
  if (adminPath !== getAdminPath()) {
    return res.status(404).json({ error: 'Not found' })
  }

  if (!requireAdmin(req, res)) return

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  if (!protectMutation(req, res, { key: 'admin-write', max: 30, windowMs: 60 * 1000 })) {
    return
  }

  const id = Number.parseInt(req.body?.id, 10)
  const row = Number.isInteger(id) && id > 0 ? db.prepare('SELECT name FROM domains WHERE id = ?').get(id) : null
  const domain = row ? getDomainForImap(row.name) : null
  if (!domain) {
    return res.status(404).json({ error: 'Domain not found' })
  }
  if (!domain.imap_password) {
    return res.status(400).json({ error: 'No IMAP password is saved for this domain, or it can no longer be read with the current DATA_ENCRYPTION_KEY.' })
  }

  let releaseSlot
  try {
    releaseSlot = await imapLimiter.acquire()
  } catch {
    return res.status(503).json({ error: 'The mailbox is busy right now. Please try again in a moment.' })
  }

  const { client, close } = createImapSession(domain)

  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, 'Timed out connecting to mailbox.', close)
    const lock = await withTimeout(client.getMailboxLock('INBOX', { acquireTimeout: 3_000 }), 4_000, 'Timed out opening mailbox.', close)
    const messages = Number(client.mailbox?.exists || 0)
    lock.release()

    return res.status(200).json({ ok: true, messages })
  } catch (error) {
    console.warn('IMAP test failed:', { domain: domain.name, code: error?.code, message: error?.message })
    return res.status(200).json({ ok: false, error: describeFailure(error) })
  } finally {
    try {
      if (!client.closed) await client.logout().catch(() => close())
    } finally {
      releaseSlot()
    }
  }
})
