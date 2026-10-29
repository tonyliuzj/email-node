// Adds a column if it is missing. Table and column names must be constants, never user input.
//
// Several processes can start against the same database at once: the workers of `next build` all load
// the app, and so can replicas that share a data folder. Checking for the column and then adding it as
// two separate steps lets two of them both see it missing, and the second ALTER fails. So the check,
// the ALTER and the optional back-fill run as one write transaction. Whoever gets the lock first adds
// the column and the others find it already there, and nobody can see the column before its back-fill.
export function ensureColumn(database, table, column, definition, { backfill } = {}) {
  const apply = database.transaction(() => {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all()
    if (columns.some(existing => existing.name === column)) return false

    database.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run()
    if (backfill) database.prepare(backfill).run()
    return true
  })

  try {
    return apply.immediate()
  } catch (error) {
    // Belt and braces: if someone still got there first, the column exists, which is all we wanted.
    if (/duplicate column name/i.test(String(error?.message))) return false
    throw error
  }
}
