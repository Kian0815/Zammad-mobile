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
const { addArticle, getAttachment, getLookups, getTicket, listPowerDnsTickets, updateTicket } = require('./zammad');

validateConfig();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const sessions = new Map();

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

function createSession(username) {
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + (config.sessionTtlHours * 60 * 60 * 1000);
  const session = { token, username, expiresAt };
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
    customer: ticket.customer ? (ticket.customer.fullname || ticket.customer.email || `User #${ticket.customer.id}`) : 'Unknown customer',
    state: ticket.state_name,
    priority: ticket.priority_name,
    owner: ticket.owner ? (ticket.owner.fullname || ticket.owner.email || `User #${ticket.owner.id}`) : 'Unassigned',
    updated_at: ticket.updated_at,
    escalation_at: ticket.escalation_at,
    owner_id: ticket.owner_id,
    customer_id: ticket.customer_id,
    state_id: ticket.state_id,
    priority_id: ticket.priority_id,
  };
}

function buildViews(tickets) {
  const waitingCustomerSet = new Set(config.powerdns.waitingCustomerStates);
  const highPriorityNameSet = new Set(config.powerdns.highPriorityNames);
  const highPriorityIdSet = new Set(config.powerdns.highPriorityIds);
  const unassignedSet = new Set(config.powerdns.unassignedOwnerIds);

  const views = {
    myOpen: {
      key: 'myOpen',
      label: 'My Open Tickets',
      tickets: tickets.filter((ticket) => ticket.owner_id === config.powerdns.defaultOwnerId),
    },
    unassigned: {
      key: 'unassigned',
      label: 'Unassigned PowerDNS Tickets',
      tickets: tickets.filter((ticket) => !ticket.owner_id || unassignedSet.has(ticket.owner_id)),
    },
    waitingCustomer: {
      key: 'waitingCustomer',
      label: 'Waiting for Customer',
      tickets: tickets.filter((ticket) => waitingCustomerSet.has(String(ticket.state_name || '').toLowerCase())),
    },
    escalated: {
      key: 'escalated',
      label: 'Escalated / High Priority',
      tickets: tickets.filter((ticket) => {
        const priorityName = String(ticket.priority_name || '').toLowerCase();
        return Boolean(ticket.escalation_at) || highPriorityNameSet.has(priorityName) || highPriorityIdSet.has(ticket.priority_id);
      }),
    },
  };

  for (const view of Object.values(views)) {
    view.tickets = view.tickets
      .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
      .map(toViewPayload);
  }

  return views;
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    env: config.env,
    zammadUrl: config.zammad.url,
    powerdnsGroupId: config.powerdns.groupId,
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== config.appUser || password !== config.appPassword) {
    audit('auth.login_failed', { username: username || '' });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const session = createSession(username);
  res.cookie(config.sessionCookieName, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: config.sessionTtlHours * 60 * 60 * 1000,
  });
  audit('auth.login', { username });
  return res.json({
    username,
    defaultOwnerId: config.powerdns.defaultOwnerId,
    readOnlyMode: config.readOnlyMode,
  });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  sessions.delete(req.session.token);
  res.clearCookie(config.sessionCookieName);
  audit('auth.logout', { username: req.session.username });
  res.status(204).end();
});

app.get('/api/auth/session', (req, res) => {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'No active session' });
  }

  return res.json({
    username: session.username,
    defaultOwnerId: config.powerdns.defaultOwnerId,
    readOnlyMode: config.readOnlyMode,
  });
});

app.get('/api/lookups', requireAuth, async (_req, res, next) => {
  try {
    return res.json(await getLookups());
  } catch (error) {
    return next(error);
  }
});

app.get('/api/tickets', requireAuth, async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const tickets = await listPowerDnsTickets(search);
    return res.json({
      generatedAt: new Date().toISOString(),
      search,
      views: buildViews(tickets),
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

app.listen(config.port, () => {
  fs.mkdirSync(path.dirname(config.auditLogPath), { recursive: true });
  console.log(`Zammad mobile backend listening on http://localhost:${config.port}`);
});
