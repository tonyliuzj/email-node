import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmail, db, deleteEmail, getMessageStates, setMessageStates } from '../src/lib/db.js'

db.prepare("INSERT INTO domains (name, imap_host, imap_port, imap_user, imap_password, imap_tls, is_active) VALUES ('example.test', 'imap.test', 993, 'u', 'p', 1, 1)").run()
const newAddress = name => createEmail(`${name}@example.test`, 'passkey', 'example.test').emailId
const stateOf = (id, validity, uid) => getMessageStates(id, validity, [uid]).get(uid)

test('messages start with no state, and reading marks only the ones named', () => {
  const id = newAddress('reader')
  assert.equal(getMessageStates(id, '7', [1, 2, 3]).size, 0)

  assert.equal(setMessageStates(id, '7', [1, 3], 'read'), 2)
  assert.deepEqual(stateOf(id, '7', 1), { read: true, deleted: false })
  assert.equal(stateOf(id, '7', 2), undefined)
  assert.deepEqual(stateOf(id, '7', 3), { read: true, deleted: false })
})

test('a message can be marked unread again', () => {
  const id = newAddress('flipper')
  setMessageStates(id, '7', [5], 'read')
  setMessageStates(id, '7', [5], 'unread')
  assert.deepEqual(stateOf(id, '7', 5), { read: false, deleted: false })
})

test('deleting hides the message and also counts it as read; marking unread does not bring it back', () => {
  const id = newAddress('deleter')
  setMessageStates(id, '7', [9], 'delete')
  assert.deepEqual(stateOf(id, '7', 9), { read: true, deleted: true })

  setMessageStates(id, '7', [9], 'unread')
  assert.equal(stateOf(id, '7', 9).deleted, true, 'a removed message stays removed')
})

test('one address\'s state never affects another\'s, even for the same message', () => {
  const alice = newAddress('alice1')
  const bob = newAddress('bob1')
  setMessageStates(alice, '7', [4], 'delete')

  assert.equal(stateOf(alice, '7', 4).deleted, true)
  assert.equal(stateOf(bob, '7', 4), undefined, 'the same message is untouched for the other recipient')
})

test('state belongs to one generation of the mailbox', () => {
  const id = newAddress('generations')
  setMessageStates(id, '7', [1], 'delete')
  assert.equal(stateOf(id, '8', 1), undefined, 'after the mailbox is rebuilt, old UIDs mean something else')
})

test('deleting an address removes its states, so a recycled id starts clean', () => {
  const first = newAddress('recycled')
  setMessageStates(first, '7', [1, 2, 3], 'delete')
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM message_states WHERE email_id = ?').get(first).c, 3)

  deleteEmail(first)
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM message_states WHERE email_id = ?').get(first).c, 0, 'the trigger cleaned up')

  const second = newAddress('recycled')
  assert.equal(second, first, 'this test needs SQLite to reuse the id')
  assert.equal(getMessageStates(second, '7', [1, 2, 3]).size, 0, 'the new owner inherits nothing')
})

test('junk UIDs are ignored and only real ones are stored', () => {
  const id = newAddress('junk')
  assert.equal(setMessageStates(id, '7', ['x', -1, 0, null, 1.5, {}, 12, 12], 'read'), 1)
  assert.deepEqual([...getMessageStates(id, '7', [12, -1, 0]).keys()], [12])
  assert.equal(setMessageStates(id, '7', undefined, 'read'), 0)
  assert.equal(setMessageStates(id, '7', 'not a list', 'read'), 0)
})

test('an unknown action is refused rather than guessed at', () => {
  const id = newAddress('strict')
  assert.throws(() => setMessageStates(id, '7', [1], 'obliterate'), /Unknown message action/)
  assert.throws(() => setMessageStates(id, '7', [1], "read'; DROP TABLE emails; --"), /Unknown message action/)
  assert.ok(db.prepare('SELECT COUNT(*) AS c FROM emails').get().c > 0)
})

test('no more than 100 UIDs of one request are used', () => {
  const id = newAddress('bulk')
  assert.equal(setMessageStates(id, '7', Array.from({ length: 300 }, (_, i) => i + 1), 'read'), 100)
})

test('an address keeps a bounded number of states, dropping the oldest', () => {
  const id = newAddress('capped')
  for (let batch = 0; batch < 22; batch += 1) {
    setMessageStates(id, '7', Array.from({ length: 100 }, (_, i) => batch * 100 + i + 1), 'read')
  }
  const count = db.prepare('SELECT COUNT(*) AS c FROM message_states WHERE email_id = ?').get(id).c
  assert.equal(count, 2000)
  assert.ok(stateOf(id, '7', 2200), 'the newest is kept')
})
