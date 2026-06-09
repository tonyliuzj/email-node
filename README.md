# Email Node — IMAP Webmail UI

A modern, self-hosted IMAP webmail UI with an inbox address system. Email Node does not send, receive, relay, or host mail by itself; it connects to catch-all IMAP mailboxes you already control, lets visitors create persistent inbox addresses on configured domains, and provides a browser inbox for reading matching messages.

---

## Features

- **Inbox Address System**
  Create persistent inbox addresses with secure passkey authentication. Users can log back in anytime to access mail delivered to that address.

- **Multi-Domain Support**
  Configure multiple domains backed by catch-all IMAP mailboxes. Users can choose from available domains when creating addresses.

- **IMAP Webmail Inbox**
  Polls IMAP on a configurable interval. View sender, subject, and message preview, then click to read full emails with sanitized HTML rendering.

- **Modern, Responsive UI**
  Clean interface with dark mode support, built with Tailwind CSS and Lucide icons. Mobile-friendly design with smooth animations.

- **Secure Authentication**
  - Session-based authentication with iron-session
  - Bcrypt password hashing for admin and user passkeys
  - Passkey regeneration with manual masking controls
  - Optional Cloudflare Turnstile CAPTCHA for address creation and login

- **Admin Panel**
  - First-run setup page for creating the initial admin user
  - Configure multiple domains with individual IMAP settings
  - Manage Turnstile CAPTCHA settings for address creation and login
  - Change admin credentials and customize site title
  - Dynamic admin path configuration

- **SQLite Storage**
  Self-contained `temp-mail.db` in `data/` directory with automatic schema migrations.

---

## Getting Started

### Prerequisites

- **Node.js** v18+ (recommended v20+)
- **npm** or **yarn**
- A **catch-all** IMAP mailbox you control (one per domain)
- (Optional) A [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) account for CAPTCHA protection

### Installation

#### Quick Install (One-Click Script)

```bash
curl -sSL https://github.com/tonyliuzj/email-node/releases/latest/download/email-node.sh -o email-node.sh && chmod +x email-node.sh && bash email-node.sh
```

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
│   ├── session.js                  # Admin session management
│   ├── user-session.js             # User session management
│   ├── user-auth.js                # User authentication helpers
│   └── turnstile.js                # Turnstile verification
├── components/
│   ├── app-shell.js                # Shared app shell built with shadcn/ui
│   └── ui/                         # shadcn/ui components
│       └── ...
└── styles/
    └── globals.css                 # Global styles & Tailwind
data/
└── temp-mail.db                    # SQLite database (auto-created)
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

Docker assets are not included in this repository yet. Use the Node.js production build above, or add a project-specific Dockerfile before deploying with Docker.

### Environment Variables

Most configuration is done through the admin panel. Environment variables:

- `SESSION_PASSWORD` - Secret used for encrypted sessions.
- `DATA_ENCRYPTION_KEY` - Secret used to encrypt stored IMAP and Turnstile secrets. If omitted, the app falls back to `SESSION_PASSWORD`.
- `PORT` - Port used by the Next.js server.

---

## Security Features

- **Session-based authentication** with `iron-session` for both admin and users
- **Bcrypt password hashing** for all credentials (admin and user passkeys)
- **Secure passkey management** with regeneration and manual masking controls
- **Optional CAPTCHA protection** via Cloudflare Turnstile for address creation and login
- **Encrypted stored secrets** for IMAP passwords and Turnstile secret keys
- **Same-origin checks and rate limits** on mutating API routes
- **Secure cookie settings** with httpOnly and secure flags

---

## User Experience

- **Responsive Design** - Mobile-first layout that adapts to all screen sizes
- **Dark Mode Support** - Automatic theme switching based on system preferences
- **Auto Refresh** - Inbox refresh interval is configurable from the admin dashboard
- **Smooth Animations** - Polished transitions and loading states
- **Accessible UI** - Keyboard navigation and screen reader support
- **Copy to Clipboard** - One-click copying of email addresses and passkeys

---

## License

This project is [MIT-licensed](./LICENSE). Feel free to fork and adapt!
