import { toSafeSessionEmail, verifyEmail } from '../../../lib/db.js'
import { withSessionRoute } from '../../../lib/session.js'
import { isTurnstileEnabled, verifyTurnstileToken, getClientIp } from '../../../lib/turnstile.js'
import { protectMutation } from '../../../lib/security.js'
import { normalizeEmailAddress } from '../../../lib/validation.js'

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    if (!protectMutation(req, res, { key: 'user-login', max: 12, windowMs: 10 * 60 * 1000 })) {
      return
    }

    const { email, passkey, turnstileToken } = req.body || {}

    
    if (isTurnstileEnabled('login')) {
      const verification = await verifyTurnstileToken(turnstileToken, getClientIp(req))
      if (!verification.success) {
        const statusCode = verification.error && verification.error.includes('not configured') ? 500 : 400
        return res.status(statusCode).json({ error: verification.error || 'Turnstile verification failed' })
      }
    }

    
    const normalizedEmail = normalizeEmailAddress(email)
    if (!normalizedEmail || !passkey) {
      return res.status(400).json({ error: 'Email and passkey are required' })
    }

    
    const verificationResult = verifyEmail(normalizedEmail, passkey)
    if (!verificationResult.success) {
      return res.status(401).json({ error: 'Invalid email or passkey' })
    }

    req.session.set('email', toSafeSessionEmail(verificationResult.email))
    await req.session.save()

    return res.status(200).json({
      success: true,
      email: verificationResult.email.email_address,
      emailId: verificationResult.email.id,
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Login failed' });
  }
}

export default withSessionRoute(handler);
