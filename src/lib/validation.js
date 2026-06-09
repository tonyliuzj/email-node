const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const EMAIL_LOCAL_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/
const ADMIN_PATH_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i

export function normalizeDomainName(value) {
  const domain = String(value || '').trim().toLowerCase()
  if (!domain || domain.length > 253 || domain.includes('..')) return null

  const labels = domain.split('.')
  if (labels.length < 2 || labels.some(label => !DOMAIN_LABEL_PATTERN.test(label))) {
    return null
  }

  return domain
}

export function normalizeEmailLocalPart(value) {
  const localPart = String(value || '').trim().toLowerCase()
  if (
    !EMAIL_LOCAL_PATTERN.test(localPart) ||
    localPart.includes('..') ||
    localPart.startsWith('.') ||
    localPart.endsWith('.')
  ) {
    return null
  }
  return localPart
}

export function normalizeEmailAddress(value) {
  const email = String(value || '').trim().toLowerCase()
  const parts = email.split('@')
  if (parts.length !== 2) return null

  const localPart = normalizeEmailLocalPart(parts[0])
  const domain = normalizeDomainName(parts[1])
  if (!localPart || !domain) return null

  return `${localPart}@${domain}`
}

export function buildEmailAddress(localPart, domainName) {
  const normalizedLocalPart = normalizeEmailLocalPart(localPart)
  const normalizedDomain = normalizeDomainName(domainName)
  if (!normalizedLocalPart || !normalizedDomain) return null
  return `${normalizedLocalPart}@${normalizedDomain}`
}

export function normalizeAdminPath(value) {
  const adminPath = String(value || '').trim().toLowerCase()
  return ADMIN_PATH_PATTERN.test(adminPath) ? adminPath : null
}

export function normalizeHost(value) {
  const host = String(value || '').trim().toLowerCase()
  if (!host || host.length > 253 || host.includes('/') || host.includes(':')) return null
  return HOST_PATTERN.test(host) ? host : null
}

export function normalizePort(value, fallback = 993) {
  const port = Number(value || fallback)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return port
}

export function normalizeSiteTitle(value) {
  const title = String(value || '').trim()
  if (!title || title.length > 80) return null
  return title
}

export function isStrongAdminPassword(value) {
  return typeof value === 'string' && value.length >= 12
}

export function toBoolean(value) {
  return ['1', 1, true, 'true', 'yes', 'on'].includes(value)
}
