// Attachments are listed from the message's BODYSTRUCTURE (a small description of its parts) rather than
// by parsing the message, so a big attachment is never downloaded just to show its name and size.

import { INLINE_IMAGE_TYPES } from './inline-images.js'

export { INLINE_IMAGE_TYPES }

const MAX_LISTED = 50
const MAX_FILENAME_LENGTH = 150

export const MAX_ATTACHMENT_BYTES = (() => {
  const megabytes = Number.parseInt(process.env.MAX_ATTACHMENT_MB ?? '', 10)
  return (Number.isInteger(megabytes) && megabytes > 0 ? megabytes : 15) * 1024 * 1024
})()

export function isValidPartId(part) {
  return typeof part === 'string' && /^\d{1,3}(\.\d{1,3}){0,9}$/.test(part)
}

// A name is only ever used for display and for the download's file name, never as a path, but it still
// comes from the sender, so strip anything that could be a path or a control character.
export function cleanFilename(value, fallback = 'attachment') {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, MAX_FILENAME_LENGTH)
  return cleaned || fallback
}

// Content-Disposition with a plain-ASCII fallback and the full UTF-8 name for browsers that understand it.
export function contentDisposition(filename, disposition = 'attachment') {
  const name = cleanFilename(filename)
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_')
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`
}

// BODYSTRUCTURE reports the size as sent. Base64 turns 3 bytes into 4, so the file is about three quarters of it.
function decodedSize(node) {
  const sent = Number.isFinite(node.size) ? node.size : 0
  return String(node.encoding || '').toLowerCase() === 'base64' ? Math.floor(sent * 0.75) : sent
}

export function listAttachments(structure) {
  const found = []

  const visit = node => {
    if (!node || found.length >= MAX_LISTED) return

    const type = String(node.type || '').toLowerCase()

    // A forwarded email is one attachment. Its own parts share its part number and are not separate files.
    const isEmbeddedMessage = type === 'message/rfc822'
    if (!isEmbeddedMessage && Array.isArray(node.childNodes) && node.childNodes.length > 0) {
      node.childNodes.forEach(visit)
      return
    }
    if (type.startsWith('multipart/')) return

    const disposition = String(node.disposition || '').toLowerCase()
    const filename = node.dispositionParameters?.filename || node.parameters?.name || ''

    // The readable parts of the message itself are not attachments.
    const isBodyText = (type === 'text/plain' || type === 'text/html') && disposition !== 'attachment' && !filename
    if (isBodyText) return

    const contentId = node.id ? String(node.id).trim().replace(/^<|>$/g, '') : ''
    const isInlineImage = Boolean(contentId) && INLINE_IMAGE_TYPES.has(type) && disposition !== 'attachment'

    found.push({
      // A message that is a single part has no part number; its only part is 1.
      part: node.part || '1',
      filename: cleanFilename(filename, isEmbeddedMessage ? 'forwarded-message.eml' : 'attachment'),
      type,
      size: decodedSize(node),
      // The size as sent, before decoding: what the download should receive from the mail server.
      encodedSize: Number.isFinite(node.size) ? node.size : 0,
      // How the part was encoded for transport; the download decodes it with this (see part-stream.js).
      encoding: String(node.encoding || '').toLowerCase(),
      inline: isInlineImage,
      cid: isInlineImage ? contentId : '',
    })
  }

  visit(structure)
  return found
}
