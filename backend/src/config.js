const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..', '..');
const localEnvPath = path.join(rootDir, '.env');

if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath, quiet: true });
}

const fallbackAutoRecatEnv = process.env.AUTO_RECAT_ENV_PATH || '/Users/afrisina/auto-recat/.env';
if ((!process.env.ZAMMAD_TOKEN || !process.env.ZAMMAD_URL) && fallbackAutoRecatEnv && fs.existsSync(fallbackAutoRecatEnv)) {
  dotenv.config({ path: fallbackAutoRecatEnv, override: false, quiet: true });
}

function parseIntValue(value, fallback = null) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIntList(value) {
  return parseCsv(value)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isInteger(item));
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseOwnerOptions(value) {
  return parseCsv(value)
    .map((item) => {
      const [idPart, ...labelParts] = item.split(':');
      const id = Number.parseInt((idPart || '').trim(), 10);
      if (!Number.isInteger(id)) {
        return null;
      }

      return {
        id,
        label: labelParts.join(':').trim() || `Owner #${id}`,
      };
    })
    .filter(Boolean);
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseIntValue(process.env.PORT, 3001),
  rootDir,
  appUser: process.env.APP_USERNAME || 'agent',
  appPassword: process.env.APP_PASSWORD || 'changeme',
  sessionTtlHours: parseIntValue(process.env.SESSION_TTL_HOURS, 12),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'zammad_mobile_session',
  readOnlyMode: parseBoolean(process.env.READ_ONLY_MODE, true),
  auditLogPath: path.resolve(rootDir, process.env.AUDIT_LOG_PATH || 'logs/audit.log'),
  frontendDistPath: path.resolve(rootDir, 'frontend', 'dist'),
  zammad: {
    url: String(process.env.ZAMMAD_URL || '').replace(/\/+$/, ''),
    authMode: (process.env.ZAMMAD_AUTH_MODE || 'token').trim().toLowerCase(),
    token: (process.env.ZAMMAD_TOKEN || process.env.ZAMMAD_API_TOKEN || '').trim(),
    sessionCookie: (process.env.ZAMMAD_SESSION_COOKIE || '').trim(),
  },
  powerdns: {
    groupId: parseIntValue(process.env.POWERDNS_GROUP_ID, null),
    groupName: process.env.POWERDNS_GROUP_NAME || 'PowerDNS',
    customerIds: parseIntList(process.env.POWERDNS_CUSTOMER_IDS),
    defaultOwnerId: parseIntValue(process.env.POWERDNS_DEFAULT_OWNER_ID, 214),
    ownerOptions: parseOwnerOptions(process.env.POWERDNS_OWNER_OPTIONS || '214:Antonio Frisina'),
    unassignedOwnerIds: parseIntList(process.env.UNASSIGNED_OWNER_IDS || '1'),
    waitingCustomerStates: parseCsv(process.env.WAITING_CUSTOMER_STATE_NAMES || 'waiting for customer,pending reminder,pending action')
      .map((state) => state.toLowerCase()),
    highPriorityNames: parseCsv(process.env.HIGH_PRIORITY_NAMES || '3 high,4 urgent')
      .map((priority) => priority.toLowerCase()),
    highPriorityIds: parseIntList(process.env.HIGH_PRIORITY_IDS),
    openStateExclusions: parseCsv(process.env.OPEN_STATE_EXCLUSIONS || 'closed,merged,removed')
      .map((state) => state.toLowerCase()),
    ticketListLimit: parseIntValue(process.env.TICKET_LIST_LIMIT, 75),
  },
};

function validateConfig() {
  if (!config.zammad.url) {
    throw new Error('ZAMMAD_URL is required. Set it in .env or point AUTO_RECAT_ENV_PATH to the auto-recat env file.');
  }

  if (config.zammad.authMode === 'token' && !config.zammad.token) {
    throw new Error('ZAMMAD_TOKEN is required when ZAMMAD_AUTH_MODE=token.');
  }

  if (config.zammad.authMode === 'session' && !config.zammad.sessionCookie) {
    throw new Error('ZAMMAD_SESSION_COOKIE is required when ZAMMAD_AUTH_MODE=session.');
  }
}

module.exports = {
  config,
  validateConfig,
};
