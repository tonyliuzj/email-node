// Every address shares one catch-all mailbox, so mail is not an address's just because it sits there.
// It belongs to the address only if it arrived while that address was registered. Without this, deleting
// or expiring an address would hand the previous owner's mail (password resets, receipts) to whoever
// registers the same name next, and anyone could register a name to read what was already sent to it.

// The mail server's clock and this server's can differ a little. The cost of too small a margin is that
// the first message after sign-up is hidden when the mail server runs behind (sign up, then wait for the
// verification email is the main use), so the margin is generous.
const DEFAULT_CLOCK_SKEW_SECONDS = 120

function skewMs() {
  const seconds = Number.parseInt(process.env.MAIL_CLOCK_SKEW_SECONDS ?? '', 10)
  return (Number.isInteger(seconds) && seconds >= 0 ? seconds : DEFAULT_CLOCK_SKEW_SECONDS) * 1000
}

// SQLite writes UTC as "YYYY-MM-DD HH:MM:SS".
export function parseSqliteTimestamp(value) {
  const time = Date.parse(`${String(value || '').replace(' ', 'T')}Z`)
  return Number.isFinite(time) ? time : null
}

export function arrivedAfterRegistration(internalDate, createdAt) {
  const registered = parseSqliteTimestamp(createdAt)
  // Without a registration time there is nothing to compare with, and hiding mail would be worse.
  if (registered === null) return true

  // INTERNALDATE is when the mail server received the message. The Date header is whatever the sender
  // wrote, so it cannot be used for this. A message with no usable date is hidden.
  const arrived = internalDate instanceof Date ? internalDate.getTime() : Date.parse(internalDate)
  return Number.isFinite(arrived) && arrived >= registered - skewMs()
}
