// Every inbox refresh opens its own connection to the mail server. Without a limit, enough open inboxes
// (or one noisy client) can use up the mailbox's connection allowance and lock everybody out. Requests
// beyond the limit wait briefly for a slot, then give up with code EBUSY.

export function createLimiter({ max = 8, waitMs = 8000 } = {}) {
  let active = 0
  const waiting = []

  function releaser() {
    let released = false
    return () => {
      if (released) return
      released = true
      active -= 1
      promoteWaiting()
    }
  }

  function promoteWaiting() {
    while (active < max && waiting.length > 0) {
      const next = waiting.shift()
      clearTimeout(next.timer)
      active += 1
      next.resolve(releaser())
    }
  }

  return {
    // Resolves with a release function. Always call it, in a finally block.
    acquire() {
      if (active < max) {
        active += 1
        return Promise.resolve(releaser())
      }

      return new Promise((resolve, reject) => {
        const entry = { resolve }
        entry.timer = setTimeout(() => {
          waiting.splice(waiting.indexOf(entry), 1)
          const error = new Error('Too many mailbox requests at once.')
          error.code = 'EBUSY'
          reject(error)
        }, waitMs)
        waiting.push(entry)
      })
    },
    stats() {
      return { active, waiting: waiting.length }
    },
  }
}

export const imapLimiter = createLimiter({
  max: Number.parseInt(process.env.IMAP_MAX_CONNECTIONS ?? '', 10) || 8,
})
