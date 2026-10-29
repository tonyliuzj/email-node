import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  beginTotpEnrollment,
  createInitialAdmin,
  db,
  enableTotp,
  getAdmin,
} from '../src/lib/db.js'
import { authenticateAdmin } from '../src/lib/admin-auth.js'
import { resetRateLimitsForTests } from '../src/lib/security.js'
import { encryptSecret } from '../src/lib/secret-store.js'
import { buildAdminSession, getSessionAdmin } from '../src/lib/session-auth.js'
import { generateRecoveryCodes, generateSecret, hashRecoveryCode } from '../src/lib/totp.js'

const SCRIPT = path.resolve('scripts/reset-admin.cjs')
const OLD_PASSWORD = 'the original password'
const NEW_PASSWORD = 'a brand new password'

createInitialAdmin('root-admin', OLD_PASSWORD)
test.beforeEach(() => resetRateLimitsForTests())

function run(args, { input = '', env = {} } = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    input,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    cwd: process.cwd(),
  })
  return { status: result.status, out: result.stdout, err: result.stderr }
}

test('with no action it explains itself and changes nothing', () => {
  const result = run([])
  assert.equal(result.status, 1)
  assert.match(result.out, /Usage: node scripts\/reset-admin\.cjs/)
  assert.equal(authenticateAdmin({ username: 'root-admin', password: OLD_PASSWORD }).status, 'ok')
})

test('a weak or mismatched password is refused and the old one still works', () => {
  const short = run(['--password'], { input: 'tooshort\ntooshort\n' })
  assert.equal(short.status, 1)
  assert.match(short.err, /at least 12 characters/)

  const mismatch = run(['--password'], { input: `${NEW_PASSWORD}\nsomething else entirely\n` })
  assert.equal(mismatch.status, 1)
  assert.match(mismatch.err, /do not match/)

  assert.equal(authenticateAdmin({ username: 'root-admin', password: OLD_PASSWORD }).status, 'ok')
})

test('--password sets a new password and signs out sessions that were open', () => {
  const openSession = { data: { admin: buildAdminSession(getAdmin('root-admin')) }, get(key) { return this.data[key] } }
  assert.deepEqual(getSessionAdmin({ session: openSession }), { username: 'root-admin' })

  const result = run(['--password'], { input: `${NEW_PASSWORD}\n${NEW_PASSWORD}\n` })
  assert.equal(result.status, 0, result.err)
  assert.match(result.out, /Password changed for "root-admin"/)

  assert.equal(authenticateAdmin({ username: 'root-admin', password: OLD_PASSWORD }).status, 'invalid')
  assert.equal(authenticateAdmin({ username: 'root-admin', password: NEW_PASSWORD }).status, 'ok')
  assert.equal(getSessionAdmin({ session: openSession }), null, 'the open session is gone')
})

test('--disable-2fa lifts a lockout caused by a lost authenticator', () => {
  beginTotpEnrollment('root-admin', encryptSecret(generateSecret()))
  enableTotp('root-admin', generateRecoveryCodes(3).map(hashRecoveryCode), 0)
  assert.equal(authenticateAdmin({ username: 'root-admin', password: NEW_PASSWORD }).status, 'totp-required')

  const result = run(['--disable-2fa'])
  assert.equal(result.status, 0, result.err)
  assert.match(result.out, /Two-factor authentication is off/)

  const admin = getAdmin('root-admin')
  assert.equal(admin.totp_enabled, 0)
  assert.equal(admin.totp_secret, null)
  assert.equal(admin.recovery_codes, null)
  assert.equal(authenticateAdmin({ username: 'root-admin', password: NEW_PASSWORD }).status, 'ok')
})

test('both actions can be combined in one run', () => {
  beginTotpEnrollment('root-admin', encryptSecret(generateSecret()))
  enableTotp('root-admin', [], 0)

  const result = run(['--password', '--disable-2fa'], { input: `${OLD_PASSWORD}\n${OLD_PASSWORD}\n` })
  assert.equal(result.status, 0, result.err)
  assert.equal(authenticateAdmin({ username: 'root-admin', password: OLD_PASSWORD }).status, 'ok')
})

test('with several admins it insists on --username, and rejects names that do not exist', () => {
  db.prepare('INSERT INTO admin (username, password_hash) VALUES (?, ?)').run('second-admin', 'x')

  const ambiguous = run(['--password'], { input: `${NEW_PASSWORD}\n${NEW_PASSWORD}\n` })
  assert.equal(ambiguous.status, 1)
  assert.match(ambiguous.err, /Several admins exist/)

  const unknown = run(['--username', 'nobody', '--password'], { input: `${NEW_PASSWORD}\n${NEW_PASSWORD}\n` })
  assert.equal(unknown.status, 1)
  assert.match(unknown.err, /No admin named "nobody"/)

  const chosen = run(['--username', 'root-admin', '--password'], { input: `${NEW_PASSWORD}\n${NEW_PASSWORD}\n` })
  assert.equal(chosen.status, 0, chosen.err)
  db.prepare('DELETE FROM admin WHERE username = ?').run('second-admin')
})

test('unknown options and a missing database are reported clearly', () => {
  const bad = run(['--nonsense'])
  assert.equal(bad.status, 1)
  assert.match(bad.err, /Unknown option: --nonsense/)

  const missing = run(['--disable-2fa'], { env: { DATABASE_URL: path.join(os.tmpdir(), 'does-not-exist', 'x.db') } })
  assert.equal(missing.status, 1)
  assert.match(missing.err, /No database at/)
})

test('it works on a database from before two-factor existed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'email-node-reset-'))
  const file = path.join(directory, 'old.db')
  const seed = spawnSync(process.execPath, ['-e', `
    const Database = require('better-sqlite3')
    const db = new Database(${JSON.stringify(file)})
    db.exec("CREATE TABLE admin (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT); INSERT INTO admin (username, password_hash) VALUES ('legacy', 'x')")
    db.close()
  `], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(seed.status, 0, seed.stderr)

  const result = run(['--disable-2fa'], { env: { DATABASE_URL: file } })
  assert.equal(result.status, 0, result.err)

  const setPassword = run(['--password'], { input: `${NEW_PASSWORD}\n${NEW_PASSWORD}\n`, env: { DATABASE_URL: file } })
  assert.equal(setPassword.status, 0, setPassword.err)
  fs.rmSync(directory, { recursive: true, force: true })
})
