const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const multer = require('multer');
const { audit } = require('./audit');
const { config, validateConfig } = require('./config');
const { getPushConfig, removeSubscription, saveSubscription, startNotificationPolling } = require('./notifications');
const { addArticle, applyMacro, getAttachment, getLookups, getTicket, getWorkflowMacros, listPowerDnsTickets, resolveAssignedOwnerIdForUsername, updateTicket } = require('./zammad');

validateConfig();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const sessions = new Map();

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.use((req, _res, next) => {
  if (req.url === config.apiBasePath) {
    req.url = '/api';
  } else if (req.url.startsWith(`${config.apiBasePath}/`)) {
    req.url = `/api/${req.url.slice(`${config.apiBasePath}/`.length)}`;
  }
  next();
});

function createSession(username, assignedOwnerId, remember = false) {
  const token = crypto.randomUUID();
  const ttlHours = remember ? config.rememberSessionTtlHours : config.sessionTtlHours;
  const ttlMs = ttlHours * 60 * 60 * 1000;
  const expiresAt = Date.now() + ttlMs;
  const session = { token, username, assignedOwnerId, expiresAt, ttlMs, remember };
  sessions.set(token, session);
  return session;
}

function getSession(req) {
  const token = req.cookies[config.sessionCookieName];
  if (!token || !sessions.has(token)) {
    return null;
  }

  const session = sessions.get(token);
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  return session;
}

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.session = session;
  return next();
}

function requireWritable(req, res, next) {
  if (!config.readOnlyMode) {
    return next();
  }

  audit('read_only.blocked', {
    username: req.session?.username || 'unknown',
    method: req.method,
    path: req.path,
  });
  return res.status(403).json({
    error: 'Read-only mode is enabled. Live ticket changes are blocked.',
  });
}

function toViewPayload(ticket) {
  return {
    id: ticket.id,
    number: ticket.number,
    title: ticket.title,
    queue_key: ticket.queue_key,
    queue_label: ticket.queue_label,
    customer: ticket.customer,
    state: ticket.state,
    priority: ticket.priority,
    owner: ticket.owner,
    updated_at: ticket.updated_at,
    escalation_at: ticket.escalation_at,
    owner_id: ticket.owner_id,
    customer_id: ticket.customer_id,
    organization_id: ticket.organization_id,
    state_id: ticket.state_id,
    priority_id: ticket.priority_id,
    is_new: ticket.is_new,
    sla_customer: ticket.sla_customer,
    first_response_escalation_at: ticket.first_response_escalation_at,
    update_escalation_at: ticket.update_escalation_at,
    close_escalation_at: ticket.close_escalation_at,
  };
}

function sortTickets(tickets, sortBy = 'updated') {
  const queueOrder = new Map(config.powerdns.queueGroups.map((queue, index) => [queue.key, index]));

  return [...tickets].sort((left, right) => {
    if (sortBy === 'queue') {
      const queueDelta = (queueOrder.get(left.queue_key) ?? 999) - (queueOrder.get(right.queue_key) ?? 999);
      if (queueDelta !== 0) {
        return queueDelta;
      }
    }

    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });
}

function buildViews(tickets, assignedOwnerId, sortBy = 'updated') {
  const newTicketSet = new Set(config.powerdns.newTicketStates);
  const openTicketSet = new Set(config.powerdns.openTicketStates);
  const processingSet = new Set(config.powerdns.processingStates);
  const waitingCustomerSet = new Set(config.powerdns.waitingCustomerStates);
  const pendingAutocloseSet = new Set(config.powerdns.pendingAutocloseStates);

  const views = {
    allActive: {
      key: 'allActive',
      label: 'All active',
      tickets,
    },
    myAssigned: {
      key: 'myAssigned',
      label: 'My assigned tickets',
      tickets: tickets.filter((ticket) => ticket.owner_id === assignedOwnerId),
    },
    newTickets: {
      key: 'newTickets',
      label: 'New',
      tickets: tickets.filter((ticket) => newTicketSet.has(String(ticket.state_name || '').toLowerCase())),
    },
    openTickets: {
      key: 'openTickets',
      label: 'Open',
      tickets: tickets.filter((ticket) => openTicketSet.has(String(ticket.state_name || '').toLowerCase())),
    },
    waitingCustomer: {
      key: 'waitingCustomer',
      label: 'Waiting for customer',
      tickets: tickets.filter((ticket) => waitingCustomerSet.has(String(ticket.state_name || '').toLowerCase())),
    },
    pendingAutoclose: {
      key: 'pendingAutoclose',
      label: 'Pending auto-close',
      tickets: tickets.filter((ticket) => pendingAutocloseSet.has(String(ticket.state_name || '').toLowerCase())),
    },
    processing: {
      key: 'processing',
      label: 'Processing',
      tickets: tickets.filter((ticket) => processingSet.has(String(ticket.state_name || '').toLowerCase())),
    },
  };

  for (const view of Object.values(views)) {
    view.tickets = sortTickets(view.tickets, sortBy).map(toViewPayload);
  }

  return views;
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    env: config.env,
    zammadUrl: config.zammad.url,
    powerdnsGroupId: config.powerdns.groupId,
    powerdnsGroupIds: config.powerdns.groupIds,
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password, remember } = req.body || {};
  if (username !== config.appUser || password !== config.appPassword) {
    audit('auth.login_failed', { username: username || '' });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const assignedOwnerId = await resolveAssignedOwnerIdForUsername(username);
  const session = createSession(username, assignedOwnerId, Boolean(remember));
  res.cookie(config.sessionCookieName, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.sessionCookieSecure,
    maxAge: session.ttlMs,
  });
  audit('auth.login', { username, remember: Boolean(remember) });
  return res.json({
    username,
    defaultOwnerId: assignedOwnerId,
    readOnlyMode: config.readOnlyMode,
  });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  sessions.delete(req.session.token);
  res.clearCookie(config.sessionCookieName);
  audit('auth.logout', { username: req.session.username });
  res.status(204).end();
});

app.get('/api/auth/session', async (req, res) => {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'No active session' });
  }

  const assignedOwnerId = session.assignedOwnerId || await resolveAssignedOwnerIdForUsername(session.username);
  return res.json({
    username: session.username,
    defaultOwnerId: assignedOwnerId,
    readOnlyMode: config.readOnlyMode,
  });
});

app.get('/api/lookups', requireAuth, async (req, res, next) => {
  try {
    const lookups = await getLookups();
    const assignedOwnerId = req.session.assignedOwnerId || await resolveAssignedOwnerIdForUsername(req.session.username);
    return res.json({
      ...lookups,
      defaultOwnerId: assignedOwnerId,
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/push/config', requireAuth, (_req, res) => {
  res.json(getPushConfig());
});

app.post('/api/push/subscribe', requireAuth, (req, res, next) => {
  try {
    saveSubscription(req.session.username, req.body?.subscription);
    audit('push.subscribe', {
      username: req.session.username,
      endpoint: req.body?.subscription?.endpoint || null,
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
  const endpoint = String(req.body?.endpoint || '').trim();
  if (endpoint) {
    removeSubscription(endpoint);
    audit('push.unsubscribe', {
      username: req.session.username,
      endpoint,
    });
  }

  res.status(204).end();
});

app.get('/api/tickets', requireAuth, async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const queue = String(req.query.queue || 'all').trim() || 'all';
    const sortBy = String(req.query.sort || 'updated').trim() || 'updated';
    const tickets = await listPowerDnsTickets(search, queue);
    const assignedOwnerId = req.session.assignedOwnerId || await resolveAssignedOwnerIdForUsername(req.session.username);
    return res.json({
      generatedAt: new Date().toISOString(),
      search,
      queue,
      sort: sortBy,
      views: buildViews(tickets, assignedOwnerId, sortBy),
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/tickets/:ticketId', requireAuth, async (req, res, next) => {
  try {
    return res.json(await getTicket(Number.parseInt(req.params.ticketId, 10)));
  } catch (error) {
    return next(error);
  }
});

app.put('/api/tickets/:ticketId', requireAuth, requireWritable, async (req, res, next) => {
  try {
    const ticketId = Number.parseInt(req.params.ticketId, 10);
    const payload = {};
    const { owner_id, state, priority } = req.body || {};

    if (owner_id !== undefined && owner_id !== null && String(owner_id).trim() !== '') {
      payload.owner_id = Number.parseInt(owner_id, 10);
    }
    if (state) {
      payload.state = state;
    }
    if (priority) {
      payload.priority = priority;
    }

    const updated = await updateTicket(ticketId, payload);
    audit('ticket.update', { username: req.session.username, ticketId, payload });
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/tickets/:ticketId/articles', requireAuth, requireWritable, upload.array('attachments'), async (req, res, next) => {
  try {
    const ticketId = Number.parseInt(req.params.ticketId, 10);
    const articleType = req.body.articleType === 'reply' ? 'email' : 'note';
    const articlePayload = {
      subject: req.body.subject || 'PowerDNS mobile update',
      body: req.body.body || '',
      content_type: 'text/html',
      type: articleType,
      internal: articleType === 'note',
      sender: 'Agent',
    };

    const article = await addArticle(ticketId, articlePayload, req.files || []);
    audit('ticket.article.add', {
      username: req.session.username,
      ticketId,
      articleType,
      attachments: (req.files || []).map((file) => file.originalname),
    });
    return res.status(201).json(article);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/tickets/:ticketId/macro', requireAuth, requireWritable, async (req, res, next) => {
  try {
    const ticketId = Number.parseInt(req.params.ticketId, 10);
    const macroKey = String(req.body?.macroKey || '').trim();
    const workflowMacros = await getWorkflowMacros();
    const macro = workflowMacros.find((entry) => entry.key === macroKey);

    if (!macro) {
      return res.status(400).json({ error: 'Unknown workflow macro.' });
    }

    const result = await applyMacro(ticketId, macro.id);
    audit('ticket.macro.apply', {
      username: req.session.username,
      ticketId,
      macroKey: macro.key,
      macroId: macro.id,
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/tickets/:ticketId/attachments/:articleId/:attachmentId', requireAuth, async (req, res, next) => {
  try {
    const ticketId = Number.parseInt(req.params.ticketId, 10);
    const articleId = Number.parseInt(req.params.articleId, 10);
    const attachmentId = Number.parseInt(req.params.attachmentId, 10);
    const attachment = await getAttachment(ticketId, articleId, attachmentId, String(req.query.view || 'download'));
    res.setHeader('Content-Type', attachment.contentType);
    audit('ticket.attachment.download', { username: req.session.username, ticketId, articleId, attachmentId });
    return res.send(attachment.buffer);
  } catch (error) {
    return next(error);
  }
});

if (fs.existsSync(config.frontendDistPath)) {
  app.use(express.static(config.frontendDistPath));
  if (config.frontendBasePath !== '/') {
    app.use(config.frontendBasePath, express.static(config.frontendDistPath));
  }
  app.get(/^\/(?!api|health).*/, (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') {
      return next();
    }

    return res.sendFile(path.join(config.frontendDistPath, 'index.html'));
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.message || 'Unexpected server error',
  });
});

app.listen(config.port, config.host, () => {
  fs.mkdirSync(path.dirname(config.auditLogPath), { recursive: true });
  console.log(`Zammad mobile backend listening on http://${config.host}:${config.port}${config.frontendBasePath}`);
  startNotificationPolling();
});
