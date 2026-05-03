<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
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
const { addArticle, applyMacro, getAttachment, getLookups, getTicket, getWorkflowMacros, listPowerDnsTickets, updateTicket } = require('./zammad');

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
    queue_key: ticket.queue_key,
    queue_label: ticket.queue_label,
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

function buildViews(tickets, sortBy = 'updated') {
  const newTicketSet = new Set(config.powerdns.newTicketStates);
  const openTicketSet = new Set(config.powerdns.openTicketStates);
  const waitingCustomerSet = new Set(config.powerdns.waitingCustomerStates);
  const highPriorityNameSet = new Set(config.powerdns.highPriorityNames);
  const highPriorityIdSet = new Set(config.powerdns.highPriorityIds);
  const unassignedSet = new Set(config.powerdns.unassignedOwnerIds);

  const views = {
    newTickets: {
      key: 'newTickets',
      label: 'New Tickets',
      tickets: tickets.filter((ticket) => newTicketSet.has(String(ticket.state_name || '').toLowerCase())),
    },
    openTickets: {
      key: 'openTickets',
      label: 'Open Tickets',
      tickets: tickets.filter((ticket) => openTicketSet.has(String(ticket.state_name || '').toLowerCase())),
    },
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
    return res.json({
      generatedAt: new Date().toISOString(),
      search,
      queue,
      sort: sortBy,
      views: buildViews(tickets, sortBy),
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
  startNotificationPolling();
=======
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import morgan from 'morgan';
import multer from 'multer';
import { config, ensureConfig } from './config.js';
import { auditLog } from './audit.js';
import {
  buildTicketQuery,
  findPowerdnsGroupId,
  mapTicket,
  zammadGet,
  zammadPost,
  zammadPut,
  zammadSignin
} from './zammadClient.js';

ensureConfig();

const upload = multer();
const app = express();

app.use(helmet());
app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('tiny'));
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
  })
);

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

async function fetchMeta(sessionData) {
  const [users, states, priorities] = await Promise.all([
    zammadGet('/users/search?query=*', sessionData),
    zammadGet('/ticket_states', sessionData),
    zammadGet('/ticket_priorities', sessionData)
  ]);

  return {
    users: Object.fromEntries(users.map((u) => [u.id, u])),
    states: Object.fromEntries(states.map((s) => [s.id, s])),
    priorities: Object.fromEntries(priorities.map((p) => [p.id, p])),
    usersList: users,
    statesList: states,
    prioritiesList: priorities
  };
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (config.zammadAuthMode === 'token') {
      if (username !== config.proxyUsername || password !== config.proxyPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      req.session.user = { id: 0, fullname: username };
      req.session.zammad = null;
    } else {
      const signin = await zammadSignin(username, password);
      req.session.user = signin.profile;
      req.session.zammad = { zammadCookie: signin.zammadCookie };
    }

    auditLog('login', { username });
    return res.json({ user: req.session.user });
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  auditLog('logout', { user: req.session.user?.id });
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

app.get('/api/meta', requireAuth, async (req, res) => {
  try {
    const meta = await fetchMeta(req.session.zammad);
    res.json({
      owners: meta.usersList,
      states: meta.statesList,
      priorities: meta.prioritiesList,
      me: req.session.user
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tickets', requireAuth, async (req, res) => {
  try {
    const view = req.query.view || 'my-open';
    const search = req.query.q || '';
    const groupId = await findPowerdnsGroupId(req.session.zammad);
    const meta = await fetchMeta(req.session.zammad);
    const query = buildTicketQuery(view, groupId, req.session.user.id, search);
    const rawTickets = await zammadGet(`/tickets/search?query=${encodeURIComponent(query)}`, req.session.zammad);
    const tickets = rawTickets.map((t) => mapTicket(t, meta.users, meta.states, meta.priorities));
    res.json({ tickets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tickets/:id', requireAuth, async (req, res) => {
  try {
    const ticket = await zammadGet(`/tickets/${req.params.id}`, req.session.zammad);
    const groupId = await findPowerdnsGroupId(req.session.zammad);
    if (ticket.group_id !== groupId) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    const articles = await zammadGet(`/ticket_articles/by_ticket/${req.params.id}`, req.session.zammad);
    res.json({ ticket, articles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/tickets/:id', requireAuth, async (req, res) => {
  try {
    const { owner_id, state_id, priority_id } = req.body;
    const payload = Object.fromEntries(
      Object.entries({ owner_id, state_id, priority_id }).filter(([, value]) => value !== undefined)
    );
    const updated = await zammadPut(`/tickets/${req.params.id}`, payload, req.session.zammad);
    auditLog('ticket_update', { user: req.session.user.id, ticket: req.params.id, payload });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tickets/:id/articles', requireAuth, upload.array('attachments'), async (req, res) => {
  try {
    const attachments = (req.files || []).map((f) => ({
      filename: f.originalname,
      'mime-type': f.mimetype,
      data: f.buffer.toString('base64')
    }));

    const body = {
      ticket_id: Number(req.params.id),
      body: req.body.body,
      type: req.body.internal === 'true' ? 'note' : 'email',
      internal: req.body.internal === 'true',
      attachments
    };

    const article = await zammadPost('/ticket_articles', body, req.session.zammad);
    auditLog('article_create', {
      user: req.session.user.id,
      ticket: req.params.id,
      internal: body.internal,
      attachment_count: attachments.length
    });
    res.json(article);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on :${config.port}`);
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
});
