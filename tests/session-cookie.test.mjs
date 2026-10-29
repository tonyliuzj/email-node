import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'

// The setting is read when the module loads, so each case loads a fresh copy of it.
async function cookieOptions(env, tag) {
  const saved = { ...process.env }
  Object.assign(process.env, env)
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]
  try {
    return (await import(`../src/lib/session.js?${tag}`)).sessionOptions.cookieOptions
  } finally {
    process.env = saved
  }
}

test('session cookies are Secure in production by default', async () => {
  const options = await cookieOptions({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: undefined }, 'prod')
  assert.equal(options.secure, true)
  assert.equal(options.httpOnly, true)
  assert.equal(options.sameSite, 'strict')
})

test('SESSION_COOKIE_SECURE=false lets a plain-HTTP deployment keep its session', async () => {
  const options = await cookieOptions({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' }, 'plain')
  assert.equal(options.secure, false)
})

test('SESSION_COOKIE_SECURE=true forces Secure outside production', async () => {
  const options = await cookieOptions({ NODE_ENV: 'development', SESSION_COOKIE_SECURE: 'true' }, 'forced')
  assert.equal(options.secure, true)
})

test('cookies are not Secure in development and tests by default', async () => {
  const options = await cookieOptions({ NODE_ENV: 'development', SESSION_COOKIE_SECURE: undefined }, 'dev')
  assert.equal(options.secure, false)
})
