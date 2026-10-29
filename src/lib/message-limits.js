// Every refresh sends the messages it fetched to the browser, and anyone can email an address a huge
// message. These caps keep one such message from bloating each response or freezing the page.
export const MAX_TEXT_CHARS = 200_000
export const MAX_HTML_CHARS = 1_000_000

// Over-long text is cut. Over-long HTML is dropped rather than cut, because a cut would leave broken
// markup; the reader then falls back to the text version.
export function limitMessageBody({ text, html }) {
  const textTooLong = typeof text === 'string' && text.length > MAX_TEXT_CHARS
  const htmlTooLong = typeof html === 'string' && html.length > MAX_HTML_CHARS

  return {
    text: textTooLong ? text.slice(0, MAX_TEXT_CHARS) : text,
    html: htmlTooLong ? null : html,
    truncated: textTooLong || htmlTooLong,
  }
}
