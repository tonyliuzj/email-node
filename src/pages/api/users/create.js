import { createEmail, getActiveDomainByName, getEmailById } from '../../../lib/db.js';
import { withSessionRoute } from '../../../lib/session.js';
import { startUserSession } from '../../../lib/session-auth.js';
import { generate as randomWords } from 'random-words';
import { nanoid } from 'nanoid';
import { isTurnstileEnabled, verifyTurnstileToken, getClientIp } from '../../../lib/turnstile.js';
import { protectMutation } from '../../../lib/security.js';
import { buildEmailAddress, normalizeEmailAddress, normalizeEmailLocalPart, normalizeDomainName } from '../../../lib/validation.js';

const RANDOM_ADDRESS_ATTEMPTS = 5

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    if (!protectMutation(req, res, { key: 'user-create', max: 12, windowMs: 10 * 60 * 1000 })) {
      return
    }

    const { userEmail, emailType, customEmail, domainName, turnstileToken } = req.body || {}


    if (isTurnstileEnabled('registration')) {
      const verification = await verifyTurnstileToken(turnstileToken, getClientIp(req));
      if (!verification.success) {
        const statusCode = verification.error && verification.error.includes('not configured') ? 500 : 400;
        return res.status(statusCode).json({ error: verification.error || 'Turnstile verification failed' });
      }
    }


    if (!emailType || !domainName) {
      return res.status(400).json({ error: 'Missing required fields' })
    }


    const selectedDomainName = normalizeDomainName(domainName)
    const activeDomain = getActiveDomainByName(selectedDomainName)
    if (!activeDomain) {
      return res.status(400).json({ error: 'Invalid or inactive domain' })
    }

    const passkey = nanoid(24);
    let emailAddress;
    let emailResult;

    if (emailType === 'random') {
      // Random aliases can collide with an existing address, so try a few before giving up.
      for (let attempt = 0; attempt < RANDOM_ADDRESS_ATTEMPTS; attempt += 1) {
        emailAddress = `${randomWords({ exactly: 2, join: '.' })}@${activeDomain.name}`;
        emailResult = await createEmail(emailAddress, passkey, activeDomain.name);
        if (emailResult.success || emailResult.error !== 'Email address already taken') break;
      }
    } else if (emailType === 'custom') {
      if (!customEmail) {
        return res.status(400).json({ error: 'Custom email address is required' });
      }
      emailAddress = normalizeEmailAddress(customEmail);
      if (!emailAddress || !emailAddress.endsWith(`@${activeDomain.name}`)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
      emailResult = await createEmail(emailAddress, passkey, activeDomain.name);
    } else if (emailType === 'username') {
      const localPart = normalizeEmailLocalPart(userEmail)
      if (!localPart) {
        return res.status(400).json({ error: 'Invalid username format' });
      }

      emailAddress = buildEmailAddress(localPart, activeDomain.name);
      emailResult = await createEmail(emailAddress, passkey, activeDomain.name);
    } else {
      return res.status(400).json({ error: 'Invalid email type' });
    }

    if (!emailResult.success) {
      return res.status(400).json({ error: emailResult.error });
    }

    await startUserSession(req, getEmailById(emailResult.emailId));

    return res.status(201).json({
      success: true,
      email: {
        email: emailAddress,
      },
      passkey: passkey,
      emailId: emailResult.emailId,
    });

  } catch (error) {
    console.error('User creation error:', error);
    return res.status(500).json({ error: 'Failed to create user account' });
  }
}

export default withSessionRoute(handler);
