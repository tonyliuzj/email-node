import { Transform } from 'node:stream'

// Streams one part of a message out of the mail box and decodes it.
//
// The part is fetched as raw bytes, a chunk at a time, and decoded here according to the encoding the
// message's BODYSTRUCTURE gives for it. The IMAP library can decode for us, but it learns the encoding from
// a separate request for the part's own header, which some servers do not answer for parts nested inside
// other parts, and then it quietly returns the still-encoded text. This does not depend on that.

export const CHUNK_BYTES = 256 * 1024

export class PartTooLargeError extends Error {
  constructor() {
    super('The attachment is larger than the allowed size.')
    this.code = 'ETOOLARGE'
  }
}

// base64 -> bytes. A chunk can end in the middle of a group of four characters, so the remainder waits for
// the next chunk. Line breaks and any stray characters are ignored, as the format allows.
export class Base64Decoder extends Transform {
  constructor() {
    super()
    this.pending = ''
  }

  _transform(chunk, _encoding, callback) {
    const text = this.pending + chunk.toString('latin1').replace(/[^A-Za-z0-9+/]/g, '')
    const usable = text.length - (text.length % 4)
    this.pending = text.slice(usable)
    if (usable > 0) this.push(Buffer.from(text.slice(0, usable), 'base64'))
    callback()
  }

  _flush(callback) {
    // Padding ("=") was dropped above; a short final group decodes fine without it.
    if (this.pending) this.push(Buffer.from(this.pending, 'base64'))
    callback()
  }
}

// quoted-printable -> bytes: =XX is a byte and a "=" at the end of a line joins it to the next. A chunk can
// end halfway through an escape, so a possible start of one is held back for the next chunk.
export class QuotedPrintableDecoder extends Transform {
  constructor() {
    super()
    this.pending = ''
  }

  _transform(chunk, _encoding, callback) {
    let text = this.pending + chunk.toString('latin1')
    this.pending = ''

    const unfinished = /=[0-9A-Fa-f]?$|=\r$/.exec(text)
    if (unfinished) {
      this.pending = text.slice(unfinished.index)
      text = text.slice(0, unfinished.index)
    }

    this.push(Buffer.from(decodeQuotedPrintable(text), 'latin1'))
    callback()
  }

  _flush(callback) {
    if (this.pending) this.push(Buffer.from(this.pending, 'latin1'))
    callback()
  }
}

function decodeQuotedPrintable(text) {
  return text
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
}

// 7bit, 8bit, binary and anything unrecognised are already the bytes themselves.
export function decoderFor(encoding) {
  switch (String(encoding || '').toLowerCase()) {
    case 'base64':
      return new Base64Decoder()
    case 'quoted-printable':
      return new QuotedPrintableDecoder()
    default:
      return null
  }
}

// Yields the raw (still encoded) bytes of a part, one chunk at a time, and stops with PartTooLargeError if the
// server sends more than maxBytes. The caller must already hold the mailbox lock.
export async function* readPartChunks(client, uid, part, { maxBytes, chunkBytes = CHUNK_BYTES } = {}) {
  let received = 0

  while (true) {
    const message = await client.fetchOne(
      String(uid),
      { uid: true, bodyParts: [{ key: part, start: received, maxLength: chunkBytes }] },
      { uid: true }
    )
    const chunk = message?.bodyParts?.get(part)
    if (!chunk || chunk.length === 0) return

    received += chunk.length
    if (Number.isFinite(maxBytes) && received > maxBytes) throw new PartTooLargeError()

    yield chunk
    if (chunk.length < chunkBytes) return
  }
}
