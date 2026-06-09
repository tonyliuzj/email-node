import { createEmail, getActiveDomainByName, getFirstActiveDomain, toSafeSessionEmail } from '../../../lib/db.js';
import { withSessionRoute } from '../../../lib/session.js';
import { generate as randomWords } from 'random-words';
import { nanoid } from 'nanoid';
import { isTurnstileEnabled, verifyTurnstileToken, getClientIp } from '../../../lib/turnstile.js';
import { protectMutation } from '../../../lib/security.js';
import { buildEmailAddress, normalizeEmailAddress, normalizeEmailLocalPart, normalizeDomainName } from '../../../lib/validation.js';

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

    
    let emailAddress;
    let selectedDomainName = normalizeDomainName(domainName)
    const activeDomain = getActiveDomainByName(selectedDomainName)
    if (!activeDomain) {
      return res.status(400).json({ error: 'Invalid or inactive domain' })
    }
    selectedDomainName = activeDomain.name

    if (emailType === 'random') {
      const randomAlias = randomWords({ exactly: 2, join: '.' });
      const domain = getFirstActiveDomain();
      emailAddress = `${randomAlias}@${domain.name}`;
      selectedDomainName = domain.name
    } else if (emailType === 'custom') {
      if (!customEmail) {
        return res.status(400).json({ error: 'Custom email address is required' });
      }
      emailAddress = normalizeEmailAddress(customEmail);
      if (!emailAddress || !emailAddress.endsWith(`@${selectedDomainName}`)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
    } else if (emailType === 'username') {
      const localPart = normalizeEmailLocalPart(userEmail)
      if (!localPart) {
        return res.status(400).json({ error: 'Invalid username format' });
      }
      
      emailAddress = buildEmailAddress(localPart, selectedDomainName);
    } else {
      return res.status(400).json({ error: 'Invalid email type' });
    }

    
    const passkey = nanoid(24);

    
    const emailResult = createEmail(emailAddress, passkey, selectedDomainName);
    if (!emailResult.success) {
      return res.status(400).json({ error: emailResult.error });
    }

    
    req.session.set('email', toSafeSessionEmail({
      email_id: emailResult.emailId,
      id: emailResult.emailId,
      email_address: emailAddress,
      domain_name: selectedDomainName,
    }));
    await req.session.save();

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
