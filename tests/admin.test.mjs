import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  beginTotpEnrollment,
  countInactiveAddresses,
  createEmail,
  createInitialAdmin,
  db,
  deleteEmailsByIds,
  disableTotp,
  enableTotp,
  getAddressRetentionDays,
  getAdmin,
  getEmailById,
  getRecoveryCodeHashes,
  listAddresses,
  purgeInactiveAddresses,
  setAddressRetentionDays,
  touchAddressActivity,
  verifyEmail,
} from '../src/lib/db.js'
import { authenticateAdmin, confirmAdminPassword } from '../src/lib/admin-auth.js'
import { clearFailures, isLockedOut, recordFailure, resetRateLimitsForTests } from '../src/lib/security.js'
import { encryptSecret } from '../src/lib/secret-store.js'
import { buildAdminSession, getSessionAdmin } from '../src/lib/session-auth.js'
import { generateRecoveryCodes, generateSecret, hashRecoveryCode, totpAt } from '../src/lib/totp.js'

const PASSWORD = 'a long enough password'

createInitialAdmin('root-admin', PASSWORD)
db.prepare("INSERT OR IGNORE INTO domains (name, imap_host, imap_port, imap_user, imap_password, imap_tls, is_active) VALUES ('example.test', 'imap.test', 993, 'u', 'p', 1, 1)").run()

test.beforeEach(() => {
  resetRateLimitsForTests()
  disableTotp('root-admin')
})

const sessionFor = admin => ({ data: { admin }, get(key) { return this.data[key] } })

function enableTwoFactor() {
  const secret = generateSecret()
  const recoveryCodes = generateRecoveryCodes(3)
  beginTotpEnrollment('root-admin', encryptSecret(secret))
  enableTotp('root-admin', recoveryCodes.map(hashRecoveryCode), 0)
  return { secret, recoveryCodes }
}

// ---------- password + lockout ----------

test('the right password signs in, a wrong one does not', () => {
  assert.equal(authenticateAdmin({ username: 'root-admin', password: PASSWORD }).status, 'ok')
  assert.equal(authenticateAdmin({ username: 'root-admin', password: 'wrong' }).status, 'invalid')
  assert.equal(authenticateAdmin({ username: 'nobody', password: PASSWORD }).status, 'invalid')
  assert.equal(authenticateAdmin({ username: 'root-admin', password: { $ne: 1 } }).status, 'invalid')
  assert.equal(authenticateAdmin({}).status, 'invalid')
})

test('repeated failures lock the account, even against the right password, whichever IP they come from', () => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    assert.equal(authenticateAdmin({ username: 'root-admin', password: `guess-${attempt}` }).status, 'invalid')
  }

  assert.equal(authenticateAdmin({ username: 'root-admin', password: PASSWORD }).status, 'locked')
  assert.equal(confirmAdminPassword('root-admin', PASSWORD), 'locked')
})

test('a successful sign-in clears the failure count', () => {
  for (let attempt = 0; attempt < 7; attempt += 1) authenticateAdmin({ username: 'root-admin', password: 'wrong' })
  assert.equal(authenticateAdmin({ username: 'root-admin', password: PASSWORD }).status, 'ok')

  for (let attempt = 0; attempt < 7; attempt += 1) {
    assert.equal(authenticateAdmin({ username: 'root-admin', password: 'wrong' }).status, 'invalid')
  }
  assert.equal(authenticateAdmin({ username: 'root-admin', password: PASSWORD }).status, 'ok')
})

test('an unknown username locks exactly like a real one, so the lockout is not an oracle', () => {
  for (let attempt = 0; attempt < 8; attempt += 1) authenticateAdmin({ username: 'ghost', password: 'x' })
  assert.equal(authenticateAdmin({ username: 'ghost', password: 'x' }).status, 'locked')
  assert.equal(authenticateAdmin({ username: 'GHOST ', password: 'x' }).status, 'locked', 'case and spaces do not dodge it')
})

test('a lockout ends when its window closes, and can be cleared', async () => {
  for (let index = 0; index < 8; index += 1) recordFailure('expiring', { windowMs: 30 })
  assert.equal(isLockedOut('expiring'), true)
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(isLockedOut('expiring'), false, 'the window closed')

  for (let index = 0; index < 8; index += 1) recordFailure('held', { windowMs: 60_000 })
  assert.equal(isLockedOut('held'), true)
  clearFailures('held')
  assert.equal(isLockedOut('held'), false)
})

// ---------- two-factor ----------

test('with two-factor on, the password alone is not enough, and asking for the code is not a failure', () => {
  enableTwoFactor()

  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal(authenticateAdmin({ username: 'root-admin', password: PASSWORD }).status, 'totp-required')
  }
  assert.equal(isLockedOut('admin:root-admin'), false)
  assert.equal(authenticateAdmin({ username: 'root-admin', password: 'wrong', code: '123456' }).status, 'invalid')
})

test('a current authenticator code signs in, a wrong one does not, and a code cannot be replayed', () => {
  const { secret } = enableTwoFactor()

  assert.equal(authenticateAdmin({ username: 'root-admin', password: PASSWORD, code: '000000' }).status, 'invalid-code')

  const code = totpAt(secret)
  assert.equal(authenticateAdmin({ username: 'root-admin', password: PASSWORD, code }).status, 'ok')
  assert.equal(authenticateAdmin({ username: 'root-admin', password: PASSWORD, code }).status, 'invalid-code', 'same code twice')
})

test('wrong codes count towards the lockout', () => {
  enableTwoFactor()
  for (let attempt = 0; attempt < 8; attempt += 1) {
    assert.equal(authenticateAdmin({ username: 'root-admin', password: PASSWORD, code: '111111' }).status, 'invalid-code')
  }
  assert.equal(authenticateAdmin({ username: 'root-admin', password: PASSWORD, code: '111111' }).status, 'locked')
})

test('a recovery code works once, in any case or spacing, then is gone', () => {
  const { recoveryCodes } = enableTwoFactor()
  const [first, second] = recoveryCodes

  assert.equal(authenticateAdmin({ username: 'root-admin', password: PASSWORD, code: first.toUpperCase() }).status, 'ok')
  assert.equal(authenticateAdmin({ username: 'root-admin', password: PASSWORD, code: first }).status, 'invalid-code', 'already used')
  assert.equal(getRecoveryCodeHashes(getAdmin('root-admin')).length, 2)
  assert.equal(authenticateAdmin({ username: 'root-admin', password: PASSWORD, code: second.replace('-', ' ') }).status, 'ok')
  assert.equal(authenticateAdmin({ username: 'root-admin', password: PASSWORD, code: 'short' }).status, 'invalid-code')
})

test('turning two-factor on or off signs out every session that was issued before', () => {
  const before = sessionFor(buildAdminSession(getAdmin('root-admin')))
  assert.deepEqual(getSessionAdmin({ session: before }), { username: 'root-admin' })

  enableTwoFactor()
  assert.equal(getSessionAdmin({ session: before }), null, 'enabling signs it out')

  const during = sessionFor(buildAdminSession(getAdmin('root-admin')))
  assert.deepEqual(getSessionAdmin({ session: during }), { username: 'root-admin' })

  disableTotp('root-admin')
  assert.equal(getSessionAdmin({ session: during }), null, 'disabling signs it out')
})

test('beginning enrollment again discards an unfinished attempt and never enables anything', () => {
  beginTotpEnrollment('root-admin', encryptSecret(generateSecret()))
  assert.equal(Boolean(getAdmin('root-admin').totp_enabled), false)
  assert.equal(authenticateAdmin({ username: 'root-admin', password: PASSWORD }).status, 'ok', 'a pending secret does not gate login')
  assert.equal(enableTotp('nobody', [], 0), false, 'enabling needs a stored secret')
})

// ---------- address retention and administration ----------

function backdate(emailId, days) {
  db.prepare("UPDATE emails SET last_active_at = datetime('now', ?), created_at = datetime('now', ?) WHERE id = ?")
    .run(`-${days} days`, `-${days} days`, emailId)
}

test('retention accepts only sensible values', () => {
  assert.equal(setAddressRetentionDays(30).success, true)
  assert.equal(getAddressRetentionDays(), 30)
  for (const bad of [-1, 3651, 'abc', null, undefined]) {
    assert.equal(setAddressRetentionDays(bad).success, false, String(bad))
  }
  assert.equal(getAddressRetentionDays(), 30, 'a rejected value changes nothing')
  assert.equal(setAddressRetentionDays(0).success, true)
  assert.equal(getAddressRetentionDays(), 0)
})

test('with retention off nothing is ever purged', () => {
  setAddressRetentionDays(0)
  const { emailId } = createEmail('ancient@example.test', 'p', 'example.test')
  backdate(emailId, 5000)

  assert.deepEqual(purgeInactiveAddresses({ force: true }), { removed: 0 })
  assert.ok(getEmailById(emailId))
  deleteEmailsByIds([emailId])
})

test('purge removes only addresses unused for longer than the limit', () => {
  const old = createEmail('old@example.test', 'p', 'example.test').emailId
  const recent = createEmail('recent@example.test', 'p', 'example.test').emailId
  const fresh = createEmail('fresh@example.test', 'p', 'example.test').emailId
  backdate(old, 40)
  backdate(recent, 20)

  setAddressRetentionDays(30)
  assert.equal(countInactiveAddresses(30), 1, 'the preview matches what will be removed')
  assert.equal(countInactiveAddresses(10), 2)

  assert.deepEqual(purgeInactiveAddresses({ force: true }), { removed: 1 })
  assert.equal(getEmailById(old), undefined)
  assert.ok(getEmailById(recent))
  assert.ok(getEmailById(fresh))

  setAddressRetentionDays(0)
  deleteEmailsByIds([recent, fresh])
})

test('using an address keeps it alive', () => {
  const id = createEmail('busy@example.test', 'p', 'example.test').emailId
  backdate(id, 40)
  setAddressRetentionDays(30)

  touchAddressActivity(id)
  assert.deepEqual(purgeInactiveAddresses({ force: true }), { removed: 0 })
  assert.ok(getEmailById(id))

  setAddressRetentionDays(0)
  deleteEmailsByIds([id])
})

test('an expired address cannot sign in, and its name is free to register again', () => {
  const { emailId } = createEmail('lapsed@example.test', 'old-passkey', 'example.test')
  backdate(emailId, 40)
  setAddressRetentionDays(30)

  // The hourly throttle has not run for a while in this process, so force the first sweep to be due.
  purgeInactiveAddresses({ force: true })
  assert.equal(verifyEmail('lapsed@example.test', 'old-passkey').success, false)

  const again = createEmail('lapsed@example.test', 'new-passkey', 'example.test')
  assert.equal(again.success, true)
  assert.equal(verifyEmail('lapsed@example.test', 'new-passkey').success, true)

  setAddressRetentionDays(0)
  deleteEmailsByIds([again.emailId])
})

test('address search matches literally, pages, and cannot be injected into', () => {
  const ids = ['a_b', 'axb', 'p1', 'p2', 'p3'].map(name => createEmail(`${name}@example.test`, 'p', 'example.test').emailId)

  const names = result => result.rows.map(row => row.email_address)
  assert.deepEqual(names(listAddresses({ search: 'a_b' })), ['a_b@example.test'], '_ is not a wildcard')
  assert.deepEqual(names(listAddresses({ search: 'A_B' })), ['a_b@example.test'], 'case-insensitive')
  assert.equal(listAddresses({ search: "' OR 1=1 --" }).total, 0)
  assert.equal(listAddresses({ search: '%' }).total, 0, '% is not a wildcard')

  const page1 = listAddresses({ pageSize: 2, page: 1 })
  const page2 = listAddresses({ pageSize: 2, page: 2 })
  assert.equal(page1.rows.length, 2)
  assert.notDeepEqual(names(page1), names(page2))
  assert.equal(listAddresses({ pageSize: 9999 }).pageSize, 100, 'page size is capped')

  assert.equal(deleteEmailsByIds([...ids, 'x', -1, 0, null, ids[0]]), ids.length, 'junk and repeats are ignored')
})

// ---------- upgrading an existing install ----------

test('an install from before these features is migrated, and its old addresses are not purged at once', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'email-node-migrate-'))
  const databaseFile = path.join(directory, 'old.db')

  // The schema exactly as the first release created it: no last_active_at, no two-factor columns.
  const seed = `
    const Database = require('better-sqlite3')
    const db = new Database(${JSON.stringify(databaseFile)})
    db.exec(\`
      CREATE TABLE admin (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT);
      CREATE TABLE emails (id INTEGER PRIMARY KEY, email_address TEXT UNIQUE NOT NULL, passkey_hash TEXT NOT NULL,
        domain_name TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO emails (email_address, passkey_hash, domain_name, created_at)
        VALUES ('veteran@example.test', 'x', 'example.test', datetime('now', '-900 days'));
      INSERT INTO admin (username, password_hash) VALUES ('  padded  ', 'x');
    \`)
    db.close()
  `
  assert.equal(spawnSync(process.execPath, ['-e', seed], { cwd: process.cwd(), encoding: 'utf8' }).status, 0)

  const check = `
    const db = await import(${JSON.stringify(path.resolve('src/lib/db.js'))})
    db.setAddressRetentionDays(30)
    const before = db.db.prepare('SELECT last_active_at FROM emails').get()
    const removed = db.purgeInactiveAddresses({ force: true }).removed
    const admin = db.db.prepare('SELECT username, totp_enabled FROM admin').get()
    const columns = db.db.prepare('PRAGMA table_info(admin)').all().map(column => column.name)
    console.log(JSON.stringify({ lastActive: before.last_active_at, removed, username: admin.username, columns }))
  `
  const run = spawnSync(process.execPath, ['--input-type=module', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '-e', check], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseFile },
  })
  assert.equal(run.status, 0, run.stderr)

  const result = JSON.parse(run.stdout.trim().split('\n').pop())
  assert.ok(result.lastActive, 'the new column was added and back-filled')
  assert.equal(result.removed, 0, 'a 900-day-old address is not purged the moment retention is switched on')
  assert.equal(result.username, 'padded', 'a username saved with stray spaces was repaired')
  for (const column of ['totp_secret', 'totp_enabled', 'totp_last_step', 'recovery_codes']) {
    assert.ok(result.columns.includes(column), column)
  }

  fs.rmSync(directory, { recursive: true, force: true })
})

test('an over-long search is cut short instead of being passed on whole', () => {
  const huge = 'x'.repeat(100_000)
  assert.equal(listAddresses({ search: huge }).total, 0)
  assert.equal(listAddresses({ search: `${huge}@example.test` }).total, 0)
})
