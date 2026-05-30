# Zammad Mobile for PowerDNS

Mobile-first React PWA plus a small Express proxy for working only on PowerDNS tickets in Zammad.

## What this MVP includes

- backend proxy that keeps the Zammad token or session cookie on the server
- app login handled separately from Zammad, backed by `.env`
- PowerDNS-only queue filtering using the same Zammad URL and token source as the local `auto-recat` project
- four focused views:
  - My Open Tickets
  - Unassigned PowerDNS Tickets
  - Waiting for Customer
  - Escalated / High Priority
- ticket cards with number, title, customer, state, priority, owner, and `updated_at`
- ticket detail with the full article thread
- clear distinction between internal notes and customer-visible replies
- reply or internal note composer
- owner, state, and priority updates
- attachment upload and attachment download proxy
- search by ticket number or subject
- mobile-first queue tabs with touch swipe between views
- installable PWA assets and service worker registration
- audit log written as JSON lines to `logs/audit.log`

## Stack

- frontend: React + Vite + React Query
- backend: Node.js + Express
- deploy: Docker multi-stage build + Docker Compose

## Configuration

Copy the sample env:

```bash
cp .env.example .env
```

The backend loads `.env` first and then optionally falls back to `/Users/afrisina/auto-recat/.env` when `ZAMMAD_URL` or `ZAMMAD_TOKEN` are missing locally. That gives you the same API key source as the `auto-recat` project without exposing it to the browser.

Important variables:

- `APP_USERNAME` and `APP_PASSWORD`: credentials for logging into this mobile app
- `APP_USER_OWNER_MAP`: optional mapping between app usernames and Zammad owner IDs, example `agent:214,todd:87`
- `HOST`: bind address used by the packaged Express app
- `DOCKER_BIND_ADDRESS`: host-side bind address for Docker port publishing, use `127.0.0.1` for local-only or `0.0.0.0` for LAN/Tailscale reachability
- `HOST_PORT`: host-side published port for Docker, defaults to `3001`
- `SESSION_COOKIE_SECURE`: set to `true` when you front the app with HTTPS such as Tailscale Serve
- `READ_ONLY_MODE`: set to `true` to block all ticket updates and article posting while still allowing browsing
- `ZAMMAD_URL`: your Zammad base URL
- `ZAMMAD_AUTH_MODE`: `token` or `session`
- `ZAMMAD_TOKEN`: use the same value already used by `auto-recat`
- `ZAMMAD_SESSION_COOKIE`: optional alternative to token auth
- `POWERDNS_GROUP_ID`: numeric PowerDNS group ID for single-group setups
- `POWERDNS_GROUP_IDS`: comma-separated PowerDNS group IDs for tenants that split queues across multiple PowerDNS groups
- `POWERDNS_ORGANIZATION_IDS`: comma-separated PowerDNS organization IDs for B2B queue scoping
- `POWERDNS_CUSTOMER_IDS`: optional comma-separated customer IDs to keep the queue scoped to PowerDNS customers
- `POWERDNS_DEFAULT_OWNER_ID`: fallback owner when no per-user mapping is configured; seeded to `214` from `auto-recat`
- `POWERDNS_OWNER_OPTIONS`: owner choices shown in the UI, example `214:Antonio Frisina,87:Another Agent`
- `PUBLIC_APP_URL`: full externally reachable app URL used in push notification links, for example `http://192.168.1.20:3001/zammad/` or `https://your-mac.tailnet.ts.net/zammad/`
- `VITE_BASE_PATH` and `VITE_API_BASE`: frontend and backend base paths, defaulting to `/zammad/` and `/zammad-api`

When `POWERDNS_ORGANIZATION_IDS` is set, it takes precedence over `POWERDNS_CUSTOMER_IDS`. This is usually the better fit for shared support organizations.

If your tenant uses different workflow naming, tune:

- `WAITING_CUSTOMER_STATE_NAMES`
- `HIGH_PRIORITY_NAMES`
- `HIGH_PRIORITY_IDS`
- `UNASSIGNED_OWNER_IDS`
- `OPEN_STATE_EXCLUSIONS`

## Local development

Run the backend:

```bash
cd backend
npm install
npm run dev
```

Run the frontend in another terminal:

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` and `/health` to `http://localhost:3001`.

## Docker

Build and run the packaged app:

```bash
docker compose up --build
```

The container serves the compiled frontend and the API from the same Express server on port `3001`.

### Run entirely on your Mac

For a local-only Docker setup on macOS:

```bash
cp .env.example .env
docker compose up --build -d
```

That publishes `127.0.0.1:3001` by default, so the app is available only on the Mac itself.

To expose it directly on your LAN or over the Mac's Tailscale IP, set these in `.env` before starting:

```bash
HOST=0.0.0.0
DOCKER_BIND_ADDRESS=0.0.0.0
HOST_PORT=3001
PUBLIC_APP_URL=http://YOUR-MAC-IP:3001/zammad/
```

Then open:

```text
http://YOUR-MAC-IP:3001/zammad/
```

### Tailscale-recommended setup

For tailnet-only access with HTTPS, keep Docker published on localhost and let Tailscale proxy it:

```bash
HOST=0.0.0.0
DOCKER_BIND_ADDRESS=127.0.0.1
HOST_PORT=3001
SESSION_COOKIE_SECURE=true
docker compose up --build -d
tailscale serve --bg 3001
```

Then set `PUBLIC_APP_URL` to the HTTPS URL shown by `tailscale serve`, for example:

```text
https://your-mac.tailnet.ts.net/zammad/
```

This is the cleaner option for iPhone/PWA use because it gives you HTTPS without opening the app on your whole LAN.

## Notes about iPhone install

This repo includes a web manifest, service worker registration, and standalone-capable metadata. For real iPhone installation outside localhost, serve it through HTTPS on a reachable hostname or reverse proxy.

## API integration layer

The Zammad integration lives in:

- [backend/src/zammad.js](/Users/afrisina/repositories/Zammad-mobile/backend/src/zammad.js)
- [backend/src/config.js](/Users/afrisina/repositories/Zammad-mobile/backend/src/config.js)

It currently uses these official Zammad REST endpoints:

- `GET /api/v1/tickets`
- `GET /api/v1/tickets/search`
- `GET /api/v1/tickets/:id`
- `PUT /api/v1/tickets/:id`
- `GET /api/v1/ticket_articles/by_ticket/:id`
- `POST /api/v1/ticket_articles`
- `GET /api/v1/ticket_attachment/:ticketId/:articleId/:attachmentId`
- `GET /api/v1/ticket_states`
- `GET /api/v1/ticket_priorities`
- `GET /api/v1/users/:id`

## Security model

- the browser never receives the Zammad API token
- credentials stay in `.env`
- the app uses an app-level session cookie for login
- read-only mode can block all write operations server-side against the live helpdesk
- every ticket update, article creation, attachment download, and auth event is audit logged

## Current MVP trade-offs

- owner options are preset from env for predictability instead of dynamically listing every Zammad agent
- “My assigned tickets” uses `APP_USER_OWNER_MAP` when present and falls back to `POWERDNS_DEFAULT_OWNER_ID`
- search uses the dedicated ticket search endpoint when available and falls back to the ticket list endpoint if needed
