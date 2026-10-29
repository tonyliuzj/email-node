// Pictures a message shows through Content-ID (<img src="cid:logo">) are part of the message itself, not
// something fetched from the internet, so they are shown without asking. This file has no dependencies
// because the inbox page uses it in the browser as well as the server.

// Images a browser can show safely in an <img>. SVG is deliberately absent: it can carry script and links.
export const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'])

export const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024

// The sanitiser writes attribute values with & escaped, so a Content-ID containing one appears as &amp;.
const escapeAttribute = value => String(value).replace(/&/g, '&amp;')

// Replaces src="cid:ID" with the picture itself. images maps a Content-ID to a data: address the page made
// from bytes it fetched from this site. Only well-formed data addresses of the allowed image types are used.
export function applyInlineImages(html, images) {
  if (typeof html !== 'string' || !images) return html

  let result = html
  for (const [cid, dataUri] of Object.entries(images)) {
    if (!/^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=]+$/.test(String(dataUri))) continue
    result = result.split(`src="cid:${escapeAttribute(cid)}"`).join(`src="${dataUri}"`)
  }
  return result
}

// The Content-IDs the page should fetch pictures for: those that are really referenced by the message body.
export function inlineImagesToFetch(html, attachments) {
  if (typeof html !== 'string' || !Array.isArray(attachments)) return []
  return attachments
    .filter(item => item.inline && item.cid && html.includes(`src="cid:${escapeAttribute(item.cid)}"`))
    .slice(0, 20)
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
