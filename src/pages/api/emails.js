import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { getDomainForImap } from '../../lib/db.js'
import { withSessionRoute } from '../../lib/session.js'
import { getSessionEmail } from '../../lib/session-auth.js'
import { protectMutation } from '../../lib/security.js'
import { sanitizeEmailHtml } from '../../lib/email-sanitizer.js'
import { isAddressedTo } from '../../lib/recipients.js'
import { hasBlockedRemoteImages } from '../../lib/remote-images.js'
import { imapLimiter } from '../../lib/imap-limit.js'
import { arrivedAfterRegistration } from '../../lib/mail-window.js'
import { limitMessageBody } from '../../lib/message-limits.js'
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

function formatAddressList(addressList) {
  const address = addressList?.value?.[0]
  if (!address) return addressList?.text || ''

  const emailAddress = address.address || ''
  const senderName = String(address.name || '').trim().replace(/^["']+|["']+$/g, '')

  if (senderName && emailAddress) return `${senderName} <${emailAddress}>`
  return senderName || emailAddress || addressList?.text || ''
}

// Candidate messages only: IMAP header search matches substrings ("a@x.com" also matches "ba@x.com"),
// so every result is checked against its exact recipients after it is parsed.
function recipientQuery(address) {
  return {
    or: [
      { header: { to: address } },
      { header: { cc: address } },
      { header: { 'delivered-to': address } },
      { header: { 'x-original-to': address } },
    ],
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!protectMutation(req, res, { key: 'mailbox-poll', max: 60, windowMs: 60 * 1000 })) {
    return
  }

  const userEmail = await getSessionEmail(req)

  if (!userEmail) {
    return res.status(401).json({ error: 'Unauthorized: No session found' })
  }

  // Only the signed-in address can be read. The request may name it, but not choose another one.
  const requestedAddress = normalizeEmailAddress(req.body?.email) || userEmail.email_address
  if (requestedAddress !== userEmail.email_address) {
    return res.status(403).json({ error: 'Unauthorized access to this email' })
  }

  const domain = getDomainForImap(userEmail.domain_name)
  if (!domain) {
    return res.status(500).json({ error: 'Domain configuration not found' })
  }

  // The inbox page sends the highest UID it already has, so a refresh fetches and parses only new mail
  // instead of the whole last 50 every few seconds.
  const requestedSince = Number.parseInt(req.body?.sinceUid, 10)
  const knownValidity = req.body?.uidValidity === undefined ? '' : String(req.body.uidValidity)

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

  // Taken right before the try so that every way out of it, including errors, gives the slot back.
  let releaseSlot
  try {
    releaseSlot = await imapLimiter.acquire()
  } catch {
    return res.status(503).json({ error: 'The mailbox is busy right now. Please try again in a moment.' })
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

    // UIDs only mean something within one UIDVALIDITY. If the mailbox was rebuilt, start from scratch.
    const uidValidity = String(client.mailbox?.uidValidity ?? '')
    const sinceTrusted = Number.isInteger(requestedSince) && requestedSince > 0 && knownValidity === uidValidity
    const sinceUid = sinceTrusted ? requestedSince : 0
    const reset = Number.isInteger(requestedSince) && requestedSince > 0 && !sinceTrusted

    let rawMessages = []
    let highestUid = 0
    try {
      const uids = await withTimeout(
        client.search(recipientQuery(requestedAddress), { uid: true }),
        MAILBOX_OPERATION_TIMEOUT_MS,
        'Timed out searching mailbox.',
        closeClient
      )

      // UIDs ascend with arrival, so the newest 50 candidates are the last 50.
      const candidateUids = Array.isArray(uids) ? uids.filter(uid => uid > sinceUid).slice(-MAX_MESSAGES) : []
      highestUid = candidateUids.length > 0 ? candidateUids[candidateUids.length - 1] : 0

      // Arrival dates first (small), so the bodies of mail that is not this owner's are never downloaded.
      const ownUids = []
      if (candidateUids.length > 0) {
        await withTimeout((async () => {
          for await (const message of client.fetch(candidateUids, { uid: true, internalDate: true }, { uid: true })) {
            // Only mail that arrived while this address was registered is its owner's (see mail-window.js).
            if (arrivedAfterRegistration(message.internalDate, userEmail.created_at)) ownUids.push(message.uid)
          }
        })(), MAILBOX_OPERATION_TIMEOUT_MS, 'Timed out reading message dates.', closeClient)
      }

      if (ownUids.length > 0) {
        await withTimeout((async () => {
          for await (const message of client.fetch(
            ownUids,
            { uid: true, source: { maxLength: MAX_EMAIL_BYTES } },
            { uid: true }
          )) {
            rawMessages.push({
              uid: message.uid,
              buffer: message.source,
            })
          }
        })(), MAILBOX_OPERATION_TIMEOUT_MS, 'Timed out fetching mailbox messages.', closeClient)
      }

      if (imapErrors.length > 0) {
        throw imapErrors[0]
      }
    } finally {
      lock.release()
    }

    if (rawMessages.length === 0) {
      return res.status(200).json({ emails: [], uidValidity, reset, highestUid })
    }

    // One at a time: parsing up to 50 messages of 1 MB together is a memory spike anyone can provoke.
    const emails = []
    for (const { uid, buffer } of rawMessages) {
      try {
        const parsed = await simpleParser(buffer)
        if (!isAddressedTo(parsed, requestedAddress)) continue

        const sanitized = parsed.html ? sanitizeEmailHtml(parsed.html) : null
        const { text, html, truncated } = limitMessageBody({ text: parsed.text, html: sanitized })
        emails.push({
          uid,
          subject: parsed.subject,
          from: formatAddressList(parsed.from),
          date: parsed.date,
          text,
          html,
          hasRemoteImages: hasBlockedRemoteImages(html),
          truncated,
        })
      } catch (error) {
        console.error(`Failed to parse email UID ${uid}:`, error)
      }
    }

    const validEmails = emails
    validEmails.sort((a, b) => (b.date ? +new Date(b.date) : 0) - (a.date ? +new Date(a.date) : 0))
    
    res.status(200).json({ emails: validEmails, uidValidity, reset, highestUid })
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
    try {
      if (!client.closed) {
        await client.logout().catch(() => closeClient())
      }
    } finally {
      releaseSlot()
    }
  }
}

export default withSessionRoute(handler)
