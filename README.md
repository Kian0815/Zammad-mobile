# Zammad Mobile

Zammad Mobile is a mobile-first web app for working on a focused subset of Zammad tickets through a small server-side proxy. It keeps Zammad credentials on the backend, exposes a touch-friendly PWA interface, and supports lightweight deployment with Docker Compose.

## What It Does

- Provides a separate app login for the mobile UI
- Proxies Zammad API access through Express so browser clients never receive the Zammad token or session cookie
- Filters ticket views around PowerDNS-oriented queues and workflow states
- Supports ticket browsing, search, detail views, replies, internal notes, owner changes, state changes, priority updates, and attachments
- Includes installable PWA metadata and service worker support
- Writes audit events to local log files
- Supports optional web push notifications

## Stack

- Frontend: React, TypeScript, Vite, TanStack Query
- Backend: Node.js, Express
- Deployment: Docker multi-stage build and Docker Compose

## Configuration

Create a local env file:

```bash
cp .env.example .env
```

Important variables:

- `APP_USERNAME` and `APP_PASSWORD`: credentials for the app login
- `APP_USER_OWNER_MAP`: optional mapping from app username to default Zammad owner ID, for example `agent:123`
- `APP_USER_ZAMMAD_EMAIL_MAP`: optional mapping from app username to Zammad email, used to resolve the matching Zammad user dynamically
- `SESSION_TTL_HOURS` and `REMEMBER_SESSION_TTL_HOURS`: session lifetime settings
- `SESSION_COOKIE_NAME` and `SESSION_COOKIE_SECURE`: session cookie settings
- `READ_ONLY_MODE`: when `true`, blocks ticket updates and article creation
- `ZAMMAD_URL`: base URL of your Zammad instance
- `ZAMMAD_AUTH_MODE`: `token` or `session`
- `ZAMMAD_TOKEN`: API token when using token auth
- `ZAMMAD_SESSION_COOKIE`: alternative to token auth
- `ZAMMAD_FALLBACK_ENV_PATH`: optional path to another env file that already contains `ZAMMAD_URL` and `ZAMMAD_TOKEN`
- `POWERDNS_GROUP_ID` or `POWERDNS_GROUP_IDS`: queue scoping for the ticket views
- `POWERDNS_GROUP_NAME`: label used for the grouped queue
- `POWERDNS_ORGANIZATION_IDS` and `POWERDNS_CUSTOMER_IDS`: optional extra scoping filters
- `POWERDNS_DEFAULT_OWNER_ID`: fallback owner used when no per-user mapping is available
- `POWERDNS_OWNER_OPTIONS`: comma-separated owner options shown in the UI, for example `123:Primary Agent,456:Secondary Agent`
- `POWERDNS_WORKFLOW_MACROS`: optional fallback macro list when macros cannot be loaded dynamically
- `PUBLIC_APP_URL`: externally reachable base URL used in push-notification links
- `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY`: required only for push notifications
- `HOST`, `PORT`, `DOCKER_BIND_ADDRESS`, and `HOST_PORT`: runtime and published port settings
- `VITE_BASE_PATH` and `VITE_API_BASE`: frontend and backend base paths

When `POWERDNS_ORGANIZATION_IDS` is set, it takes precedence over `POWERDNS_CUSTOMER_IDS`.

## Local Development

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

The frontend dev server proxies API requests to `http://localhost:3001`.

## Deploy With Docker Compose

Build and start the app:

```bash
cp .env.example .env
docker compose up --build -d
```

By default, Docker publishes the app on `127.0.0.1:3001`. That is a good default when you plan to place the app behind a reverse proxy, VPN access layer, or HTTPS tunnel.

Example LAN-accessible settings:

```dotenv
HOST=0.0.0.0
DOCKER_BIND_ADDRESS=0.0.0.0
HOST_PORT=3001
PUBLIC_APP_URL=http://your-host-or-ip:3001/zammad/
```

Example reverse-proxy or tunnel-friendly settings:

```dotenv
HOST=0.0.0.0
DOCKER_BIND_ADDRESS=127.0.0.1
HOST_PORT=3001
SESSION_COOKIE_SECURE=true
PUBLIC_APP_URL=https://support.example.com/zammad/
```

Once the container is running, the app serves both the frontend and API from the same Express process.

## Deployment Notes

- Use HTTPS whenever the app is reachable outside the local machine
- Set `SESSION_COOKIE_SECURE=true` when the public URL is HTTPS
- Make sure `PUBLIC_APP_URL` matches the real user-facing URL so push links open correctly
- Keep `.env`, `logs/`, and any local CSV mapping files out of version control
- If you need a simple remote sync helper, use `scripts/deploy-big-vm.sh` and override `REMOTE_HOST` and `REMOTE_PATH` as needed

## Push Notifications

Push notifications are optional. To enable them:

1. Generate VAPID keys
2. Set `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY`
3. Set `PUBLIC_APP_URL` to the real public HTTPS URL
4. Redeploy the app

## Security Model

- Zammad credentials stay on the server
- The browser talks only to the local backend
- The app uses its own session cookie for access control
- `READ_ONLY_MODE` can disable all write operations
- Audit logs capture auth activity and ticket mutations

## Repository Layout

- `backend/`: Express API, Zammad integration, notifications, and config parsing
- `frontend/`: React PWA client
- `docker-compose.yml`: single-container runtime definition
- `scripts/`: optional deployment helpers
