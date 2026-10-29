#!/bin/sh
set -eu

db_path="${DATABASE_URL:-/app/data/temp-mail.db}"

db_dir=""
case "$db_path" in
  */*)
    db_dir="$(dirname "$db_path")"
    ;;
esac

mkdir -p /app/data
if [ -n "$db_dir" ] && [ "$db_dir" != "." ]; then
  mkdir -p "$db_dir"
fi

# A host directory mounted at /app/data is usually owned by root or by the host user, not by the
# unprivileged user the app runs as, so hand it over before dropping privileges.
if [ "$(id -u)" = "0" ]; then
  chown -R nextjs:nodejs /app/data
  # The database holds password hashes and encrypted IMAP credentials; nobody else needs to read it.
  chmod 700 /app/data
  if [ -n "$db_dir" ] && [ "$db_dir" != "." ] && [ "$db_dir" != "/app/data" ]; then
    chown -R nextjs:nodejs "$db_dir"
    chmod 700 "$db_dir"
  fi

  exec gosu nextjs "$@"
fi

exec "$@"
