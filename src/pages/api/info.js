import { getFirstActiveDomain, getSiteTitle, getTurnstileConfig } from '../../lib/db'
import { withSessionRoute } from '../../lib/session'
import { visibleAdminPath } from '../../lib/session-auth'

export default withSessionRoute(function handler(req, res) {
  const domain = getFirstActiveDomain()
  const siteTitle = getSiteTitle()
  const turnstile = getTurnstileConfig()
  res.json({
    domain: domain.name,
    title: domain.title || siteTitle,
    // Only an administrator who is signed in is told where the admin pages are.
    adminPath: visibleAdminPath(req),
    turnstileSiteKey: turnstile.siteKey || '',
    turnstileRegistrationEnabled: turnstile.registrationEnabled || false,
    turnstileLoginEnabled: turnstile.loginEnabled || false,
  })
})
