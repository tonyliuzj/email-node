#!/usr/bin/env node
'use strict'

// This runs straight under `node` inside the Docker image, with no build step, and CommonJS is the form
// that resolves the packages the image actually contains (Next's standalone output only copies the files
// it traced). So it keeps require(), and the lint rule against it is switched off for this file only.
/* eslint-disable @typescript-eslint/no-require-imports */

// Recovery for a locked-out administrator. There is no "forgot password" email, so this runs on the
// server, next to the database:
//
//   node scripts/reset-admin.cjs --password            set a new admin password (asks for it)
//   node scripts/reset-admin.cjs --disable-2fa         turn two-factor off (lost phone and codes)
//   node scripts/reset-admin.cjs --password --disable-2fa
//
// Docker:  docker compose exec -u nextjs email-node node scripts/reset-admin.cjs --password
//
// Both actions sign every other admin session out. If the account was locked after failed logins,
// restart the app: that lock is held in memory.

const fs = require('fs')
const path = require('path')
const readline = require('readline')
const Database = require('better-sqlite3')
const bcrypt = require('bcrypt')

const MIN_PASSWORD_LENGTH = 12
// bcrypt only reads the first 72 bytes, so a longer password would be checked as if it were cut off.
const MAX_PASSWORD_BYTES = 72

function usage() {
  return [
    'Usage: node scripts/reset-admin.cjs [--username NAME] [--password] [--disable-2fa]',
    '',
    '  --password       set a new password (typed at a prompt, or piped in on stdin)',
    '  --disable-2fa    turn off two-factor authentication and discard its recovery codes',
    '  --username NAME  which admin to change (not needed when there is only one)',
    '',
    'The database is DATABASE_URL, or data/temp-mail.db in the current directory.',
  ].join('\n')
}

function parseArguments(argv) {
  const options = { password: false, disableTwoFactor: false, username: null, help: false }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--password') options.password = true
    else if (argument === '--disable-2fa') options.disableTwoFactor = true
    else if (argument === '--username') options.username = argv[(index += 1)]
    else if (argument === '--help' || argument === '-h') options.help = true
    else throw new Error(`Unknown option: ${argument}`)
  }

  return options
}

function databasePath() {
  return path.resolve(process.cwd(), process.env.DATABASE_URL || path.join('data', 'temp-mail.db'))
}

// Typed passwords are not echoed. Piped input (scripts, tests) is read as plain lines.
async function readPasswords() {
  if (process.stdin.isTTY) {
    const ask = question => new Promise(resolve => {
      const prompt = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
      prompt._writeToOutput = text => {
        if (text.startsWith(question)) process.stdout.write(text)
      }
      prompt.question(question, answer => {
        prompt.close()
        process.stdout.write('\n')
        resolve(answer)
      })
    })
    return [await ask('New admin password: '), await ask('Repeat it: ')]
  }

  const lines = fs.readFileSync(0, 'utf8').split(/\r?\n/)
  return [lines[0] ?? '', lines[1] ?? lines[0] ?? '']
}

async function main() {
  const options = parseArguments(process.argv.slice(2))

  if (options.help || (!options.password && !options.disableTwoFactor)) {
    console.log(usage())
    return options.help ? 0 : 1
  }

  const file = databasePath()
  if (!fs.existsSync(file)) {
    console.error(`No database at ${file}. Run this from the app folder, or set DATABASE_URL.`)
    return 1
  }

  const db = new Database(file)
  try {
    const admins = db.prepare('SELECT id, username FROM admin ORDER BY id').all()
    if (admins.length === 0) {
      console.error('There is no admin account yet. Open /setup in the browser to create one.')
      return 1
    }

    const admin = options.username
      ? admins.find(row => row.username === options.username.trim())
      : admins.length === 1 ? admins[0] : null
    if (!admin) {
      console.error(options.username
        ? `No admin named "${options.username}". Admins: ${admins.map(row => row.username).join(', ')}`
        : `Several admins exist, so say which with --username. Admins: ${admins.map(row => row.username).join(', ')}`)
      return 1
    }

    if (options.password) {
      const [password, repeat] = await readPasswords()
      if (password !== repeat) {
        console.error('The two passwords do not match. Nothing was changed.')
        return 1
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        console.error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters. Nothing was changed.`)
        return 1
      }
      if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
        console.error(`The password must be no more than ${MAX_PASSWORD_BYTES} bytes. Nothing was changed.`)
        return 1
      }

      db.prepare('UPDATE admin SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(password, 10), admin.id)
      console.log(`Password changed for "${admin.username}".`)
    }

    if (options.disableTwoFactor) {
      const columns = db.prepare('PRAGMA table_info(admin)').all().map(column => column.name)
      if (columns.includes('totp_enabled')) {
        db.prepare('UPDATE admin SET totp_secret = NULL, totp_enabled = 0, totp_last_step = 0, recovery_codes = NULL WHERE id = ?')
          .run(admin.id)
      }
      console.log(`Two-factor authentication is off for "${admin.username}".`)
    }

    console.log('All other admin sessions were signed out. If the account was locked by failed logins, restart the app.')
    return 0
  } finally {
    db.close()
  }
}

main().then(
  code => process.exit(code),
  error => {
    console.error(error.message)
    process.exit(1)
  }
)
