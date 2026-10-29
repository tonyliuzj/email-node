import './helpers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createLimiter } from '../src/lib/imap-limit.js'
import { arrivedAfterRegistration, parseSqliteTimestamp } from '../src/lib/mail-window.js'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

// ---------- which mail belongs to an address ----------

// SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC.
const sqliteTime = date => date.toISOString().slice(0, 19).replace('T', ' ')
const registeredAt = new Date('2026-03-01T12:00:00Z')

test('mail from before the address was registered is not shown to its owner', () => {
  const created = sqliteTime(registeredAt)
  const earlier = new Date(registeredAt.getTime() - 60 * 60 * 1000)
  const lastWeek = new Date(registeredAt.getTime() - 7 * 24 * 60 * 60 * 1000)

  assert.equal(arrivedAfterRegistration(earlier, created), false, 'an hour before')
  assert.equal(arrivedAfterRegistration(lastWeek, created), false, 'a week before: the previous owner\'s mail')
})

test('mail from after registration is shown, including the first message seconds later', () => {
  const created = sqliteTime(registeredAt)
  for (const seconds of [0, 3, 30, 3600]) {
    assert.equal(arrivedAfterRegistration(new Date(registeredAt.getTime() + seconds * 1000), created), true, `${seconds}s after`)
  }
})

test('a mail server whose clock runs a little behind does not hide the first verification email', () => {
  const created = sqliteTime(registeredAt)
  // stamped 90 seconds before the app's registration time, though it really arrived just after
  assert.equal(arrivedAfterRegistration(new Date(registeredAt.getTime() - 90_000), created), true)
  assert.equal(arrivedAfterRegistration(new Date(registeredAt.getTime() - 130_000), created), false, 'beyond the margin')
})

test('the margin can be changed', () => {
  const created = sqliteTime(registeredAt)
  process.env.MAIL_CLOCK_SKEW_SECONDS = '0'
  assert.equal(arrivedAfterRegistration(new Date(registeredAt.getTime() - 1000), created), false)
  process.env.MAIL_CLOCK_SKEW_SECONDS = '600'
  assert.equal(arrivedAfterRegistration(new Date(registeredAt.getTime() - 500_000), created), true)
  process.env.MAIL_CLOCK_SKEW_SECONDS = 'nonsense'
  assert.equal(arrivedAfterRegistration(new Date(registeredAt.getTime() - 100_000), created), true, 'falls back to 120s')
  delete process.env.MAIL_CLOCK_SKEW_SECONDS
})

test('dates may arrive as strings, and a message with no usable date is hidden', () => {
  const created = sqliteTime(registeredAt)
  assert.equal(arrivedAfterRegistration('2026-03-01T13:00:00Z', created), true)
  assert.equal(arrivedAfterRegistration('2026-02-01T13:00:00Z', created), false)
  for (const bad of [undefined, null, '', 'not a date', NaN]) {
    assert.equal(arrivedAfterRegistration(bad, created), false, String(bad))
  }
})

test('when the registration time is unknown nothing is hidden', () => {
  for (const unknown of [undefined, null, '', 'garbage']) {
    assert.equal(arrivedAfterRegistration(new Date(0), unknown), true, String(unknown))
  }
  assert.equal(parseSqliteTimestamp('2026-03-01 12:00:00'), registeredAt.getTime(), 'read as UTC, not local time')
})

// ---------- the connection limit ----------

test('never more than the limit run at once, and everyone eventually gets a turn', async () => {
  const limiter = createLimiter({ max: 3, waitMs: 5000 })
  let running = 0
  let peak = 0
  const finished = []

  await Promise.all(Array.from({ length: 12 }, (_, id) => (async () => {
    const release = await limiter.acquire()
    try {
      running += 1
      peak = Math.max(peak, running)
      await pause(15)
      finished.push(id)
    } finally {
      running -= 1
      release()
    }
  })()))

  assert.equal(peak, 3)
  assert.equal(finished.length, 12)
  assert.deepEqual(limiter.stats(), { active: 0, waiting: 0 })
})

test('requests that wait too long are turned away with EBUSY and do not block the rest', async () => {
  const limiter = createLimiter({ max: 1, waitMs: 40 })
  const release = await limiter.acquire()

  await assert.rejects(limiter.acquire(), { code: 'EBUSY' })
  assert.deepEqual(limiter.stats(), { active: 1, waiting: 0 }, 'the refused request left the queue')

  release()
  const next = await limiter.acquire()
  next()
  assert.deepEqual(limiter.stats(), { active: 0, waiting: 0 })
})

test('a slot is returned when the work fails, and releasing twice is harmless', async () => {
  const limiter = createLimiter({ max: 1, waitMs: 100 })

  await assert.rejects((async () => {
    const release = await limiter.acquire()
    try {
      throw new Error('IMAP exploded')
    } finally {
      release()
    }
  })(), /IMAP exploded/)

  const release = await limiter.acquire()
  release()
  release()
  assert.deepEqual(limiter.stats(), { active: 0, waiting: 0 }, 'a double release did not free a slot that was not held')

  const first = await limiter.acquire()
  await assert.rejects(limiter.acquire(), { code: 'EBUSY' }, 'only one slot exists')
  first()
})

// ---------- size caps ----------

test('ordinary messages pass through the size caps untouched', async () => {
  const { limitMessageBody } = await import('../src/lib/message-limits.js')
  assert.deepEqual(limitMessageBody({ text: 'hello', html: '<p>hello</p>' }), { text: 'hello', html: '<p>hello</p>', truncated: false })
  assert.deepEqual(limitMessageBody({ text: undefined, html: null }), { text: undefined, html: null, truncated: false })
})

test('over-long text is cut and over-long HTML is dropped, never cut into broken markup', async () => {
  const { limitMessageBody, MAX_TEXT_CHARS, MAX_HTML_CHARS } = await import('../src/lib/message-limits.js')

  const longText = limitMessageBody({ text: 'x'.repeat(MAX_TEXT_CHARS + 500), html: '<p>ok</p>' })
  assert.equal(longText.text.length, MAX_TEXT_CHARS)
  assert.equal(longText.html, '<p>ok</p>')
  assert.equal(longText.truncated, true)

  const longHtml = limitMessageBody({ text: 'readable fallback', html: `<p>${'y'.repeat(MAX_HTML_CHARS)}</p>` })
  assert.equal(longHtml.html, null, 'the reader falls back to the text part')
  assert.equal(longHtml.text, 'readable fallback')
  assert.equal(longHtml.truncated, true)

  assert.equal(limitMessageBody({ text: 'x'.repeat(MAX_TEXT_CHARS), html: 'y'.repeat(MAX_HTML_CHARS) }).truncated, false, 'exactly at the limit is fine')
})
