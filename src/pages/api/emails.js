import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { getDomainForImap, getUserEmailByAddress } from '../../lib/db.js'
import { withSessionRoute } from '../../lib/session.js'
import { protectMutation } from '../../lib/security.js'
import { sanitizeEmailHtml } from '../../lib/email-sanitizer.js'
import { normalizeEmailAddress } from '../../lib/validation.js'

const MAX_MESSAGES = 50
const MAX_EMAIL_BYTES = 1024 * 1024
const CONNECT_TIMEOUT_MS = 20_000
const MAILBOX_OPERATION_TIMEOUT_MS = 120_000

function isTimeoutError(error) {
  return error?.code === 'ETIMEOUT' || error?.code === 'LockTimeout'
}

function withTimeout(promise, timeoutMs, message, onTimeout) {
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(message)
      error.code = 'ETIMEOUT'
      onTimeout?.(error)
      reject(error)
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId))
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!protectMutation(req, res, { key: 'mailbox-poll', max: 60, windowMs: 60 * 1000 })) {
    return
  }

  // Get user data from iron-session
  const userEmail = req.session.get('email')
  
  if (!userEmail) {
    return res.status(401).json({ error: 'Unauthorized: No session found' })
  }

  const requestedAddress = normalizeEmailAddress(req.body?.email)
  if (!requestedAddress) {
    return res.status(400).json({ error: 'Email is required' })
  }

  // Verify the email belongs to the authenticated user
  const requestedEmail = getUserEmailByAddress(requestedAddress)
  const userEmailId = userEmail.id || userEmail.email_id
  if (!requestedEmail || requestedEmail.id !== userEmailId) {
    return res.status(403).json({ error: 'Unauthorized access to this email' })
  }

  const domain = getDomainForImap(userEmail.domain_name)
  if (!domain) {
    return res.status(500).json({ error: 'Domain configuration not found' })
  }

  const client = new ImapFlow({
    host: domain.imap_host,
    port: Number(domain.imap_port || 993),
    secure: Boolean(domain.imap_tls),
    auth: {
      user: domain.imap_user,
      pass: domain.imap_password,
    },
    tls: { rejectUnauthorized: true },
    connectionTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: MAILBOX_OPERATION_TIMEOUT_MS,
    logger: false,
  })
  const imapErrors = []
  client.on('error', error => {
    imapErrors.push(error)
  })
  const closeClient = () => {
    try {
      client.close()
    } catch {
      // Ignore close failures; the active operation will surface the original error.
    }
  }

  try {
    await withTimeout(
      client.connect(),
      CONNECT_TIMEOUT_MS,
      'Timed out connecting to mailbox.',
      closeClient
    )
    const lock = await withTimeout(
      client.getMailboxLock('INBOX', { acquireTimeout: 3_000 }),
      4_000,
      'Timed out opening mailbox.',
      closeClient
    )

    let rawMessages = []
    try {
      const uids = await withTimeout(
        client.search({ header: { to: requestedAddress } }, { uid: true }),
        MAILBOX_OPERATION_TIMEOUT_MS,
        'Timed out searching mailbox.',
        closeClient
      )

      const limitedUids = Array.isArray(uids) ? uids.slice(-MAX_MESSAGES) : []
      await withTimeout((async () => {
        for await (const message of client.fetch(
          limitedUids,
          { uid: true, source: { maxLength: MAX_EMAIL_BYTES } },
          { uid: true }
        )) {
          rawMessages.push({
            uid: message.uid,
            buffer: message.source,
          })
        }
      })(), MAILBOX_OPERATION_TIMEOUT_MS, 'Timed out fetching mailbox messages.', closeClient)

      if (imapErrors.length > 0) {
        throw imapErrors[0]
      }
    } finally {
      lock.release()
    }

    if (rawMessages.length === 0) {
      return res.status(200).json({ emails: [] })
    }

    const emails = await Promise.all(
      rawMessages.map(async ({ uid, buffer }) => {
        try {
          const parsed = await simpleParser(buffer)
          return {
            uid,
            subject: parsed.subject,
            from: parsed.from?.text,
            date: parsed.date,
            text: parsed.text,
            html: parsed.html ? sanitizeEmailHtml(parsed.html) : null,
          }
        } catch (error) {
          console.error(`Failed to parse email UID ${uid}:`, error)
          return null
        }
      })
    )

    const validEmails = emails.filter(Boolean)
    validEmails.sort((a, b) => new Date(b.date) - new Date(a.date))
    
    res.status(200).json({ emails: validEmails })
  } catch (error) {
    if (isTimeoutError(error)) {
      console.warn('IMAP sync timed out:', {
        code: error.code,
        message: error.message,
      })
      return res.status(200).json({
        emails: [],
        timedOut: true,
        warning: 'Mailbox sync timed out. The next refresh will try again.',
      })
    }

    console.error('IMAP processing failed:', error)
    res.status(500).json({ error: 'Failed to fetch mailbox messages.' })
  } finally {
    if (!client.closed) {
      await client.logout().catch(() => closeClient())
    }
  }
}

export default withSessionRoute(handler)
