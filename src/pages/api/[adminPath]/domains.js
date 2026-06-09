import { withSessionSsr } from '../../../lib/session'
import { db, getAdminDomains, getAdminPath } from '../../../lib/db'
import { protectMutation } from '../../../lib/security'
import { encryptSecret } from '../../../lib/secret-store'
import { normalizeDomainName, normalizeHost, normalizePort } from '../../../lib/validation'

export default withSessionSsr(async function handler(req, res) {
  const { adminPath } = req.query
  if (adminPath !== getAdminPath()) {
    return res.status(404).json({ error: 'Not found' })
  }

  const admin = req.session.get('admin')
  if (!admin) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    switch (req.method) {
      case 'GET':
        return res.status(200).json(getAdminDomains())

      case 'POST':
        if (!protectMutation(req, res, { key: 'admin-write', max: 30, windowMs: 60 * 1000 })) {
          return
        }

        const { name, imap_host, imap_port, imap_user, imap_password, imap_tls, is_active } = req.body || {}
        const normalizedName = normalizeDomainName(name)
        const normalizedHost = normalizeHost(imap_host)
        const normalizedPort = normalizePort(imap_port)
        const normalizedUser = String(imap_user || '').trim()
        const normalizedPassword = String(imap_password || '').trim()

        if (!normalizedName || !normalizedHost || !normalizedPort || !normalizedUser || !normalizedPassword) {
          return res.status(400).json({ error: 'Valid domain, IMAP host, port, user, and password are required' })
        }

        const result = db
          .prepare(
            `INSERT INTO domains (
              name, imap_host, imap_port, imap_user, imap_password, imap_tls, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            normalizedName,
            normalizedHost,
            normalizedPort,
            normalizedUser,
            encryptSecret(normalizedPassword),
            imap_tls ? 1 : 0,
            typeof is_active === 'undefined' ? 1 : is_active ? 1 : 0
          )

        return res.status(201).json({ id: result.lastInsertRowid })

      case 'PUT':
        if (!protectMutation(req, res, { key: 'admin-write', max: 30, windowMs: 60 * 1000 })) {
          return
        }

        const { id, ...updateData } = req.body || {}
        const domainId = Number.parseInt(id, 10)
        if (!Number.isInteger(domainId) || domainId <= 0) {
          return res.status(400).json({ error: 'Domain ID is required' })
        }

        const existingDomain = db.prepare('SELECT * FROM domains WHERE id = ?').get(domainId)
        if (!existingDomain) {
          return res.status(404).json({ error: 'Domain not found' })
        }

        const updateName = normalizeDomainName(updateData.name)
        const updateHost = normalizeHost(updateData.imap_host)
        const updatePort = normalizePort(updateData.imap_port)
        const updateUser = String(updateData.imap_user || '').trim()
        const updatePassword = String(updateData.imap_password || '').trim()

        if (!updateName || !updateHost || !updatePort || !updateUser) {
          return res.status(400).json({ error: 'Valid domain, IMAP host, port, and user are required' })
        }

        const updateResult = db
          .prepare(
            `UPDATE domains SET
              name = ?,
              imap_host = ?,
              imap_port = ?,
              imap_user = ?,
              imap_password = ?,
              imap_tls = ?,
              is_active = ?
            WHERE id = ?`
          )
          .run(
            updateName,
            updateHost,
            updatePort,
            updateUser,
            updatePassword ? encryptSecret(updatePassword) : existingDomain.imap_password || '',
            updateData.imap_tls ? 1 : 0,
            updateData.is_active ? 1 : 0,
            domainId
          )

        if (updateResult.changes === 0) {
          return res.status(404).json({ error: 'Domain not found' })
        }
        return res.status(200).json({ success: true })

      case 'DELETE':
        if (!protectMutation(req, res, { key: 'admin-write', max: 30, windowMs: 60 * 1000 })) {
          return
        }

        const deleteId = Number.parseInt(req.body?.id, 10)
        if (!Number.isInteger(deleteId) || deleteId <= 0) {
          return res.status(400).json({ error: 'Domain ID is required' })
        }

        const deleteResult = db.prepare('DELETE FROM domains WHERE id = ?').run(deleteId)
        if (deleteResult.changes === 0) {
          return res.status(404).json({ error: 'Domain not found' })
        }
        return res.status(200).json({ success: true })

      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE'])
        return res.status(405).end(`Method ${req.method} Not Allowed`)
    }
  } catch (error) {
    console.error('Domain API error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})
