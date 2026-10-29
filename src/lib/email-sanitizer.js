import sanitizeHtml from 'sanitize-html'

const allowedTags = sanitizeHtml.defaults.allowedTags.concat([
  'img',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
])

const REMOTE_URL = /^https?:/i
const CONTENT_ID_URL = /^cid:/i

// Browsers read an address differently from how it is written: they drop tabs and line breaks anywhere in
// it, ignore control characters and spaces at either end, and treat a backslash as a slash. A check made on
// the text as written ("starts with http://") is therefore passed by "ht<tab>tp://" and "http:\\host",
// which a browser then loads. Reduce the address to what a browser will actually request before judging it.
function browserView(value) {
  return String(value || '')
    .replace(/[\t\n\r]/g, '')
    .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')
}

export function sanitizeEmailHtml(html, { blockRemoteImages = true } = {}) {
  if (typeof html !== 'string' || html.length === 0) return ''

  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'data-remote-src'],
      table: ['align', 'border', 'cellpadding', 'cellspacing'],
      th: ['align', 'colspan', 'rowspan'],
      td: ['align', 'colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'cid'],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        rel: 'noopener noreferrer',
        target: '_blank',
      }),
      img: (tagName, attribs) => {
        const next = { ...attribs }
        // data-remote-src is ours alone: one that arrived in the message would skip the blocking.
        delete next['data-remote-src']

        // Only a picture that belongs to the message (cid:) is ever left as a source the browser would load.
        // Anything else is either an internet address, which waits for the reader, or an address that can
        // only mean something on this site, which a message has no business pointing at.
        const source = browserView(next.src)

        if (CONTENT_ID_URL.test(source)) {
          next.src = source
        } else {
          delete next.src
          if (REMOTE_URL.test(source)) {
            if (blockRemoteImages) next['data-remote-src'] = source
            else next.src = source
          }
        }

        return { tagName, attribs: next }
      },
    },
  })
}
