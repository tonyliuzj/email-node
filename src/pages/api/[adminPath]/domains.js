import { withSessionSsr } from '../../../lib/session'
import {
  countAddressesForDomain,
  db,
  deleteDomainWithAddresses,
  getAdminDomains,
  getAdminPath,
} from '../../../lib/db'
import { protectMutation } from '../../../lib/security'
import { requireAdmin } from '../../../lib/session-auth'
import { encryptSecret } from '../../../lib/secret-store'
import { normalizeDomainName, normalizeHost, normalizePort } from '../../../lib/validation'

function isDuplicateError(error) {
  return error?.code === 'SQLITE_CONSTRAINT_UNIQUE'
}

export default withSessionSsr(async function handler(req, res) {
  const { adminPath } = req.query
  if (adminPath !== getAdminPath()) {
    return res.status(404).json({ error: 'Not found' })
  }

  if (!requireAdmin(req, res)) return

  try {
    switch (req.method) {
      case 'GET':
        return res.status(200).json(getAdminDomains())

      case 'POST': {
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

        let result
        try {
          result = db
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
              typeof imap_tls === 'undefined' ? 1 : imap_tls ? 1 : 0,
              typeof is_active === 'undefined' ? 1 : is_active ? 1 : 0
            )
        } catch (error) {
          if (isDuplicateError(error)) {
            return res.status(409).json({ error: 'That domain is already configured' })
          }
          throw error
        }

        return res.status(201).json({ id: result.lastInsertRowid })
      }

      case 'PUT': {
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

        // Addresses store the domain they were created on, so renaming it would orphan them.
        if (updateName !== existingDomain.name) {
          const addressCount = countAddressesForDomain(existingDomain.name)
          if (addressCount > 0) {
            return res.status(409).json({
              error: `${addressCount} address${addressCount === 1 ? '' : 'es'} use this domain, so it cannot be renamed. Add the new domain instead and deactivate this one.`,
            })
          }
        }

        let updateResult
        try {
          updateResult = db
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
              typeof updateData.imap_tls === 'undefined' ? existingDomain.imap_tls : updateData.imap_tls ? 1 : 0,
              typeof updateData.is_active === 'undefined' ? existingDomain.is_active : updateData.is_active ? 1 : 0,
              domainId
            )
        } catch (error) {
          if (isDuplicateError(error)) {
            return res.status(409).json({ error: 'That domain is already configured' })
          }
          throw error
        }

        if (updateResult.changes === 0) {
          return res.status(404).json({ error: 'Domain not found' })
        }
        return res.status(200).json({ success: true })
      }

      case 'DELETE': {
        if (!protectMutation(req, res, { key: 'admin-write', max: 30, windowMs: 60 * 1000 })) {
          return
        }

        const deleteId = Number.parseInt(req.body?.id, 10)
        if (!Number.isInteger(deleteId) || deleteId <= 0) {
          return res.status(400).json({ error: 'Domain ID is required' })
        }

        const deleted = deleteDomainWithAddresses(deleteId)
        if (!deleted) {
          return res.status(404).json({ error: 'Domain not found' })
        }
        return res.status(200).json({ success: true, removedAddresses: deleted.removedAddresses })
      }

      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE'])
        return res.status(405).end(`Method ${req.method} Not Allowed`)
    }
  } catch (error) {
    console.error('Domain API error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})
