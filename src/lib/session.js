import { getIronSession } from 'iron-session'

function getSessionPassword() {
  if (!process.env.SESSION_PASSWORD) {
    throw new Error(
      'Missing `SESSION_PASSWORD` environment variable for iron-session.\n' +
      'Please add a `SESSION_PASSWORD` (at least 32 characters) to your .env.local or deployment env.'
    )
  }

  return process.env.SESSION_PASSWORD
}

const sessionOptions = {
  get password() {
    return getSessionPassword()
  },
  cookieName: 'temp-mail-session',
  ttl: 7 * 24 * 60 * 60,
  cookieOptions: {
    httpOnly: true,
    // Browsers drop Secure cookies on plain HTTP (except on localhost), so nobody could stay signed in at
    // http://<server-ip>:3000. Serve the app over HTTPS when you can; otherwise set SESSION_COOKIE_SECURE=false.
    secure: process.env.SESSION_COOKIE_SECURE
      ? process.env.SESSION_COOKIE_SECURE !== 'false'
      : process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  },
}

function attachSessionCompat(session) {
  if (typeof session.get === 'function') return session

  Object.defineProperties(session, {
    get: {
      value(key) {
        return this[key]
      },
    },
    set: {
      value(key, value) {
        this[key] = value
      },
    },
  })

  return session
}

async function loadSession(req, res) {
  const session = await getIronSession(req, res, sessionOptions)
  return attachSessionCompat(session)
}

export function withSessionRoute(handler) {
  return async function sessionRoute(req, res) {
    req.session = await loadSession(req, res)
    return handler(req, res)
  }
}

export function withSessionSsr(handler) {
  return async function sessionSsr(...args) {
    if (args.length === 1 && args[0]?.req && args[0]?.res) {
      const context = args[0]
      context.req.session = await loadSession(context.req, context.res)
      return handler(context)
    }

    const [req, res] = args
    req.session = await loadSession(req, res)
    return handler(req, res)
  }
}

export { sessionOptions }
