import { withSessionRoute } from '../../../lib/session'
import {
  countInactiveAddresses,
  deleteEmailsByIds,
  getAdminPath,
  getAddressRetentionDays,
  listAddresses,
  purgeInactiveAddresses,
  setAddressRetentionDays,
} from '../../../lib/db'
import { protectMutation } from '../../../lib/security'
import { requireAdmin } from '../../../lib/session-auth'

const MAX_DELETE_BATCH = 100

const single = value => (Array.isArray(value) ? value[0] : value)

export default withSessionRoute(async function handler(req, res) {
  const { adminPath } = req.query
  if (adminPath !== getAdminPath()) {
    return res.status(404).json({ error: 'Not found' })
  }

  if (!requireAdmin(req, res)) return

  try {
    if (req.method === 'GET') {
      const result = listAddresses({
        search: single(req.query.search),
        page: single(req.query.page),
        pageSize: single(req.query.pageSize),
      })
      const body = { ...result, retentionDays: getAddressRetentionDays() }

      // Lets the page say how many addresses a retention limit would remove, before it is saved.
      const previewDays = Number.parseInt(single(req.query.previewDays), 10)
      if (Number.isInteger(previewDays) && previewDays > 0) {
        body.previewDays = previewDays
        body.previewInactive = countInactiveAddresses(previewDays)
      }

      return res.status(200).json(body)
    }

    if (req.method !== 'POST' && req.method !== 'DELETE') {
      res.setHeader('Allow', ['GET', 'POST', 'DELETE'])
      return res.status(405).end(`Method ${req.method} Not Allowed`)
    }

    if (!protectMutation(req, res, { key: 'admin-write', max: 30, windowMs: 60 * 1000 })) {
      return
    }

    if (req.method === 'DELETE') {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [req.body?.id]
      if (ids.length === 0 || ids.length > MAX_DELETE_BATCH) {
        return res.status(400).json({ error: `Choose between 1 and ${MAX_DELETE_BATCH} addresses.` })
      }

      return res.status(200).json({ success: true, removed: deleteEmailsByIds(ids) })
    }

    const { action, days } = req.body || {}

    if (action === 'retention') {
      const result = setAddressRetentionDays(days)
      if (!result.success) return res.status(400).json({ error: result.error })
      return res.status(200).json({ success: true, retentionDays: result.value })
    }

    if (action === 'purge') {
      if (!getAddressRetentionDays()) {
        return res.status(409).json({ error: 'Set an inactivity limit first.' })
      }
      return res.status(200).json({ success: true, removed: purgeInactiveAddresses({ force: true }).removed })
    }

    return res.status(400).json({ error: 'Unknown action.' })
  } catch (error) {
    console.error('Addresses API error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})
