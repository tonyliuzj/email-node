#!/usr/bin/env node
'use strict'

// Puts a backup (downloaded from the admin panel) back in place of the live database.
//
//   1. Stop the app.
//   2. node scripts/restore-backup.cjs path/to/email-node-backup.db
//   3. Start the app.
//
// Docker:
//   docker compose stop
//   cp email-node-backup.db data/restore.db
//   docker compose run --rm --no-deps -u nextjs email-node node scripts/restore-backup.cjs /app/data/restore.db
//   docker compose start
//
// The file is checked first (it must be a healthy SQLite database with this app's tables), and the
// database it replaces is kept next to it as temp-mail.db.before-restore-<time>.

// This runs straight under `node` inside the Docker image, with no build step, and CommonJS is the form
// that resolves the packages the image actually contains, so require() is allowed in this file.
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('fs')
const path = require('path')
const readline = require('readline')
const Database = require('better-sqlite3')

const REQUIRED_TABLES = ['admin', 'emails', 'domains', 'settings']
const SQLITE_HEADER = 'SQLite format 3\u0000'

function usage() {
  return [
    'Usage: node scripts/restore-backup.cjs BACKUP_FILE [--yes]',
    '',
    '  --yes   do not ask for confirmation (needed when there is no terminal)',
    '',
    'Stop the app first. The database is DATABASE_URL, or data/temp-mail.db in the current directory.',
  ].join('\n')
}

function targetPath() {
  return path.resolve(process.cwd(), process.env.DATABASE_URL || path.join('data', 'temp-mail.db'))
}

function readHeader(file) {
  const descriptor = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(SQLITE_HEADER.length)
    fs.readSync(descriptor, buffer, 0, buffer.length, 0)
    return buffer.toString('latin1')
  } finally {
    fs.closeSync(descriptor)
  }
}

// Throws with a plain explanation if the file is not a usable backup; returns what it contains otherwise.
function inspectBackup(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`There is no file at ${file}.`)
  if (readHeader(file) !== SQLITE_HEADER) throw new Error('That file is not a SQLite database, so it is not one of this app\'s backups.')

  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const integrity = db.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new Error(`The backup is damaged (${integrity}). Nothing was changed.`)

    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name))
    const missing = REQUIRED_TABLES.filter(name => !tables.has(name))
    if (missing.length > 0) throw new Error(`That database is missing ${missing.join(', ')}, so it is not one of this app's backups.`)

    return {
      admins: db.prepare('SELECT COUNT(*) AS n FROM admin').get().n,
      addresses: db.prepare('SELECT COUNT(*) AS n FROM emails').get().n,
      domains: db.prepare('SELECT COUNT(*) AS n FROM domains').get().n,
    }
  } finally {
    db.close()
  }
}

// If something else holds the database open for writing, the app is almost certainly still running.
function assertNotInUse(file) {
  if (!fs.existsSync(file)) return
  const db = new Database(file, { timeout: 0 })
  try {
    db.exec('BEGIN EXCLUSIVE')
    db.exec('ROLLBACK')
  } catch (error) {
    if (/locked|busy/i.test(error.message)) throw new Error('The database is in use. Stop the app first, then run this again.')
    throw error
  } finally {
    db.close()
  }
}

function confirm(question) {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    prompt.question(question, answer => {
      prompt.close()
      resolve(/^y(es)?$/i.test(answer.trim()))
    })
  })
}

async function main() {
  const args = process.argv.slice(2)
  const assumeYes = args.includes('--yes')
  const files = args.filter(argument => !argument.startsWith('--'))

  if (args.includes('--help') || args.includes('-h') || files.length !== 1) {
    console.log(usage())
    return args.includes('--help') || args.includes('-h') ? 0 : 1
  }

  const source = path.resolve(process.cwd(), files[0])
  const target = targetPath()

  if (source === target) throw new Error('That is the live database itself. Give the path of the downloaded backup.')

  const contents = inspectBackup(source)
  console.log(`Backup: ${contents.admins} admin account(s), ${contents.addresses} address(es), ${contents.domains} domain(s).`)

  assertNotInUse(target)

  if (!assumeYes) {
    if (!process.stdin.isTTY) throw new Error('There is no terminal to ask on. Run it again with --yes to go ahead.')
    if (!(await confirm(`This replaces ${target} with the backup. Continue? (yes/no) `))) {
      console.log('Cancelled. Nothing was changed.')
      return 1
    }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true })

  let kept = null
  if (fs.existsSync(target)) {
    kept = `${target}.before-restore-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`
    fs.copyFileSync(target, kept)
    fs.chmodSync(kept, 0o600)
  }

  // Leftovers from the old database would be applied to the restored file.
  for (const suffix of ['-wal', '-shm', '-journal']) fs.rmSync(`${target}${suffix}`, { force: true })

  fs.copyFileSync(source, target)
  fs.chmodSync(target, 0o600)

  console.log(`Restored ${target}.`)
  if (kept) console.log(`The database it replaced was kept as ${kept}.`)
  console.log('Start the app again. Everyone is signed out if SESSION_PASSWORD changed, and the saved IMAP passwords')
  console.log('and two-factor secrets can only be read if DATA_ENCRYPTION_KEY is the same one the backup was made with.')
  return 0
}

main().then(
  code => process.exit(code),
  error => {
    console.error(error.message)
    process.exit(1)
  }
)
