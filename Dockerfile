FROM node:22-bookworm-slim AS deps

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder

COPY . .
RUN npm run build

# The standalone build is what ships, so it must hold only what the server needs. If a bundler change ever
# pulls the whole project, or a database, into it, fail here instead of publishing an image that contains them.
RUN for unwanted in src/lib src/components src/pages/api data tests scripts; do \
      if [ -e ".next/standalone/$unwanted" ]; then echo "The standalone build contains $unwanted/, which must not ship." >&2; exit 1; fi; \
    done; \
    if find .next/standalone -name '*.db' -not -path '*/node_modules/*' | grep -q .; then echo "A database file ended up in the standalone build." >&2; exit 1; fi

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DATABASE_URL=/app/data/temp-mail.db

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates gosu \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs \
  && mkdir -p /app/data \
  && chown -R nextjs:nodejs /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

# No USER here: the entrypoint starts as root only to fix ownership of /app/data, then runs the app
# as nextjs through gosu.
EXPOSE 3000

VOLUME ["/app/data"]

# Healthy means the server answers and can read its database (this route queries it).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/domains').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
