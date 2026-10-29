import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { simpleParser } from 'mailparser'
import { isAddressedTo } from '../src/lib/recipients.js'

async function parse(headers) {
  const raw = [...Object.entries(headers).map(([name, value]) => `${name}: ${value}`), '', 'Hello'].join('\r\n')
  return simpleParser(raw)
}

test('mail for a longer address is NOT shown to the owner of a shorter one that it contains', async () => {
  // IMAP header search for "a@example.com" also returns these, because it is a substring match.
  const message = await parse({ From: 'x@sender.test', To: 'ba@example.com', Subject: 's' })
  assert.equal(isAddressedTo(message, 'a@example.com'), false)

  const dotted = await parse({ From: 'x@sender.test', To: 'big.john@example.com' })
  assert.equal(isAddressedTo(dotted, 'john@example.com'), false)
})

test('mail whose address merely has the wanted one as a prefix is not matched', async () => {
  const message = await parse({ From: 'x@sender.test', To: 'john@example.com.evil.test' })
  assert.equal(isAddressedTo(message, 'john@example.com'), false)
})

test('matches the exact address in To, with display names and any case', async () => {
  const plain = await parse({ From: 'x@sender.test', To: 'john@example.com' })
  assert.equal(isAddressedTo(plain, 'john@example.com'), true)

  const named = await parse({ From: 'x@sender.test', To: '"John Q. Public" <John@Example.COM>' })
  assert.equal(isAddressedTo(named, 'john@example.com'), true)
})

test('matches among several recipients and in Cc', async () => {
  const many = await parse({ From: 'x@sender.test', To: 'alice@example.com, john@example.com' })
  assert.equal(isAddressedTo(many, 'john@example.com'), true)
  assert.equal(isAddressedTo(many, 'alic@example.com'), false)

  const cc = await parse({ From: 'x@sender.test', To: 'alice@example.com', Cc: 'john@example.com' })
  assert.equal(isAddressedTo(cc, 'john@example.com'), true)
})

test('matches delivery headers, which cover Bcc and mailing-list mail', async () => {
  const bcc = await parse({
    From: 'x@sender.test',
    To: 'list@lists.test',
    'Delivered-To': 'john@example.com',
  })
  assert.equal(isAddressedTo(bcc, 'john@example.com'), true)

  const original = await parse({ From: 'x@sender.test', To: 'catchall@example.com', 'X-Original-To': 'john@example.com' })
  assert.equal(isAddressedTo(original, 'john@example.com'), true)
})

test('a delivery header for someone else does not match', async () => {
  const message = await parse({ From: 'x@sender.test', To: 'list@lists.test', 'Delivered-To': 'jane@example.com' })
  assert.equal(isAddressedTo(message, 'john@example.com'), false)
})

test('nothing matches an empty address or an empty message', async () => {
  const message = await parse({ From: 'x@sender.test', Subject: 'no recipients' })
  assert.equal(isAddressedTo(message, 'john@example.com'), false)
  assert.equal(isAddressedTo(message, ''), false)
  assert.equal(isAddressedTo(null, 'john@example.com'), false)
})
