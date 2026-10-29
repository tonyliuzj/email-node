import { getTurnstileConfig } from './db.js'

const VERIFY_TIMEOUT_MS = 10_000

export { getClientIp } from './security.js'

function parseBoolean(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lowered = value.toLowerCase()
    return lowered === 'true' || lowered === '1' || lowered === 'yes' || lowered === 'on'
  }
  return Boolean(value)
}

export function isTurnstileEnabled(type) {
  const config = getTurnstileConfig()
  if (!config.siteKey || !config.secretKey) {
    return false
  }
  if (type === 'registration') {
    return parseBoolean(config.registrationEnabled)
  }
  if (type === 'login') {
    return parseBoolean(config.loginEnabled)
  }
  return false
}

export async function verifyTurnstileToken(token, remoteIp) {
  const { secretKey } = getTurnstileConfig()

  if (!secretKey) {
    return { success: false, error: 'Turnstile secret key is not configured' }
  }
  if (!token || typeof token !== 'string') {
    return { success: false, error: 'Turnstile token is missing' }
  }

  const payload = new URLSearchParams()
  payload.append('secret', secretKey)
  payload.append('response', token)
  if (remoteIp && remoteIp !== 'unknown') {
    payload.append('remoteip', remoteIp)
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: payload,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })

    if (!response.ok) {
      return { success: false, error: 'Failed to reach Turnstile verification service' }
    }

    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        error: 'Turnstile verification failed',
        details: data['error-codes'] || [],
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Turnstile verification error:', error)
    return { success: false, error: 'Error verifying Turnstile token' }
  }
}
