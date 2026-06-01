const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..', '..');
const localEnvPath = path.join(rootDir, '.env');

if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath, quiet: true });
}

const fallbackEnvPath = process.env.ZAMMAD_FALLBACK_ENV_PATH || process.env.AUTO_RECAT_ENV_PATH || '';
if ((!process.env.ZAMMAD_TOKEN || !process.env.ZAMMAD_URL) && fallbackEnvPath && fs.existsSync(fallbackEnvPath)) {
  dotenv.config({ path: fallbackEnvPath, override: false, quiet: true });
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

function parseUserOwnerMap(value) {
  return parseCsv(value)
    .map((item) => {
      const [usernamePart, ownerIdPart] = item.split(':');
      const username = String(usernamePart || '').trim().toLowerCase();
      const ownerId = Number.parseInt(String(ownerIdPart || '').trim(), 10);
      if (!username || !Number.isInteger(ownerId)) {
        return null;
      }

      return [username, ownerId];
    })
    .filter(Boolean);
}

function parseUserEmailMap(value) {
  return parseCsv(value)
    .map((item) => {
      const [usernamePart, ...emailParts] = item.split(':');
      const username = String(usernamePart || '').trim().toLowerCase();
      const email = emailParts.join(':').trim().toLowerCase();
      if (!username || !email) {
        return null;
      }

      return [username, email];
    })
    .filter(Boolean);
}

function normalizeUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function normalizeBasePath(value, fallback = '/') {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return fallback;
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutDuplicateSlashes = withLeadingSlash.replace(/\/{2,}/g, '/');
  if (withoutDuplicateSlashes === '/') {
    return '/';
  }

  return withoutDuplicateSlashes.endsWith('/') ? withoutDuplicateSlashes : `${withoutDuplicateSlashes}/`;
}

function normalizeApiBasePath(value, fallback = '/api') {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return fallback;
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutDuplicateSlashes = withLeadingSlash.replace(/\/{2,}/g, '/');
  if (withoutDuplicateSlashes === '/') {
    return '/';
  }

  return withoutDuplicateSlashes.endsWith('/') ? withoutDuplicateSlashes.slice(0, -1) : withoutDuplicateSlashes;
}

function parseCsvRows(content) {
  const rows = [];
  let row = [];
  let value = '';
  let insideQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"') {
      if (insideQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === ',' && !insideQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(value);
      value = '';
      if (row.some((entry) => entry !== '')) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    value += char;
  }

  if (value !== '' || row.length > 0) {
    row.push(value);
    if (row.some((entry) => entry !== '')) {
      rows.push(row);
    }
  }

  return rows;
}

function loadSlaCustomerOrgMap(filePath) {
  if (!fs.existsSync(filePath)) {
    return new Map();
  }

  try {
    const rows = parseCsvRows(fs.readFileSync(filePath, 'utf8'));
    if (rows.length < 2) {
      return new Map();
    }

    const header = rows[0].map((entry) => entry.trim());
    const statusIndex = header.indexOf('status');
    const orgIdIndex = header.indexOf('org_id');
    const slaCustomerIndex = header.indexOf('sla_customer');

    if (statusIndex === -1 || orgIdIndex === -1 || slaCustomerIndex === -1) {
      return new Map();
    }

    const entries = rows.slice(1)
      .map((columns) => ({
        status: String(columns[statusIndex] || '').trim().toLowerCase(),
        orgId: Number.parseInt(String(columns[orgIdIndex] || '').trim(), 10),
        slaCustomer: String(columns[slaCustomerIndex] || '').trim(),
      }))
      .filter((entry) => entry.status === 'mapped' && Number.isInteger(entry.orgId) && entry.slaCustomer);

    return new Map(entries.map((entry) => [entry.orgId, entry.slaCustomer]));
  } catch {
    return new Map();
  }
}

const defaultPowerDnsQueueGroups = [
  { key: 'emea', label: 'PowerDNS EMEA', groupIds: [22] },
  { key: 'strategic', label: 'PowerDNS Strategic & Partners', groupIds: [21] },
  { key: 'americas', label: 'PowerDNS Americas', groupIds: [23] },
  { key: 'centerCells', label: 'PowerDNS Center Cells', groupIds: [35, 36, 40, 42, 48] },
  { key: 'supportGlobal', label: 'Support Global PDNS', groupIds: [53] },
];

function uniqueIntList(values) {
  return [...new Set(values.filter((item) => Number.isInteger(item)))];
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseIntValue(process.env.PORT, 3001),
  host: String(process.env.HOST || process.env.BIND_HOST || '0.0.0.0').trim() || '0.0.0.0',
  rootDir,
  appUser: process.env.APP_USERNAME || 'agent',
  appPassword: process.env.APP_PASSWORD || 'changeme',
  sessionTtlHours: parseIntValue(process.env.SESSION_TTL_HOURS, 12),
  rememberSessionTtlHours: parseIntValue(process.env.REMEMBER_SESSION_TTL_HOURS, 24 * 30),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'zammad_mobile_session',
  sessionCookieSecure: parseBoolean(process.env.SESSION_COOKIE_SECURE, false),
  readOnlyMode: parseBoolean(process.env.READ_ONLY_MODE, false),
  auditLogPath: path.resolve(rootDir, process.env.AUDIT_LOG_PATH || 'logs/audit.log'),
  frontendDistPath: path.resolve(rootDir, 'frontend', 'dist'),
  frontendBasePath: normalizeBasePath(process.env.VITE_BASE_PATH || process.env.APP_BASE_PATH || '/zammad/'),
  apiBasePath: normalizeApiBasePath(process.env.VITE_API_BASE || process.env.API_BASE_PATH || '/zammad-api'),
  publicAppUrl: normalizeUrl(process.env.PUBLIC_APP_URL || process.env.APP_BASE_URL || `http://localhost:${parseIntValue(process.env.PORT, 3001)}/`),
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
    requireAccountFilter: parseBoolean(process.env.POWERDNS_REQUIRE_ACCOUNT_FILTER, false),
    defaultOwnerId: parseIntValue(process.env.POWERDNS_DEFAULT_OWNER_ID, null),
    ownerOptions: parseOwnerOptions(process.env.POWERDNS_OWNER_OPTIONS || ''),
    workflowMacros: parseMacroOptions(
      process.env.POWERDNS_WORKFLOW_MACROS,
      'waitingCustomer:2:Waiting for customer +7d,processing:18:Processing +7d,pendingAutoclose3:16:Pending autoclose +3d',
    ),
    unassignedOwnerIds: parseIntList(process.env.UNASSIGNED_OWNER_IDS || '1'),
    newTicketStates: parseCsv(process.env.NEW_TICKET_STATE_NAMES || 'new')
      .map((state) => state.toLowerCase()),
    openTicketStates: parseCsv(process.env.OPEN_TICKET_STATE_NAMES || 'open')
      .map((state) => state.toLowerCase()),
    processingStates: parseCsv(process.env.PROCESSING_STATE_NAMES || 'processing')
      .map((state) => state.toLowerCase()),
    waitingCustomerStates: parseCsv(process.env.WAITING_CUSTOMER_STATE_NAMES || 'waiting for customer,pending reminder,pending action')
      .map((state) => state.toLowerCase()),
    pendingAutocloseStates: parseCsv(process.env.PENDING_AUTOCLOSE_STATE_NAMES || 'pending autoclose,pending auto-close,pending close')
      .map((state) => state.toLowerCase()),
    visibleTicketStates: parseCsv(
      process.env.VISIBLE_TICKET_STATE_NAMES || 'new,open,waiting for customer,pending autoclose,pending auto-close,pending close,processing',
    ).map((state) => state.toLowerCase()),
    highPriorityNames: parseCsv(process.env.HIGH_PRIORITY_NAMES || '3 high,4 urgent')
      .map((priority) => priority.toLowerCase()),
    highPriorityIds: parseIntList(process.env.HIGH_PRIORITY_IDS),
    openStateExclusions: parseCsv(process.env.OPEN_STATE_EXCLUSIONS || 'closed,merged,removed')
      .map((state) => state.toLowerCase()),
    ticketListLimit: parseIntValue(process.env.TICKET_LIST_LIMIT, 75),
  },
  appUserOwnerMap: new Map(parseUserOwnerMap(process.env.APP_USER_OWNER_MAP || '')),
  appUserZammadEmailMap: new Map(parseUserEmailMap(process.env.APP_USER_ZAMMAD_EMAIL_MAP || '')),
  notifications: {
    pollSeconds: parseIntValue(process.env.NOTIFICATION_POLL_SECONDS, 60),
    statePath: path.resolve(rootDir, process.env.NOTIFICATION_STATE_PATH || 'logs/notification-state.json'),
  },
  push: {
    subject: String(process.env.VAPID_SUBJECT || '').trim(),
    publicKey: String(process.env.VAPID_PUBLIC_KEY || '').trim(),
    privateKey: String(process.env.VAPID_PRIVATE_KEY || '').trim(),
    subscriptionStorePath: path.resolve(rootDir, process.env.PUSH_SUBSCRIPTIONS_PATH || 'logs/push-subscriptions.json'),
  },
  sla: {
    customerOrgMapPath: path.resolve(rootDir, process.env.SLA_CUSTOMER_ORG_MAP_PATH || 'sla_customer_org_map.csv'),
    customerOrgMap: new Map(),
  },
};

config.sla.customerOrgMap = loadSlaCustomerOrgMap(config.sla.customerOrgMapPath);

if (config.powerdns.groupIds.length === 0 && Number.isInteger(config.powerdns.groupId)) {
  config.powerdns.groupIds = [config.powerdns.groupId];
}

if (config.powerdns.groupIds.length === 0) {
  config.powerdns.groupIds = uniqueIntList(defaultPowerDnsQueueGroups.flatMap((queue) => queue.groupIds));
}

config.powerdns.queueGroups = [
  {
    key: 'all',
    label: 'All PowerDNS Queues',
    groupIds: uniqueIntList([
      ...config.powerdns.groupIds,
      ...defaultPowerDnsQueueGroups.flatMap((queue) => queue.groupIds),
    ]),
  },
  ...defaultPowerDnsQueueGroups,
];

function resolveAssignedOwnerId(username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (normalized && config.appUserOwnerMap.has(normalized)) {
    return config.appUserOwnerMap.get(normalized);
  }

  return config.powerdns.defaultOwnerId;
}

function resolveAssignedUserEmail(username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (normalized && config.appUserZammadEmailMap.has(normalized)) {
    return config.appUserZammadEmailMap.get(normalized);
  }

  return '';
}

function validateConfig() {
  if (!config.zammad.url) {
    throw new Error('ZAMMAD_URL is required. Set it in .env or point ZAMMAD_FALLBACK_ENV_PATH to a shared env file.');
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
  resolveAssignedOwnerId,
  resolveAssignedUserEmail,
  validateConfig,
};
