const { config } = require('./config');

const userCache = new Map();
const stateCache = { fetchedAt: 0, items: [] };
const priorityCache = { fetchedAt: 0, items: [] };

function authHeaders() {
  if (config.zammad.authMode === 'session') {
    return { Cookie: config.zammad.sessionCookie };
  }

  return {
    Authorization: `Token token=${config.zammad.token}`,
  };
}

async function zammadFetch(path, options = {}) {
  const response = await fetch(`${config.zammad.url}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Zammad request failed: ${response.status} ${response.statusText} - ${text}`);
    error.status = response.status;
    throw error;
  }

  return response;
}

async function zammadJson(path, options = {}) {
  const response = await zammadFetch(path, options);
  return response.json();
}

async function getTicketStates(force = false) {
  const now = Date.now();
  if (!force && stateCache.items.length > 0 && now - stateCache.fetchedAt < 10 * 60 * 1000) {
    return stateCache.items;
  }

  stateCache.items = await zammadJson('/api/v1/ticket_states');
  stateCache.fetchedAt = now;
  return stateCache.items;
}

async function getTicketPriorities(force = false) {
  const now = Date.now();
  if (!force && priorityCache.items.length > 0 && now - priorityCache.fetchedAt < 10 * 60 * 1000) {
    return priorityCache.items;
  }

  priorityCache.items = await zammadJson('/api/v1/ticket_priorities');
  priorityCache.fetchedAt = now;
  return priorityCache.items;
}

async function getUserById(userId) {
  if (!Number.isInteger(userId) || userId <= 0) {
    return null;
  }

  if (userCache.has(userId)) {
    return userCache.get(userId);
  }

  try {
    const user = await zammadJson(`/api/v1/users/${userId}`);
    userCache.set(userId, user);
    return user;
  } catch (_error) {
    return null;
  }
}

async function getUsersByIds(userIds) {
  const uniqueIds = [...new Set(userIds.filter((item) => Number.isInteger(item) && item > 0))];
  const users = await Promise.all(uniqueIds.map((id) => getUserById(id)));
  return users.filter(Boolean);
}

function stateMapFrom(states) {
  return new Map(states.map((state) => [state.id, state]));
}

function priorityMapFrom(priorities) {
  return new Map(priorities.map((priority) => [priority.id, priority]));
}

function queueGroupMap() {
  return new Map(config.powerdns.queueGroups.map((queue) => [queue.key, queue]));
}

function resolveActiveGroupIds(queueKey) {
  const queue = queueGroupMap().get(queueKey || 'all');
  if (queue && queue.groupIds.length > 0) {
    return queue.groupIds;
  }

  return config.powerdns.groupIds;
}

function queueLabelForGroupId(groupId) {
  const queue = config.powerdns.queueGroups.find((entry) => entry.key !== 'all' && entry.groupIds.includes(groupId));
  return queue?.label || config.powerdns.groupName;
}

function queueKeyForGroupId(groupId) {
  const queue = config.powerdns.queueGroups.find((entry) => entry.key !== 'all' && entry.groupIds.includes(groupId));
  return queue?.key || 'all';
}

function buildTicketSearchQuery(searchTerm, queueKey) {
  const fragments = [];
  const activeGroupIds = resolveActiveGroupIds(queueKey);

  if (activeGroupIds.length > 0) {
    fragments.push(`(${activeGroupIds.map((id) => `group_id:${id}`).join(' OR ')})`);
  }

  if (searchTerm) {
    const trimmed = String(searchTerm).trim();
    const numericSearch = Number.parseInt(trimmed, 10);
    if (Number.isInteger(numericSearch) && String(numericSearch) === trimmed) {
      fragments.push(`(number:${numericSearch} OR id:${numericSearch})`);
    } else {
      const escaped = trimmed.replace(/"/g, '\\"');
      fragments.push(`title:"${escaped}"`);
    }
  }

  return fragments.join(' AND ');
}

async function listPowerDnsTickets(searchTerm = '', queueKey = 'all') {
  const limit = config.powerdns.ticketListLimit;
  const activeGroupIds = resolveActiveGroupIds(queueKey);
  const query = buildTicketSearchQuery(searchTerm, queueKey);

  let tickets;
  try {
    const path = query
      ? `/api/v1/tickets/search?query=${encodeURIComponent(query)}&limit=${limit}`
      : `/api/v1/tickets?per_page=${limit}`;
    tickets = await zammadJson(path);
  } catch (_error) {
    tickets = await zammadJson(`/api/v1/tickets?per_page=${limit}`);
  }

  const [states, priorities] = await Promise.all([getTicketStates(), getTicketPriorities()]);
  const statesById = stateMapFrom(states);
  const prioritiesById = priorityMapFrom(priorities);

  const filtered = (Array.isArray(tickets) ? tickets : []).filter((ticket) => {
    const stateName = String(statesById.get(ticket.state_id)?.name || '').toLowerCase();

    if (activeGroupIds.length > 0 && !activeGroupIds.includes(ticket.group_id)) {
      return false;
    }

    if (config.powerdns.organizationIds.length > 0 && !config.powerdns.organizationIds.includes(ticket.organization_id)) {
      return false;
    }

    if (
      config.powerdns.organizationIds.length === 0 &&
      config.powerdns.customerIds.length > 0 &&
      !config.powerdns.customerIds.includes(ticket.customer_id)
    ) {
      return false;
    }

    if (searchTerm) {
      const normalizedSearch = searchTerm.trim().toLowerCase();
      const matchesNumber = String(ticket.number || '').toLowerCase().includes(normalizedSearch);
      const matchesTitle = String(ticket.title || '').toLowerCase().includes(normalizedSearch);
      if (!matchesNumber && !matchesTitle) {
        return false;
      }
    }

    return !config.powerdns.openStateExclusions.includes(stateName);
  });

  const users = await getUsersByIds(filtered.flatMap((ticket) => [ticket.owner_id, ticket.customer_id]));
  const usersById = new Map(users.map((user) => [user.id, user]));

  return filtered.map((ticket) => ({
    ...ticket,
    queue_key: queueKeyForGroupId(ticket.group_id),
    queue_label: queueLabelForGroupId(ticket.group_id),
    state_name: statesById.get(ticket.state_id)?.name || `State #${ticket.state_id}`,
    priority_name: prioritiesById.get(ticket.priority_id)?.name || `Priority #${ticket.priority_id}`,
    customer: usersById.get(ticket.customer_id) || null,
    owner: usersById.get(ticket.owner_id) || null,
  }));
}

async function getTicket(ticketId) {
  const [ticket, articles, states, priorities] = await Promise.all([
    zammadJson(`/api/v1/tickets/${ticketId}`),
    zammadJson(`/api/v1/ticket_articles/by_ticket/${ticketId}`),
    getTicketStates(),
    getTicketPriorities(),
  ]);

  const users = await getUsersByIds([
    ticket.owner_id,
    ticket.customer_id,
    ...articles.flatMap((article) => [article.created_by_id, article.updated_by_id, article.origin_by_id]),
  ]);

  const usersById = new Map(users.map((user) => [user.id, user]));
  const statesById = stateMapFrom(states);
  const prioritiesById = priorityMapFrom(priorities);

  return {
    ...ticket,
    state_name: statesById.get(ticket.state_id)?.name || `State #${ticket.state_id}`,
    priority_name: prioritiesById.get(ticket.priority_id)?.name || `Priority #${ticket.priority_id}`,
    customer: usersById.get(ticket.customer_id) || null,
    owner: usersById.get(ticket.owner_id) || null,
    articles: articles.map((article) => ({
      ...article,
      created_by_user: usersById.get(article.created_by_id) || null,
      updated_by_user: usersById.get(article.updated_by_id) || null,
    })),
  };
}

async function updateTicket(ticketId, payload) {
  return zammadJson(`/api/v1/tickets/${ticketId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

function fileToAttachment(file) {
  return {
    filename: file.originalname,
    data: file.buffer.toString('base64'),
    'mime-type': file.mimetype || 'application/octet-stream',
  };
}

function extractEmails(value) {
  if (!value) {
    return [];
  }

  const normalized = Array.isArray(value) ? value.join(',') : String(value);
  const matches = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  return matches ? [...new Set(matches.map((item) => item.toLowerCase()))] : [];
}

function uniqueEmails(...groups) {
  return [...new Set(groups.flat().filter(Boolean))];
}

function replyRecipientsFromArticle(article, fallbackCustomerEmail) {
  const customerEmail = extractEmails(fallbackCustomerEmail);
  if (!article) {
    return {
      to: customerEmail[0] || null,
      cc: [],
    };
  }

  const sender = String(article.sender || '').toLowerCase();
  const from = extractEmails(article.from);
  const to = extractEmails(article.to);
  const cc = extractEmails(article.cc);

  if (sender === 'customer') {
    const recipients = uniqueEmails(from, cc, customerEmail);
    return {
      to: recipients[0] || null,
      cc: recipients.slice(1),
    };
  }

  const recipients = uniqueEmails(to, cc, customerEmail, from);
  return {
    to: recipients[0] || null,
    cc: recipients.slice(1),
  };
}

function latestCustomerVisibleArticle(articles) {
  return [...articles]
    .filter((article) => !article.internal)
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0] || null;
}

async function addArticle(ticketId, articlePayload, files = []) {
  const payload = {
    ...articlePayload,
    ticket_id: ticketId,
  };

  if (payload.type === 'email') {
    const ticket = await getTicket(ticketId);
    const latestArticle = latestCustomerVisibleArticle(ticket.articles || []);
    const recipients = replyRecipientsFromArticle(latestArticle, ticket.customer?.email);

    if (!recipients.to) {
      const error = new Error('Unable to determine a valid customer recipient from the latest visible update.');
      error.status = 422;
      throw error;
    }

    payload.to = recipients.to;
    if (recipients.cc.length > 0) {
      payload.cc = recipients.cc.join(', ');
    }
  }

  if (files.length > 0) {
    payload.attachments = files.map(fileToAttachment);
  }

  return zammadJson('/api/v1/ticket_articles', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

async function getLookups() {
  const [states, priorities] = await Promise.all([getTicketStates(), getTicketPriorities()]);
  return {
    states: states.map((state) => ({ id: state.id, name: state.name })),
    priorities: priorities.map((priority) => ({ id: priority.id, name: priority.name })),
    owners: config.powerdns.ownerOptions,
    defaultOwnerId: config.powerdns.defaultOwnerId,
    queues: config.powerdns.queueGroups.map((queue) => ({
      key: queue.key,
      label: queue.label,
    })),
  };
}

async function getAttachment(ticketId, articleId, attachmentId, view = 'download') {
  const response = await zammadFetch(`/api/v1/ticket_attachment/${ticketId}/${articleId}/${attachmentId}?view=${encodeURIComponent(view)}`);
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
}

module.exports = {
  addArticle,
  getAttachment,
  getLookups,
  getTicket,
  listPowerDnsTickets,
  updateTicket,
};
