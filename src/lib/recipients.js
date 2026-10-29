// IMAP SEARCH HEADER is a substring match, so searching a shared catch-all mailbox for "a@example.com"
// also returns mail addressed to "ba@example.com". Messages therefore have to be checked again against
// their parsed recipients before they are shown to anyone.

const ADDRESS_PATTERN = /[^\s<>,;"'()]+@[^\s<>,;"'()]+/g

// Headers an MTA adds with the address a message was actually delivered to. They cover Bcc, mailing
// lists and catch-all routing, where the To header names someone else.
const DELIVERY_HEADERS = ['delivered-to', 'x-original-to', 'envelope-to', 'x-envelope-to']

function collectAddresses(value, into) {
  if (!value) return

  if (Array.isArray(value)) {
    value.forEach(item => collectAddresses(item, into))
    return
  }

  if (typeof value === 'string') {
    for (const match of value.toLowerCase().matchAll(ADDRESS_PATTERN)) {
      into.add(match[0].replace(/\.+$/, ''))
    }
    return
  }

  // mailparser AddressObject: { value: [{ address, name, group? }], text }
  if (Array.isArray(value.value)) {
    for (const entry of value.value) {
      if (entry?.address) into.add(String(entry.address).trim().toLowerCase())
      if (Array.isArray(entry?.group)) collectAddresses({ value: entry.group }, into)
    }
    return
  }

  if (typeof value.text === 'string') collectAddresses(value.text, into)
}

export function getMessageRecipients(parsed) {
  const addresses = new Set()

  collectAddresses(parsed?.to, addresses)
  collectAddresses(parsed?.cc, addresses)
  collectAddresses(parsed?.bcc, addresses)

  for (const header of DELIVERY_HEADERS) {
    collectAddresses(parsed?.headers?.get?.(header), addresses)
  }

  return addresses
}

export function isAddressedTo(parsed, address) {
  const target = String(address || '').trim().toLowerCase()
  return Boolean(target) && getMessageRecipients(parsed).has(target)
}
