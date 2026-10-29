import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { getIronSession } from 'iron-session'
import { Client, createRequest, createResponse } from './helpers.mjs'
import { createInitialAdmin, db, getAdmin, getEmailById } from '../src/lib/db.js'
import { resetRateLimitsForTests } from '../src/lib/security.js'
import { sessionOptions } from '../src/lib/session.js'
import { buildAdminSession, getSessionAdmin } from '../src/lib/session-auth.js'
import accountInfo from '../src/pages/api/account/info.js'
import createAddress from '../src/pages/api/users/create.js'
import logoutUser from '../src/pages/api/users/logout.js'

createInitialAdmin('root-admin', 'a long enough password')
db.prepare("INSERT INTO domains (name, imap_host, imap_port, imap_user, imap_password, imap_tls, is_active) VALUES ('example.test', 'imap.test', 993, 'u', 'p', 1, 1)").run()
test.beforeEach(() => resetRateLimitsForTests())

// What the browser's one session cookie currently holds.
async function contents(client) {
  const cookie = [...client.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  const session = await getIronSession(createRequest({ headers: { cookie } }), createResponse(), sessionOptions)
  return { hasEmail: Boolean(session.email), hasAdmin: Boolean(session.admin), admin: session.admin }
}

test('a visitor signing out does not sign the admin out of the same browser', async () => {
  const browser = new Client()

  // Sign the admin in by writing the same kind of cookie the admin login route writes.
  const res = createResponse()
  const session = await getIronSession(createRequest(), res, sessionOptions)
  session.admin = buildAdminSession(getAdmin('root-admin'))
  await session.save()
  browser.storeCookies(res.getHeader('set-cookie'))

  // The same browser then makes a visitor address, so the one cookie holds both.
  const created = await browser.call(createAddress, { body: { emailType: 'username', userEmail: 'shared', domainName: 'example.test' } })
  assert.equal(created.statusCode, 201)
  assert.deepEqual(await contents(browser), { hasEmail: true, hasAdmin: true, admin: (await contents(browser)).admin })

  const out = await browser.call(logoutUser, { body: {} })
  assert.equal(out.statusCode, 200)

  const after = await contents(browser)
  assert.equal(after.hasEmail, false, 'the visitor is signed out')
  assert.equal(after.hasAdmin, true, 'the admin is NOT')
  assert.deepEqual(getSessionAdmin({ session: { get: key => after[key] } }), { username: 'root-admin' })
  assert.equal((await browser.call(accountInfo, { method: 'GET' })).statusCode, 401)
})

test('signing out with nobody signed in is harmless', async () => {
  const browser = new Client()
  assert.equal((await browser.call(logoutUser, { body: {} })).statusCode, 200)
  assert.deepEqual(await contents(browser), { hasEmail: false, hasAdmin: false, admin: undefined })
})

test('the visitor can sign in again after signing out', async () => {
  const browser = new Client()
  const created = await browser.call(createAddress, { body: { emailType: 'username', userEmail: 'again', domainName: 'example.test' } })
  await browser.call(logoutUser, { body: {} })
  assert.equal((await browser.call(accountInfo, { method: 'GET' })).statusCode, 401)
  assert.ok(getEmailById(created.body.emailId), 'signing out does not delete the address')
})
