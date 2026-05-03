<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
# Zammad Mobile for PowerDNS

Mobile-first React PWA plus a small Express proxy for working only on PowerDNS tickets in Zammad.

## What this MVP includes

- backend proxy that keeps the Zammad token or session cookie on the server
- app login handled separately from Zammad, backed by `.env`
- PowerDNS-only queue filtering using the same Zammad URL and token source as the local `auto-recat` project
- four focused views:
=======
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
# Zammad PowerDNS Mobile PWA (MVP)

Mobile-first PWA focused on **PowerDNS** tickets only. This repo contains:

- `frontend/`: React + Vite PWA client for iPhone-installable mobile workflow.
- `backend/`: Node.js/Express proxy to Zammad API.

## Features Delivered

- Login via backend proxy (`/api/auth/login`), with credentials kept server-side.
- Zammad token/session mode controlled by environment variables.
- Ticket views:
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
  - My Open Tickets
  - Unassigned PowerDNS Tickets
  - Waiting for Customer
  - Escalated / High Priority
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
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
=======
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
- Ticket cards include:
  - number, title, customer, state, priority, owner, updated_at
- Ticket detail includes:
  - mobile-friendly full article thread
  - internal notes vs customer-visible reply distinction
  - add reply/internal note
  - change owner/state/priority
  - upload attachments
- Search by ticket number or subject.
- Swipe left/right between queue views.
- Basic audit logging (`audit.log`) for login and ticket actions.
- Dockerized stack with docker-compose.

## Quick Start

1. Copy env file:
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs

```bash
cp .env.example .env
```

<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
The backend loads `.env` first and then optionally falls back to `/Users/afrisina/auto-recat/.env` when `ZAMMAD_URL` or `ZAMMAD_TOKEN` are missing locally. That gives you the same API key source as the `auto-recat` project without exposing it to the browser.

Important variables:

- `APP_USERNAME` and `APP_PASSWORD`: credentials for logging into this mobile app
- `READ_ONLY_MODE`: set to `true` to block all ticket updates and article posting while still allowing browsing
- `ZAMMAD_URL`: your Zammad base URL
- `ZAMMAD_AUTH_MODE`: `token` or `session`
- `ZAMMAD_TOKEN`: use the same value already used by `auto-recat`
- `ZAMMAD_SESSION_COOKIE`: optional alternative to token auth
- `POWERDNS_GROUP_ID`: numeric PowerDNS group ID for single-group setups
- `POWERDNS_GROUP_IDS`: comma-separated PowerDNS group IDs for tenants that split queues across multiple PowerDNS groups. The built-in PowerDNS queue set includes `21,22,23,35,36,40,42,48,53`.
- `POWERDNS_ORGANIZATION_IDS`: comma-separated PowerDNS organization IDs for B2B queue scoping
- `POWERDNS_CUSTOMER_IDS`: optional comma-separated customer IDs to keep the queue scoped to PowerDNS customers
- `POWERDNS_DEFAULT_OWNER_ID`: default owner for “My Open Tickets”; seeded to `214` from `auto-recat`
- `POWERDNS_OWNER_OPTIONS`: owner choices shown in the UI, example `214:Antonio Frisina,87:Another Agent`
- `POWERDNS_WORKFLOW_MACROS`: fallback macro list used only if `/api/v1/macros` cannot be read

When `POWERDNS_ORGANIZATION_IDS` is set, it takes precedence over `POWERDNS_CUSTOMER_IDS`. This is usually the better fit for shared support organizations.
Zammad macros are loaded dynamically from `/api/v1/macros`, filtered to active macros visible to the configured PowerDNS groups, and cached briefly by the backend.
The mobile queue selector exposes PowerDNS EMEA, PowerDNS Strategic & Partners, PowerDNS Americas, PowerDNS Center Cells, and Support Global PDNS. “All PowerDNS Queues” includes all of those groups.

If your tenant uses different workflow naming, tune:

- `WAITING_CUSTOMER_STATE_NAMES`
- `HIGH_PRIORITY_NAMES`
- `HIGH_PRIORITY_IDS`
- `UNASSIGNED_OWNER_IDS`
- `OPEN_STATE_EXCLUSIONS`

## Local development

Use Node 22 or newer. The repo includes `.nvmrc` and `.node-version`, and the Docker image also uses Node 22.

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
- “My Open Tickets” is tied to `POWERDNS_DEFAULT_OWNER_ID`
- search uses the dedicated ticket search endpoint when available and falls back to the ticket list endpoint if needed
=======
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
2. Fill in `ZAMMAD_URL`, `ZAMMAD_API_TOKEN`, and proxy credentials.

3. Start stack:

```bash
docker compose up --build
```

4. Open app:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4000`

## iPhone PWA install

1. Open the frontend URL in Safari.
2. Tap Share → **Add to Home Screen**.
3. Launch the installed app icon.

<<<<<<< ours
<<<<<<< ours
=======
=======
>>>>>>> theirs
### Note about installed app domain

- The iPhone home-screen PWA always opens from the exact domain it was installed from.
- If your icon opens `antoniofrisina.com`, that specific deployment is being served from `https://antoniofrisina.com` (not from this local repo by itself).
- This repository does **not** include any DNS/hosting provider configuration; by default, local development serves:
  - Frontend: `http://localhost:5173`
  - Backend: `http://localhost:4000`

### Is it running on my Mac or on my IONOS VM?

- If the app URL is `http://localhost:5173` (or your Mac LAN IP), it is running locally on your Mac.
- If the app URL is your public domain (for example `https://antoniofrisina.com`), it is running on whichever server that domain points to (likely your IONOS VM if DNS is configured there).
- iPhone-installed PWAs keep the original install URL, so reinstalling from a different URL changes where the icon opens.

<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
## Auth modes

### `ZAMMAD_AUTH_MODE=token` (default)

- Backend authenticates to Zammad with `ZAMMAD_API_TOKEN`.
- Browser never receives token.
- User login checked against `PROXY_USERNAME`/`PROXY_PASSWORD`.

### `ZAMMAD_AUTH_MODE=session`

- Backend forwards username/password to Zammad `/signin`.
- Zammad session cookie is stored server-side in Express session.

## API Integration Layer

Implemented in `backend/src/zammadClient.js`:

- Handles Zammad auth headers/session cookies.
- Provides typed helper methods:
  - `zammadGet`, `zammadPost`, `zammadPut`
- Ticket query builder scoped to PowerDNS group.
- Ticket payload mapper for UI cards.

## Security Notes

- Zammad token is never exposed to frontend code.
- Sensitive values are loaded from `.env`.
- Session cookie is `httpOnly`.
- Add TLS + secure cookies in production.
- Restrict CORS `FRONTEND_URL` to trusted origin.

## Dev Commands

Backend:

```bash
cd backend && npm install && npm run dev
```

Frontend:

```bash
cd frontend && npm install && npm run dev
```
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======

## Git troubleshooting

If `git push` fails with:

`fatal: No configured push destination.`

configure a remote and push the current branch:

```bash
git remote add origin <your-repo-url>
git push -u origin "$(git branch --show-current)"
```
>>>>>>> theirs
