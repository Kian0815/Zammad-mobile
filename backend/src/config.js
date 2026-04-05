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

function parseMacroOptions(value, fallback = '') {
  return parseCsv(value || fallback)
    .map((item) => {
      const [keyPart, idPart, ...labelParts] = item.split(':');
      const key = String(keyPart || '').trim();
      const id = Number.parseInt(String(idPart || '').trim(), 10);
      if (!key || !Number.isInteger(id)) {
        return null;
      }

      return {
        key,
        id,
        label: labelParts.join(':').trim() || key,
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
    groupIds: parseIntList(process.env.POWERDNS_GROUP_IDS),
    groupName: process.env.POWERDNS_GROUP_NAME || 'PowerDNS',
    organizationIds: parseIntList(process.env.POWERDNS_ORGANIZATION_IDS),
    customerIds: parseIntList(process.env.POWERDNS_CUSTOMER_IDS),
    defaultOwnerId: parseIntValue(process.env.POWERDNS_DEFAULT_OWNER_ID, 214),
    ownerOptions: parseOwnerOptions(process.env.POWERDNS_OWNER_OPTIONS || '214:Antonio Frisina'),
    workflowMacros: parseMacroOptions(
      process.env.POWERDNS_WORKFLOW_MACROS,
      'waitingCustomer:2:Waiting for customer +7d,processing:18:Processing +7d,pendingAutoclose3:16:Pending autoclose +3d',
    ),
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

if (config.powerdns.groupIds.length === 0 && Number.isInteger(config.powerdns.groupId)) {
  config.powerdns.groupIds = [config.powerdns.groupId];
}

config.powerdns.queueGroups = [
  { key: 'all', label: 'All PowerDNS Queues', groupIds: config.powerdns.groupIds },
  { key: 'emea', label: 'PowerDNS EMEA', groupIds: [22] },
  { key: 'americas', label: 'PowerDNS Americas', groupIds: [23] },
  { key: 'strategic', label: 'PowerDNS Strategic & Partners', groupIds: [21] },
  { key: 'centerCells', label: 'PowerDNS Center Cells', groupIds: [35, 36, 40, 42, 48] },
];

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
