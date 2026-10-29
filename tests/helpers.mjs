// Import this first in every test file: it points the app at a throwaway database and a test session
// password before any app module is loaded.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'email-node-test-'))

process.env.DATABASE_URL = path.join(directory, 'test.db')
process.env.SESSION_PASSWORD = 'test-session-password-that-is-long-enough'
process.env.NODE_ENV = 'test'
delete process.env.SETUP_TOKEN
delete process.env.TRUST_PROXY_HEADERS

process.on('exit', () => {
  fs.rmSync(directory, { recursive: true, force: true })
})

export function createRequest({ method = 'POST', headers = {}, body, query = {}, ip = '203.0.113.7' } = {}) {
  return {
    method,
    headers: { host: 'localhost', origin: 'http://localhost', ...headers },
    body,
    query,
    socket: { remoteAddress: ip },
  }
}

export function createResponse() {
  const headers = {}
  const res = {
    statusCode: 200,
    body: undefined,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value
      return res
    },
    getHeader(name) {
      return headers[name.toLowerCase()]
    },
    status(code) {
      res.statusCode = code
      return res
    },
    json(payload) {
      res.body = payload
      return res
    },
    end(payload) {
      res.body = payload
      return res
    },
  }
  return res
}

// A browser: keeps the cookies the app sets and sends them back, so sessions are exercised for real.
export class Client {
  constructor(ip = '203.0.113.7') {
    this.cookies = new Map()
    this.ip = ip
  }

  clone() {
    const copy = new Client(this.ip)
    copy.cookies = new Map(this.cookies)
    return copy
  }

  async call(handler, { method = 'POST', body, query, headers = {} } = {}) {
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
    const req = createRequest({
      method,
      body,
      query,
      ip: this.ip,
      headers: { ...(cookie ? { cookie } : {}), ...headers },
    })
    const res = createResponse()
    await handler(req, res)
    this.storeCookies(res.getHeader('set-cookie'))
    return res
  }

  storeCookies(setCookie) {
    const lines = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
    for (const line of lines) {
      const [pair, ...attributes] = line.split(';')
      const separator = pair.indexOf('=')
      const name = pair.slice(0, separator).trim()
      const value = pair.slice(separator + 1).trim()
      const expired = attributes.some(attribute => /^\s*max-age=0\s*$/i.test(attribute))
      if (!value || expired) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }
}
