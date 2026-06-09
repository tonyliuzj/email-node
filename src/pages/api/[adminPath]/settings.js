import { withSessionSsr } from '../../../lib/session'
import {
  getAdminPath,
  getBlockedEmailPrefixes,
  getInboxRefreshSeconds,
  getSiteTitle,
  getTurnstileConfig,
  setBlockedEmailPrefixes,
  setInboxRefreshSeconds,
  setSiteTitle,
  setTurnstileConfig,
} from '../../../lib/db'
import { protectMutation } from '../../../lib/security'

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lowered = value.toLowerCase()
    return lowered === 'true' || lowered === '1' || lowered === 'yes' || lowered === 'on'
  }
  return Boolean(value)
}

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
    if (req.method === 'GET') {
      const turnstile = getTurnstileConfig()
      return res.status(200).json({
        site_title: getSiteTitle(),
        inbox_refresh_seconds: getInboxRefreshSeconds(),
        blocked_email_prefixes: getBlockedEmailPrefixes(),
        turnstile_site_key: turnstile.siteKey,
        turnstile_secret_configured: Boolean(turnstile.secretKey),
        turnstile_registration_enabled: turnstile.registrationEnabled,
        turnstile_login_enabled: turnstile.loginEnabled,
      })
    }
    
    if (req.method === 'POST') {
      if (!protectMutation(req, res, { key: 'admin-write', max: 30, windowMs: 60 * 1000 })) {
        return
      }

      const { 
        site_title,
        inbox_refresh_seconds,
        blocked_email_prefixes,
        turnstile_site_key,
        turnstile_secret_key,
        turnstile_registration_enabled,
        turnstile_login_enabled,
      } = req.body || {}

      if (typeof site_title !== 'undefined') {
        const result = setSiteTitle(site_title)
        if (!result.success) {
          return res.status(400).json({ error: result.error })
        }
      }

      if (typeof inbox_refresh_seconds !== 'undefined') {
        const result = setInboxRefreshSeconds(inbox_refresh_seconds)
        if (!result.success) {
          return res.status(400).json({ error: result.error })
        }
      }

      if (typeof blocked_email_prefixes !== 'undefined') {
        const result = setBlockedEmailPrefixes(blocked_email_prefixes)
        if (!result.success) {
          return res.status(400).json({ error: result.error })
        }
      }

      if (
        typeof turnstile_site_key !== 'undefined' ||
        typeof turnstile_secret_key !== 'undefined' ||
        typeof turnstile_registration_enabled !== 'undefined' ||
        typeof turnstile_login_enabled !== 'undefined'
      ) {
        setTurnstileConfig({
          siteKey: typeof turnstile_site_key === 'string' ? turnstile_site_key : undefined,
          secretKey: typeof turnstile_secret_key === 'string' ? turnstile_secret_key : undefined,
          registrationEnabled: typeof turnstile_registration_enabled !== 'undefined'
            ? normalizeBoolean(turnstile_registration_enabled)
            : undefined,
          loginEnabled: typeof turnstile_login_enabled !== 'undefined'
            ? normalizeBoolean(turnstile_login_enabled)
            : undefined,
        })
      }

      return res.status(200).json({ success: true })
    }
    
    res.setHeader('Allow', ['GET', 'POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  } catch (error) {
    console.error('Settings API error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})
