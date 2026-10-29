import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { simpleParser } from 'mailparser'
import { applyInlineImages, inlineImagesToFetch } from '../src/lib/inline-images.js'
import { listAttachments } from '../src/lib/attachments.js'
import { sanitizeEmailHtml } from '../src/lib/email-sanitizer.js'
import { parseMessage } from '../src/lib/message-parser.js'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const raw = Buffer.from([
  'From: s@sender.test', 'To: a@x.test', 'Subject: Logo', 'MIME-Version: 1.0',
  'Content-Type: multipart/related; boundary="B"', '',
  '--B', 'Content-Type: text/html; charset=utf-8', '', '<p>Hello</p><img src="cid:logo1" alt="logo">',
  '--B', 'Content-Type: image/png; name="logo.png"', 'Content-Transfer-Encoding: base64', 'Content-ID: <logo1>',
  'Content-Disposition: inline; filename="logo.png"', '', PNG,
  '--B--', '',
].join('\r\n'))

test('the default parser turns a cid: picture into a data: address, which the sanitiser must (and does) remove', async () => {
  const parsed = await simpleParser(raw)
  assert.match(parsed.html, /src="data:image\/png;base64,/)
  assert.doesNotMatch(sanitizeEmailHtml(parsed.html), /src=/, 'so the picture is lost')
})

test('parseMessage leaves the cid: reference alone, and it survives sanitising', async () => {
  const parsed = await parseMessage(raw)
  assert.match(parsed.html, /src="cid:logo1"/)
  assert.match(sanitizeEmailHtml(parsed.html), /src="cid:logo1"/)
})

test('so the page can recognise and fill in the picture', async () => {
  const html = sanitizeEmailHtml((await parseMessage(raw)).html)
  const attachments = listAttachments({
    type: 'multipart/related',
    childNodes: [
      { part: '1', type: 'text/html', size: 40 },
      { part: '2', type: 'image/png', id: '<logo1>', encoding: 'base64', size: 98, disposition: 'inline', dispositionParameters: { filename: 'logo.png' } },
    ],
  })

  const wanted = inlineImagesToFetch(html, attachments)
  assert.deepEqual(wanted.map(item => item.cid), ['logo1'])

  const filled = applyInlineImages(html, { logo1: `data:image/png;base64,${PNG}` })
  assert.match(filled, /<img src="data:image\/png;base64,iVBOR/)
  assert.doesNotMatch(filled, /cid:/)
})

test('other parsing is unchanged: subject, recipients and plain text come through', async () => {
  const parsed = await parseMessage(Buffer.from('From: A <a@x.test>\r\nTo: b@y.test\r\nSubject: Hi there\r\nContent-Type: text/plain\r\n\r\nbody text\r\n'))
  assert.equal(parsed.subject, 'Hi there')
  assert.equal(parsed.to.value[0].address, 'b@y.test')
  assert.equal(parsed.text.trim(), 'body text')
})
