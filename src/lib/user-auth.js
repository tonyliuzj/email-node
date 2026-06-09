import { withSessionRoute, withSessionSsr } from './session.js'

export function withUserAuth(handler) {
  return withSessionRoute(async function(req, res) {
    try {
      const user = req.session.get('email')
      if (!user) {
        return res.status(401).json({ error: 'Invalid or expired session' })
      }

      req.userSession = user
      return handler(req, res)
    } catch (error) {
      console.error('Authentication error:', error)
      return res.status(500).json({ error: 'Authentication failed' })
    }
  })
}

export function withUser(handler) {
  return withSessionSsr(async function(context) {
    const { req } = context;
    context.user = req.session.get('email') || null;
    return handler(context);
  });
}
