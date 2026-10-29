import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { createEmail, createInitialAdmin, db, getDomainForImap } from '../src/lib/db.js'
import { encryptSecret } from '../src/lib/secret-store.js'

const SCRIPT = path.resolve('scripts/restore-backup.cjs')
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'email-node-restore-'))
test.after(() => fs.rmSync(workspace, { recursive: true, force: true }))

createInitialAdmin('root-admin', 'a long enough password')
db.prepare("INSERT INTO domains (name, imap_host, imap_port, imap_user, imap_password, imap_tls, is_active) VALUES ('example.test', 'imap.test', 993, 'u', ?, 1, 1)")
  .run(encryptSecret('the imap password'))
createEmail('kept@example.test', 'passkey', 'example.test')

let counter = 0
const fresh = name => path.join(workspace, `${++counter}-${name}`)

// The same call the admin panel's backup endpoint makes.
async function makeBackup() {
  const file = fresh('backup.db')
  await db.backup(file)
  return file
}

function restore(source, { target, args = ['--yes'], input } = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, source, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input,
    env: { ...process.env, DATABASE_URL: target },
  })
  return { status: result.status, out: result.stdout, err: result.stderr }
}

const count = (file, table) => {
  const database = new Database(file, { readonly: true })
  try { return database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n } finally { database.close() }
}

test('a backup is a complete, consistent copy that opens as a database', async () => {
  const backup = await makeBackup()
  assert.equal(fs.readFileSync(backup).subarray(0, 15).toString(), 'SQLite format 3')
  assert.equal(count(backup, 'admin'), 1)
  assert.equal(count(backup, 'emails'), 1)
  assert.equal(count(backup, 'domains'), 1)
})

test('restoring puts the data back where the app expects it, private to its owner', async () => {
  const backup = await makeBackup()
  const target = fresh('live.db')

  const result = restore(backup, { target })
  assert.equal(result.status, 0, result.err)
  assert.match(result.out, /1 admin account\(s\), 1 address\(es\), 1 domain\(s\)/)
  assert.equal(count(target, 'emails'), 1)
  assert.equal(fs.statSync(target).mode & 0o777, 0o600)
})

test('the restored secrets are readable with the same key', async () => {
  const backup = await makeBackup()
  const target = fresh('secrets.db')
  assert.equal(restore(backup, { target }).status, 0)

  const database = new Database(target, { readonly: true })
  const stored = database.prepare('SELECT imap_password FROM domains').get().imap_password
  database.close()
  assert.equal(stored, db.prepare('SELECT imap_password FROM domains').get().imap_password, 'the encrypted value is carried over unchanged')
  assert.equal(getDomainForImap('example.test').imap_password, 'the imap password', 'and decrypts with this key')
})

test('the database it replaces is kept, and leftovers from it are not applied to the restored file', async () => {
  const backup = await makeBackup()
  const target = fresh('replaced.db')

  const old = new Database(target)
  old.exec("CREATE TABLE marker (note TEXT); INSERT INTO marker VALUES ('the old database')")
  old.close()
  fs.writeFileSync(`${target}-wal`, 'stale write-ahead log from the old database')

  const result = restore(backup, { target })
  assert.equal(result.status, 0, result.err)

  const kept = fs.readdirSync(workspace).find(name => name.startsWith(`${path.basename(target)}.before-restore-`))
  assert.ok(kept, 'a copy of the old database was kept')
  assert.equal(new Database(path.join(workspace, kept), { readonly: true }).prepare('SELECT note FROM marker').get().note, 'the old database')
  assert.equal(fs.existsSync(`${target}-wal`), false, 'the stale log is gone')
  assert.equal(count(target, 'emails'), 1)
})

test('it refuses files that are not this app\'s backups, and changes nothing', async () => {
  const target = fresh('untouched.db')
  const original = new Database(target)
  original.exec("CREATE TABLE marker (note TEXT); INSERT INTO marker VALUES ('still here')")
  original.close()
  const before = fs.readFileSync(target)

  const notSqlite = fresh('text.db')
  fs.writeFileSync(notSqlite, 'this is just a text file')
  const wrongSchema = fresh('other.db')
  const other = new Database(wrongSchema)
  other.exec('CREATE TABLE unrelated (x INTEGER)')
  other.close()
  const damaged = fresh('damaged.db')
  const good = await makeBackup()
  fs.writeFileSync(damaged, fs.readFileSync(good).subarray(0, 6000))

  for (const [file, expected] of [
    [notSqlite, /not a SQLite database/],
    [wrongSchema, /missing admin, emails, domains, settings/],
    [damaged, /./],
    [fresh('nothing-here.db'), /no file at/],
  ]) {
    const result = restore(file, { target })
    assert.equal(result.status, 1, file)
    assert.match(result.err, expected, file)
  }
  assert.deepEqual(fs.readFileSync(target), before, 'the live database was never touched')
})

test('it will not run without confirmation when there is no terminal to ask on', async () => {
  const backup = await makeBackup()
  const target = fresh('confirm.db')
  const result = restore(backup, { target, args: [] })

  assert.equal(result.status, 1)
  assert.match(result.err, /Run it again with --yes/)
  assert.equal(fs.existsSync(target), false)
})

test('it will not replace a database that is in use', async () => {
  const backup = await makeBackup()
  const target = fresh('busy.db')
  const holder = new Database(target)
  holder.exec('CREATE TABLE t (x)')
  holder.exec('BEGIN EXCLUSIVE') // what a running app writing to it would hold

  try {
    const result = restore(backup, { target })
    assert.equal(result.status, 1)
    assert.match(result.err, /in use\. Stop the app first/)
  } finally {
    holder.exec('ROLLBACK')
    holder.close()
  }
})

test('it refuses to restore the live database over itself', () => {
  const target = fresh('self.db')
  new Database(target).close()
  const result = restore(target, { target })
  assert.equal(result.status, 1)
  assert.match(result.err, /live database itself/)
})

test('with no file it explains how to use it', () => {
  const none = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: process.cwd() })
  assert.equal(none.status, 1)
  assert.match(none.stdout, /Usage: node scripts\/restore-backup\.cjs/)

  const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', cwd: process.cwd() })
  assert.equal(help.status, 0)
})
