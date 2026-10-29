import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  Base64Decoder,
  PartTooLargeError,
  QuotedPrintableDecoder,
  decoderFor,
  readPartChunks,
} from '../src/lib/part-stream.js'

async function run(decoder, chunks) {
  const out = []
  await pipeline(Readable.from(chunks.map(chunk => Buffer.from(chunk, 'latin1'))), decoder, async function (source) {
    for await (const piece of source) out.push(piece)
  })
  return Buffer.concat(out)
}

// Every way of cutting the input into two chunks, plus into single bytes.
const splits = text => [
  [text],
  ...Array.from({ length: text.length - 1 }, (_, i) => [text.slice(0, i + 1), text.slice(i + 1)]),
  text.split(''),
]

const bytes = Buffer.from(Array.from({ length: 700 }, (_, i) => (i * 7 + 3) % 256))
const wrapped = b64 => b64.replace(/(.{76})/g, '$1\r\n')

test('base64 decodes to the exact bytes however the input is cut up, with or without line breaks', async () => {
  const encoded = wrapped(bytes.toString('base64'))
  for (const chunks of [[encoded], encoded.split('\r\n'), encoded.split('').map(c => c), [encoded.slice(0, 1), encoded.slice(1, 77), encoded.slice(77)]]) {
    assert.deepEqual(await run(new Base64Decoder(), chunks), bytes)
  }
})

test('base64 survives a chunk boundary at every position, including mid-group', async () => {
  const sample = Buffer.from('Hello, wörld! \u0000ÿ binary tail').toString('base64')
  const expected = Buffer.from(sample, 'base64')
  for (const chunks of splits(sample)) {
    assert.deepEqual(await run(new Base64Decoder(), chunks), expected, JSON.stringify(chunks).slice(0, 60))
  }
})

test('base64 handles padding of every length and an empty part', async () => {
  for (const original of ['', 'a', 'ab', 'abc', 'abcd', 'abcde']) {
    const encoded = Buffer.from(original).toString('base64')
    assert.equal((await run(new Base64Decoder(), [encoded])).toString(), original, JSON.stringify(original))
  }
})

test('quoted-printable decodes escapes and joins soft line breaks, wherever the input is cut', async () => {
  const encoded = 'Caf=C3=A9 costs =E2=82=AC5. Long line that is bro=\r\nken here. Equals sign: =3D done.\r\nSecond line.'
  const expected = Buffer.from('Café costs €5. Long line that is broken here. Equals sign: = done.\r\nSecond line.')

  for (const chunks of splits(encoded)) {
    assert.deepEqual(await run(new QuotedPrintableDecoder(), chunks), expected, JSON.stringify(chunks).slice(0, 70))
  }
})

test('quoted-printable does not mistake a decoded "=" for the start of another escape', async () => {
  assert.equal((await run(new QuotedPrintableDecoder(), ['a=3D41 b'])).toString(), 'a=41 b')
})

test('a malformed escape is left as it is instead of being lost', async () => {
  assert.equal((await run(new QuotedPrintableDecoder(), ['price = 5, id=G1, end='])).toString(), 'price = 5, id=G1, end=')
})

test('only base64 and quoted-printable need decoding; everything else is passed through as bytes', () => {
  assert.ok(decoderFor('base64') instanceof Base64Decoder)
  assert.ok(decoderFor('BASE64') instanceof Base64Decoder)
  assert.ok(decoderFor('quoted-printable') instanceof QuotedPrintableDecoder)
  for (const plain of ['7bit', '8bit', 'binary', '', undefined, null, 'x-unknown']) assert.equal(decoderFor(plain), null, String(plain))
})

// ---------- reading a part from the mailbox ----------

function fakeClient(raw, calls = []) {
  return {
    async fetchOne(uid, query, options) {
      calls.push({ uid, query, options })
      const { key, start, maxLength } = query.bodyParts[0]
      const slice = raw.subarray(start, start + maxLength)
      return slice.length ? { bodyParts: new Map([[key, slice]]) } : { bodyParts: new Map() }
    },
  }
}
const collect = async generator => {
  const parts = []
  for await (const piece of generator) parts.push(piece)
  return Buffer.concat(parts)
}

test('a part is read in chunks until the server has no more, and nothing is lost or repeated', async () => {
  const raw = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))
  const calls = []
  const result = await collect(readPartChunks(fakeClient(raw, calls), 42, '1.2', { maxBytes: 5000, chunkBytes: 300 }))

  assert.deepEqual(result, raw)
  assert.deepEqual(calls.map(call => call.query.bodyParts[0].start), [0, 300, 600, 900])
  assert.ok(calls.every(call => call.uid === '42' && call.options.uid === true && call.query.bodyParts[0].key === '1.2'))
})

test('a part that is an exact multiple of the chunk size ends cleanly', async () => {
  const raw = Buffer.alloc(600, 7)
  assert.deepEqual(await collect(readPartChunks(fakeClient(raw), 1, '2', { maxBytes: 5000, chunkBytes: 300 })), raw)
})

test('a missing or empty part yields nothing', async () => {
  assert.equal((await collect(readPartChunks(fakeClient(Buffer.alloc(0)), 1, '2', { maxBytes: 100 }))).length, 0)
})

test('a server that sends more than allowed is cut off instead of streamed forever', async () => {
  const raw = Buffer.alloc(10_000, 1)
  await assert.rejects(collect(readPartChunks(fakeClient(raw), 1, '2', { maxBytes: 1000, chunkBytes: 400 })), PartTooLargeError)
})

test('reading a nested base64 part end to end gives back the original file', async () => {
  const original = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 13) % 256))
  const encoded = Buffer.from(wrapped(original.toString('base64')))
  const out = []
  await pipeline(
    Readable.from(readPartChunks(fakeClient(encoded), 9, '1.2', { maxBytes: 100_000, chunkBytes: 777 })),
    decoderFor('base64'),
    async function (source) { for await (const piece of source) out.push(piece) }
  )
  assert.deepEqual(Buffer.concat(out), original)
})
