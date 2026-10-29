import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { withSessionRoute } from '../../../lib/session'
import { db, getAdminPath } from '../../../lib/db'
import { confirmAdminPassword } from '../../../lib/admin-auth'
import { protectMutation } from '../../../lib/security'
import { requireAdmin } from '../../../lib/session-auth'

// A backup holds every password hash and the encrypted IMAP, Turnstile and two-factor secrets, so it is
// only given to a signed-in admin who types their password again, and only a few times an hour.
export default withSessionRoute(async function handler(req, res) {
  const { adminPath } = req.query
  if (adminPath !== getAdminPath()) {
    return res.status(404).json({ error: 'Not found' })
  }

  const admin = requireAdmin(req, res)
  if (!admin) return

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  if (!protectMutation(req, res, { key: 'admin-backup', max: 5, windowMs: 10 * 60 * 1000 })) {
    return
  }

  const check = confirmAdminPassword(admin.username, req.body?.password)
  if (check === 'locked') {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' })
  }
  if (check !== 'ok') {
    return res.status(401).json({ error: 'Password is incorrect.' })
  }

  // The copy is made in a private temporary folder and removed as soon as it has been sent.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'email-node-backup-'))
  const file = path.join(directory, 'backup.db')

  try {
    // SQLite's own online backup: a consistent snapshot even while the app is writing.
    await db.backup(file)

    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    res.status(200)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Length', String(fs.statSync(file).size))
    res.setHeader('Content-Disposition', `attachment; filename="email-node-backup-${stamp}.db"`)
    await pipeline(fs.createReadStream(file), res)
  } catch (error) {
    console.error('Backup failed:', error)
    if (res.headersSent) {
      res.destroy()
    } else {
      res.status(500).json({ error: 'The backup could not be created.' })
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

export const config = {
  api: { responseLimit: false },
}
