# Email Node — IMAP Webmail UI

A modern, self-hosted IMAP webmail UI with an inbox address system. Email Node does not send, receive, relay, or host mail by itself; it connects to catch-all IMAP mailboxes you already control, lets visitors create persistent inbox addresses on configured domains, and provides a browser inbox for reading matching messages.

---

## Features

- **Inbox Address System**
  Create persistent inbox addresses with secure passkey authentication. Users can log back in anytime to access mail delivered to that address.

- **Multi-Domain Support**
  Configure multiple domains backed by catch-all IMAP mailboxes. Users can choose from available domains when creating addresses.

- **IMAP Webmail Inbox**
  Polls IMAP on a configurable interval. View sender, subject, and message preview, then click to read full emails with sanitized HTML rendering. Images from the internet are blocked until the reader clicks **Load images**, so senders cannot track who opened a message.
  - **Attachments** are listed on each message and download with their real name and exact contents. Pictures that are part of a message (logos, signatures) are shown in it.
  - Messages can be marked **read or unread** and **deleted**. These are kept per address on this site, never on your mail server: one message can be addressed to several of your users, so deleting it there would delete it for all of them.
  - **Load older messages** pages back through mail beyond the newest 50.

- **Modern, Responsive UI**
  Clean interface with dark mode support, built with Tailwind CSS and Lucide icons. Mobile-friendly design with smooth animations.

- **Secure Authentication**
  - Session-based authentication with iron-session
  - Bcrypt password hashing for admin and user passkeys
  - Passkey regeneration with manual masking controls
  - Changing a passkey or the admin password signs out every other device
  - Optional two-factor authentication (authenticator app) for the admin, with one-time recovery codes
  - Repeated failed admin logins lock the account for a while, whatever IP they come from
  - Optional Cloudflare Turnstile CAPTCHA for address creation and login
  - Optional setup token so only you can create the first admin account

- **Admin Panel**
  - First-run setup page for creating the initial admin user
  - Configure multiple domains with individual IMAP settings
  - Manage Turnstile CAPTCHA settings for address creation and login
  - Browse, search and delete the addresses visitors have created, and expire unused ones automatically
  - Download a backup of the database, with a tested restore
  - Turn on two-factor authentication for the admin account
  - Change admin credentials and customize site title
  - Dynamic admin path configuration

- **SQLite Storage**
  Self-contained `temp-mail.db` in `data/` directory with automatic schema migrations.

---

## Getting Started

### Prerequisites

- **Node.js** v18+ (recommended v20+)
- **npm** or **yarn**
- **Docker Engine** with **Docker Compose v2** (`docker compose`) for manual container deployment
- A **catch-all** IMAP mailbox you control (one per domain)
- (Optional) A [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) account for CAPTCHA protection

### Installation

#### Quick Install (One-Click Script)

```bash
curl -fsSL --retry 5 --retry-delay 5 --retry-all-errors https://github.com/tonyliuzj/email-node/releases/latest/download/email-node.sh -o email-node.sh && chmod +x email-node.sh && bash email-node.sh
```

The download is retried automatically because the file is briefly unavailable while a new version is being published.

Choose **Docker install (Compose)** in the installer to run the published Docker image with a persistent `data/` directory. On Ubuntu/Debian hosts, the installer configures Docker's official apt repository, removes conflicting distro Docker packages such as `docker.io`, and installs Docker Engine with the Compose v2 plugin.

The installer shows a menu: **Install**, **Update**, **Start**, **Stop**, **Restart**, **Status**, **Logs** and **Uninstall**.

##### Updating

Run the installer again and choose **Update**. It pulls the latest code, then:

- **Docker installs** stop a leftover direct (systemd) service if there is one, pull the newest image and restart the containers. If the host port is still being released by the old container, starting is retried automatically.
- **Direct installs** reinstall dependencies, rebuild the app and restart the systemd service.

Local edits to `package-lock.json` are discarded during an update. Any other locally modified file is stashed (not lost); restore it afterwards with `git stash pop`.

Always download a fresh `email-node.sh` with the command above before updating, so you run the newest installer.

##### Troubleshooting

- **`address already in use` when starting Docker**: if the app was previously installed directly, the installer stops and disables its systemd service first (both modes use the same `data/` folder, so nothing is lost) and retries if the old container is still releasing the port. If something else is using the port, the installer prints the process and its PID. Stop it or change `HOST_PORT` in `.env`.
- **Installer download returns an XML error**: the file is briefly missing while a release is published. Use the download command above, which retries.

#### Docker Compose Installation

Manual Docker deployment requires the Compose v2 command form, `docker compose`. The legacy `docker-compose` executable is not used.

1. **Clone the repository**
```bash
git clone https://github.com/tonyliuzj/email-node.git
cd email-node
```

2. **Create runtime secrets**
```bash
cp example.env.local .env.local
```

Replace the placeholder `SESSION_PASSWORD` and `DATA_ENCRYPTION_KEY` values in `.env.local` with strong random values:
```bash
openssl rand -base64 32
```

Also add a setup token, so nobody else can create the admin account before you do:
```bash
echo "SETUP_TOKEN=$(openssl rand -hex 16)" >> .env.local
```
The setup page asks for it; read it back from `.env.local`.

3. **Start the app**
```bash
docker compose pull
docker compose up -d
```

4. **Open your browser**
   Navigate to [http://localhost:3000/setup](http://localhost:3000/setup) and create the first admin user.

The Compose file uses the published image `tonyliuzj/email-node:latest` by default and mounts `./data` to `/app/data` so the SQLite database survives container updates. The container's start-up script takes ownership of that folder for the unprivileged user the app runs as, so it works even when Docker creates `./data` as root. The file is named `docker-compose.yml`; only the command syntax is Compose v2.

#### Manual Installation

1. **Clone the repository**
```bash
git clone https://github.com/tonyliuzj/email-node.git
cd email-node
```

2. **Install dependencies**
```bash
npm install
```

3. **Run in development mode**
```bash
npm run dev
```

4. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

5. **Create the first admin user**
   On a fresh database, the app redirects to [http://localhost:3000/setup](http://localhost:3000/setup). Create your admin user there.

6. **Configure your first domain**
   In the admin panel, add a domain with your IMAP settings.

---

## Configuration

All settings are stored in the SQLite database at `data/temp-mail.db`. Configure everything through the admin panel.

### Admin Settings

Access the admin panel at `/admin` (or your custom admin path):

| Setting                          | Description                                      |
| -------------------------------- | ------------------------------------------------ |
| **Site Title**                   | Displayed in browser tab and header              |
| **Admin Path**                   | Custom URL path for admin panel (default: admin) |
| **Admin Username**               | Change your admin username                       |
| **Admin Password**               | Change your admin password                       |
| **Turnstile Site Key**           | Cloudflare Turnstile site key                    |
| **Turnstile Secret Key**         | Cloudflare Turnstile secret key                  |
| **Registration CAPTCHA**         | Enable/disable CAPTCHA for account creation      |
| **Login CAPTCHA**                | Enable/disable CAPTCHA for login                 |
| **Addresses**                    | Search, delete (one or many) any visitor address |
| **Inactivity limit**             | Delete addresses unused for N days (0 = never)   |
| **Two-factor authentication**    | Authenticator-app code required at admin login   |
| **Backup**                       | Download a copy of the whole database            |

**Deleting addresses.** The **Addresses** card lists every address with when it was created and last used. Deleting one removes its passkey and sign-in for good; the name can be registered again. Deleting a domain deletes the addresses on it too.

**Inactivity limit.** An address counts as used when its owner signs in or opens the inbox; mail arriving for it does not count. With a limit set (for example 90 days), unused addresses are removed the next time someone uses the site, checked at most once an hour. The page tells you how many would go before you save. Existing addresses start counting from the day you upgrade, so switching this on never deletes old addresses straight away.

**Two-factor authentication.** Under **Two-factor authentication**, confirm your password, add the shown key to an authenticator app (Google Authenticator, Authy, 1Password, Bitwarden: choose "enter a setup key"), then type the 6-digit code it shows. You are given eight recovery codes, each usable once, so keep them somewhere safe. Turning it on or off signs out every other device. If you lose both the app and the codes, see [Recovering admin access](#recovering-admin-access).

Because failed logins are counted per account, someone who knows your admin username can lock you out for about 15 minutes by guessing wrongly eight times. Pick a username that isn't obvious.

### Recovering admin access

There is no "forgot password" email, so recovery happens on the server, next to the database. It works if you forgot the password, lost your authenticator and recovery codes, or both:

```bash
# set a new admin password (typed at a prompt, not shown)
node scripts/reset-admin.cjs --password

# turn two-factor off
node scripts/reset-admin.cjs --disable-2fa

# Docker
docker compose exec -u nextjs email-node node scripts/reset-admin.cjs --password
```

Both actions sign every other admin session out. If the account was locked by failed logins, restart the app, because that lock is held in memory. Add `--username NAME` if there is more than one admin. The script uses `DATABASE_URL`, or `data/temp-mail.db` in the folder you run it from.

### Backup and restore

The **Backup** card downloads a consistent copy of the database (addresses, domains, settings and the admin account). It asks for your password again, because the file holds every password hash and the encrypted IMAP, Turnstile and two-factor secrets. Store it somewhere private, and keep your `DATA_ENCRYPTION_KEY` with it: those saved secrets can only be read with the key they were encrypted with.

To restore, stop the app, put the backup in place, and start it again. The script checks the file first (it must be a healthy SQLite database with this app's tables) and keeps the database it replaces next to it as `temp-mail.db.before-restore-<time>`:

```bash
# direct install
sudo systemctl stop email-node
node scripts/restore-backup.cjs path/to/email-node-backup-2026-01-01-12-00-00.db
sudo systemctl start email-node

# Docker
docker compose stop
cp email-node-backup-2026-01-01-12-00-00.db data/restore.db
docker compose run --rm --no-deps -u nextjs email-node node scripts/restore-backup.cjs /app/data/restore.db
docker compose start
```

The script will not run without a terminal to confirm on unless you add `--yes`, and it refuses if the database is in use.

### Domain Configuration

Add and manage multiple domains in the admin panel:

| Setting          | Description                                      |
| ---------------- | ------------------------------------------------ |
| **Domain Name**  | e.g. `example.com`                               |
| **IMAP Host**    | e.g. `imap.example.com`                          |
| **IMAP Port**    | Usually `993` for TLS                            |
| **IMAP User**    | Catch-all account (e.g. `catchall@example.com`)  |
| **IMAP Password**| Password for IMAP account                        |
| **Use TLS**      | Enable TLS/SSL (recommended)                     |
| **Active**       | Enable/disable domain for new address creation   |

**Important:** Email Node is only a web UI and address manager. Each domain requires an external catch-all IMAP mailbox that receives all emails sent to `*@yourdomain.com`.

**First-run admin setup:**
Fresh installs start without an admin account. Visit `/setup` to create the first admin user; after setup completes, `/setup` redirects to the admin login page.

Until setup is finished, whoever reaches `/setup` first becomes the admin. The installer therefore generates a `SETUP_TOKEN`, prints it, and stores it in `.env.local`; the setup page asks for it. If you set up manually, add a `SETUP_TOKEN` (any long random string) to `.env.local` before exposing the app. Without one, setup is open to the first visitor.

---

## Project Structure

```
src/
├── pages/
│   ├── index.js                    # Landing page: address creation & login
│   ├── inbox.js                    # User inbox with email list & detail view
│   ├── [adminPath]/
│   │   ├── index.js                # Admin dashboard
│   │   └── login.js                # Admin login page
│   └── api/
│       ├── users/
│       │   ├── create.js           # Inbox address creation
│       │   ├── login.js            # User authentication
│       │   ├── logout.js           # User logout
│       │   └── me.js               # Get current user
│       ├── account/
│       │   ├── info.js             # Get user account details
│       │   └── regenerate-passkey.js # Regenerate user passkey
│       ├── [adminPath]/
│       │   ├── login.js            # Admin authentication
│       │   ├── logout.js           # Admin logout
│       │   ├── config.js           # Admin settings management
│       │   ├── domains.js          # Domain CRUD operations
│       │   ├── change-username.js  # Change admin username
│       │   └── change-password.js  # Change admin password
│       ├── emails.js               # Fetch IMAP messages for user
│       ├── domains.js              # Get active domains list
│       └── info.js                 # Get public site info
├── lib/
│   ├── db.js                       # SQLite database & schema
│   ├── session.js                  # iron-session cookie configuration
│   ├── session-auth.js             # Checks session cookies against the database
│   ├── user-auth.js                # Page and route wrappers for signed-in users
│   ├── security.js                 # Client IP, rate limits, same-origin checks, setup token
│   ├── recipients.js               # Exact recipient matching for IMAP results
│   ├── admin-auth.js               # Admin sign-in: password, lockout, second factor
│   ├── totp.js                     # Authenticator-app codes and recovery codes
│   ├── remote-images.js            # Blocks/restores remote images in messages
│   ├── mail-window.js              # Which messages arrived while an address was registered
│   ├── imap-limit.js               # Caps simultaneous connections to the mail server
│   ├── message-limits.js           # Size caps for message bodies sent to the browser
│   ├── schema-migrations.js        # Race-safe column migrations
│   ├── attachments.js              # Lists a message's attachments and makes their names safe
│   ├── part-stream.js              # Streams and decodes one attachment from the mail server
│   ├── inline-images.js            # Pictures that are part of a message (Content-ID)
│   ├── imap-session.js             # Mail server connection, timeouts, ownership check
│   ├── message-parser.js           # Message parsing settings
│   ├── validation.js               # Input normalisation
│   ├── email-sanitizer.js          # HTML sanitising for message bodies
│   ├── secret-store.js             # Encryption for stored secrets
│   └── turnstile.js                # Turnstile verification
├── components/
│   ├── app-shell.js                # Shared app shell built with shadcn/ui
│   ├── admin/                      # Admin dashboard cards (addresses, two-factor)
│   └── ui/                         # shadcn/ui components
│       └── ...
└── styles/
    └── globals.css                 # Global styles & Tailwind
data/
└── temp-mail.db                    # SQLite database (auto-created)
Dockerfile                          # Production container image
docker-compose.yml                  # Docker Compose deployment
email-node.sh                       # Interactive direct/Docker installer
scripts/
├── reset-admin.cjs                 # Reset the admin password / turn off two-factor from the server
└── restore-backup.cjs              # Validate a backup and put it in place of the database
tests/                              # Automated tests (npm test)
```

### Key Components

- **`db.js`** - Database schema with tables for admin, settings, domains, emails, and sessions
- **`user-auth.js`** - Server-side authentication wrapper for protected pages
- **`emails.js`** - IMAP client that fetches messages for specific email addresses
- **`inbox.js`** - IMAP inbox UI with configurable auto-refresh
- **`[adminPath]`** - Dynamic admin routes based on configured admin path

---

## Deployment

### Production Build

```bash
npm run build
npm start
```

### Vercel Deployment

Email Node can be deployed to Vercel, but note that SQLite requires a persistent filesystem:

1. Connect your GitHub repository to Vercel
2. Ensure the `data/` directory is writable and persisted
3. Consider using a volume or external database for production

### Docker Deployment

The repository includes a production `Dockerfile` and `docker-compose.yml`. Use Docker Compose v2 commands only:

```bash
docker compose pull
docker compose up -d
```

The one-click installer can install Docker for Ubuntu/Debian systems. It uses Docker's official apt packages:

```text
docker-ce
docker-ce-cli
containerd.io
docker-buildx-plugin
docker-compose-plugin
```

Before installing those packages, the installer removes conflicting distro packages when present, including `docker.io`, `docker-compose`, `containerd`, and `runc`.

Useful Docker commands:

```bash
docker compose logs -f
docker compose ps
docker compose down
```

To expose a different host port, create or edit `.env` next to `docker-compose.yml`:

```bash
HOST_PORT=8080
CONTAINER_PORT=3000
DOCKER_IMAGE=tonyliuzj/email-node:latest
```

To build locally instead of using Docker Hub:

```bash
docker compose up -d --build
```

When using the installer, Docker mode pulls the published image first and builds from the cloned checkout if the pull fails.

### Publishing Docker Images

GitHub Actions publishes the image for `linux/amd64` and `linux/arm64` to Docker Hub after every push to `main`, once lint and type checking pass. Each build is tagged `tonyliuzj/email-node:latest` and `tonyliuzj/email-node:<commit-sha>`. The workflow can also be run by hand from the **Actions** tab, and only publishes when run on `main`.

It needs two repository secrets: `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (a Docker Hub access token with write access to `tonyliuzj/email-node`).

To publish manually instead:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t tonyliuzj/email-node:latest --push .
```

Pull requests and pushes to other branches run lint, type checking and a production build.

### Environment Variables

Most configuration is done through the admin panel. Environment variables:

- `SESSION_PASSWORD` - Secret used for encrypted sessions.
- `DATA_ENCRYPTION_KEY` - Secret used to encrypt stored IMAP and Turnstile secrets. If omitted, the app falls back to `SESSION_PASSWORD`. Keep it unchanged once secrets are stored: a different key cannot decrypt them. When the installer adds a missing key during an update, it copies the current `SESSION_PASSWORD` so existing secrets keep working.
- `DATABASE_URL` - SQLite file path, absolute or relative to the working directory. Defaults to `data/temp-mail.db` (`/app/data/temp-mail.db` in Docker).
- `PORT` - Port used by the Next.js server.
- `SETUP_TOKEN` - Required on the first-run setup page when set. The installer generates one. It has no effect once an admin exists.
- `SESSION_COOKIE_SECURE` - Session cookies are `Secure` in production, so browsers only keep them over HTTPS (or on `localhost`). Set this to `false` only if you open the app over plain `http://` with a server address; HTTPS is strongly preferred.
- `TRUST_PROXY_HEADERS` - Client IPs (used for rate limiting) are read from `CF-Connecting-IP`, `X-Real-IP` or the last `X-Forwarded-For` entry. Set this to `false` if the app is reachable directly, without a proxy that sets one of them, so a client cannot forge its address.
- `MAX_ATTACHMENT_MB` - Largest attachment that can be downloaded. Default `15`. Bigger files are refused rather than streamed.
- `MAIL_CLOCK_SKEW_SECONDS` - How far before an address was registered a message may be stamped and still be shown to it. Default `120`. See [Who can read which mail](#who-can-read-which-mail).
- `IMAP_MAX_CONNECTIONS` - Most inbox refreshes allowed to talk to the mail server at once. Default `8`. Extra refreshes wait a few seconds, then are told the mailbox is busy.
- `HOST_PORT` - Host port used by Docker Compose.
- `CONTAINER_PORT` - Container port used by Docker Compose.
- `DOCKER_IMAGE` - Docker image used by Docker Compose and the installer.

---

### Who can read which mail

All addresses on a domain share one catch-all mailbox, so being in that mailbox does not make a message yours. A message is shown to an address only if both of these hold:

1. **It was sent to exactly that address** (To, Cc or the delivery headers). A search for `a@example.com` never returns mail for `ba@example.com`.
2. **It arrived after the address was registered.** Without this, deleting or expiring an address would hand the previous owner's mail (password resets, receipts) to whoever registers the same name next, and anyone could register a name just to read what was already sent to it.

The second rule uses the time the mail server received the message (not the `Date` header, which the sender controls), and allows `MAIL_CLOCK_SKEW_SECONDS` of difference between the two servers' clocks. The trade-off: mail that arrived in the two minutes before a name was re-registered is still shown to the new owner. Lower the setting if your servers keep good time; raise it if the first email after sign-up ever fails to appear and the mail server's clock runs behind.

Messages stay in your mailbox after an address is deleted or expires. Clean them up with your mail server's own retention rules.

## Security Features

- **Session-based authentication** with `iron-session` for both admin and users
- **Bcrypt password hashing** for all credentials (admin and user passkeys)
- **Secure passkey management** with regeneration and manual masking controls
- **Optional CAPTCHA protection** via Cloudflare Turnstile for address creation and login
- **Encrypted stored secrets** for IMAP passwords and Turnstile secret keys
- **Same-origin checks and rate limits** on mutating API routes. Limits are keyed on a client IP that a visitor cannot forge through `X-Forwarded-For`, and IPv6 clients share a limit per /64.
- **Exact inbox isolation**: IMAP header search matches substrings, so every message is checked against its real recipients before it is shown. `a@example.com` never sees mail for `ba@example.com`.
- **Sessions are checked against the database** on every request. Regenerating a passkey, changing the admin password or username, or deleting an address signs out all other sessions.
- **Hardened service**: the systemd unit the installer writes runs the app as an ordinary user with a read-only file system except its database and build cache, no new privileges, a private `/tmp`, no device access and no extra capabilities (just `NET_BIND_SERVICE` if you choose a port below 1024). `systemd-analyze security` rates it 3.6 "OK"; an unhardened service scores about 9.6.
- **Safe attachments**: every download is checked again for ownership (exact recipient, arrived while the address was registered) before a byte is sent. Everything downloads as a file, never rendered in the browser, with a sanitised name; only a few image types are ever shown inline, and never SVG.
- **Private by default**: the installer creates the env files (which hold the session secret, encryption key and setup token) readable only by their owner, tightens existing ones on update, and keeps the data folder private to the app user.
- **Bounded mailbox load**: each refresh only fetches mail newer than what the page already has, message bodies are size-capped, messages are parsed one at a time, and the number of simultaneous connections to your mail server is limited.
- **No cached API responses**: every `/api` response is sent with `Cache-Control: no-store`.
- **Signing out only signs you out**: visitors and the admin share one session cookie, but signing out as one no longer signs out the other.
- **Constant-time logins**: an unknown address or admin username takes as long to reject as a wrong password.
- **Setup protection** with an optional `SETUP_TOKEN`, so a freshly deployed server cannot be claimed by whoever finds it first.
- **Two-factor login** for the admin (RFC 6238 codes that cannot be replayed, hashed single-use recovery codes) and per-account lockout after repeated failures.
- **Remote image blocking**: images from the internet in a message do not load until the reader asks, so tracking pixels reveal nothing.
- **Strict script policy**: in production, pages only run scripts served by this site (plus Cloudflare Turnstile). There is no `unsafe-inline` or `unsafe-eval`, so injected markup cannot execute code even if it got past the sanitiser.
- **Reserved admin paths**: the admin path cannot be set to a name such as `inbox` or `setup`, which would make the dashboard unreachable.
- **Secure cookie settings** with httpOnly, sameSite=strict and secure flags, plus an HSTS header in production.

---

## User Experience

- **Responsive Design** - Mobile-first layout that adapts to all screen sizes
- **Dark Mode Support** - Automatic theme switching based on system preferences
- **Auto Refresh** - Inbox refresh interval is configurable from the admin dashboard
- **Smooth Animations** - Polished transitions and loading states
- **Accessible UI** - Keyboard navigation and screen reader support
- **Copy to Clipboard** - One-click copying of email addresses and passkeys
- **Delete Address** - Remove your address, passkey and sign-in from the account page

---

## Development

```bash
npm run dev      # start the dev server
npm test         # automated tests (Node's built-in test runner, uses a temporary SQLite database)
npm run lint
npx tsc --noEmit
```

GitHub Actions runs lint, type checking and the tests before every Docker image publish, and on pull requests. Tests need Node.js 22.7 or newer.

`npm run build` uses webpack (`next build --webpack`) on purpose. Next 16's default bundler, Turbopack, puts one inline `<script>` in every page, and the script policy (no `unsafe-inline`) blocks it, which leaves a page that loads but does nothing. CI starts the standalone server and fails if any page contains an inline script, and checks that the standalone build holds only what the server needs. The Docker workflow starts the built image and checks that it serves pages before it is published.

Dependabot proposes dependency updates weekly, and a separate weekly workflow runs `npm audit` on the production dependencies, so a newly published advisory shows up there instead of blocking a deploy.

---

## License

This project is [MIT-licensed](./LICENSE). Feel free to fork and adapt!
