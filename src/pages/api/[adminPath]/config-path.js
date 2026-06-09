import { getAdminPath, setAdminPath } from '../../../lib/db'
import { withSessionRoute } from '../../../lib/session'
import { protectMutation } from '../../../lib/security'
import { normalizeAdminPath } from '../../../lib/validation'

export default withSessionRoute(async (req, res) => {
  const { adminPath } = req.query
  if (adminPath !== getAdminPath()) {
    return res.status(404).json({ error: 'Not found' })
  }

  if (!req.session.get('admin')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method === 'GET') {
    return res.json({ adminPath: getAdminPath() });
  } else if (req.method === 'POST') {
    const { adminPath: newPath } = req.body;
    const normalizedPath = normalizeAdminPath(newPath)
    if (!normalizedPath) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (!protectMutation(req, res, { key: 'admin-write', max: 30, windowMs: 60 * 1000 })) {
      return
    }
    setAdminPath(normalizedPath);
    return res.json({ ok: true, adminPath: normalizedPath });
  } else {
    res.status(405).end();
  }
});
