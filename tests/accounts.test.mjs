import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { getIronSession } from 'iron-session'
import { Client, createRequest, createResponse } from './helpers.mjs'
import {
  countAddressesForDomain,
  createEmail,
  createInitialAdmin,
  db,
  deleteDomainWithAddresses,
  getAdmin,
  isSetupRequired,
  spendPasswordCheckTime,
  updateAdminPassword,
  updateAdminUsername,
  verifyEmail,
} from '../src/lib/db.js'
import { resetRateLimitsForTests } from '../src/lib/security.js'
import { sessionOptions } from '../src/lib/session.js'
import { buildAdminSession, getSessionAdmin, requireAdmin } from '../src/lib/session-auth.js'
import accountInfo from '../src/pages/api/account/info.js'
import accountDelete from '../src/pages/api/account/delete.js'
import regeneratePasskey from '../src/pages/api/account/regenerate-passkey.js'
import createAddress from '../src/pages/api/users/create.js'
import loginUser from '../src/pages/api/users/login.js'

function addDomain(name) {
  return db
    .prepare(
      `INSERT INTO domains (name, imap_host, imap_port, imap_user, imap_password, imap_tls, is_active)
       VALUES (?, 'imap.test', 993, 'user', 'secret', 1, 1)`
    )
    .run(name).lastInsertRowid
}

addDomain('example.test')
const secondDomainId = addDomain('second.test')

test.beforeEach(() => resetRateLimitsForTests())

async function signUp(client, name, domainName = 'example.test') {
  const res = await client.call(createAddress, {
    body: { emailType: 'username', userEmail: name, domainName },
  })
  assert.equal(res.statusCode, 201, JSON.stringify(res.body))
  return res.body
}

async function signIn(client, address, passkey) {
  return client.call(loginUser, { body: { email: address, passkey } })
}

const whoAmI = client => client.call(accountInfo, { method: 'GET' })

test('creating an address signs you in, and the passkey signs you in elsewhere', async () => {
  const phone = new Client()
  const created = await signUp(phone, 'alice')
  assert.equal(created.email.email, 'alice@example.test')

  const info = await whoAmI(phone)
  assert.equal(info.statusCode, 200)
  assert.equal(info.body.emails[0].email_address, 'alice@example.test')

  const laptop = new Client()
  assert.equal((await signIn(laptop, 'alice@example.test', created.passkey)).statusCode, 200)
  assert.equal((await whoAmI(laptop)).statusCode, 200)
})

test('a wrong passkey, an unknown address and malformed input are all rejected without a server error', async () => {
  const created = await signUp(new Client(), 'bob')
  const stranger = new Client()

  assert.equal((await signIn(stranger, 'bob@example.test', 'wrong')).statusCode, 401)
  assert.equal((await signIn(stranger, 'nobody@example.test', 'wrong')).statusCode, 401)
  assert.equal((await signIn(stranger, 'bob@example.test', 12345)).statusCode, 400)
  assert.equal((await signIn(stranger, 'bob@example.test', { $ne: '' })).statusCode, 400)
  assert.equal((await signIn(stranger, 'bob@example.test', created.passkey)).statusCode, 200)
})

test('an unknown address takes as long to reject as a wrong passkey', () => {
  createEmail('timing@example.test', 'right-passkey', 'example.test')

  const time = fn => {
    const start = process.hrtime.bigint()
    fn()
    return Number(process.hrtime.bigint() - start) / 1e6
  }

  const unknown = time(() => verifyEmail('ghost@example.test', 'whatever'))
  const wrong = time(() => verifyEmail('timing@example.test', 'wrong-passkey'))

  // Without the fix an unknown address returns in well under a millisecond; a bcrypt check takes tens.
  assert.ok(unknown > 10, `unknown address was rejected in ${unknown.toFixed(2)}ms`)
  assert.ok(wrong > 10, `wrong passkey was rejected in ${wrong.toFixed(2)}ms`)
  assert.ok(time(() => spendPasswordCheckTime('x')) > 10)
})

test('regenerating the passkey signs out every other device but not this one', async () => {
  const phone = new Client()
  const created = await signUp(phone, 'carol')

  const laptop = new Client()
  await signIn(laptop, 'carol@example.test', created.passkey)
  assert.equal((await whoAmI(laptop)).statusCode, 200)

  const regenerated = await phone.call(regeneratePasskey, { body: { emailId: created.emailId } })
  assert.equal(regenerated.statusCode, 200)

  assert.equal((await whoAmI(phone)).statusCode, 200, 'the device that regenerated stays signed in')
  assert.equal((await whoAmI(laptop)).statusCode, 401, 'other devices are signed out')

  assert.equal((await signIn(new Client(), 'carol@example.test', created.passkey)).statusCode, 401)
  assert.equal((await signIn(new Client(), 'carol@example.test', regenerated.body.newPasskey)).statusCode, 200)
})

test('you cannot regenerate or delete somebody else\'s address by guessing its id', async () => {
  const dave = new Client()
  await signUp(dave, 'dave')
  const erin = new Client()
  const erinCreated = await signUp(erin, 'erin')

  assert.equal((await dave.call(regeneratePasskey, { body: { emailId: erinCreated.emailId } })).statusCode, 403)
  assert.equal((await dave.call(accountDelete, { body: { emailId: erinCreated.emailId } })).statusCode, 403)
  assert.equal((await whoAmI(erin)).statusCode, 200)
})

test('deleting an address removes it and signs it out everywhere', async () => {
  const phone = new Client()
  const created = await signUp(phone, 'frank')
  const laptop = new Client()
  await signIn(laptop, 'frank@example.test', created.passkey)

  const deleted = await phone.call(accountDelete, { body: { emailId: created.emailId } })
  assert.equal(deleted.statusCode, 200)

  assert.equal((await whoAmI(phone)).statusCode, 401)
  assert.equal((await whoAmI(laptop)).statusCode, 401)
  assert.equal((await signIn(new Client(), 'frank@example.test', created.passkey)).statusCode, 401)
})

test('a stale cookie for a deleted address cannot be used on a new address that reuses its id', async () => {
  const owner = new Client()
  const created = await signUp(owner, 'grace')
  const staleCookie = owner.clone()

  assert.equal((await owner.call(accountDelete, { body: { emailId: created.emailId } })).statusCode, 200)

  // SQLite hands the freed id to the next row, so the new address ends up with the old id.
  const newcomer = new Client()
  const reused = await signUp(newcomer, 'heidi')
  assert.equal(reused.emailId, created.emailId, 'this test needs the id to be reused')

  const attempt = await whoAmI(staleCookie)
  assert.equal(attempt.statusCode, 401)
  assert.notEqual(attempt.body?.emails?.[0]?.email_address, 'heidi@example.test')
})

test('a session issued before sessions were bound to a credential still works, and is bound on first use', async () => {
  const created = await signUp(new Client(), 'ivan')
  const email = db.prepare('SELECT * FROM emails WHERE id = ?').get(created.emailId)

  // Exactly what older versions stored in the cookie: no credential fingerprint.
  const legacy = new Client()
  const res = createResponse()
  const session = await getIronSession(createRequest(), res, sessionOptions)
  session.email = {
    id: email.id,
    email_id: email.id,
    email_address: email.email_address,
    domain_name: email.domain_name,
  }
  await session.save()
  legacy.storeCookies(res.getHeader('set-cookie'))

  assert.equal((await whoAmI(legacy)).statusCode, 200)

  // Bound now, so changing the passkey signs it out like any other session.
  const other = new Client()
  await signIn(other, 'ivan@example.test', created.passkey)
  assert.equal((await other.call(regeneratePasskey, { body: { emailId: created.emailId } })).statusCode, 200)
  assert.equal((await whoAmI(legacy)).statusCode, 401)
})

test('random addresses use the domain that was asked for', async () => {
  const res = await new Client().call(createAddress, {
    body: { emailType: 'random', domainName: 'second.test' },
  })

  assert.equal(res.statusCode, 201, JSON.stringify(res.body))
  assert.match(res.body.email.email, /@second\.test$/)
})

test('an address that is already taken is refused', async () => {
  await signUp(new Client(), 'judy')
  const again = await new Client().call(createAddress, {
    body: { emailType: 'username', userEmail: 'judy', domainName: 'example.test' },
  })
  assert.equal(again.statusCode, 400)
  assert.match(again.body.error, /already taken/i)
})

test('deleting a domain removes only its own addresses, and renaming is guarded by the count', () => {
  createEmail('one@second.test', 'p1', 'second.test')
  createEmail('two@second.test', 'p2', 'second.test')
  const before = countAddressesForDomain('example.test')
  assert.ok(countAddressesForDomain('second.test') >= 2)

  const result = deleteDomainWithAddresses(secondDomainId)
  assert.ok(result.removedAddresses >= 2)
  assert.equal(countAddressesForDomain('second.test'), 0)
  assert.equal(countAddressesForDomain('example.test'), before, 'other domains are untouched')
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM domains WHERE id = ?').get(secondDomainId).c, 0)

  assert.equal(deleteDomainWithAddresses(secondDomainId), null, 'deleting twice reports not found')
})

test('admin sessions are bound to the password and username they were issued for', () => {
  assert.equal(isSetupRequired(), true)
  assert.equal(createInitialAdmin('root-admin', 'a long enough password').success, true)

  const sessionFor = admin => ({ data: { admin }, get(key) { return this.data[key] } })
  const original = sessionFor(buildAdminSession(getAdmin('root-admin')))

  assert.deepEqual(getSessionAdmin({ session: original }), { username: 'root-admin' })

  // Cookies from before sessions carried a fingerprint must sign in again.
  assert.equal(getSessionAdmin({ session: sessionFor({ username: 'root-admin' }) }), null)

  assert.equal(updateAdminPassword('root-admin', 'a different long password').success, true)
  assert.equal(getSessionAdmin({ session: original }), null, 'old sessions die when the password changes')

  const refreshed = sessionFor(buildAdminSession(getAdmin('root-admin')))
  assert.deepEqual(getSessionAdmin({ session: refreshed }), { username: 'root-admin' })

  assert.equal(updateAdminUsername('root-admin', '  new-name  ').username, 'new-name')
  assert.ok(getAdmin('new-name'), 'the saved username has no stray spaces, so it can log in')
  assert.equal(getSessionAdmin({ session: refreshed }), null, 'sessions for the old username die')
})

test('admin username changes refuse short and duplicate names', () => {
  db.prepare('INSERT INTO admin (username, password_hash) VALUES (?, ?)').run('other-admin', 'x')

  assert.equal(updateAdminUsername('new-name', 'ab').success, false)
  const duplicate = updateAdminUsername('new-name', 'other-admin')
  assert.equal(duplicate.success, false)
  assert.match(duplicate.error, /already exists/i)
})

test('requireAdmin answers 401 when the session is missing or stale', () => {
  const res = createResponse()
  const result = requireAdmin({ session: { get: () => undefined } }, res)

  assert.equal(result, null)
  assert.equal(res.statusCode, 401)
})
