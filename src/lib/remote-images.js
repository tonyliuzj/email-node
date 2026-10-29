// Remote images are how senders learn that, when and from where a message was opened. The sanitizer
// parks every http(s) image address in data-remote-src, so nothing loads until the reader asks.
// This file has no dependencies because the inbox page uses it in the browser too.

const BLOCKED_IMAGE = /<img\b[^>]*?\sdata-remote-src=/i

export function hasBlockedRemoteImages(html) {
  return typeof html === 'string' && BLOCKED_IMAGE.test(html)
}

// Only attributes inside <img> tags are touched, never message text that happens to mention the name.
export function restoreRemoteImages(html) {
  if (typeof html !== 'string') return html
  return html.replace(/(<img\b[^>]*?\s)data-remote-src=/gi, '$1src=')
}
