import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from './helpers.mjs'
import { db, getMessageStates } from '../src/lib/db.js'
import { resetRateLimitsForTests } from '../src/lib/security.js'
import createAddress from '../src/pages/api/users/create.js'
import messageState from '../src/pages/api/emails/state.js'

db.prepare("INSERT INTO domains (name, imap_host, imap_port, imap_user, imap_password, imap_tls, is_active) VALUES ('example.test', 'imap.test', 993, 'u', 'p', 1, 1)").run()
test.beforeEach(() => resetRateLimitsForTests())

async function visitor(name, ip) {
  const client = new Client(ip)
  const res = await client.call(createAddress, { body: { emailType: 'username', userEmail: name, domainName: 'example.test' } })
  assert.equal(res.statusCode, 201)
  client.emailId = res.body.emailId
  return client
}
const act = (client, body) => client.call(messageState, { body })

test('a signed-in visitor can mark messages read, unread and removed', async () => {
  const me = await visitor('statey', '203.0.113.20')

  assert.equal((await act(me, { action: 'read', uids: [1, 2], uidValidity: '99' })).statusCode, 200)
  assert.deepEqual(getMessageStates(me.emailId, '99', [1, 2]).get(2), { read: true, deleted: false })

  await act(me, { action: 'unread', uids: [2], uidValidity: '99' })
  assert.equal(getMessageStates(me.emailId, '99', [2]).get(2).read, false)

  const removed = await act(me, { action: 'delete', uids: [1], uidValidity: '99' })
  assert.deepEqual(removed.body, { success: true, changed: 1 })
  assert.equal(getMessageStates(me.emailId, '99', [1]).get(1).deleted, true)
})

test('it needs a signed-in visitor', async () => {
  const res = await act(new Client('203.0.113.21'), { action: 'delete', uids: [1], uidValidity: '99' })
  assert.equal(res.statusCode, 401)
})

test('only POST is accepted, and a request from another site is refused', async () => {
  const me = await visitor('picky', '203.0.113.22')
  assert.equal((await me.call(messageState, { method: 'GET' })).statusCode, 405)

  const crossSite = await me.call(messageState, {
    body: { action: 'delete', uids: [1], uidValidity: '99' },
    headers: { origin: 'https://evil.example' },
  })
  assert.equal(crossSite.statusCode, 403)
  assert.equal(getMessageStates(me.emailId, '99', [1]).size, 0, 'nothing was changed')
})

test('bad input is rejected with a 400 and changes nothing', async () => {
  const me = await visitor('strictly', '203.0.113.23')
  const bad = [
    { action: 'obliterate', uids: [1], uidValidity: '99' },
    { action: 'delete', uids: [], uidValidity: '99' },
    { action: 'delete', uids: 'all', uidValidity: '99' },
    { action: 'delete', uids: [1, 'x'], uidValidity: '99' },
    { action: 'delete', uids: [0], uidValidity: '99' },
    { action: 'delete', uids: [-3], uidValidity: '99' },
    { action: 'delete', uids: [1.5], uidValidity: '99' },
    { action: 'delete', uids: Array.from({ length: 101 }, (_, i) => i + 1), uidValidity: '99' },
    { action: 'delete', uids: [1] },
    { action: 'delete', uids: [1], uidValidity: 'abc' },
    { action: 'delete', uids: [1], uidValidity: '9'.repeat(30) },
    {},
  ]
  for (const body of bad) {
    assert.equal((await act(me, body)).statusCode, 400, JSON.stringify(body).slice(0, 80))
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM message_states WHERE email_id = ?').get(me.emailId).c, 0)
})

test('one visitor cannot change what another visitor sees', async () => {
  const alice = await visitor('alicestate', '203.0.113.24')
  const bob = await visitor('bobstate', '203.0.113.25')

  await act(alice, { action: 'delete', uids: [7], uidValidity: '99' })
  assert.equal(getMessageStates(bob.emailId, '99', [7]).size, 0, 'bob still has message 7')
  assert.equal(getMessageStates(alice.emailId, '99', [7]).size, 1)
})
