import { getAdminPath, getSiteTitle, getFirstActiveDomain, getTurnstileConfig } from '../../lib/db'

export default function handler(req, res) {
  const domain = getFirstActiveDomain()
  const siteTitle = getSiteTitle()
  const turnstile = getTurnstileConfig()
  res.json({
    domain: domain.name,
    title: domain.title || siteTitle,
    adminPath: getAdminPath(),
    turnstileSiteKey: turnstile.siteKey || '',
    turnstileRegistrationEnabled: turnstile.registrationEnabled || false,
    turnstileLoginEnabled: turnstile.loginEnabled || false,
  })
}
