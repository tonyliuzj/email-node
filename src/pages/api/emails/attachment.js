import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getDomainForImap } from '../../../lib/db.js'
import { withSessionRoute } from '../../../lib/session.js'
import { getSessionEmail } from '../../../lib/session-auth.js'
import { applyRateLimit } from '../../../lib/security.js'
import { imapLimiter } from '../../../lib/imap-limit.js'
import {
  CONNECT_TIMEOUT_MS,
  MAILBOX_OPERATION_TIMEOUT_MS,
  createImapSession,
  findOwnedMessage,
  isTimeoutError,
  withTimeout,
} from '../../../lib/imap-session.js'
import { decoderFor, readPartChunks } from '../../../lib/part-stream.js'
import {
  INLINE_IMAGE_TYPES,
  MAX_ATTACHMENT_BYTES,
  contentDisposition,
  isValidPartId,
  listAttachments,
} from '../../../lib/attachments.js'

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!applyRateLimit(req, res, { key: 'attachment', max: 60, windowMs: 60 * 1000 })) {
    return
  }

  const userEmail = await getSessionEmail(req)
  if (!userEmail) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const uid = Number.parseInt(req.query.uid, 10)
  const part = String(req.query.part || '')
  if (!Number.isInteger(uid) || uid <= 0 || !isValidPartId(part)) {
    return res.status(400).json({ error: 'Choose a message and an attachment.' })
  }

  const domain = getDomainForImap(userEmail.domain_name)
  if (!domain) {
    return res.status(500).json({ error: 'Domain configuration not found' })
  }

  const { client, close: closeClient } = createImapSession(domain)

  let releaseSlot
  try {
    releaseSlot = await imapLimiter.acquire()
  } catch {
    return res.status(503).json({ error: 'The mailbox is busy right now. Please try again in a moment.' })
  }

  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, 'Timed out connecting to mailbox.', closeClient)
    const lock = await withTimeout(
      client.getMailboxLock('INBOX', { acquireTimeout: 3_000 }),
      4_000,
      'Timed out opening mailbox.',
      closeClient
    )

    try {
      // UIDs only mean something within one generation of the mailbox.
      const validity = String(client.mailbox?.uidValidity ?? '')
      if (req.query.v !== undefined && String(req.query.v) !== validity) {
        return res.status(409).json({ error: 'The mailbox changed. Refresh the inbox and try again.' })
      }

      // The same two rules as the message list: addressed to this address, and received while it was registered.
      const owned = await withTimeout(
        findOwnedMessage(client, uid, userEmail),
        MAILBOX_OPERATION_TIMEOUT_MS,
        'Timed out reading the message.',
        closeClient
      )
      const attachment = owned && listAttachments(owned.structure).find(item => item.part === part)
      if (!attachment) {
        return res.status(404).json({ error: 'Attachment not found.' })
      }
      if (attachment.size > MAX_ATTACHMENT_BYTES) {
        return res.status(413).json({ error: `Attachments over ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB cannot be downloaded here.` })
      }

      // The part is fetched raw and decoded here (see part-stream.js). The limit is on the encoded bytes, which
      // are about a third more than the file, in case a server sends more than the part list promised.
      const chunks = readPartChunks(client, uid, part, { maxBytes: Math.ceil(MAX_ATTACHMENT_BYTES * 1.4) + 64 * 1024 })

      // The first chunk is read before anything is sent, so a part that is not there is a clean 404 instead
      // of an empty download.
      const first = await withTimeout(
        chunks.next(),
        MAILBOX_OPERATION_TIMEOUT_MS,
        'Timed out fetching the attachment.',
        closeClient
      )
      if (first.done) {
        return res.status(404).json({ error: 'Attachment not found.' })
      }

      // Everything is a download, whatever the sender claims it is, except pictures the page asks to
      // show inline, and only the kinds a browser can display without running anything.
      const showInline = req.query.inline === '1' && INLINE_IMAGE_TYPES.has(attachment.type)
      res.status(200)
      res.setHeader('Content-Type', showInline ? attachment.type : 'application/octet-stream')
      res.setHeader('Content-Disposition', contentDisposition(attachment.filename, showInline ? 'inline' : 'attachment'))
      res.setHeader('X-Content-Type-Options', 'nosniff')

      const body = Readable.from((async function* () {
        yield first.value
        yield* chunks
      })())
      const decoder = decoderFor(attachment.encoding)

      // The lock must stay held until the last byte, because the file is fetched in pieces as it is sent.
      await (decoder ? pipeline(body, decoder, res) : pipeline(body, res))
    } finally {
      lock.release()
    }
  } catch (error) {
    // Once the file has started, the status can no longer change; just stop. A closed browser tab ends up here too.
    if (res.headersSent) {
      res.destroy()
      return
    }
    if (isTimeoutError(error)) {
      return res.status(504).json({ error: 'The mailbox took too long to answer. Try again.' })
    }
    console.error('Attachment download failed:', error)
    res.status(500).json({ error: 'Could not download the attachment.' })
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

export const config = {
  api: { responseLimit: false },
}
