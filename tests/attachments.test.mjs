import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  INLINE_IMAGE_TYPES,
  cleanFilename,
  contentDisposition,
  isValidPartId,
  listAttachments,
} from '../src/lib/attachments.js'

// Shapes as imapflow's BODYSTRUCTURE parser produces them: the root multipart has no part number.
const text = (part, extra = {}) => ({ part, type: 'text/plain', parameters: { charset: 'utf-8' }, encoding: '7bit', size: 40, ...extra })
const html = part => ({ part, type: 'text/html', parameters: { charset: 'utf-8' }, encoding: 'quoted-printable', size: 90 })
const file = (part, type, name, extra = {}) => ({
  part, type, parameters: { name }, encoding: 'base64', size: 1234,
  disposition: 'attachment', dispositionParameters: { filename: name }, ...extra,
})

test('a plain message, and a text+html message, have no attachments', () => {
  assert.deepEqual(listAttachments({ type: 'text/plain', parameters: {}, size: 10 }), [])
  assert.deepEqual(listAttachments({ type: 'multipart/alternative', childNodes: [text('1'), html('2')] }), [])
  assert.deepEqual(listAttachments(undefined), [])
  assert.deepEqual(listAttachments(null), [])
})

test('a file attached to a message is listed with its part number, name, type and size', () => {
  const found = listAttachments({
    type: 'multipart/mixed',
    childNodes: [text('1'), file('2', 'application/pdf', 'invoice.pdf')],
  })
  // 1234 bytes as sent in base64 is a file of about 925 bytes
  assert.deepEqual(found, [{ part: '2', filename: 'invoice.pdf', type: 'application/pdf', size: 925, encoding: 'base64', inline: false, cid: '' }])
})

test('an image the body refers to by Content-ID is inline, and its angle brackets are removed', () => {
  const found = listAttachments({
    type: 'multipart/related',
    childNodes: [
      html('1'),
      { part: '2', type: 'image/png', parameters: { name: 'logo.png' }, id: '<logo123@mail>', encoding: 'base64', size: 500, disposition: 'inline', dispositionParameters: { filename: 'logo.png' } },
    ],
  })
  assert.equal(found.length, 1)
  assert.equal(found[0].inline, true)
  assert.equal(found[0].cid, 'logo123@mail')
})

test('an image marked as an attachment is not treated as inline even if it has a Content-ID', () => {
  const found = listAttachments({ type: 'multipart/mixed', childNodes: [text('1'), file('2', 'image/png', 'photo.png', { id: '<p1>' })] })
  assert.equal(found[0].inline, false)
})

test('SVG is never treated as an inline image, because it can carry script', () => {
  assert.equal(INLINE_IMAGE_TYPES.has('image/svg+xml'), false)
  const found = listAttachments({
    type: 'multipart/related',
    childNodes: [html('1'), { part: '2', type: 'image/svg+xml', id: '<x>', size: 10, disposition: 'inline' }],
  })
  assert.equal(found[0].inline, false)
  assert.equal(found[0].cid, '')
})

test('nested multiparts are walked, with the part numbers the server uses', () => {
  const found = listAttachments({
    type: 'multipart/mixed',
    childNodes: [
      { part: '1', type: 'multipart/alternative', childNodes: [text('1.1'), html('1.2')] },
      file('2', 'application/zip', 'a.zip'),
      file('3', 'text/csv', 'data.csv'),
    ],
  })
  assert.deepEqual(found.map(item => [item.part, item.filename]), [['2', 'a.zip'], ['3', 'data.csv']])
})

test('a text file with a name is an attachment, though it is also text/plain', () => {
  const found = listAttachments({ type: 'multipart/mixed', childNodes: [text('1'), text('2', { dispositionParameters: { filename: 'notes.txt' }, disposition: 'attachment' })] })
  assert.deepEqual(found.map(item => item.filename), ['notes.txt'])
})

test('a forwarded email is one attachment, not its inner parts', () => {
  const found = listAttachments({
    type: 'multipart/mixed',
    childNodes: [
      text('1'),
      { part: '2', type: 'message/rfc822', size: 9000, childNodes: [{ part: '2', type: 'multipart/mixed', childNodes: [text('2.1'), file('2.2', 'application/pdf', 'inner.pdf')] }] },
    ],
  })
  assert.equal(found.length, 1)
  assert.equal(found[0].part, '2')
  assert.equal(found[0].type, 'message/rfc822')
  assert.equal(found[0].filename, 'forwarded-message.eml')
})

test('when the whole message is a single file its part is 1', () => {
  const found = listAttachments({ type: 'application/pdf', parameters: { name: 'whole.pdf' }, encoding: 'base64', size: 77, disposition: 'attachment', dispositionParameters: { filename: 'whole.pdf' } })
  assert.equal(found[0].part, '1')
})

test('the name falls back to the Content-Type name, then to a generic one', () => {
  const byName = listAttachments({ type: 'multipart/mixed', childNodes: [text('1'), { part: '2', type: 'application/pdf', parameters: { name: 'from-type.pdf' }, size: 5 }] })
  assert.equal(byName[0].filename, 'from-type.pdf')
  const anonymous = listAttachments({ type: 'multipart/mixed', childNodes: [text('1'), { part: '2', type: 'application/octet-stream', size: 5, disposition: 'attachment' }] })
  assert.equal(anonymous[0].filename, 'attachment')
})

test('no more than 50 are listed', () => {
  const many = { type: 'multipart/mixed', childNodes: Array.from({ length: 80 }, (_, i) => file(String(i + 1), 'application/pdf', `f${i}.pdf`)) }
  assert.equal(listAttachments(many).length, 50)
})

test('file names from a sender cannot be paths or contain control characters', () => {
  assert.equal(cleanFilename('../../etc/passwd'), '_.._etc_passwd')
  assert.equal(cleanFilename('C:\\Windows\\system32\\evil.exe'), 'C:_Windows_system32_evil.exe')
  assert.equal(cleanFilename('bad\r\nname\u0000.txt'), 'badname.txt')
  assert.equal(cleanFilename('.hidden'), 'hidden')
  assert.equal(cleanFilename('   '), 'attachment')
  assert.equal(cleanFilename(undefined, 'fallback'), 'fallback')
  assert.equal(cleanFilename('x'.repeat(400)).length, 150)
})

test('the download header cannot be broken out of, and carries non-ASCII names', () => {
  const nasty = contentDisposition('a"; filename="evil.exe\r\nX-Injected: 1')
  assert.doesNotMatch(nasty, /[\r\n]/)
  assert.equal((nasty.match(/filename="/g) || []).length, 1, 'only one plain filename parameter')

  const unicode = contentDisposition('résumé 日本.pdf')
  assert.match(unicode, /^attachment; filename="r_sum_ __\.pdf"; filename\*=UTF-8''r%C3%A9sum%C3%A9%20%E6%97%A5%E6%9C%AC\.pdf$/)

  assert.match(contentDisposition("it's (1)*.txt"), /filename\*=UTF-8''it%27s%20%281%29%2A\.txt$/)
  assert.match(contentDisposition('pic.png', 'inline'), /^inline; /)
})

test('only well-formed part numbers are accepted', () => {
  for (const good of ['1', '2', '1.2', '3.10.4']) assert.equal(isValidPartId(good), true, good)
  for (const bad of ['', '0x1', '1.', '.1', '1..2', '1;2', '../1', 'TEXT', 'HEADER', '1.MIME', 1, null, undefined, '1'.repeat(10), '1.2.3.4.5.6.7.8.9.10.11']) {
    assert.equal(isValidPartId(bad), false, String(bad))
  }
})

// ---------- showing inline pictures ----------

import { applyInlineImages, formatBytes, inlineImagesToFetch } from '../src/lib/inline-images.js'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

test('a Content-ID reference is replaced by the picture, only inside src attributes', () => {
  const html = '<p>cid:logo mentioned in text</p><img src="cid:logo" alt="a"><img src="cid:other" alt="b">'
  const result = applyInlineImages(html, { logo: PNG })

  assert.match(result, new RegExp(`<img src="${PNG}" alt="a">`))
  assert.match(result, /<img src="cid:other"/, 'a picture that was not supplied is left alone')
  assert.match(result, /<p>cid:logo mentioned in text<\/p>/, 'text is untouched')
})

test('only well-formed data addresses of safe image types are ever inserted', () => {
  const html = '<img src="cid:x">'
  for (const hostile of [
    'javascript:alert(1)',
    'https://tracker.test/p.gif',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,AAAA" onerror="alert(1)',
    'data:image/png;base64,AAAA"><script>',
    'data:image/png,not-base64',
    '',
    undefined,
    42,
  ]) {
    assert.equal(applyInlineImages(html, { x: hostile }), html, String(hostile))
  }
})

test('a Content-ID with an ampersand matches the way the sanitiser writes it', () => {
  assert.match(applyInlineImages('<img src="cid:a&amp;b@x">', { 'a&b@x': PNG }), /src="data:image\/png/)
})

test('a missing map or non-string HTML is handled', () => {
  assert.equal(applyInlineImages('<img src="cid:x">', undefined), '<img src="cid:x">')
  assert.equal(applyInlineImages(null, { x: PNG }), null)
})

test('only pictures the body really refers to are fetched, and no more than 20', () => {
  const html = '<img src="cid:used"><img src="cid:also">'
  const attachments = [
    { inline: true, cid: 'used', part: '2' },
    { inline: true, cid: 'unused', part: '3' },
    { inline: false, cid: '', part: '4' },
    { inline: true, cid: 'also', part: '5' },
  ]
  assert.deepEqual(inlineImagesToFetch(html, attachments).map(item => item.part), ['2', '5'])

  const many = Array.from({ length: 40 }, (_, i) => ({ inline: true, cid: `c${i}`, part: String(i + 1) }))
  assert.equal(inlineImagesToFetch(many.map(item => `<img src="cid:${item.cid}">`).join(''), many).length, 20)
  assert.deepEqual(inlineImagesToFetch(undefined, attachments), [])
  assert.deepEqual(inlineImagesToFetch(html, undefined), [])
})

test('sizes are shown in human units', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1023), '1023 B')
  assert.equal(formatBytes(2048), '2 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')
  assert.equal(formatBytes(-1), '')
  assert.equal(formatBytes(NaN), '')
})
