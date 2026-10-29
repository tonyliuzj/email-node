import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { arrivedAfterRegistration } from './mail-window.js'
import { isAddressedTo } from './recipients.js'

export const CONNECT_TIMEOUT_MS = 20_000
export const MAILBOX_OPERATION_TIMEOUT_MS = 120_000

export function isTimeoutError(error) {
  return error?.code === 'ETIMEOUT' || error?.code === 'LockTimeout'
}

export function withTimeout(promise, timeoutMs, message, onTimeout) {
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

// A connection to the catch-all mailbox for one domain, with the error and close handling every caller needs.
export function createImapSession(domain) {
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

  const close = () => {
    try {
      client.close()
    } catch {
      // Ignore close failures; the active operation will surface the original error.
    }
  }

  return { client, imapErrors, close }
}

// Looks one message up and says whether it belongs to this address: it must have arrived while the address
// was registered, and name the address exactly as a recipient. These are the same two rules the message list
// applies. Returns its body structure, or null if it is not theirs (or does not exist).
export async function findOwnedMessage(client, uid, userEmail) {
  const message = await client.fetchOne(
    String(uid),
    { uid: true, internalDate: true, bodyStructure: true, headers: true },
    { uid: true }
  )
  if (!message) return null

  if (!arrivedAfterRegistration(message.internalDate, userEmail.created_at)) return null

  // Only the header block was fetched; parsing it is enough to read the recipients.
  const parsed = await simpleParser(Buffer.concat([Buffer.from(message.headers || ''), Buffer.from('\r\n')]))
  if (!isAddressedTo(parsed, userEmail.email_address)) return null

  return { structure: message.bodyStructure }
}
