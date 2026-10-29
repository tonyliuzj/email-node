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

const REMOTE_URL = /^https?:\/\//i

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

        const source = String(next.src || '').trim()
        if (blockRemoteImages && REMOTE_URL.test(source)) {
          next['data-remote-src'] = source
          delete next.src
        }

        return { tagName, attribs: next }
      },
    },
  })
}
