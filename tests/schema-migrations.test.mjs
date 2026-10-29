import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { ensureColumn } from '../src/lib/schema-migrations.js'

function freshTable() {
  const database = new Database(':memory:')
  database.exec("CREATE TABLE things (id INTEGER PRIMARY KEY); INSERT INTO things DEFAULT VALUES; INSERT INTO things DEFAULT VALUES")
  return database
}

test('adds a missing column once, and reports whether it did', () => {
  const database = freshTable()
  assert.equal(ensureColumn(database, 'things', 'note', 'TEXT'), true)
  assert.equal(ensureColumn(database, 'things', 'note', 'TEXT'), false, 'already there')
  assert.ok(database.prepare('PRAGMA table_info(things)').all().some(column => column.name === 'note'))
})

test('the back-fill runs when the column is added, and never again', () => {
  const database = freshTable()
  const backfill = "UPDATE things SET stamp = 'filled'"

  assert.equal(ensureColumn(database, 'things', 'stamp', 'TEXT', { backfill }), true)
  assert.deepEqual(database.prepare('SELECT stamp FROM things').all().map(row => row.stamp), ['filled', 'filled'])

  database.prepare("UPDATE things SET stamp = 'changed later' WHERE id = 1").run()
  assert.equal(ensureColumn(database, 'things', 'stamp', 'TEXT', { backfill }), false)
  assert.equal(database.prepare('SELECT stamp FROM things WHERE id = 1').get().stamp, 'changed later', 'a later start must not overwrite real data')
})

test('a failed back-fill leaves no half-added column behind', () => {
  const database = freshTable()
  assert.throws(() => ensureColumn(database, 'things', 'broken', 'TEXT', { backfill: 'UPDATE nonexistent SET x = 1' }))
  assert.equal(database.prepare('PRAGMA table_info(things)').all().some(column => column.name === 'broken'), false, 'the ALTER was rolled back')
  assert.equal(ensureColumn(database, 'things', 'broken', 'TEXT'), true, 'so a later start can still add it')
})

test('losing the race to another process is not an error', () => {
  const real = freshTable()
  real.exec('ALTER TABLE things ADD COLUMN raced TEXT') // the other process got there first

  // This process still believes the column is missing: its check ran before the other one's ALTER.
  const staleView = {
    transaction: fn => real.transaction(fn),
    prepare: sql => (sql.startsWith('PRAGMA') ? { all: () => [] } : real.prepare(sql)),
  }
  assert.equal(ensureColumn(staleView, 'things', 'raced', 'TEXT'), false)
})

test('real errors are not swallowed', () => {
  const database = freshTable()
  assert.throws(() => ensureColumn(database, 'no_such_table', 'x', 'TEXT'), /no such table/i)
  assert.throws(() => ensureColumn(database, 'things', 'bad', 'NOT A TYPE ((('), /syntax|near/i)
})

test('many processes starting on one empty database at the same moment all come up (what `next build` does)', async () => {
  const processes = 14
  const rounds = 3

  for (let round = 0; round < rounds; round += 1) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'email-node-race-'))
    const databaseFile = path.join(directory, 'fresh.db')
    const code = `await import(${JSON.stringify(path.resolve('src/lib/db.js'))})`

    const results = await Promise.all(Array.from({ length: processes }, () => new Promise(resolve => {
      const child = spawn(process.execPath, ['--input-type=module', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '-e', code], {
        env: { ...process.env, DATABASE_URL: databaseFile },
      })
      let stderr = ''
      child.stderr.on('data', chunk => { stderr += chunk })
      child.on('close', status => resolve({ status, stderr }))
    })))

    const failed = results.filter(result => result.status !== 0)
    assert.equal(failed.length, 0, failed[0]?.stderr)

    const check = new Database(databaseFile, { readonly: true })
    const emailColumns = check.prepare('PRAGMA table_info(emails)').all().map(column => column.name)
    assert.equal(emailColumns.filter(name => name === 'last_active_at').length, 1)
    check.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
