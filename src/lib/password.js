import bcrypt from 'bcrypt'

// Passwords and passkeys are hashed with the native bcrypt module, which does the work on a worker thread.
// A hash takes about 50 ms, and bcryptjs (pure JavaScript) does it on the main thread, even through its
// async functions, so a few login attempts a second would keep the whole server from answering anything else.

const ROUNDS = 10

export function hashPassword(secret) {
  return bcrypt.hash(String(secret ?? ''), ROUNDS)
}

export async function verifyPassword(secret, hash) {
  if (typeof secret !== 'string' || typeof hash !== 'string' || hash.length === 0) return false

  try {
    return await bcrypt.compare(secret, hash)
  } catch {
    return false
  }
}

// A real hash of something nobody knows, made once, so a failed lookup can be checked against it.
let timingHash = null

// Checks a secret against a throwaway hash so a failed lookup takes as long as a real check instead of
// revealing whether the account exists.
export async function spendPasswordCheckTime(secret) {
  timingHash ??= hashPassword('timing-placeholder')
  await verifyPassword(typeof secret === 'string' ? secret : '', await timingHash)
}
